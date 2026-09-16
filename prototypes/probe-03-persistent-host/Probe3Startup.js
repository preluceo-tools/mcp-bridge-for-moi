// Probe 3 / question D: is <MoI app data>\startup\ executed at MoI launch, and
// in which JS context? Install as <MoI app data>\startup\Probe3Startup.js.
// Writes findings through moi.filesystem.openFileStream - there is no console.
// Output goes next to the MoI app data folder so the script needs no absolute
// path baked in (and no backslash escaping).

var DIR = moi.filesystem.getAppDataDir();
var OUT = DIR + 'probe3-startup-js.txt';

var lines = [];
function rec( k, v ) { lines.push( k + ' = ' + v ); }
function safe( k, fn ) { try { rec( k, fn() ); } catch ( e ) { rec( k, 'THREW: ' + e ); } }

function writeOut( tag )
{
    try
    {
        var s = moi.filesystem.openFileStream( OUT, 'w' );
        if ( s )
        {
            s.writeLine( ['# probe 3 - startup folder .js context (' + tag + ')'].concat( lines ).join( '\n' ) );
            if ( s.close ) s.close();
        }
    }
    catch ( e ) { }
}

rec( 'ran', 'yes - the startup folder IS executed' );
safe( 'moi.version', function () { return moi.version; } );
rec( 'typeof XMLHttpRequest', typeof XMLHttpRequest );
rec( 'typeof WebSocket', typeof WebSocket );
rec( 'typeof setTimeout', typeof setTimeout );
rec( 'typeof setInterval', typeof setInterval );
rec( 'typeof window', typeof window );
rec( 'typeof document', typeof document );
rec( 'typeof localStorage', typeof localStorage );
rec( 'typeof fetch', typeof fetch );
rec( 'typeof moi', typeof moi );
rec( 'typeof JSON', typeof JSON );
rec( 'typeof Promise', typeof Promise );
rec( 'typeof ActiveXObject', typeof ActiveXObject );
safe( 'moi.ui.commandUI', function () { return typeof moi.ui.commandUI; } );
safe( 'moi.ui.mainWindow', function () { return typeof moi.ui.mainWindow; } );
safe( 'moi.ui.mainWindow.htmlWindow', function () { return typeof moi.ui.mainWindow.htmlWindow; } );
safe( 'moi.ui.mainWindow.htmlDocument', function () { return typeof moi.ui.mainWindow.htmlDocument; } );
safe( 'moi.ui.sidePane', function () { return typeof moi.ui.sidePane; } );
safe( 'moi.ui.sidePane.htmlWindow', function () { return typeof moi.ui.sidePane.htmlWindow; } );
safe( 'moi.ui.getUIPanels', function () { return typeof moi.ui.getUIPanels; } );
safe( 'moi.ui.getUIPanel', function () { return typeof moi.ui.getUIPanel; } );
safe( 'moi.ui.createDialog', function () { return typeof moi.ui.createDialog; } );
safe( 'moi.command.currentCommandName', function () { return '[' + moi.command.currentCommandName + ']'; } );
safe( 'getAppDataDir', function () { return moi.filesystem.getAppDataDir(); } );
safe( 'getCommandsDir', function () { return moi.filesystem.getCommandsDir(); } );

writeOut( 'globals' );

// If timers exist here, do they still fire with MoI idle and no command running?
// Written to a separate file so a missing file is unambiguous.
if ( typeof setTimeout !== 'undefined' )
{
    var ticks = 0;
    var t0 = ( new Date() ).getTime();
    var tick = function ()
    {
        ticks++;
        var dt = ( new Date() ).getTime() - t0;
        try
        {
            var s = moi.filesystem.openFileStream( DIR + 'probe3-startup-ticks.txt', 'w' );
            if ( s ) { s.writeLine( 'ticks = ' + ticks + '\nelapsed_ms = ' + dt ); if ( s.close ) s.close(); }
        }
        catch ( e ) { }
        if ( dt < 40000 ) setTimeout( tick, 1000 );
    };
    setTimeout( tick, 1000 );
    rec( 'timer test', 'scheduled' );
    writeOut( 'timer-scheduled' );
}
