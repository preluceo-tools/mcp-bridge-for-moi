import { test } from "node:test";
import assert from "node:assert/strict";
import { assertES5 } from "./es5.js";
import { LAYOUTS, VIEW_PANES, VIEWPORTS, type FrameSubject } from "./scripts.js";
import { TOOLS } from "./index.js";
import { setSelectionTool } from "./tools/set-selection.js";
import { deleteObjectsTool } from "./tools/delete-objects.js";
import { exportObjectsTool } from "./tools/export-objects.js";
import { setViewTool } from "./tools/set-view.js";
import { FULL_SCENE_MAX, getSceneTool } from "./tools/get-scene.js";
import { getSelectionTool } from "./tools/get-selection.js";
import { moiEvalTool } from "./tools/moi-eval.js";
import { UNITS } from "./tools/set-units.js";
import { A, B, C, fakeMoi, guid, ids, runScript, sceneOf } from "./fake-moi.js";

const frames: FrameSubject[] = [["a"], "selection", "scene", "none"];
/** Every pane with every framing subject: what get_view and set_view both send. */
const paneFrames = VIEW_PANES.flatMap((viewport) => frames.map((frame) => ({ viewport, frame, angle: "top" })));

/** Sample args per tool: every shape of script each one can send. */
const SAMPLES: Record<string, object[]> = {
  moi_eval: [{ script: "return 1;" }],
  set_units: UNITS.map((units) => ({ units })),
  get_scene: [{}],
  get_selection: [{}],
  set_selection: [{ ids: ["a", "b"] }],
  delete_objects: [{ ids: ["a", "b"] }],
  export_objects: [
    { ids: ["a"], path: "C:/x.obj", angle: 5 },
    { path: "C:/x.stl", output: "triangles", weld: false, divideLargerThan: 1, avoidSmallerThan: 0.5 },
    { path: "C:/x.step" },
  ],
  get_view: [...VIEWPORTS.map((viewport) => ({ viewport })), ...paneFrames],
  set_view: paneFrames,
  set_viewport_layout: LAYOUTS.map((layout) => ({ layout })),
  moi_factory_help: [
    { name: "loft", full: false },
    { name: "loft", full: true },
  ],
};

test("every registered tool's script is ES5", () => {
  for (const tool of TOOLS) {
    const samples = SAMPLES[tool.name];
    assert.ok(samples, `${tool.name} has no sample args here`);
    for (const args of samples)
      assertES5(tool.script(args), `${tool.name} ${JSON.stringify(args)}`);
  }
});

test("every script that takes ids reports a malformed or all-zero id missing, never throws", () => {
  // MoI's findObject throws on both; see findById in the bridge prelude.
  const bad = ["not-a-guid", guid(0)];
  const run = (script: string) => runScript(script, sceneOf(A).moi);
  assert.deepEqual(run(setSelectionTool.script({ ids: bad })).missing, bad);
  assert.deepEqual(run(deleteObjectsTool.script({ ids: bad })).missing, bad);
  assert.deepEqual(run(exportObjectsTool.script({ ids: bad, path: "C:/x.obj" })).missing, bad);
  assert.deepEqual(run(setViewTool.script({ viewport: "3D", frame: bad })).missing, bad);
});

test("delete_objects counts an id given twice once, and keeps the order and spelling given", () => {
  // MoI spells the ids back in its own case; the reply keeps the caller's.
  const a = guid(10), b = guid(11), gone = guid(99);
  const run = (ids: string[]) => {
    const fake = fakeMoi({ objects: [{ id: a.toUpperCase() }, { id: b.toUpperCase() }] });
    return { reply: runScript(deleteObjectsTool.script({ ids }), fake.moi), fake };
  };

  const first = run([b, gone, a, "bad"]);
  assert.deepEqual(first.reply, { removed: [b, a], missing: [gone, "bad"] });
  assert.deepEqual(first.fake.log, [`removeObject ${b.toUpperCase()}`, `removeObject ${a.toUpperCase()}`, "redraw"]);
  assert.deepEqual(first.fake.objects, []);

  const twice = run([a, a, gone, gone, b]);
  assert.deepEqual(twice.reply, { removed: [a, b], missing: [gone] });
  assert.deepEqual(
    twice.fake.log.filter((l) => l.startsWith("removeObject")),
    [`removeObject ${a.toUpperCase()}`, `removeObject ${b.toUpperCase()}`],
    "an id given twice is removed once",
  );
});

test("set_selection makes the selection exactly the objects found, and reports the rest", () => {
  const fake = sceneOf(A, { id: B, selected: true }, C);
  const reply = runScript(setSelectionTool.script({ ids: [A, guid(99), C] }), fake.moi);
  assert.deepEqual(reply, { selected: 2, missing: [guid(99)] });
  assert.deepEqual(fake.selectedIds(), [A, C]);
});

test("get_scene reports units, file name, count and one record per object", () => {
  const fake = fakeMoi({
    objects: [{ id: A }, { id: B, selected: true }],
    units: "Inches",
    currentFileName: "part.3dm",
  });
  const reply = runScript(getSceneTool.script({}), fake.moi);
  assert.equal(reply.units, "in");
  assert.equal(reply.unitsCode, "Inches");
  assert.equal(reply.file, "part.3dm");
  assert.equal(reply.objectCount, 2);
  assert.deepEqual(ids(reply.objects), [A, B]);
  assert.equal(reply.objects[0].typeName, "brep");
});

test("get_scene and get_selection say which objects are closed solids", () => {
  const fake = sceneOf({ id: A, solid: true, selected: true }, { id: B, selected: true }, { id: C, type: 2 });
  const scene = runScript(getSceneTool.script({}), fake.moi);
  assert.deepEqual(scene.objects.map((o: { isSolid: boolean }) => o.isSolid), [true, false, false]);
  const sel = runScript(getSelectionTool.script({}), fake.moi);
  assert.deepEqual(sel.objects.map((o: { isSolid: boolean }) => o.isSolid), [true, false]);
});

test("get_scene lists full records up to its cap, and id, name and type for every object above it", () => {
  const answer = (count: number) => {
    const fake = fakeMoi({ objects: Array.from({ length: count }, (_, i) => ({ id: guid(i + 1), name: `part ${i}` })) });
    const text = (getSceneTool.reply!(runScript(getSceneTool.script({}), fake.moi), {})[0] as { text: string }).text;
    assert.ok(!text.includes("\n"), "compact JSON");
    return JSON.parse(text);
  };

  const full = answer(FULL_SCENE_MAX);
  assert.equal(full.objectCount, FULL_SCENE_MAX);
  assert.equal(full.shortened, undefined);
  assert.equal(full.objects.length, FULL_SCENE_MAX);
  assert.ok("bbox" in full.objects[0] && "isSolid" in full.objects[0]);

  const over = answer(FULL_SCENE_MAX + 1);
  assert.equal(over.objectCount, FULL_SCENE_MAX + 1);
  assert.equal(over.units, "mm");
  assert.match(over.shortened, /moi_eval/);
  assert.deepEqual(ids(over.objects), Array.from({ length: FULL_SCENE_MAX + 1 }, (_, i) => guid(i + 1)));
  assert.deepEqual(Object.keys(over.objects[0]), ["id", "name", "typeName"]);
});

test("get_selection reports only the selected objects", () => {
  const fake = sceneOf(A, { id: B, selected: true }, { id: C, selected: true });
  const reply = runScript(getSelectionTool.script({}), fake.moi);
  assert.equal(reply.units, "mm");
  assert.equal(reply.count, 2);
  assert.deepEqual(ids(reply.objects), [B, C]);
});

/** Runs a moi_eval script on `moi` and returns the agent's answer: its content blocks. */
const evalReply = (script: string, moi: unknown) => moiEvalTool.reply!(runScript(moiEvalTool.script({ script }), moi), { script });
const valueOf = (script: string, moi: unknown) => JSON.parse((evalReply(script, moi)[0] as { text: string }).text);

test("moi_eval's capture returns the function's result and a record per object it added", () => {
  const fake = fakeMoi({ objects: [{ id: guid(1) }] });
  const script = `return capture( function () { moi.__add( { id: '${guid(2)}' } ); moi.__add( { id: '${guid(3)}' } ); return 7; } );`;
  const reply = valueOf(script, fake.moi);
  assert.equal(reply.result, 7);
  assert.deepEqual(ids(reply.created), [guid(2), guid(3)]);
  assert.equal(reply.created[0].typeName, "brep");
  assert.deepEqual(reply.consumed, []);
  assert.equal("warning" in reply, false);
});

test("capture lists the ids a boolean-like change removed, and does not warn", () => {
  const fake = fakeMoi({ objects: [{ id: guid(1) }, { id: guid(2) }, { id: guid(3) }] });
  const script =
    "return capture( function () { var db = moi.geometryDatabase; " +
    `db.removeObject( db.findObject( '${guid(1)}' ) ); db.removeObject( db.findObject( '${guid(2)}' ) ); ` +
    `moi.__add( { id: '${guid(4)}' } ); } );`;
  const reply = valueOf(script, fake.moi);
  assert.deepEqual(ids(reply.created), [guid(4)]);
  assert.deepEqual(reply.consumed, [guid(1), guid(2)]);
  assert.equal("warning" in reply, false);
});

test("capture around nothing warns, and moi_eval repeats the warning after the value", () => {
  const nothing = valueOf("return capture( function () {} );", fakeMoi().moi);
  assert.deepEqual(Object.keys(nothing), ["result", "created", "consumed", "warning"]);
  assert.deepEqual([nothing.result, nothing.created, nothing.consumed], [null, [], []]);
  assert.match(nothing.warning, /^Nothing was created or consumed\. .*fillet.*background image/);

  // The script drops the warning from its value; the reply still carries it, naming the capture.
  const fake = fakeMoi();
  const script = `var a = capture( function () { moi.__add( { id: '${guid(1)}' } ); } ); var b = capture( function () {} ); return b.created;`;
  const content = evalReply(script, fake.moi);
  assert.equal(content.length, 2);
  assert.deepEqual(content[0], { type: "text", text: "[]" });
  assert.match((content[1] as { text: string }).text, /^Warning \(capture 2 of 2\): Nothing was created or consumed\./);
  assert.equal((content[1] as { text: string }).text.split("\n").length, 1);

  // The next call, on the same document, starts with no warnings.
  assert.deepEqual(evalReply("return 1;", fake.moi), [{ type: "text", text: "1" }]);
});

test("a moi_eval with no warning replies with one block, as before", () => {
  const script = `return capture( function () { moi.__add( { id: '${guid(1)}' } ); } ).created.length;`;
  assert.deepEqual(evalReply(script, fakeMoi().moi), [{ type: "text", text: "1" }]);
  assert.deepEqual(evalReply("var x = 2;", fakeMoi().moi), [{ type: "text", text: "null" }]);
});

test("a moi_eval that throws after creating an object names what it left behind", () => {
  const fake = fakeMoi({ objects: [{ id: guid(1) }, { id: guid(2) }] });
  const script =
    `var db = moi.geometryDatabase; db.removeObject( db.findObject( '${guid(1)}' ) ); ` +
    `moi.__add( { id: '${guid(3)}' } ); throw new Error( 'boom' );`;
  assert.throws(
    () => runScript(moiEvalTool.script({ script }), fake.moi),
    (e: Error) =>
      e.message.startsWith("boom\n") &&
      e.message.includes(`created 1 object(s) that are still in the document: ${guid(3)}. Delete them with delete_objects`) &&
      e.message.includes(`consumed 1 object(s): ${guid(1)}.`) &&
      !e.message.includes(guid(2)) &&
      /Ctrl\+Z/.test(e.message),
  );
});

test("a moi_eval that throws before changing anything rethrows the error as it was", () => {
  const thrown = new Error("nope");
  const moi = fakeMoi({ objects: [{ id: guid(1) }] }).moi as unknown as Record<string, unknown>;
  moi.__thrown = thrown;
  assert.throws(() => runScript(moiEvalTool.script({ script: "throw moi.__thrown;" }), moi), (e) => e === thrown);
  assert.throws(() => runScript(moiEvalTool.script({ script: "throw 'plain';" }), moi), (e) => e === "plain");
});

test("the id snapshot leaves a successful moi_eval's reply unchanged", () => {
  const script = `moi.__add( { id: '${guid(2)}' } ); return 5;`;
  assert.deepEqual(evalReply(script, fakeMoi({ objects: [{ id: guid(1) }] }).moi), [{ type: "text", text: "5" }]);
});

test("moi_eval's description asks for capture around every commit, and no longer says it always works", () => {
  assert.match(moiEvalTool.description, /Wrap every commit in capture\(function\(\)\{ … \}\)/);
  assert.match(moiEvalTool.description, /Without capture there is no such check\./);
  assert.doesNotMatch(moiEvalTool.description, /always works/);
});

test("assertES5 rejects ES6 syntax and names the script", () => {
  assert.throws(() => assertES5("let x = 1;", "sample"), /sample is not ES5/);
  assert.throws(() => assertES5("var f = () => 1;", "sample"), /sample is not ES5/);
  assert.doesNotThrow(() => assertES5("return 1;", "sample"));
});

test("the fake finds an object by its id without braces, in either case, as MoI does", () => {
  const db = sceneOf(A).moi.geometryDatabase;
  assert.equal(db.findObject(A.slice(1, -1).toUpperCase())?.id, A);
  assert.throws(() => db.findObject("not-a-guid"), /is not a GUID/);
});
