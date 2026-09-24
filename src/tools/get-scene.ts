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

/**
 * Above this many objects get_scene lists only id, name and typeName. A full record is about
 * 300 characters of compact JSON (a GUID and six bbox doubles), roughly 110 tokens; the default
 * MCP client limit is 25,000 tokens per tool result. 100 full records is about 11,000 tokens,
 * under half the limit, leaving room for long names and a client with a smaller limit.
 */
export const FULL_SCENE_MAX = 100;

type SceneObject = { id: string; name: string; typeName: string };
type Scene = { objectCount: number; shortened?: string; objects: SceneObject[] };

export const getSceneTool: Tool<Record<string, never>, Scene> = {
  name: "get_scene",
  description:
    "List every object in the open MoI document with its id, name, type, style, " +
    "visibility, bounding box and isSolid (true only for a closed solid), plus the " +
    "document's units. Numbers you send to MoI are in these units. " +
    `On a document of more than ${FULL_SCENE_MAX} objects the list is shortened: every object ` +
    "is still listed, but only with id, name and typeName, and a `shortened` note says so; " +
    "query the details of the objects you need with moi_eval (e.g. toJson( findById( id ) ), bbox( findById( id ) )).",
  input: {},
  direct: true,
  annotations: READ_ONLY,
  script: () => GET_SCENE,
  reply: (scene) => {
    if (scene.objectCount > FULL_SCENE_MAX)
      scene = {
        ...scene,
        shortened:
          `${scene.objectCount} objects is more than ${FULL_SCENE_MAX}, so each is listed with ` +
          "id, name and typeName only. Query details with moi_eval, e.g. " +
          "toJson( findById( id ) ) or bbox( findById( id ) ).",
        objects: scene.objects.map(({ id, name, typeName }) => ({ id, name, typeName })),
      };
    return [{ type: "text", text: JSON.stringify(scene) }];
  },
};
