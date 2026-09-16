
var fs = moi.filesystem;
var wanted = "loft";
var full = false;
var NL = String.fromCharCode( 10 );

var dirs = [ fs.getCommandsDir(), fs.getAppDataDir() + 'commands' ];

// readLine gives no end-of-file signal at all: past the end it returns '' forever, and
// the stream has no size member to bound the read. Real scripts contain isolated blank
// lines, so stop after a long run of empties and trim the tail. Ten is well past
// anything in MoI's own scripts.
function readAll( path ) {
	var stream = fs.openFileStream( path, 'r' );
	if ( !stream ) return null;
	var lines = [];
	var guard = 0;
	var emptyRun = 0;
	while ( guard < 8000 ) {
		var line = stream.readLine();
		if ( line === null || line === undefined ) break;
		emptyRun = ( line === '' ) ? emptyRun + 1 : 0;
		if ( emptyRun > 10 ) break;
		lines.push( line );
		guard++;
	}
	stream.close();
	while ( lines.length && lines[ lines.length - 1 ] === '' ) lines.pop();
	return lines;
}

// No regular expressions anywhere in this generated script: the backslashes do not
// survive the trip through the template literal that builds it.
function trimLeft( s ) {
	var i = 0;
	while ( i < s.length && ( s.charAt( i ) === ' ' || s.charCodeAt( i ) === 9 ) ) i++;
	return s.substring( i );
}

function interestingLines( lines ) {
	var out = [];
	for ( var k = 0; k < lines.length; ++k ) {
		var L = lines[k];
		if ( L.indexOf( 'setInput' ) !== -1 || L.indexOf( 'getInput' ) !== -1 ||
		     L.indexOf( 'createInput' ) !== -1 || L.indexOf( 'addToListInput' ) !== -1 ||
		     L.indexOf( 'createFactory' ) !== -1 || L.indexOf( "'" + wanted + "'" ) !== -1 ) {
			out.push( ( k + 1 ) + ': ' + trimLeft( L ) );
		}
	}
	return out;
}

function findIncludes( lines ) {
	var names = [];
	for ( var k = 0; k < lines.length; ++k ) {
		var at = lines[k].indexOf( '#include' );
		if ( at === -1 ) continue;
		var q1 = lines[k].indexOf( '"', at );
		if ( q1 === -1 ) continue;
		var q2 = lines[k].indexOf( '"', q1 + 1 );
		if ( q2 === -1 ) continue;
		names.push( lines[k].substring( q1 + 1, q2 ) );
	}
	return names;
}

var hits = [];
var seen = {};

for ( var d = 0; d < dirs.length; ++d ) {
	var files;
	try { files = fs.getFiles( dirs[d], '*.js' ); } catch ( e ) { continue; }
	if ( !files || !files.length ) continue;

	for ( var i = 0; i < files.length; ++i ) {
		var path = files.item( i );
		var name = fs.getFileNameFromPath( path );
		if ( seen[name] ) continue;

		var lines = readAll( path );
		if ( !lines ) continue;
		var text = lines.join( NL );
		if ( text.indexOf( "'" + wanted + "'" ) === -1 ) continue;
		seen[name] = true;

		var hit = { file: name, lines: interestingLines( lines ), via: [] };
		if ( full ) hit.source = text;

		// The setInput calls often live in an included helper, not here.
		var includes = findIncludes( lines );
		for ( var n = 0; n < includes.length; ++n ) {
			var ipath = dirs[d] + ( dirs[d].charAt( dirs[d].length - 1 ) === fs.getPathDelimiter() ? '' : fs.getPathDelimiter() ) + includes[n];
			if ( !fs.fileExists( ipath ) ) continue;
			var ilines = readAll( ipath );
			if ( !ilines ) continue;
			var entry = { file: includes[n], lines: interestingLines( ilines ) };
			if ( full ) entry.source = ilines.join( NL );
			hit.via.push( entry );
		}
		hits.push( hit );
	}
}

// The authoritative answer: factory inputs describe themselves. Every input has a
// human name and a type code, so this works for all 110 factories whether or not any
// stock script happens to use them. The file search above only adds worked context.
var TYPES = { 1: 'point', 2: 'frame', 3: 'bool', 4: 'number', 5: 'int/enum', 6: 'string', 8: 'objects' };
var inputs = null;
var numInputs = null;
try {
	var f = moi.command.createFactory( wanted );
	numInputs = f.numInputs;
	inputs = [];
	for ( var q = 0; q < f.numInputs; ++q ) {
		var inp = f.getInput( q );
		var t = inp.type;
		inputs.push( { index: q, name: inp.name, type: ( TYPES[t] || ( 'type' + t ) ) } );
	}
} catch ( e ) {
	numInputs = 'no such factory';
}

return {
	factory: wanted,
	numInputs: numInputs,
	inputs: inputs,
	filesFound: hits.length,
	hits: hits
};
