import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { z } from "zod";
import { BridgeError } from "../session.js";
import { RESOLVE_IDS, WITH_SELECTION } from "../scripts.js";
import { asJson, WRITES_FILE, type Tool } from "../tool.js";

/**
 * The mesh settings, named after MoI's Meshing options dialog, each with the key MoI reads in the
 * options string and the default sent when the caller leaves it out: MoI's own factory values.
 * Every mesh export sends all seven, because MoI keeps the last value of any key left out
 * (ADR 0006, docs/research/probe-14-mesh-export-options.md).
 */
const MESH = {
  angle: { key: "Angle", default: 12 },
  output: { key: "Output", default: "quads" },
  weld: { key: "Weld", default: true },
  divideLargerThan: { key: "MaxLength", default: 0 },
  divideLargerThanApplyTo: { key: "MaxLengthApplyTo", default: "curved" },
  avoidSmallerThan: { key: "MinLength", default: 0 },
  aspectRatioLimit: { key: "AspectRatio", default: 0 },
} as const;

type MeshSettings = {
  angle: number;
  output: "ngons" | "quads" | "triangles";
  weld: boolean;
  divideLargerThan: number;
  divideLargerThanApplyTo: "curved" | "planes" | "all";
  avoidSmallerThan: number;
  aspectRatioLimit: number;
};

type Args = { ids?: string[]; path: string } & Partial<MeshSettings>;

/** The formats MoI meshes on export (probe-14); every other format ignores mesh settings. */
const MESH_FORMAT = /\.(obj|stl|3ds|fbx|lwo|skp)$/i;
const isStl = (path: string) => /\.stl$/i.test(path);

/**
 * The full set of mesh settings an export sends, or undefined for a format that is not meshed.
 * STL is always triangles, so that is its default output too.
 */
const meshSettings = (args: Args): MeshSettings | undefined => {
  if (!MESH_FORMAT.test(args.path)) return undefined;
  const settings = Object.fromEntries(
    Object.entries(MESH).map(([name, { default: d }]) => [name, args[name as keyof MeshSettings] ?? d]),
  ) as MeshSettings;
  if (isStl(args.path) && args.output === undefined) settings.output = "triangles";
  return settings;
};

/** Numbers and schema-checked enum words only, so plain quotes around the string are safe. */
const optionsOf = (settings: MeshSettings | undefined) =>
  ["NoUI=true", ...Object.entries(settings ?? {}).map(([name, value]) =>
    `${MESH[name as keyof MeshSettings].key}=${typeof value === "number" ? Number(value) : String(value)}`,
  )].join(";");

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

/** Whether `p` is a folder; false, not a throw, when a part of it is a file or unreadable. */
const isFolder = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

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
    "exists is refused, so no file is ever overwritten. Also refused before MoI is asked: " +
    ".dwg, which MoI 4 cannot write (use .dxf), and a folder that does not exist, which " +
    "would leave MoI stuck on an error box. Mesh formats (OBJ, STL, 3DS, FBX, LWO, SKP) " +
    "take the mesh settings of MoI's Meshing options dialog: angle, output, weld, " +
    "divideLargerThan, divideLargerThanApplyTo, avoidSmallerThan, aspectRatioLimit. Every " +
    "mesh export sends all of them, the defaults filling any left out, so the same call " +
    "always gives the same mesh; the reply lists the settings used. Warning: those settings " +
    "then stay in MoI's own mesh dialog for the rest of the MoI session, and the user's " +
    "previous settings cannot be restored. Mesh settings on any other format are refused, " +
    "as is an STL output other than triangles. Reports the bytes written and any ids not found.",
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
      .describe("Mesh angle in degrees, mesh formats only. Smaller gives more faces. Default 12."),
    output: z
      .enum(["ngons", "quads", "triangles"])
      .optional()
      .describe("Polygons to write, mesh formats only. Default quads (quads and triangles); STL is always triangles."),
    weld: z
      .boolean()
      .optional()
      .describe("Weld vertices along edges, so faces share them. Mesh formats only. Default true."),
    divideLargerThan: z
      .number()
      .finite()
      .nonnegative()
      .optional()
      .describe("Divide polygons longer than this, in document units; 0 is off. Mesh formats only. Default 0."),
    divideLargerThanApplyTo: z
      .enum(["curved", "planes", "all"])
      .optional()
      .describe("Which surfaces divideLargerThan divides. Mesh formats only. Default curved."),
    avoidSmallerThan: z
      .number()
      .finite()
      .nonnegative()
      .optional()
      .describe("Avoid polygons smaller than this, in document units; 0 is off. Mesh formats only. Default 0."),
    aspectRatioLimit: z
      .number()
      .finite()
      .nonnegative()
      .optional()
      .describe("Limit on a polygon's aspect ratio; 0 is off. Mesh formats only. Default 0."),
  },
  direct: false,
  annotations: WRITES_FILE,
  needsUnits: true,

  /**
   * Refuses, before MoI is touched: `.dwg`, which MoI 4 writes nothing to and raises nothing
   * for; a missing target folder, which leaves modal error boxes open in MoI and blocks every
   * later call (probe-14); and a path that already exists.
   */
  precheck: (args) => {
    const { path } = args;
    if (!MESH_FORMAT.test(path)) {
      const given = Object.keys(MESH).filter((name) => args[name as keyof MeshSettings] !== undefined);
      if (given.length) {
        return `${given.join(", ")}: mesh settings apply only to mesh formats (OBJ, STL, 3DS, FBX, ` +
          `LWO, SKP), and ${path} is not one. Leave them out.`;
      }
    }
    if (isStl(path) && args.output !== undefined && args.output !== "triangles") {
      return `STL is always triangles; output "${args.output}" cannot be written to it. ` +
        `Leave output out or set it to "triangles".`;
    }
    if (/\.dwg$/i.test(path)) {
      return "MoI 4 cannot write DWG: it writes no file and reports no error. Export to .dxf, " +
        "the closest format it does write.";
    }
    const folder = dirname(path);
    if (!isFolder(folder)) {
      return `The folder ${folder} does not exist. export_objects does not create folders; ` +
        `create it first or choose a path in an existing folder.`;
    }
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
   * freezes the side pane the bridge lives in until a person clicks it away. A mesh format also
   * gets all seven mesh settings; the only caller values that reach the options string are those,
   * numbers and enum words the schema has already checked.
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
    const options = `'${optionsOf(meshSettings(opts))}'`;
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

  reply: ({ via, exported, found, missing }, args) => {
    const { path } = args;
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
          `nothing to export, and nothing to a folder that cannot be written.`,
      );
    }
    // `objects` is null for a whole-scene export: saveAs does not say how many it wrote.
    const mesh = meshSettings(args);
    return asJson({ path, bytes, via, objects: found, missing, ...(mesh && { meshSettings: mesh }) });
  },
};
