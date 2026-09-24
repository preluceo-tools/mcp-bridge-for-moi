import { z } from "zod";
import { asJson, DESTRUCTIVE, type Tool } from "../tool.js";

const ES5_NOTE =
  "MoI runs ECMAScript 5 only: no let/const, no arrow functions, no Promise, no fetch. " +
  "Objects are addressed by their `id` — a brace-wrapped GUID — and resolved with " +
  "moi.geometryDatabase.findObject( id ). An object's id changes whenever an operation " +
  "consumes it (a move, a fillet and a boolean all produce new objects with new ids), so " +
  "read the ids back out of the result rather than reusing the ones you sent.";

/**
 * The README says the same thing to the user under "Factory quirks". Reword one, reword both;
 * a test checks they still name the same inputs.
 */
export const FACTORY_POINT_NOTE =
  "Some primitive factories need their point input, not the number: cylinder and cone " +
  "ignore Height (input 5) unless End pt (input 4) is set, and give a flat circle " +
  "instead of a solid, so check the output's type before using it in a boolean. ";

/** MoI host behaviour the bridge cannot change, one clause per trap. */
const TRAPS_NOTE =
  "MoI scripting traps: Undeclared globals (X = …) persist between calls; var declarations " +
  "do not. Host objects do not enumerate: learn an API from moi_factory_help or MoI's own " +
  "command scripts (the commands folder of MoI's install folder), not by listing properties. " +
  "Pass object inputs to a factory as moi.geometryDatabase.createObjectList() plus addObject; " +
  "with moi.createList() the factory commits nothing. getCreatedObjects() is empty after " +
  "commit() for move, rotateaxis and polyline: use capture and read created[].id. extrude and " +
  "loft leave their profile curves in place (delete them); join consumes its inputs. " +
  "createFrame(origin, xAxis, yAxis) needs all three arguments; its normal (xAxis × yAxis) " +
  "sets the direction of extrude and box, so a cutter extruded the wrong way misses the part " +
  "(boolean() then warns). box accepts a rotated frame, so an oriented box needs no separate " +
  "rotate. A fillet radius of half the height or more on a thin cylinder splits it into two " +
  "objects. A bare boolean factory leaves its results unnamed and may change their style; " +
  "boolean() restores both. Keep gaps of 0.5 mm or more between parallel faces: " +
  "booleanintersection of solids about 0.1 mm apart returns a bogus object instead of nothing. " +
  "To test two solids for intersection without consuming them, set up booleanintersection, " +
  "call update(), read getCreatedObjects().length, then cancel(); filter pairs by bounding " +
  "box first and run at most about 25 tests per call, since more runs past the timeout and " +
  "blocks MoI. getBoundingBox() on a NURBS curve (or a brep made from one) is the " +
  "control-hull box; sample evaluatePoint(t) for the real extent. rotateaxis by +θ then −θ " +
  "restores parts to within about 3e-5 mm, keeping names and styles, so untilt, build, " +
  "re-tilt is safe. ";

/**
 * Snapshots the document's ids before the agent's script runs, so a script that throws partway
 * can say what it left behind: everything it committed before the throw stays. Only reported,
 * never removed: one Ctrl+Z by the user undoes the whole call. Nothing changed, nothing added.
 */
const LEFTOVERS = `
var __moiMcpBefore = {}, __moiMcpObjs = moi.geometryDatabase.getObjects();
for ( var __i = 0; __i < __moiMcpObjs.length; ++__i ) __moiMcpBefore[ __moiMcpObjs.item( __i ).id ] = true;
function __moiMcpLeftovers( e ) {
	var msg = ( e && e.message ) ? String( e.message ) : String( e );
	var now = moi.geometryDatabase.getObjects(), made = [], gone = [];
	for ( var i = 0; i < now.length; ++i ) {
		var id = now.item( i ).id;
		if ( __moiMcpBefore[ id ] ) delete __moiMcpBefore[ id ];
		else made.push( id );
	}
	for ( var k in __moiMcpBefore ) gone.push( k );
	if ( !made.length && !gone.length ) return e;
	if ( made.length ) msg += '\\nBefore it threw, the script created ' + made.length + ' object(s) that are still in the document: ' + made.join( ', ' ) + '. Delete them with delete_objects if they are not wanted.';
	if ( gone.length ) msg += '\\nBefore it threw, the script consumed ' + gone.length + ' object(s): ' + gone.join( ', ' ) + '.';
	return new Error( msg + '\\nOne Ctrl+Z in MoI undoes this whole call.' );
}
`;

/** What the wrapped script sends back: the agent's value, and the prelude's capture record. */
type Wrapped = { value: unknown; captures: number; warnings: { index: number; text: string }[] };

export const moiEvalTool: Tool<{ script: string }, Wrapped> = {
  name: "moi_eval",
  description:
    "Run ES5 JavaScript inside the live MoI session against the `moi` API and return " +
    "its value. This is the modelling surface: build geometry with factories — " +
    "moi.command.createFactory('box'), setInput(i, value), update(), commit(). Call " +
    "moi_factory_help(name) to learn any factory's input indices — they are positional " +
    "and undocumented, so do not guess them. Wrap every commit in capture(function(){ … }): " +
    "it returns { result, created, consumed }, where created describes the new objects and " +
    "consumed lists the ids that are gone. MoI commits a factory that cannot do what it was " +
    "asked — e.g. a fillet, chamfer or shell too large for the geometry — without any error " +
    "and changes nothing; capture then adds a warning, which this tool's reply repeats after " +
    "your result. Without capture there is no such check. Use `return` for your result; it must be " +
    "JSON-serialisable. Helpers: capture(fn), toJson(obj), listToJson(list), pt(point), " +
    "bbox(obj), faces(obj), edges(obj). faces/edges list an object's faces or edges as " +
    "{ index, bbox } in getFaces()/getEdges() order; filter the rows yourself and get " +
    "the item back with obj.getEdges().item(row.index), e.g. to chamfer it. " +
    "For booleans use boolean(kind, targets, tools): kind is 'difference', 'union' or " +
    "'intersection', targets and tools are ids or objects, one or an array (a union takes " +
    "them all as targets). It runs the factory through capture and returns its record with " +
    "every result in created, named and styled like the first target, and warns when a " +
    "difference or union left the face count unchanged (the cutter most likely missed), a " +
    "union left separate objects, or nothing was created. An empty intersection is not a warning. " +
    "A live object has no isSolid (it reads undefined): test a closed solid with " +
    "obj.isSolidBRep, or read toJson(obj).isSolid. Do not call moi.geometryDatabase.save() — this tool never saves the " +
    "user's file. If the script throws, the error lists the ids of the objects it created " +
    "or consumed before the throw: they stay in the document. " +
    FACTORY_POINT_NOTE +
    TRAPS_NOTE +
    ES5_NOTE,
  input: { script: z.string().describe("ES5 source. Use `return` to produce a value.") },
  direct: false,
  annotations: DESTRUCTIVE,
  needsUnits: true,
  // The agent's script runs in its own function, so its `return` is its value and the capture
  // warnings still reach the reply whatever it returns. A throw is rethrown with its leftovers.
  script: ({ script }) =>
    LEFTOVERS +
    `var __moiMcpValue;\ntry { __moiMcpValue = ( function () {\n${script}\n} )(); }\n` +
    "catch ( e ) { throw __moiMcpLeftovers( e ); }\n" +
    "return { value: ( __moiMcpValue === undefined ? null : __moiMcpValue ), " +
    "captures: __moiMcpCaptures.count, warnings: __moiMcpCaptures.warnings };",
  reply: ({ value, captures, warnings }) => {
    const content = asJson(value);
    if (warnings.length)
      content.push({
        type: "text",
        text: warnings.map((w) => `Warning (capture ${w.index} of ${captures}): ${w.text}`).join("\n"),
      });
    return content;
  },
};
