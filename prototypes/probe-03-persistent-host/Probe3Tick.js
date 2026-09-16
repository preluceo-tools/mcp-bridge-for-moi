// Probe 3 / question C, decisive test: does anything opened from a startup
// script keep running after the script returns, with MoI idle and no command
// active? Install as <MoI app data>\startup\Probe3Tick.js.
//
// Two candidate hosts are tried at once:
//   A. a hidden dialog page created with moi.ui.createDialog( 'moi://commands/...' )
//   B. the side pane's own long-lived window, reached as moi.ui.sidePane.window
// Each writes a tick file of its own, so a missing file is unambiguous.

var DIR = moi.filesystem.getAppDataDir();
var lines = [];
function rec( k, v ) { lines.push( k + ' = ' + v ); }
function safe( k, fn ) { try { rec( k, fn() ); } catch ( e ) { rec( k, 'THREW: ' + e ); } }

function writeOut( tag )
{
    try
    {
        var s = moi.filesystem.openFileStream( DIR + 'probe3-tick.txt', 'w' );
        if ( s ) { s.writeLine( ['# probe 3 - persistence test (' + tag + ')'].concat( lines ).join( '\n' ) ); if ( s.close ) s.close(); }
    }
    catch ( e ) { }
}

// ---- A. hidden dialog page. Kept in a global so it is not collected. -----
g_probe3Dialog = null;
safe( 'createDialog', function ()
{
    g_probe3Dialog = moi.ui.createDialog( 'moi://commands/Probe3Tick.htm', '', moi.ui.mainWindow );
    return typeof g_probe3Dialog;
} );
safe( 'dialog.htmlWindow', function () { return typeof g_probe3Dialog.htmlWindow; } );

// ---- B. the side pane's live window --------------------------------------
var spw = null;
safe( 'sidePane.window', function () { spw = moi.ui.sidePane.window; return typeof spw; } );
if ( spw )
{
    safe( 'sidePane.window.setTimeout', function () { return typeof spw.setTimeout; } );
    safe( 'sidePane.window.XMLHttpRequest', function () { return typeof spw.XMLHttpRequest; } );
    safe( 'sidePane.window.WebSocket', function () { return typeof spw.WebSocket; } );
    safe( 'sidePane.window.location.href', function () { return spw.location.href; } );

    // Schedule a repeating tick INTO the side pane's window. If these keep
    // firing after this script returns, the side pane is a persistent host.
    safe( 'sidePane timer', function ()
    {
        var t0 = ( new Date() ).getTime();
        var n = 0;
        var tick = function ()
        {
            n++;
            var dt = ( new Date() ).getTime() - t0;
            try
            {
                var s = moi.filesystem.openFileStream( DIR + 'probe3-sidepane-ticks.txt', 'w' );
                if ( s ) { s.writeLine( 'ticks = ' + n + '\nelapsed_ms = ' + dt ); if ( s.close ) s.close(); }
            }
            catch ( e ) { }
            if ( dt < 40000 ) spw.setTimeout( tick, 1000 );
        };
        spw.setTimeout( tick, 1000 );
        return 'scheduled';
    } );

    // And a WebSocket constructed from the side pane's window object.
    safe( 'sidePane WebSocket', function ()
    {
        g_probe3Sock = new spw.WebSocket( 'ws://127.0.0.1:8765/sidepane' );
        return 'constructed, readyState=' + g_probe3Sock.readyState;
    } );
}

writeOut( 'final' );
