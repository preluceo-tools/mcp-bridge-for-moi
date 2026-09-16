import { z } from "zod";
import { RESOLVE_IDS } from "../scripts.js";
import { DESTRUCTIVE, type Tool } from "../tool.js";

/**
 * Deletes objects by id. Never deleteAll — see docs/adr/0004.
 *
 * ponytail: uses removeObject per id rather than building an ObjectList for
 * removeObjects. Fine at the sizes an agent works with; batch it if a call ever
 * deletes thousands.
 */
function deleteObjects(ids: string[]): string {
	return `${RESOLVE_IDS}
var hit = resolveIds( ${JSON.stringify(ids)} );
for ( var i = 0; i < hit.objects.length; ++i ) moi.geometryDatabase.removeObject( hit.objects[i] );
moi.ui.redrawViewports();
return { removed: hit.found, missing: hit.missing };
`;
}

export const deleteObjectsTool: Tool<{ ids: string[] }, unknown> = {
  name: "delete_objects",
  description:
    "Delete the given objects from the open document. Deletes only the objects named — " +
    "there is deliberately no way to clear the document or start a new file.",
  input: { ids: z.array(z.string()).describe("Object ids (brace-wrapped GUIDs).") },
  direct: false,
  annotations: DESTRUCTIVE,
  script: ({ ids }) => deleteObjects(ids),
};
