import { READ_ONLY, type Tool } from "../tool.js";

const GET_SCENE = `
var db = moi.geometryDatabase;
var objs = db.getObjects();
return {
	units: db.unitsShortLabel,
	unitsCode: db.units,
	file: db.currentFileName,
	objectCount: objs.length,
	objects: listToJson( objs )
};
`;

export const getSceneTool: Tool<Record<string, never>, unknown> = {
  name: "get_scene",
  description:
    "List every object in the open MoI document with its id, name, type, style, " +
    "visibility, bounding box and isSolid (true only for a closed solid), plus the " +
    "document's units. Numbers you send to MoI " +
    "are in these units.",
  input: {},
  direct: true,
  annotations: READ_ONLY,
  script: () => GET_SCENE,
};
