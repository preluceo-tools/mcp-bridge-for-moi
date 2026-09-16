import { z } from "zod";
import { BridgeError } from "../session.js";
import { asJson, CHANGING, type Tool } from "../tool.js";

/** What MoI calls a document with no units. Live MoI holds the name, not a code. */
export const NO_UNITS = "No unit system";

/** MoI's seven unit systems, in its own order and spelling. `NO_UNITS` is not offered. */
export const UNITS = ["Millimeters", "Centimeters", "Meters", "Kilometers", "Inches", "Feet", "Miles"] as const;

const SET_IN_MOI = "a default unit system in MoI (Options > General > Units options)";

export const NO_UNITS_MESSAGE =
  `The open document has no unit system, so its numbers mean nothing yet. Ask the user which ` +
  `units to work in — ${UNITS.join(", ")} — then call set_units with their choice and try ` +
  `again. Setting ${SET_IN_MOI} stops new documents asking.`;

/** Appended to the description of every tool with `needsUnits`. */
export const NO_UNITS_NOTE =
  " Refused with no_units while the document has no unit system — ask the user which units " +
  "to use and call set_units, then try again.";

type Reply = { set: boolean; units: string };

/**
 * Settles the units of a unitless document, and nothing more: from no unit system MoI labels
 * the numbers without scaling them, but between two units it can rescale the model and give
 * every object a new id, so a document that has units is refused. One assignment, read back in
 * the same script: several in one script left MoI in an unexplained state.
 */
export const setUnitsTool: Tool<{ units: (typeof UNITS)[number] }, Reply> = {
  name: "set_units",
  description:
    "Set the unit system of an open document that has none, e.g. after moi_eval or " +
    "export_objects answered no_units. Ask the user which units first. It only settles units " +
    "and never converts them: on a document that already has units it changes nothing and " +
    "is refused with units_set, naming the current ones. Replies with the units MoI now reports.",
  input: {
    units: z.enum(UNITS).describe("The unit system the user chose, in MoI's own spelling."),
  },
  direct: false,
  annotations: CHANGING,
  script: ({ units }) => `
var db = moi.geometryDatabase;
if ( db.units !== '${NO_UNITS}' ) return { set: false, units: db.units };
db.units = ${JSON.stringify(units)};
return { set: true, units: db.units };
`,
  reply: ({ set, units }, args) => {
    if (!set) {
      throw new BridgeError(
        "units_set",
        `The document already has a unit system: ${units}. set_units only settles units on a ` +
          `document that has none and never converts them. To change them, the user does it in ` +
          `MoI's Options (Options > General > Units options).`,
      );
    }
    if (units !== args.units) {
      throw new BridgeError("moi_error", `MoI did not take ${args.units}; the document reports ${units}.`);
    }
    return asJson({ units });
  },
};
