// config: norepeat
// Probe 2 command body. The real work happens in NetProbe2.htm, which loads as
// this command's UI page. This side just keeps the command alive on the event
// loop long enough for the page's asynchronous work to finish, by waiting on an
// object picker the way every stock MoI command does.

var PDIR = '<scratch folder>\\moiprobe\\';

function NetProbe2()
{
	try
	{
		var s = moi.filesystem.openFileStream( PDIR + 'probe2-command-ran.txt', 'w' );
		if ( s )
		{
			var ui = 'none';
			try { ui = typeof moi.ui.commandUI; }
			catch ( e ) { ui = 'commandUI THREW: ' + e; }
			s.writeLine( 'NetProbe2.js ran. commandUI = ' + ui );
			if ( s.close ) s.close();
		}
	}
	catch ( e ) { }

	// Park on the event loop. The page calls moi.exit() when it is done.
	try
	{
		var picker = moi.ui.createObjectPicker();
		while ( 1 )
		{
			if ( !picker.waitForEvent() )
				break;
			if ( picker.event == 'done' || picker.event == 'finished' )
				break;
		}
	}
	catch ( e ) { }
}

NetProbe2();
