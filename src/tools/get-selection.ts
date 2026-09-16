import { READ_ONLY, type Tool } from "../tool.js";

const GET_SELECTION = `
var db = moi.geometryDatabase;
var sel = db.getSelectedObjects();
return {
	units: db.unitsShortLabel,
	unitsCode: db.units,
	count: sel.length,
	objects: listToJson( sel )
};
`;

export const getSelectionTool: Tool<Record<string, never>, unknown> = {
  name: "get_selection",
  description:
    "List the objects the user currently has selected in MoI. This is how the user " +
    "points at geometry without typing ids. Each record is the same as get_scene's, " +
    "including isSolid (true only for a closed solid).",
  input: {},
  direct: true,
  annotations: READ_ONLY,
  script: () => GET_SELECTION,
};
