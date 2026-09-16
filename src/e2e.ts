/**
 * `npm run e2e`: drives a real MoI session through every tool once and reports pass or fail
 * per step. Opt-in and outside the `*.test` glob, so `npm test` never needs MoI.
 *
 * Every call goes through `runTool`, the way the server makes it, so the direct and command
 * paths are both exercised, and every tool is taken from the server's own tool list. It runs
 * in the live-run bracket, which settles units and puts units and layout back. It never saves,
 * never closes MoI, and deletes only the boxes it built. The one file it writes is an export
 * into a temp folder it removes.
 */
import { runTool, TOOLS } from "./index.js";
import { call as callOn, liveRun, reply as replyOn, throwingScript } from "./e2e-start.js";
import type { Tool } from "./tool.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Layout } from "./scripts.js";

type Obj = { id: string; typeName: string };
type Scene = { objectCount: number; objects: Obj[]; unitsCode: string };

/** A tool the server registers, by the name the agent calls it. */
function tool(name: string): Tool<any, any> {
  const t = TOOLS.find((t) => t.name === name);
  if (!t) throw new Error(`the server lists no tool ${name}`);
  return t;
}
const moiEvalTool = tool("moi_eval");
const getSceneTool = tool("get_scene");
const getSelectionTool = tool("get_selection");
const setSelectionTool = tool("set_selection");
const deleteObjectsTool = tool("delete_objects");
const exportObjectsTool = tool("export_objects");
const getViewTool = tool("get_view");
const setViewTool = tool("set_view");
const setViewportLayoutTool = tool("set_viewport_layout");
const moiFactoryHelpTool = tool("moi_factory_help");

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

const BOX = `return capture( function() {
  var vm = moi.vectorMath;
  var f = moi.command.createFactory( 'box' );
  f.setInput( 0, vm.createTopFrame( vm.createPoint( 0, 0, 0 ) ) );
  f.setInput( 2, 10 );
  f.setInput( 3, 20 );
  f.setInput( 4, 5 );
  f.update();
  f.commit();
} );`;

await liveRun(async (host, step) => {
  const reply = (t: Tool<any, any>, args: unknown) => replyOn(host, t, args);
  const call = (t: Tool<any, any>, args: unknown) => callOn(host, t, args);
  const evaluate = (script: string) => call(moiEvalTool, { script });

  let boxId: string | null = null;
  let deleted = false;
  let twinId: string | null = null;
  const units = ((await call(getSceneTool, {})) as Scene).unitsCode;
  const startLayout = (await evaluate("return moi.ui.mainWindow.viewpanel.mode;")) as Layout;

  try {
    await step("prelude helpers exist", async () => {
      const v = (await evaluate(
        "return [ typeof capture, typeof toJson, typeof listToJson, typeof pt, typeof bbox, typeof faces, typeof edges ];",
      )) as string[];
      assert(v.every((t) => t === "function"), `expected all functions, got ${JSON.stringify(v)}`);
    });

    await step("moi_eval: box inside capture() comes back as one solid", async () => {
      const v = (await evaluate(BOX)) as { created: Obj[] };
      assert(v.created.length === 1, `expected one object, got ${v.created.length}`);
      boxId = v.created[0].id;
      assert(v.created[0].typeName === "brep", `expected a brep, got ${v.created[0].typeName}`);
      return { id: boxId };
    });

    await step("moi_eval: a fillet too large for the box warns after the result", async () => {
      assert(boxId, "no box to fillet");
      const { r, text } = await reply(moiEvalTool, {
        script: `var db = moi.geometryDatabase;
  var box = db.findObject( '${boxId}' );
  var edges = db.createObjectList();
  edges.addObject( box.getEdges().item( 0 ) );
  return capture( function() {
    var f = moi.command.createFactory( 'fillet' );
    f.setInput( 0, edges );
    f.setInput( 1, false );
    f.setInput( 3, 20 );
    f.update();
    f.commit();
  } ).created;`,
      });
      assert(!r.isError && r.content.length === 2, `expected value and warning, got ${text.slice(0, 200)}`);
      assert(/^Warning \(capture 1 of 1\): Nothing was created/.test((r.content[1] as { text: string }).text), "no warning block");
      return { warning: (r.content[1] as { text: string }).text.slice(0, 60) };
    });

    await step("get_scene lists the box", async () => {
      assert(boxId, "no box to look for");
      const scene = (await call(getSceneTool, {})) as Scene;
      assert(scene.objects.some((o) => o.id === boxId), "box not in the scene");
    });

    await step("set_selection then get_selection returns the box", async () => {
      assert(boxId, "no box to select");
      const set = (await call(setSelectionTool, { ids: [boxId] })) as { selected: number };
      assert(set.selected === 1, `set_selection selected ${set.selected}`);
      const sel = (await call(getSelectionTool, {})) as { objects: Obj[] };
      assert(sel.objects.length === 1 && sel.objects[0].id === boxId, "selection is not the box");
    });

    await step("set_view frames the box on 3D", async () => {
      assert(boxId, "no box to frame");
      const v = (await call(setViewTool, { viewport: "3D", frame: [boxId] })) as {
        framed: boolean;
        matched: number;
      };
      assert(v.framed && v.matched === 1, `framed ${v.framed}, matched ${v.matched}`);
    });

    await step("get_view on Top returns a PNG larger than 4 KB", async () => {
      const { r, text } = await reply(getViewTool, { viewport: "Top" });
      assert(!r.isError, text);
      const image = r.content.find((c) => c.type === "image");
      assert(image && "data" in image, "no image in the reply");
      const bytes = Buffer.from(image.data, "base64").length;
      assert(bytes > 4096, `PNG is only ${bytes} bytes`);
      return { bytes };
    });

    await step("set_viewport_layout to 3d and back", async () => {
      assert(startLayout, "starting layout unknown");
      const a = (await call(setViewportLayoutTool, { layout: "3d" })) as { layout: string };
      assert(a.layout === "3d", `ended on ${a.layout}`);
      const b = (await call(setViewportLayoutTool, { layout: startLayout })) as { layout: string };
      assert(b.layout === startLayout, `ended on ${b.layout}, started on ${startLayout}`);
    });

    await step("export_objects writes the box to a new STEP file", async () => {
      assert(boxId, "no box to export");
      const dir = mkdtempSync(join(tmpdir(), "mcp-bridge-for-moi-e2e-"));
      try {
        const path = join(dir, "box.step");
        const v = (await call(exportObjectsTool, { ids: [boxId], path })) as { bytes: number; objects: number };
        assert(v.objects === 1, `exported ${v.objects} object(s)`);
        const file = readFileSync(path, "latin1");
        assert(file.startsWith("ISO-10303-21"), "file is not STEP");
        const mm = /SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/.test(file);
        if (units === "Millimeters") assert(mm, "the document is in Millimeters but the STEP file does not declare millimetres");
        return { bytes: v.bytes, units, declaresMillimetres: mm };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    await step("delete_objects removes the box", async () => {
      assert(boxId, "no box to delete");
      const v = (await call(deleteObjectsTool, { ids: [boxId] })) as { removed: string[] };
      deleted = v.removed.length === 1;
      assert(deleted, `removed ${JSON.stringify(v.removed)}`);
      const gone = await evaluate(`return moi.geometryDatabase.findObject( ${JSON.stringify(boxId)} ) === null;`);
      assert(gone === true, "box still found after delete");
    });

    await step("delete_objects with the same id twice removes the object once", async () => {
      twinId = ((await evaluate(BOX)) as { created: Obj[] }).created[0].id;
      const { r, text } = await reply(deleteObjectsTool, { ids: [twinId, twinId] });
      assert(!r.isError, text);
      const gone = await evaluate(`return moi.geometryDatabase.findObject( ${JSON.stringify(twinId)} ) === null;`);
      assert(gone === true, "box still found after delete");
      const v = JSON.parse(text) as { removed: string[] };
      assert(v.removed.length === 1 && v.removed[0] === twinId, `removed ${JSON.stringify(v.removed)}`);
      twinId = null;
      return v;
    });

    await step("moi_factory_help for box names 6 typed inputs and a stock script", async () => {
      const v = (await call(moiFactoryHelpTool, { name: "box" })) as {
        inputs: { type: string }[] | null;
        filesFound: number;
      };
      assert(v.inputs?.length === 6, `expected 6 inputs, got ${JSON.stringify(v.inputs)}`);
      assert(v.inputs.every((i) => !/^type\d/.test(i.type)), `unnamed type in ${JSON.stringify(v.inputs)}`);
      assert(v.filesFound >= 1, "no stock script hit");
      return { inputs: v.inputs.map((i) => i.type), filesFound: v.filesFound };
    });

    await step("a throwing script comes back as script_error or moi_error", async () => {
      const { ok, code, text } = await throwingScript(host);
      assert(ok, `came back as ${text}`);
      return { code };
    });
  } finally {
    // A failed step must not leave the boxes behind; the bracket puts layout and units back.
    if (boxId && !deleted) await runTool(host, deleteObjectsTool, { ids: [boxId] }).catch(() => {});
    if (twinId) await runTool(host, deleteObjectsTool, { ids: [twinId] }).catch(() => {});
  }
});
