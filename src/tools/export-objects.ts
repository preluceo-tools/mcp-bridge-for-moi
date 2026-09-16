import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { BridgeError } from "../session.js";
import { RESOLVE_IDS, WITH_SELECTION } from "../scripts.js";
import { asJson, WRITES_FILE, type Tool } from "../tool.js";

type Args = { ids?: string[]; path: string; angle?: number };

/** What the script below returns. */
type Reply = { via: string; exported: boolean; found: number | null; missing: string[] };

/**
 * Where an export may go. Absolute, because MoI and the server resolve a relative path against
 * different folders; with an extension, because that is how MoI picks the format; and never
 * `.3dm`, because `saveAs` to `.3dm` renames the user's open document to the agent's copy and
 * their next Ctrl+S goes there. See docs/research/probe-13-file-export.md.
 */
const PATH_SCHEMA = z
  .string()
  .refine(isAbsolute, { message: "The path must be absolute." })
  .refine((p) => /\.[^\\/.]+$/.test(p), {
    message: "The path needs an extension; MoI picks the format from it (e.g. .step, .obj, .stl).",
  })
  .refine((p) => !/\.3dm$/i.test(p), {
    message:
      "export_objects does not write .3dm: MoI would rename the open document to the new file, " +
      "so the user's next save would go there. Export to another format.",
  });

/** The files an export writes: an OBJ brings a .mtl of the same name with it. */
const written = (path: string) =>
  /\.obj$/i.test(path) ? [path, path.replace(/\.obj$/i, ".mtl")] : [path];

/**
 * Exports through MoI, then checks the file from this side: MoI returns null whether or not it
 * wrote anything. Refusing any path that already exists is what makes existence proof of this
 * call's write — and what keeps the tool from ever overwriting a file.
 */
export const exportObjectsTool: Tool<Args, Reply> = {
  name: "export_objects",
  description:
    "Write objects to a new file on disk, in the format named by the path's extension " +
    "(e.g. .step, .iges, .obj, .stl). With ids, exports exactly those objects — the " +
    "user's selection is borrowed for the call and put back. Without ids, exports the " +
    "whole scene. Never opens a dialog. This is not saving: the open document and its file " +
    "name are untouched, .3dm is refused, and a path that already " +
    "exists is refused, so no file is ever overwritten. `angle` sets the mesh density for " +
    "mesh formats (smaller is finer); without it MoI uses the user's last mesh settings. " +
    "Reports the bytes written and any ids not found.",
  input: {
    ids: z
      .array(z.string())
      .min(1)
      .optional()
      .describe("Object ids (brace-wrapped GUIDs) to export. Omit to export the whole scene."),
    path: PATH_SCHEMA.describe(
      "Absolute path of a file that does not exist yet, e.g. 'C:\\\\exports\\\\part.step'.",
    ),
    angle: z
      .number()
      .finite()
      .positive()
      .optional()
      .describe("Mesh angle in degrees, for mesh formats. Smaller gives more faces."),
  },
  direct: false,
  annotations: WRITES_FILE,
  needsUnits: true,

  precheck: ({ path }) => {
    const clashes = written(path).filter((p) => existsSync(p));
    return clashes.length
      ? `${clashes.join(" and ")} already exists. export_objects never overwrites a file; ` +
          `choose a new path.`
      : undefined;
  },

  /**
   * Writes objects to a file, the format chosen by MoI from the extension, and never opens a
   * dialog. See docs/research/probe-13-file-export.md.
   *
   * `NoUI=true` is always sent: without it a mesh format opens MoI's modal mesh dialog, which
   * freezes the side pane the bridge lives in until a person clicks it away. The only caller text
   * that reaches the options string is `angle`, a number the schema has already checked.
   *
   * With `ids`, `fileExport` writes the selection and only the selection, so the selection is
   * set to exactly those objects for the call and the user's own put back in a `finally`. Without
   * `ids`, `saveAs` writes the whole scene with no selection involved; for an export format it
   * leaves the document's file name alone. Never `.3dm` through here — `saveAs` to `.3dm` renames
   * the open document; the schema refuses it.
   *
   * Both calls return null whether or not they wrote anything, so `reply` decides success by
   * looking for the file.
   */
  script: (opts) => {
    // Only a literal and a number go in, so plain quotes are safe.
    const options = `'NoUI=true${opts.angle === undefined ? "" : `;Angle=${Number(opts.angle)}`}'`;
    const path = JSON.stringify(opts.path);
    if (!opts.ids) {
      return `
moi.geometryDatabase.saveAs( ${path}, ${options} );
return { via: 'saveAs', exported: true, found: null, missing: [] };
`;
    }
    return `${RESOLVE_IDS}${WITH_SELECTION}
var hit = resolveIds( ${JSON.stringify(opts.ids)} );
// fileExport with nothing selected writes nothing and says nothing, so say it here.
if ( hit.objects.length === 0 ) return { via: 'fileExport', exported: false, found: 0, missing: hit.missing };
withSelection( hit.objects, function () { moi.geometryDatabase.fileExport( ${path}, ${options} ); } );
return { via: 'fileExport', exported: true, found: hit.objects.length, missing: hit.missing };
`;
  },

  reply: ({ via, exported, found, missing }, { path }) => {
    if (!exported) {
      throw new BridgeError(
        "not_found",
        `None of the ids were found, so nothing was exported: ${missing.join(", ")}.`,
      );
    }
    let bytes: number;
    try {
      bytes = statSync(path).size;
    } catch {
      throw new BridgeError(
        "moi_error",
        `MoI reported no error but wrote no file to ${path}. It writes nothing when there is ` +
          `nothing to export, and nothing to a folder that does not exist or cannot be written.`,
      );
    }
    // `objects` is null for a whole-scene export: saveAs does not say how many it wrote.
    return asJson({ path, bytes, via, objects: found, missing });
  },
};
