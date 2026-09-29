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
 * The README says the same thing to the user under "Factory quirks". Reword one, reword both;
 * a test checks they still name the same inputs.
 */
export const FACTORY_POINT_NOTE =
  "Some primitive factories need their point input, not the number: cylinder and cone " +
  "ignore Height (input 5) unless End pt (input 4) is set, and give a flat circle " +
  "instead of a solid, so check the output's type before using it in a boolean. ";

/** MoI host behaviour the bridge cannot change, one bullet per trap. */
const TRAPS_NOTE =
  "\nMoI scripting traps:\n" +
  [
    "Undeclared globals (X = …) persist between calls; var declarations do not.",
    "Host objects do not enumerate: learn an API from moi_factory_help (a factory name, or " +
      "'object', 'edge' or 'style' for the object surface) or MoI's own command scripts (the " +
      "commands folder of MoI's install folder), not by listing properties.",
    "Pass object inputs to a factory as moi.geometryDatabase.createObjectList() plus addObject; " +
      "with moi.createList() the factory commits nothing.",
    "A factory's commit() return value means nothing either way: planarsrf returns falsy while " +
      "succeeding. Count results by capture or a document diff.",
    "getCreatedObjects() is empty after commit() for move, rotateaxis and polyline: use capture " +
      "and read created[].id.",
    "extrude and loft leave their profile curves in place (delete them); join consumes its inputs.",
    "join over unconnected surfaces returns one object per connected group, so there is no need " +
      "to group first, and the count of results is a (destructive) connectivity test.",
    "Where a factory takes an object list, pass the whole list in one call: one planarsrf over " +
      "2,830 curves took 2.2 s against 50.8 s for one call per curve, and a per-item loop slows " +
      "as the document grows.",
    "createFrame(origin, xAxis, yAxis) needs all three arguments; its normal (xAxis × yAxis) " +
      "sets the direction of extrude and box, so a cutter extruded the wrong way misses the part " +
      "(boolean() then warns).",
    "box accepts a rotated frame, so an oriented box needs no separate rotate.",
    "A fillet radius of half the height or more on a thin cylinder splits it into two objects.",
    "A bare boolean factory leaves its results unnamed and may change their style; boolean() " +
      "restores both.",
    "Keep gaps of 0.5 mm or more between parallel faces: booleanintersection of solids about " +
      "0.1 mm apart returns a bogus object instead of nothing.",
    "To test two solids for intersection without consuming them, set up booleanintersection, " +
      "call update(), read getCreatedObjects().length, then cancel(); filter pairs by bounding " +
      "box first and run at most about 25 tests per call, since more runs past the timeout and " +
      "blocks MoI.",
    "getBoundingBox() on a NURBS curve (or a brep made from one) is the control-hull box; sample " +
      "evaluatePoint(t) for the real extent.",
    "rotateaxis by +θ then −θ restores parts to within about 3e-5 mm, keeping names and styles, " +
      "so untilt, build, re-tilt is safe.",
    "isClosed works on curves and edges but is undefined on a brep; a solid is closed when " +
      "getNakedEdges().length === 0 (or use isSolidBRep).",
    "obj.selected is writable per object and works while a selection lock is held.",
    "Mesh data enters through moi.geometryDatabase.fileImportSubD(path). fileImport ignores a " +
      "quad OBJ silently. fileImportSubD returns null even on success.",
    "fileImportSubD imports all of a file or nothing: one bad component loses every other one. " +
      "Check the object count afterwards; put independent pieces in separate files if a partial " +
      "result is better than none.",
    "moi.filesystem.openFileStream(path, 'r') reads; readLine() is the only reader and handles " +
      "long lines. On a missing file it still returns a stream and readLine() returns '': check " +
      "moi.filesystem.fileExists first.",
    "moi.command.execCommand on a command with a UI returns normally and runs nothing; the " +
      "command panel is out of a script's reach.",
  ]
    .map((t) => `- ${t}\n`)
    .join("");

/** The helpers moi_eval preloads, in full. moi_eval's own description only names them. */
const HELPERS_NOTE =
  "faces(obj) and edges(obj) list an object's faces or edges as { index, bbox } in " +
  "getFaces()/getEdges() order; filter the rows yourself and get the item back with " +
  "obj.getEdges().item(row.index), e.g. to chamfer it. " +
  "For booleans use boolean(kind, targets, tools): kind is 'difference', 'union' or " +
  "'intersection', targets and tools are ids or objects, one or an array (a union takes " +
  "them all as targets). It runs the factory through capture and returns its record with " +
  "every result in created, named and styled like the first target, and warns when a " +
  "difference or union left the face count unchanged (the cutter most likely missed), a " +
  "union left separate objects, or nothing was created. An empty intersection is not a warning. " +
  "capture(fn) returns { result, created, consumed }: created describes the new objects and " +
  "consumed lists the ids that are gone. Capture warns about a fillet, chamfer or shell too " +
  "large for the geometry, which MoI commits without any error. " +
  "A live object has no isSolid (it reads undefined): test a closed solid with " +
  "obj.isSolidBRep, or read toJson(obj).isSolid. " +
  "MoI runs ECMAScript 5 only: no let/const, no arrow functions, no Promise, no fetch. " +
  "Objects are addressed by their `id` — a brace-wrapped GUID — and resolved with " +
  "moi.geometryDatabase.findObject( id ). An object's id changes whenever an operation " +
  "consumes it (a move, a fillet and a boolean all produce new objects with new ids), so " +
  "read the ids back out of the result rather than reusing the ones you sent.";

/**
 * Hand-written notes on the object surface, confirmed against live MoI. Host objects
 * enumerate nothing, so these names are the only reference there is. Served locally.
 */
export const REFERENCE: Record<string, string> = {
  traps: FACTORY_POINT_NOTE + TRAPS_NOTE,
  helpers: HELPERS_NOTE,
  object:
    "Objects (from getObjects(), findById or capture) list nothing: for (k in obj) is empty on " +
    "a working object, so this is the member list. id, type; name (writable string); " +
    "styleIndex (writable number, see 'style'); selected (writable boolean, and it still " +
    "works while a selection lock is held); isSolidBRep; getEdges(), getFaces(), " +
    "getNakedEdges() (lists with length and item(i)); getBoundingBox(). isClosed is for " +
    "curves and edges only: on a brep it is undefined, so test a solid with " +
    "obj.getNakedEdges().length === 0.",
  edge:
    "Edges (obj.getEdges().item(i)) enumerate nothing either. An edge has no face1 " +
    "(undefined), and edge.getFaces() throws. isClosed works on edges and curves.",
  style:
    "moi.geometryDatabase.getObjectStyles() lists the document's styles, each with name " +
    "and color; a fresh document has 7, Default first (index 0). moi.objectStyles is " +
    "undefined. Put an object on a style with obj.styleIndex = i. The list has add, but no " +
    "working signature is known: add(name), add(name, color) and add(style) all return " +
    "null and add nothing, so use one of the existing styles or object names instead.",
};

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
      reference: Object.keys(REFERENCE),
      note:
        "numInputs is the count at creation time; the curve family starts at 0 and grows " +
        "as createInput is called. Call this tool with a name for worked examples from " +
        "MoI's own scripts. Factories listed under handProbed have notes here because " +
        "MoI's scripts document them only indirectly. The names under reference are not " +
        "factories: call this tool with one for the moi_eval helpers, MoI's host traps, and " +
        "notes on objects, edges and styles, whose members cannot be listed from a script.",
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
    "own scripts do not document. The names 'helpers' and 'traps' answer with the moi_eval " +
    "helper API and MoI's host traps; 'object', 'edge' and 'style' answer with notes on " +
    "the object surface (members, edges, faces, styles), since host objects cannot list " +
    "their own members.",
  input: {
    name: z
      .string()
      .optional()
      .describe(
        "Factory name, e.g. 'loft', or 'helpers', 'traps', 'object', 'edge' or 'style' for reference notes. " +
          "Omit to list every known factory.",
      ),
    full: z
      .boolean()
      .optional()
      .describe("Return the complete source of each matching command script."),
  },
  direct: true,
  annotations: READ_ONLY,
  // Needs no MoI, but `runTool` still reports a server conflict: the user has to hear about it.
  local: ({ name }) => {
    if (!name) return [{ type: "text", text: factoryIndex() }];
    if (Object.hasOwn(REFERENCE, name)) return [{ type: "text", text: REFERENCE[name] }];
    return undefined;
  },
  script: ({ name, full }) => factoryHelp(name ?? "", full === true),
};
