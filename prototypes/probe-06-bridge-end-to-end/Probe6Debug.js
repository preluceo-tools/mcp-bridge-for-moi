// Diagnostic: why did the bridge not dial in?
var out = null;
function w( s ) {
	try { out.writeLine( s ); } catch ( e ) {}
}
try {
	var dir = moi.filesystem.getAppDataDir();
	var sep = moi.filesystem.getPathDelimiter();
	var logPath = dir + ( dir.charAt( dir.length - 1 ) === sep ? '' : sep ) + 'probe6-debug.txt';
	out = moi.filesystem.openFileStream( logPath, 'w' );

	w( 'appDataDir = ' + dir );
	w( 'pathDelimiter = [' + sep + ']' );
	w( 'majorVersionNumber = ' + moi.majorVersionNumber + ' (typeof ' + typeof moi.majorVersionNumber + ')' );
	w( 'version = ' + moi.version );
	w( 'typeof moi.log = ' + typeof moi.log );

	var hs = dir + ( dir.charAt( dir.length - 1 ) === sep ? '' : sep ) + 'moi-mcp-handshake.json';
	w( 'handshakePath = ' + hs );
	w( 'fileExists = ' + moi.filesystem.fileExists( hs ) );

	try {
		var stream = moi.filesystem.openFileStream( hs, 'r' );
		w( 'openFileStream(r) = ' + typeof stream );
		w( 'typeof stream.readLine = ' + ( stream ? typeof stream.readLine : 'n/a' ) );
		if ( stream && typeof stream.readLine === 'function' ) {
			var text = '';
			var line = stream.readLine();
			var guard = 0;
			while ( line !== null && line !== undefined && guard < 50 ) {
				text += line;
				line = stream.readLine();
				guard++;
			}
			w( 'readLine loop iterations = ' + guard );
			w( 'raw text = [' + text + ']' );
			try {
				var parsed = JSON.parse( text );
				w( 'parsed port = ' + parsed.port + ' token length = ' + ( parsed.token ? parsed.token.length : 'none' ) );
			} catch ( pe ) {
				w( 'JSON.parse threw: ' + pe );
			}
		}
		if ( stream ) stream.close();
	} catch ( re ) {
		w( 'read threw: ' + re );
	}

	var sp = moi.ui.sidePane;
	w( 'typeof moi.ui.sidePane = ' + typeof sp );
	var win = sp ? sp.window : null;
	w( 'typeof sidePane.window = ' + typeof win );
	if ( win ) {
		w( 'href = ' + win.location.href );
		w( 'typeof win.WebSocket = ' + typeof win.WebSocket );
		w( 'typeof win.XMLHttpRequest = ' + typeof win.XMLHttpRequest );
		w( 'typeof win.setTimeout = ' + typeof win.setTimeout );
		w( 'typeof win.Function = ' + typeof win.Function );
	}
	w( 'DONE' );
	out.close();
} catch ( e ) {
	try {
		if ( out ) { out.writeLine( 'THREW: ' + e ); out.close(); }
	} catch ( e2 ) {}
}
