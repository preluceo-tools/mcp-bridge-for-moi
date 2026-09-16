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
    "the item back with obj.getEdges().item(row.index), e.g. to chamfer it. Do not call moi.geometryDatabase.save() — this tool never saves the " +
    "user's file. " +
    FACTORY_POINT_NOTE +
    ES5_NOTE,
  input: { script: z.string().describe("ES5 source. Use `return` to produce a value.") },
  direct: false,
  annotations: DESTRUCTIVE,
  needsUnits: true,
  // The agent's script runs in its own function, so its `return` is its value and the capture
  // warnings still reach the reply whatever it returns.
  script: ({ script }) =>
    `var __moiMcpValue = ( function () {\n${script}\n} )();\n` +
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
