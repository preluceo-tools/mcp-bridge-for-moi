import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool, TOOLS } from "./index.js";
import { fakeMoi, guid, ids, runScript } from "./fake-moi.js";
import { BridgeError, type SessionHost } from "./session.js";
import type { Tool } from "./tool.js";
import { moiEvalTool } from "./tools/moi-eval.js";
import { exportObjectsTool } from "./tools/export-objects.js";
import { NO_UNITS, setUnitsTool, UNITS } from "./tools/set-units.js";

/**
 * A host whose bridge runs each script against `moi`, the way the real one runs it in MoI, and
 * refuses a `needsUnits` call on a unitless document as the real one does (tested in bridge.test).
 */
const hostOn = (moi: any) =>
  ({
    call: async ({ script, needsUnits }: { script: string; needsUnits?: boolean }) => {
      if (needsUnits && moi.geometryDatabase.units === NO_UNITS) throw new BridgeError("no_units", "no units");
      return runScript(script, moi);
    },
    ensureOwner: async () => {},
  }) as unknown as SessionHost;

test("a moi_eval script that returns the bridge's old no-units shape gets its value back", async () => {
  const r = await runTool(hostOn(fakeMoi().moi), moiEvalTool, { script: "return { __moiMcpNoUnits: true };" });
  assert.notEqual(r.isError, true, text(r));
  assert.match(text(r), /__moiMcpNoUnits/);
});

const text = (r: Awaited<ReturnType<typeof runTool>>) =>
  r.content.map((c) => (c.type === "text" ? c.text : "")).join("");

const unitless = () => fakeMoi({ units: NO_UNITS, objects: [{ id: guid(1), selected: true }] });
// A path that does not exist in a folder that does: it gets past the precheck, and nothing writes it.
const nowhere = join(tmpdir(), "mcp-bridge-for-moi-no-units-part.step");

test("on a unitless document moi_eval and export_objects answer [no_units] and touch nothing", async () => {
  const calls: [Tool<any, any>, object][] = [
    [moiEvalTool, { script: `moi.__add( { id: '${guid(2)}' } ); moi.geometryDatabase.deselectAll(); return 1;` }],
    [exportObjectsTool, { ids: [guid(1)], path: nowhere }],
    [exportObjectsTool, { path: nowhere }],
  ];
  for (const [tool, args] of calls) {
    const fake = unitless();
    const r = await runTool(hostOn(fake.moi), tool, args);
    assert.equal(r.isError, true);
    assert.match(text(r), /^\[no_units\] /);
    for (const name of [...UNITS, "set_units", "Options > General > Units options"]) assert.ok(text(r).includes(name), name);
    assert.deepEqual(fake.log, [], `${tool.name} touched the document`);
    assert.deepEqual(fake.exports, []);
    assert.deepEqual(ids(fake.objects), [guid(1)]);
  }
});

test("on a unitless document every other tool answers as before", async () => {
  const args: Record<string, object> = {
    get_scene: {},
    get_selection: {},
    set_selection: { ids: [guid(1)] },
    delete_objects: { ids: [guid(9)] },
    set_view: { viewport: "3D", frame: "none" },
    set_viewport_layout: { layout: "split" },
  };
  for (const tool of TOOLS.filter((t) => !t.needsUnits)) {
    if (!args[tool.name]) continue;
    const r = await runTool(hostOn(unitless().moi), tool, args[tool.name]);
    assert.notEqual(r.isError, true, `${tool.name}: ${text(r)}`);
  }
  const scene = JSON.parse(text(await runTool(hostOn(unitless().moi), TOOLS.find((t) => t.name === "get_scene")!, {})));
  assert.equal(scene.units, "");
  assert.equal(scene.unitsCode, NO_UNITS);
});

test("set_units settles a unitless document and the next moi_eval runs", async () => {
  const fake = unitless();
  const host = hostOn(fake.moi);
  const r = await runTool(host, setUnitsTool, { units: "Inches" });
  assert.deepEqual(JSON.parse(text(r)), { units: "Inches" });
  assert.equal(fake.moi.geometryDatabase.unitsShortLabel, "in");
  assert.deepEqual(fake.log, ["units Inches"], "one assignment, nothing else");
  assert.equal(text(await runTool(host, moiEvalTool, { script: "return 1;" })), "1");
});

test("set_units on a document that has units refuses, names them, and changes nothing", async () => {
  const fake = fakeMoi({ units: "Feet" });
  const r = await runTool(hostOn(fake.moi), setUnitsTool, { units: "Millimeters" });
  assert.equal(r.isError, true);
  assert.match(text(r), /^\[units_set\] .*Feet.*MoI's Options/);
  assert.equal(fake.moi.geometryDatabase.units, "Feet");
  assert.deepEqual(fake.log, []);
});

test("the fake, like MoI, does not take an unknown unit name", () => {
  const fake = fakeMoi({ units: NO_UNITS });
  runScript("moi.geometryDatabase.units = 'mm';", fake.moi);
  assert.equal(fake.moi.geometryDatabase.units, NO_UNITS);
});
