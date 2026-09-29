import { sandbox } from "./sandbox.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const { SessionHost } = await import("./session.js");
const { fakeMoi, hostOn } = await import("./fake-moi.js");
const { readmeSection } = await import("./readme-section.js");
const { LAYOUTS } = await import("./scripts.js");
const { buildServer, TOOLS, descriptionOf } = await import("./index.js");
const { NO_UNITS_NOTE, NO_UNITS } = await import("./tools/set-units.js");
const { FACTORY_POINT_NOTE, REFERENCE } = await import("./tools/moi-factory-help.js");
const { READ_ONLY, CHANGING, WRITES_FILE, DESTRUCTIVE } = await import("./tool.js");

// A started host with no bridge attached: what an MCP client sees before MoI connects.
let host: InstanceType<typeof SessionHost>;
let client: Client;

before(async () => {
  host = new SessionHost();
  await host.start();
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await buildServer(host).connect(serverSide);
  client = new Client({ name: "mcp-test", version: "0" });
  await client.connect(clientSide);
});

after(async () => {
  await client.close();
  await host.stop();
});

type Reply = { isError?: boolean; content: { type: string; text?: string }[] };
const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as Reply;
const text = (r: Reply) => r.content.map((c) => c.text ?? "").join("");

test("listTools returns exactly the eleven tools, each described", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    [
      "delete_objects",
      "export_objects",
      "get_scene",
      "get_selection",
      "get_view",
      "moi_eval",
      "moi_factory_help",
      "set_selection",
      "set_units",
      "set_view",
      "set_viewport_layout",
    ],
  );
  for (const t of tools) assert.ok(t.description?.trim(), `${t.name} has no description`);
});

// Every tool is either direct or refused while a command runs, and says which.
test("each tool is direct or refusing, and its description says so", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), TOOLS.map((t) => t.name));
  for (const t of tools) {
    const tool = TOOLS.find((x) => x.name === t.name)!;
    const direct = tool.direct;
    // The note is appended by the server, never written into a tool's own description.
    assert.doesNotMatch(tool.description, /command_running/, `${t.name} writes its own note`);
    assert.equal(t.description, descriptionOf(tool), `${t.name} description`);
    assert.equal(
      /command_running/.test(t.description ?? ""),
      !direct,
      `${t.name} description ${direct ? "must not" : "must"} mention command_running`,
    );
  }
});

// Which kind each tool is, is checked against the README below; this checks the declared
// annotations are what a client actually receives.
test("each tool's declared annotations reach listTools", async () => {
  const { tools } = await client.listTools();
  for (const t of tools) {
    assert.deepEqual(t.annotations, TOOLS.find((x) => x.name === t.name)!.annotations, `${t.name} annotations`);
  }
});

// The README's Kind column is what a user reads before trusting a tool; it must match the
// constant each tool actually declares.
test("the server reports the version in package.json", () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"));
  assert.equal(client.getServerVersion()?.version, pkg.version);
});

test("the README's Kind column names the annotation constant each tool declares", () => {
  const constants: Record<string, unknown> = {
    "read-only": READ_ONLY,
    changing: CHANGING,
    "writes a file": WRITES_FILE,
    destructive: DESTRUCTIVE,
  };
  const section = readmeSection("### What the agent can call");
  const rows = [...section.matchAll(/^\| `(\w+)` \| ([^|]+) \|/gm)].map(([, name, kind]) => [name, kind.replace(/\*/g, "").trim()]);
  const listed = rows.filter(([name]) => TOOLS.some((t) => t.name === name));
  assert.deepEqual(listed.map(([name]) => name).sort(), TOOLS.map((t) => t.name).sort(), "README tool table");
  for (const [name, kind] of listed) {
    assert.ok(kind in constants, `${name}: README kind '${kind}' is not one of the four`);
    assert.equal(TOOLS.find((t) => t.name === name)!.annotations, constants[kind], `${name} is not ${kind}`);
  }
});

// Two wordings of one warning, one for the agent and one for the user: they must name the same
// inputs and the same symptom.
test("moi_eval's point-input warning and the README's factory quirk say the same thing", () => {
  const quirk = readmeSection("### Factory quirks").split("\n- **")[1];
  for (const word of ["cylinder", "cone", "Height", "End pt", "flat circle", "boolean"]) {
    assert.ok(FACTORY_POINT_NOTE.includes(word), `the description's note lacks ${word}`);
    assert.ok(quirk.includes(word), `the README's quirk lacks ${word}`);
  }
  assert.ok(REFERENCE.traps.includes(FACTORY_POINT_NOTE));
});

// Claude Code cuts every tool description at 2,048 characters, and the refusal notes sit at the end.
test("every tool description, refusal notes included, fits Claude Code's 2,048-character cap", () => {
  for (const t of TOOLS) assert.ok(descriptionOf(t).length <= 2048, `${t.name} is ${descriptionOf(t).length} characters`);
});

// The two tools a size enters or leaves by are refused on a unitless document, and say so.
test("moi_eval and export_objects say no_units and set_units; set_units says it never converts", async () => {
  const { tools } = await client.listTools();
  for (const t of tools) {
    const gated = t.name === "moi_eval" || t.name === "export_objects";
    assert.equal(TOOLS.find((x) => x.name === t.name)!.needsUnits === true, gated, `${t.name} needsUnits`);
    assert.equal(t.description?.includes(NO_UNITS_NOTE), gated, `${t.name} no_units note`);
    if (gated) assert.match(t.description ?? "", /no_units.*ask the user.*testing.*Millimeters/);
  }
  const setUnits = tools.find((t) => t.name === "set_units")!.description ?? "";
  assert.match(setUnits, /only settles units and never converts/);
  assert.match(setUnits, /Ask the user.*testing.*Millimeters/);
});

// A refusal is a schema error, never a call to MoI: with no bridge, a call that got past
// the schema would come back [no_session] instead.
for (const [name, args] of [
  ["get_view", { padding: -1 }],
  ["get_view", { size: 4096 }],
  ["set_viewport_layout", { layout: "quad" }],
  ["set_view", { viewport: "3D" }],
  ["export_objects", { path: "out.step" }],
  ["export_objects", { path: join(sandbox, "copy.3dm") }],
  ["export_objects", { path: join(sandbox, "copy.3DM") }],
  ["export_objects", { path: join(sandbox, "noextension") }],
  ["export_objects", { path: join(sandbox, "out.step"), ids: [] }],
  ["export_objects", { path: join(sandbox, "out.obj"), angle: 0 }],
  ["export_objects", { path: join(sandbox, "out.obj"), angle: -5 }],
  ["export_objects", { path: join(sandbox, "out.obj"), output: "polygons" }],
  ["export_objects", { path: join(sandbox, "out.obj"), weld: "yes" }],
  ["export_objects", { path: join(sandbox, "out.obj"), divideLargerThan: -1 }],
  ["export_objects", { path: join(sandbox, "out.obj"), divideLargerThanApplyTo: "curves" }],
  ["export_objects", { path: join(sandbox, "out.obj"), avoidSmallerThan: -0.5 }],
  ["export_objects", { path: join(sandbox, "out.obj"), aspectRatioLimit: -2 }],
  ["set_units", { units: "mm" }],
  ["set_units", { units: "Metres" }],
  ["set_units", { units: "No unit system" }],
  ["set_units", {}],
] as const) {
  test(`${name} ${JSON.stringify(args)} is refused by the schema`, async () => {
    const r = await call(name, args);
    assert.equal(r.isError, true);
    assert.match(text(r), /Input validation error/);
    assert.doesNotMatch(text(r), /no_session/);
  });
}

test("an unknown layout's refusal names the valid layouts", async () => {
  const r = await call("set_viewport_layout", { layout: "quad" });
  assert.ok(text(r).includes(`Unknown layout. Valid layouts: ${LAYOUTS.join(", ")}.`), text(r));
});

test("a missing layout's refusal says it is required and names the valid layouts", async () => {
  const r = await call("set_viewport_layout", {});
  assert.equal(r.isError, true);
  assert.ok(text(r).includes(`\`layout\` is required. Valid layouts: ${LAYOUTS.join(", ")}.`), text(r));
});

// Refused before MoI is asked: with no bridge, a call that got further would be [no_session].
for (const [name, args, why] of [
  ["get_view", { padding: 1 }, /padding needs a frame/],
  ["get_view", { frame: "none", padding: 1 }, /padding needs a frame/],
  ["set_view", { viewport: "3D", frame: "none", padding: 1 }, /padding needs a frame/],
  ["get_view", { viewport: "window", frame: "scene" }, /no camera to aim/],
  ["get_view", { viewport: "window", frame: ["{a}"] }, /no camera to aim/],
] as const) {
  test(`${name} ${JSON.stringify(args)} is refused as bad_request`, async () => {
    const r = await call(name, args);
    assert.equal(r.isError, true);
    assert.match(text(r), /^\[bad_request\]/);
    assert.match(text(r), why);
  });
}

// Refused before MoI is asked: with no bridge, a call that got further would be [no_session].
test("export_objects refuses a path that already exists", async () => {
  const existing = join(sandbox, "already.step");
  writeFileSync(existing, "keep me");
  const r = await call("export_objects", { path: existing, ids: ["{a}"] });
  assert.equal(r.isError, true);
  assert.match(text(r), /^\[bad_request\].*already exists/);
});

test("export_objects to .obj refuses when the .mtl beside it already exists", async () => {
  writeFileSync(join(sandbox, "sidecar.mtl"), "keep me");
  const r = await call("export_objects", { path: join(sandbox, "sidecar.obj") });
  assert.equal(r.isError, true);
  assert.match(text(r), /^\[bad_request\].*sidecar\.mtl/);
});

test("moi_factory_help with no name answers the index without MoI", async () => {
  const r = await call("moi_factory_help");
  assert.notEqual(r.isError, true);
  const index = JSON.parse(text(r));
  assert.ok(index.count > 0);
  assert.equal(Object.keys(index.factories).length, index.count);
  assert.deepEqual(index.reference, ["traps", "helpers", "object", "edge", "style"]);
});

for (const [name, marker] of [
  ["object", /getNakedEdges\(\)\.length === 0/],
  ["edge", /no face1/],
  ["style", /getObjectStyles\(\)/],
] as const) {
  test(`moi_factory_help ${name} answers its notes without MoI`, async () => {
    const r = await call("moi_factory_help", { name });
    assert.notEqual(r.isError, true);
    assert.match(text(r), marker);
  });
}

// A client on a server whose bridge runs scripts against the fake moi, or refuses with `refuse`.
async function clientOn(fake: ReturnType<typeof fakeMoi>, refuse?: "command_running") {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await buildServer(hostOn(fake.moi, refuse)).connect(serverSide);
  const c = new Client({ name: "mcp-test", version: "0" });
  await c.connect(clientSide);
  return c;
}

test("a failed moi_eval ends with the pointer to the traps note; success and other codes do not", async () => {
  const pointer = "moi_factory_help('traps')";
  const evalOn = async (fake: ReturnType<typeof fakeMoi>, script: string, refuse?: "command_running") => {
    const c = await clientOn(fake, refuse);
    try {
      return (await c.callTool({ name: "moi_eval", arguments: { script } })) as Reply;
    } finally {
      await c.close();
    }
  };
  const failed = await evalOn(fakeMoi(), "throw new Error('deliberate');");
  assert.equal(failed.isError, true);
  assert.match(text(failed), /^\[moi_error\] .*deliberate/);
  assert.ok(text(failed).trimEnd().split("\n").at(-1)!.includes(pointer), text(failed));

  const ok = await evalOn(fakeMoi(), "return 1;");
  assert.notEqual(ok.isError, true, text(ok));
  assert.ok(!text(ok).includes(pointer));

  const unitless = await evalOn(fakeMoi({ units: NO_UNITS }), "return 1;");
  assert.match(text(unitless), /^\[no_units\]/);
  assert.ok(!text(unitless).includes(pointer));

  const running = await evalOn(fakeMoi(), "return 1;", "command_running");
  assert.match(text(running), /^\[command_running\]/);
  assert.ok(!text(running).includes(pointer));
});

for (const [name, args] of [
  ["moi_eval", { script: "return 1;" }],
  ["set_units", { units: "Millimeters" }],
  ["get_scene", {}],
  ["get_selection", {}],
  ["set_selection", { ids: [] }],
  ["delete_objects", { ids: [] }],
  ["get_view", {}],
  ["get_view", { viewport: "window", frame: "none" }],
  ["get_view", { frame: "scene", padding: 1 }],
  ["set_view", { viewport: "3D", frame: "none" }],
  ["set_view", { viewport: "3D", frame: "scene", padding: 1 }],
  ["set_viewport_layout", { layout: "split" }],
  ["moi_factory_help", { name: "box" }],
  ["export_objects", { path: join(sandbox, "fresh.step"), ids: ["{a}"] }],
] as const) {
  test(`${name} with no bridge answers [no_session]`, async () => {
    const r = await call(name, args);
    assert.equal(r.isError, true);
    assert.match(text(r), /^\[no_session\]/);
  });
}
