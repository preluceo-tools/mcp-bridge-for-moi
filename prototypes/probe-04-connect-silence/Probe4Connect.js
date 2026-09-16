// Probe 4 / question: can a failed WebSocket connect from the side-pane window
// be made silent? Install as <MoI app data>\startup\Probe4Connect.js.
//
// One case per MoI launch. The harness writes the case into
// <MoI app data>\probe4-case.txt as a single line:
//     <clientmode> <url>
// clientmode is one of:
//     naive     - construct, then assign onopen/onerror/onclose
//     guarded   - install window.onerror returning true first, then construct
//     deferred  - same as naive, but scheduled inside the side pane's setTimeout
//     both      - guarded AND deferred
// Everything runs in moi.ui.sidePane.window, the host probe 03 recommended.

var DIR = moi.filesystem.getAppDataDir();
var OUT = DIR + 'probe4-result.txt';

var lines = [];
function rec( k, v ) { lines.push( k + ' = ' + v ); }

function writeOut()
{
    try
    {
        var s = moi.filesystem.openFileStream( OUT, 'w' );
        if ( s ) { s.writeLine( lines.join( '\n' ) ); if ( s.close ) s.close(); }
    }
    catch ( e ) { }
}

// ---- read the case ------------------------------------------------------
var clientmode = 'naive', url = 'ws://127.0.0.1:59999/none';
try
{
    var r = moi.filesystem.openFileStream( DIR + 'probe4-case.txt', 'r' );
    if ( r )
    {
        var line = r.readLine();
        if ( r.close ) r.close();
        if ( line )
        {
            line = line.replace( /^\s+|\s+$/g, '' );
            var sp = line.indexOf( ' ' );
            if ( sp > 0 ) { clientmode = line.substring( 0, sp ); url = line.substring( sp + 1 ); }
        }
    }
}
catch ( e ) { rec( 'case read', 'THREW: ' + e ); }

rec( '# probe 4', 'clientmode=' + clientmode + ' url=' + url );

var spw = moi.ui.sidePane.window;
rec( 'sidePane.window', typeof spw );
rec( 'sidePane href', spw.location.href );

var t0 = ( new Date() ).getTime();
function ev( what ) { rec( '+' + ( ( new Date() ).getTime() - t0 ) + 'ms', what ); writeOut(); }

// ---- optional window.onerror trap, the standard WebKit idiom -------------
if ( clientmode == 'guarded' || clientmode == 'both' )
{
    try
    {
        spw.onerror = function ( msg, src, ln ) { ev( 'window.onerror: ' + msg + ' @' + src + ':' + ln ); return true; };
        rec( 'window.onerror installed', 'yes (returns true)' );
    }
    catch ( e ) { rec( 'window.onerror installed', 'THREW: ' + e ); }

    try
    {
        spw.addEventListener( 'error', function ( e ) { ev( 'addEventListener error fired' ); if ( e && e.preventDefault ) e.preventDefault(); return true; }, true );
        rec( 'addEventListener error', 'installed' );
    }
    catch ( e ) { rec( 'addEventListener error', 'THREW: ' + e ); }
}

g_probe4Sock = null;
g_probe4All  = [];      // every socket ever made, so a retry run can be watched

function connect( tag )
{
    tag = tag || '';
    try
    {
        var ws = new spw.WebSocket( url );
        g_probe4Sock = ws;
        g_probe4All.push( ws );

        // handlersfirst: bind onerror/onclose before ANY other property is
        // touched -- not even readyState is read first.
        if ( clientmode == 'handlersfirst' )
        {
            ws.onerror = function () { ev( tag + 'onerror fired (bound first)' ); };
            ws.onclose = function ( c ) { ev( tag + 'onclose fired (bound first), code=' + ( c ? c.code : '?' ) ); };
            ev( tag + 'handlers bound BEFORE any other property touch' );
        }

        ev( tag + 'constructed, readyState=' + ws.readyState );

        ws.onopen    = function () { ev( tag + 'onopen, readyState=' + ws.readyState ); try { ws.send( 'hello from MoI side pane' ); ev( tag + 'sent' ); } catch ( e ) { ev( tag + 'send THREW: ' + e ); } };
        ws.onmessage = function ( m ) { ev( tag + 'onmessage: ' + m.data ); };
        if ( clientmode != 'handlersfirst' )
        {
            ws.onerror   = function () { ev( tag + 'onerror fired' ); };
            ws.onclose   = function ( c ) { ev( tag + 'onclose fired, code=' + ( c ? c.code : '?' ) + ' wasClean=' + ( c ? c.wasClean : '?' ) ); };
        }
        ev( tag + 'handlers assigned' );
    }
    catch ( e )
    {
        ev( tag + 'construction THREW: ' + e );
    }
}

// ---- retry loop, the shape the bridge actually wants --------------------
// Reconnects every RETRY_MS to a port nothing is listening on. Counts the
// boxes, and reports the readyState of every socket ever made so we can see
// whether dead attempts pile up in CONNECTING forever.
var RETRY_MS = 3000;
var attempts = 0;
function retryTick()
{
    attempts++;
    // teardown of the previous attempt, if the case asks for it
    if ( g_probe4Sock && ( clientmode == 'retryclose' ) )
    {
        try { g_probe4Sock.close(); ev( 'attempt ' + ( attempts - 1 ) + ' close() called, readyState=' + g_probe4Sock.readyState ); }
        catch ( e ) { ev( 'close() THREW: ' + e ); }
    }
    connect( 'attempt ' + attempts + ': ' );
    if ( attempts < 5 ) spw.setTimeout( retryTick, RETRY_MS );
}

// ---- XHR gate ------------------------------------------------------------
// If a failed XMLHttpRequest is silent where a failed WebSocket is not, the
// bridge can poll cheaply with XHR and only construct the socket once the MCP
// server has actually answered. Polls http:// on the same host/port as the ws
// URL. With no server up this must stay silent forever to be useful.
var probes = 0;
function xhrPoll()
{
    probes++;
    var httpUrl = url.replace( /^ws:/, 'http:' ).replace( /\/[^\/]*$/, '/ping' );
    try
    {
        var x = new spw.XMLHttpRequest();
        x.onreadystatechange = function ()
        {
            if ( x.readyState == 4 )
            {
                ev( 'xhr probe ' + probes + ' readyState=4 status=' + x.status );
                if ( x.status == 200 ) { ev( 'gate OPEN -> constructing WebSocket' ); connect( 'gated: ' ); return; }
                if ( probes < 8 ) spw.setTimeout( xhrPoll, 2000 );
            }
        };
        x.open( 'GET', httpUrl, true );
        x.send( null );
        ev( 'xhr probe ' + probes + ' sent to ' + httpUrl );
    }
    catch ( e )
    {
        ev( 'xhr probe ' + probes + ' THREW: ' + e );
        if ( probes < 8 ) spw.setTimeout( xhrPoll, 2000 );
    }
}

if ( clientmode == 'none' )
{
    // Control case: the whole probe harness runs, but no socket is ever made.
    // Any error box in this run belongs to the probe, not to the connect.
    rec( 'connect', 'SKIPPED (control case)' );
}
else if ( clientmode == 'xhrgate' )
{
    xhrPoll();
    rec( 'connect', 'gated behind an XHR poll every 2000ms, 8 attempts' );
}
else if ( clientmode == 'retry' || clientmode == 'retryclose' )
{
    retryTick();
    rec( 'connect', 'retry loop every ' + RETRY_MS + 'ms, 5 attempts, teardown=' + ( clientmode == 'retryclose' ? 'close() first' : 'none' ) );
}
else if ( clientmode == 'deferred' || clientmode == 'both' )
{
    spw.setTimeout( connect, 500 );
    rec( 'connect', 'deferred via sidePane.window.setTimeout(500)' );
}
else
{
    connect();
}

// Heartbeat, so the result file proves the page kept running to the end of the
// observation window whether or not a box appeared.
var beats = 0;
function beat()
{
    beats++;
    var states = 'none';
    if ( g_probe4All.length )
    {
        states = [];
        for ( var i = 0; i < g_probe4All.length; i++ )
        {
            try { states.push( g_probe4All[i].readyState ); } catch ( e ) { states.push( 'THREW' ); }
        }
        states = states.join( ',' );
    }
    rec( 'heartbeat', beats + ' at +' + ( ( new Date() ).getTime() - t0 ) + 'ms, readyState=' + ( g_probe4Sock ? g_probe4Sock.readyState : 'none' ) + ', allSockets=[' + states + ']' );
    // MoI keeps its own log; if the script-error text lands there we get it as
    // text instead of having to screenshot a modal box.
    if ( beats == 6 || beats == 15 )
    {
        try { rec( 'moi.getLog() at beat ' + beats, '<<<' + moi.getLog() + '>>>' ); }
        catch ( e ) { rec( 'moi.getLog()', 'THREW: ' + e ); }
    }
    writeOut();
    if ( beats < 20 ) spw.setTimeout( beat, 1000 );
}
spw.setTimeout( beat, 1000 );

writeOut();
