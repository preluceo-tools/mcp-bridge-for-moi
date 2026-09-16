import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { APP_DATA_DIR } from "../scripts.js";
import { READ_ONLY, type Tool } from "../tool.js";

type Args = { name?: string; full?: boolean };

export const FACTORIES: {
  _moiVersion: string;
  factories: Record<string, number>;
  notes: Record<string, string>;
} = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "factories.json"), "utf8"),
);

/**
 * The bundled factory list, plus a gap report. Answers without a MoI session, which is
 * why it is served locally rather than from the bridge.
 */
function factoryIndex(): string {
  const names = Object.keys(FACTORIES.factories).sort();
  const documented = Object.keys(FACTORIES.notes);
  return JSON.stringify(
    {
      moiVersion: FACTORIES._moiVersion,
      count: names.length,
      factories: FACTORIES.factories,
      handProbed: documented,
      note:
        "numInputs is the count at creation time; the curve family starts at 0 and grows " +
        "as createInput is called. Call this tool with a name for worked examples from " +
        "MoI's own scripts. Factories listed under handProbed have notes here because " +
        "MoI's scripts document them only indirectly.",
    },
    null,
    2,
  );
}

/**
 * Finds what a factory's inputs are by searching MoI's own command scripts.
 *
 * MoI documents its factories by example: nearly every one has a stock command that
 * calls it. Two things make this harder than a grep for `createFactory('name')`:
 *
 *  - Several factories are driven from a shared helper with the name passed as a
 *    parameter (`DoScale( 'scale1d', … )`), so the search is for the name as a string
 *    anywhere in the folder.
 *  - The helper holding the actual `setInput` calls is pulled in with MoI's own
 *    `#include "DoScale.js"`, so a hit's includes are followed one level.
 */
function factoryHelp(name: string, full: boolean): string {
  return `
var fs = moi.filesystem;
var wanted = ${JSON.stringify(name)};
var full = ${full ? "true" : "false"};
var NL = String.fromCharCode( 10 );
${APP_DATA_DIR}
var dirs = [ fs.getCommandsDir(), appDataDir() + 'commands' ];

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
var TYPES = { 1: 'point', 2: 'frame', 3: 'bool', 4: 'number', 5: 'int/enum', 6: 'string', 7: 'object', 8: 'objects' };
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
	note: ${JSON.stringify(FACTORIES.notes[name] ?? null)},
	filesFound: hits.length,
	hits: hits
};
`;
}

export const moiFactoryHelpTool: Tool<Args, unknown> = {
  name: "moi_factory_help",
  description:
    "Look up how to drive a MoI factory. With a name, searches MoI's own command " +
    "scripts for working examples and returns the setInput/createInput lines with " +
    "their indices, plus the factory's numInputs and any hand-probed note (null when " +
    "there is none) — this is how you learn a factory's " +
    "positional inputs, which are otherwise undocumented. Pass full:true for the " +
    "complete source when an index is passed as an argument rather than written " +
    "literally. With no name, lists all known factories and reports any that MoI's " +
    "own scripts do not document.",
  input: {
    name: z
      .string()
      .optional()
      .describe("Factory name, e.g. 'loft'. Omit to list every known factory."),
    full: z
      .boolean()
      .optional()
      .describe("Return the complete source of each matching command script."),
  },
  direct: true,
  annotations: READ_ONLY,
  // Needs no MoI, but `runTool` still reports a server conflict: the user has to hear about it.
  local: ({ name }) => (name ? undefined : [{ type: "text", text: factoryIndex() }]),
  script: ({ name, full }) => factoryHelp(name ?? "", full === true),
};
