// Launches the NetProbe2 command, then returns WITHOUT exiting: execCommand
// only sets a flag, and the command starts once the call stack is clean.
// Run as: MoI.exe "<this file>" /showwindow

var DIR = '<scratch folder>\\moiprobe\\';

var lines = [];

function rec( k, v ) { lines.push( k + ' = ' + v ); }

function flush()
{
    try
    {
        var s = moi.filesystem.openFileStream( DIR + 'probe2-cmdlauncher.txt', 'w' );
        if ( s ) { s.writeLine( lines.join( '\n' ) ); if ( s.close ) s.close(); }
    }
    catch ( e ) { }
}

rec( 'appdata NetProbe2.js exists',
     moi.filesystem.fileExists( '%USERPROFILE%\\AppData\\Roaming\\Moi\\commands\\NetProbe2.js' ) );
rec( 'getCommandsDir', moi.filesystem.getCommandsDir() );
rec( 'getAppDataDir', moi.filesystem.getAppDataDir() );
flush();

try
{
    rec( 'execCommand', 'calling NetProbe2' );
    flush();
    moi.command.execCommand( 'NetProbe2' );
    rec( 'execCommand', 'returned without throwing' );
}
catch ( e )
{
    rec( 'execCommand', 'THREW: ' + e );
}

flush();
