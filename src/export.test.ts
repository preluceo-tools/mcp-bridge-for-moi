import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportObjectsTool } from "./tools/export-objects.js";
import { A, B, C, fakeMoi, guid, runScript } from "./fake-moi.js";
import { runTool, descriptionOf } from "./index.js";
import type { SessionHost } from "./session.js";
import { READ_ONLY, type Tool } from "./tool.js";

const exportObjects = exportObjectsTool.script;

const PATH = "C:\\out\\part.obj";
/** MoI's options string for a mesh export with every setting at its default, angle aside. */
const meshOptions = (angle: number) =>
  `NoUI=true;Angle=${angle};Output=quads;Weld=true;MaxLength=0;MaxLengthApplyTo=curved;MinLength=0;AspectRatio=0`;
const cases = [
  { name: "ids", opts: { ids: ["{a}", "{b}"], path: PATH } },
  { name: "ids + angle", opts: { ids: ["{a}"], path: PATH, angle: 12.5 } },
  { name: "whole scene", opts: { path: PATH } },
  { name: "whole scene + angle", opts: { path: PATH, angle: 5 } },
];

for (const { name, opts } of cases) {
  test(`exportObjects (${name}) always sends NoUI=true`, () => {
    assert.match(exportObjects(opts), /'NoUI=true/);
  });
}

const doc = (fileExportThrows = false) =>
  fakeMoi({ objects: [{ id: A }, { id: B }, { id: C, selected: true }], fileExportThrows });

test("with ids: fileExport sees exactly the targets selected, and the user's selection comes back", () => {
  const fake = doc();
  const r = runScript(exportObjects({ ids: [A, guid(99), B], path: PATH, angle: 45 }), fake.moi);
  assert.deepEqual(r, { via: "fileExport", exported: true, found: 2, missing: [guid(99)] });
  // The path reaches MoI exactly as given, backslashes and all.
  assert.deepEqual(fake.exports, [{ via: "fileExport", path: PATH, options: meshOptions(45), selected: [A, B] }]);
  assert.deepEqual(fake.selectedIds(), [C]);
});

test("with ids: the user's selection comes back even when fileExport throws", () => {
  const fake = doc(true);
  assert.throws(() => runScript(exportObjects({ ids: [A], path: PATH }), fake.moi), /export failed/);
  assert.equal(fake.exports[0].options, meshOptions(12));
  assert.deepEqual(fake.selectedIds(), [C]);
});

test("with ids: an export that changes the selection itself still gives back exactly the user's", () => {
  const fake = fakeMoi({ objects: [{ id: A }, { id: B }, { id: C, selected: true }], fileExportSelectsAll: true });
  runScript(exportObjects({ ids: [A], path: PATH }), fake.moi);
  assert.deepEqual(fake.selectedIds(), [C]);
});

test("with ids, none found: nothing is exported and exported is false", () => {
  const fake = doc();
  const r = runScript(exportObjects({ ids: [guid(98), guid(99)], path: PATH }), fake.moi);
  assert.deepEqual(r, { via: "fileExport", exported: false, found: 0, missing: [guid(98), guid(99)] });
  assert.deepEqual(fake.exports, []);
  assert.deepEqual(fake.log, []);
});

// A mesh export never inherits the user's last angle: left out, it is sent as the default 12.
test("without ids: saveAs, and no selection is touched", () => {
  for (const angle of [undefined, 12.5]) {
    const fake = doc();
    const r = runScript(exportObjects({ path: PATH, angle }), fake.moi);
    assert.deepEqual(r, { via: "saveAs", exported: true, found: null, missing: [] });
    const options = meshOptions(angle ?? 12);
    assert.deepEqual(fake.exports, [{ via: "saveAs", path: PATH, options, selected: [C] }]);
    assert.deepEqual(fake.log, [`saveAs ${PATH}`], "a whole-scene export touched the selection");
  }
});

test("a mesh export sends every caller value under MoI's key", () => {
  const fake = doc();
  runScript(exportObjects({
    path: "C:\\out\\part.FBX", angle: 3, output: "ngons", weld: false, divideLargerThan: 2.5,
    divideLargerThanApplyTo: "all", avoidSmallerThan: 0.1, aspectRatioLimit: 4,
  }), fake.moi);
  assert.equal(fake.exports[0].options,
    "NoUI=true;Angle=3;Output=ngons;Weld=false;MaxLength=2.5;MaxLengthApplyTo=all;MinLength=0.1;AspectRatio=4");
});

test("a mesh export fills only the settings left out; STL defaults to triangles", () => {
  const fake = doc();
  runScript(exportObjects({ path: PATH, weld: false }), fake.moi);
  runScript(exportObjects({ path: "C:\\out\\part.stl" }), fake.moi);
  assert.deepEqual(fake.exports.map((e) => e.options), [
    meshOptions(12).replace("Weld=true", "Weld=false"),
    meshOptions(12).replace("Output=quads", "Output=triangles"),
  ]);
});

test("a non-mesh export sends NoUI=true alone", () => {
  const fake = doc();
  runScript(exportObjects({ path: "C:\\out\\part.step" }), fake.moi);
  assert.equal(fake.exports[0].options, "NoUI=true");
});

// A host that fails the test if anything reaches the bridge.
const noBridge = {
  call: () => assert.fail("reached the bridge"),
  ensureOwner: () => assert.fail("reached the bridge"),
} as unknown as SessionHost;

test("a precheck refusal never reaches the bridge", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-bridge-for-moi-export-"));
  try {
    const existing = join(dir, "part.step");
    writeFileSync(existing, "keep me");
    const r = await runTool(noBridge, exportObjectsTool, { ids: ["{a}"], path: existing });
    assert.equal(r.isError, true);
    assert.match(r.content[0].type === "text" ? r.content[0].text : "", /^\[bad_request\].*already exists/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const refusal = (r: Awaited<ReturnType<typeof runTool>>) => {
  assert.equal(r.isError, true);
  return r.content[0].type === "text" ? r.content[0].text : "";
};

test("a target folder that does not exist is refused, naming it, and never reaches the bridge", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-bridge-for-moi-export-"));
  try {
    writeFileSync(join(dir, "a-file"), "");
    // Missing outright, and "missing" because a part of the path is a file.
    for (const missing of [join(dir, "no-such-folder"), join(dir, "a-file", "sub")]) {
      const r = await runTool(noBridge, exportObjectsTool, { path: join(missing, "part.step") });
      const text = refusal(r);
      assert.match(text, /^\[bad_request\].*does not exist/);
      assert.ok(text.includes(missing), text);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const ext of ["dwg", "DWG", "Dwg"]) {
  test(`.${ext} is refused as unwritable by MoI 4, pointing to DXF, and never reaches the bridge`, async () => {
    const r = await runTool(noBridge, exportObjectsTool, { ids: ["{a}"], path: join(tmpdir(), `part.${ext}`) });
    assert.match(refusal(r), /^\[bad_request\].*cannot write DWG.*\.dxf/);
  });
}

test("mesh settings on a non-mesh format are refused, naming them, and never reach the bridge", async () => {
  const text = refusal(await runTool(noBridge, exportObjectsTool, { path: join(tmpdir(), "part.step"), angle: 5, weld: false }));
  assert.match(text, /^\[bad_request\] angle, weld: .*not one/);
});

for (const output of ["quads", "ngons"] as const) {
  test(`STL with output ${output} is refused and never reaches the bridge`, async () => {
    const r = await runTool(noBridge, exportObjectsTool, { path: join(tmpdir(), "part.Stl"), output });
    assert.match(refusal(r), /^\[bad_request\] STL is always triangles/);
  });
}

test("the reply echoes the mesh settings sent, and a non-mesh reply has none", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-bridge-for-moi-export-"));
  try {
    const obj = join(dir, "part.obj"), step = join(dir, "part.step");
    // Stands in for MoI: writes the file the call asked for.
    const json = async (args: { path: string; angle?: number }) => {
      const host = { call: async () => {
        writeFileSync(args.path, "x");
        return { via: "saveAs", exported: true, found: null, missing: [] };
      } } as unknown as SessionHost;
      const r = await runTool(host, exportObjectsTool, args);
      return JSON.parse(r.content[0].type === "text" ? r.content[0].text : "");
    };
    assert.deepEqual((await json({ path: obj, angle: 7 })).meshSettings, {
      angle: 7, output: "quads", weld: true, divideLargerThan: 0, divideLargerThanApplyTo: "curved",
      avoidSmallerThan: 0, aspectRatioLimit: 0,
    });
    assert.equal("meshSettings" in (await json({ path: step })), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a tool that is not direct gets REFUSES_NOTE; a direct one does not", () => {
  const tool = (direct: boolean): Tool<object, unknown> => ({
    name: "t",
    description: "Does a thing.",
    input: {},
    direct,
    annotations: READ_ONLY,
    script: () => "",
  });
  assert.match(descriptionOf(tool(false)), /^Does a thing\. Refused with command_running/);
  assert.equal(descriptionOf(tool(true)), "Does a thing.");
});
