import { z } from "zod";
import { asJson, DESTRUCTIVE, type Tool } from "../tool.js";

/**
 * Snapshots the document's ids before the agent's script runs, so a script that throws partway
 * can say what it left behind: everything it committed before the throw stays. Only reported,
 * never removed: one Ctrl+Z by the user undoes the whole call. Nothing changed, nothing added.
 */
const LEFTOVERS = `
var __moiMcpBefore = {}, __moiMcpObjs = moi.geometryDatabase.getObjects();
for ( var __i = 0; __i < __moiMcpObjs.length; ++__i ) __moiMcpBefore[ __moiMcpObjs.item( __i ).id ] = true;
function __moiMcpIdList( ids ) {
	return ids.slice( 0, 10 ).join( ', ' ) + ( ids.length > 10 ? ' \\u2026 and ' + ( ids.length - 10 ) + ' more' : '' );
}
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
	if ( made.length ) msg += '\\nBefore it threw, the script created ' + made.length + ' object(s) that are still in the document: ' + __moiMcpIdList( made ) + '. Delete them with delete_objects if they are not wanted.';
	if ( gone.length ) msg += '\\nBefore it threw, the script consumed ' + gone.length + ' object(s): ' + __moiMcpIdList( gone ) + '.';
	return new Error( msg + '\\nOne Ctrl+Z in MoI undoes this whole call.' );
}
`;

/** What the wrapped script sends back: the agent's value, and the prelude's capture record. */
type Wrapped = { value: unknown; captures: number; warnings: { index: number; text: string }[] };

export const moiEvalTool: Tool<{ script: string }, Wrapped> = {
  name: "moi_eval",
  description:
    "Run ES5 JavaScript inside the live MoI session against the `moi` API and return its " +
    "value. This is the modelling surface: build geometry with factories — " +
    "moi.command.createFactory('box'), setInput(i, value), update(), commit(). Input indices " +
    "are positional and undocumented: call moi_factory_help(name), never guess. Before scripting " +
    "call moi_factory_help('helpers') for the helper API and moi_factory_help('traps') for " +
    "MoI host traps. Wrap every commit in capture(function(){ … }): it returns " +
    "{ result, created, consumed }. MoI commits a factory that cannot do what it was asked " +
    "(e.g. an oversized fillet) without any error and changes nothing; capture then adds a " +
    "warning, which this tool's reply repeats after your result. Without capture there is no " +
    "such check. Use `return` for your result; it must be JSON-serialisable. Helpers: " +
    "capture(fn), boolean(kind, targets, tools), toJson(obj), listToJson(list), pt(point), " +
    "bbox(obj), faces(obj), edges(obj). ES5 only: no let/const, arrow functions, Promise or " +
    "fetch. Objects are addressed by `id` (a brace-wrapped GUID); an id changes whenever an " +
    "operation consumes the object, so read ids back from the result. Do not call " +
    "moi.geometryDatabase.save() — this tool never saves the user's file. If the script " +
    "throws, the error lists the ids it created or consumed before the throw: they stay in " +
    "the document.",
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
  reply: ({ value, captures, warnings }, { script }) => {
    const content = asJson(value);
    // A word check, not a parse: a `return` anywhere, even in a nested function, suppresses it.
    if (value === null && !/\breturn\b/.test(script))
      content.push({ type: "text", text: "The script has no `return`, so its last expression was not returned." });
    if (warnings.length)
      content.push({
        type: "text",
        text: warnings.map((w) => `Warning (capture ${w.index} of ${captures}): ${w.text}`).join("\n"),
      });
    return content;
  },
};
