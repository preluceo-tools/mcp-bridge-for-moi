import { z } from "zod";
import { RESOLVE_IDS } from "../scripts.js";
import { CHANGING, type Tool } from "../tool.js";

/** Replaces the selection outright — how the agent points at things for the user to see. */
function setSelection(ids: string[]): string {
	return `${RESOLVE_IDS}
var hit = resolveIds( ${JSON.stringify(ids)} );
moi.geometryDatabase.deselectAll();
for ( var i = 0; i < hit.objects.length; ++i ) hit.objects[i].selected = true;
moi.ui.redrawViewports();
return { selected: hit.objects.length, missing: hit.missing };
`;
}

export const setSelectionTool: Tool<{ ids: string[] }, unknown> = {
  name: "set_selection",
  description:
    "Replace the user's selection with the given object ids, so they can see on screen " +
    "exactly which geometry you mean. Reports any ids that no longer exist.",
  input: { ids: z.array(z.string()).describe("Object ids (brace-wrapped GUIDs).") },
  direct: false,
  annotations: CHANGING,
  script: ({ ids }) => setSelection(ids),
};
