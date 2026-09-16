import { test, describe, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertES5 } from "./es5.js";
import { prelude, fakeMoi, advance, APPDATA_DIR, BRIDGE_PATH } from "./fake-moi.js";
import { PROTOCOL } from "./session.js";

const BRIDGE = readFileSync(BRIDGE_PATH, "utf8");
const HANDSHAKE = `${APPDATA_DIR}mcp-bridge-for-moi-handshake.json`;
const COMMAND_FILE = `${APPDATA_DIR}commands\\mcp-bridge-for-moi-eval.js`;
const TOKEN = "t/ok+en";

type Fake = ReturnType<typeof fakeMoi>;

/**
 * Runs the shipped bridge the way MoI's script host does — `moi` supplied, nothing else — on a
 * mocked clock. With `handshake` (the default) the handshake file is there before it starts.
 */
function startBridge(t: TestContext, opts: Parameters<typeof fakeMoi>[0] & { handshake?: boolean } = {}): Fake {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const fake = fakeMoi(opts);
  if (opts.handshake !== false) fake.files.set(HANDSHAKE, JSON.stringify({ port: 4711, token: TOKEN, protocol: PROTOCOL }));
  new Function("moi", BRIDGE)(fake.moi);
  return fake;
}

/** Starts the bridge and brings it to an open socket through a good gate. */
function connected(t: TestContext, opts: Parameters<typeof fakeMoi>[0] = {}) {
  const fake = startBridge(t, opts);
  advance(t, 1000);
  fake.requests[0].respond(200, "mcp-bridge-for-moi");
  const ws = fake.sockets[0];
  ws.open();
  return { ...fake, ws };
}

/** What the bridge sent other than pings. */
const replies = (ws: { frames(): any[] }) => ws.frames().filter((f) => f.t !== "ping");

describe("bridge", () => {
  test("parses as ES5", () => {
    assertES5(BRIDGE, "assets/bridge.js");
  });

  test("the command it installs parses as ES5", (t) => {
    const fake = startBridge(t);
    const command = fake.files.get(COMMAND_FILE);
    assert.ok(command, "the bridge wrote no command file");
    assertES5(command, "mcp-bridge-for-moi-eval.js");
  });

  test("object records name the probed type codes and nothing else", () => {
    const toJson = new Function(`${prelude()}\nreturn toJson;`)() as (o: object) => { type: number; typeName: string };
    const names: Record<number, string> = {};
    for (const t of [1, 2, 3, 4, 5, 6, 7, 9]) {
      const r = toJson({ id: "{x}", type: t, getBoundingBox: () => null });
      assert.equal(r.type, t);
      names[t] = r.typeName;
    }
    assert.deepEqual(names, {
      1: "curve segment", 2: "curve", 3: "brep", 4: "face", 5: "unknown", 6: "point", 7: "unknown", 9: "unknown",
    });
  });

  test("isSolid is true only when isSolidBRep is exactly true", () => {
    const toJson = new Function(`${prelude()}\nreturn toJson;`)() as (o: object) => { isSolid: boolean };
    const solid = (isSolidBRep?: unknown) => toJson({ id: "{x}", type: 3, isSolidBRep, getBoundingBox: () => null }).isSolid;
    assert.equal(solid(true), true);
    assert.equal(solid(false), false);
    assert.equal(solid(undefined), false);
  });

  test("faces() and edges() list sub-objects as { index, bbox }, and [] for nothing", () => {
    type Rows = (o: unknown) => unknown[];
    const [faces, edges] = new Function(`${prelude()}\nreturn [faces, edges];`)() as [Rows, Rows];
    const item = (z: number) => ({ getBoundingBox: () => ({ min: { x: 0, y: 0, z }, max: { x: 1, y: 1, z } }) });
    const list = (n: number) => ({ length: n, item: (i: number) => item(i) });
    const box = { getFaces: () => list(2), getEdges: () => list(3) };
    assert.deepEqual(faces(box), [
      { index: 0, bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } } },
      { index: 1, bbox: { min: { x: 0, y: 0, z: 1 }, max: { x: 1, y: 1, z: 1 } } },
    ]);
    assert.equal(edges(box).length, 3);
    assert.deepEqual([faces(null), edges(null), faces(undefined), edges({})], [[], [], [], []]);
  });
});

describe("bridge startup", () => {
  /** Not started: it says why, never arms, and makes no request however long it waits. */
  const refused = (t: TestContext, fake: Fake, why: RegExp) => {
    advance(t, 60_000);
    assert.equal(fake.logLines.length, 1);
    assert.match(fake.logLines[0], why);
    assert.equal(fake.requests.length, 0);
  };

  test("a MoI whose major version is not 4 does not start, and says so", (t) => {
    refused(t, startBridge(t, { majorVersion: 5 }), /supports MoI 4 only; found version 5/);
  });

  for (const lacks of ["WebSocket", "XMLHttpRequest", "setTimeout"] as const) {
    test(`a side pane window without ${lacks} does not start`, (t) => {
      refused(t, startBridge(t, { windowLacks: [lacks] }), /side pane window is not usable/);
    });
  }

  test("an unwritable commands folder does not start", (t) => {
    refused(t, startBridge(t, { unwritable: [`${APPDATA_DIR}commands`] }), /could not write .*commands folder/);
  });

  test("a good start logs bridge armed", (t) => {
    const fake = startBridge(t);
    assert.deepEqual(fake.logLines, ["[mcp-bridge-for-moi] bridge armed"]);
  });
});

describe("bridge gate", () => {
  test("no handshake file: no gate request is made", (t) => {
    const fake = startBridge(t, { handshake: false });
    advance(t, 60_000);
    assert.equal(fake.requests.length, 0);
  });

  for (const [what, status, body] of [
    ["a non-200 gate", 500, "mcp-bridge-for-moi"],
    ["a gate from some other service", 200, "hello from another server"],
    ["a busy gate", 200, "mcp-bridge-for-moi busy"],
  ] as const) {
    test(`${what} opens no socket`, (t) => {
      const fake = startBridge(t);
      advance(t, 1000);
      assert.equal(fake.requests.length, 1);
      assert.equal(fake.requests[0].url, "http://127.0.0.1:4711/gate");
      fake.requests[0].respond(status, body);
      advance(t, 5000);
      fake.requests[1].respond(status, body);
      assert.equal(fake.sockets.length, 0);
    });
  }

  test("a good gate opens exactly one socket carrying the token and protocol", (t) => {
    const fake = startBridge(t);
    advance(t, 1000);
    fake.requests[0].respond(200, "mcp-bridge-for-moi");
    advance(t, 30_000);   // still connecting: no second gate, no second socket
    fake.sockets[0].open();
    advance(t, 30_000);
    assert.equal(fake.sockets.length, 1);
    assert.equal(fake.requests.length, 1);
    assert.equal(fake.sockets[0].url, `ws://127.0.0.1:4711/bridge?token=${encodeURIComponent(TOKEN)}&protocol=${PROTOCOL}`);
    assert.ok(fake.logLines.includes("[mcp-bridge-for-moi] attached to server on port 4711"));
  });
});

describe("bridge calls", () => {
  test("a direct call is answered at once", (t) => {
    const { ws } = connected(t);
    ws.receive({ id: 1, op: "eval", direct: true, script: "return 40 + 2;" });
    assert.deepEqual(ws.frames(), [{ id: 1, ok: true, value: 42 }]);
  });

  test("a command call runs through the installed command and is answered", (t) => {
    const { ws, log } = connected(t);
    ws.receive({ id: 1, op: "eval", script: "return typeof capture;" });
    assert.deepEqual(ws.frames(), []);
    advance(t, 100);
    assert.deepEqual(log, ["execCommand mcp-bridge-for-moi-eval"]);
    assert.deepEqual(ws.frames(), [{ id: 1, ok: true, value: "function" }]);
  });

  test("a script that throws is answered with its message", (t) => {
    const { ws } = connected(t);
    ws.receive({ id: 1, op: "eval", script: "throw new Error('nope');" });
    advance(t, 100);
    assert.deepEqual(ws.frames(), [{ id: 1, ok: false, value: null, error: { code: "moi_error", message: "nope" } }]);
  });

  test("calls are answered in arrival order", (t) => {
    const { ws } = connected(t);
    ws.receive({ id: 1, op: "eval", script: "return 1;" });
    ws.receive({ id: 2, op: "eval", direct: true, script: "return 2;" });
    ws.receive({ id: 3, op: "eval", script: "return 3;" });
    advance(t, 1000);
    assert.deepEqual(replies(ws).map((f) => [f.id, f.value]), [[1, 1], [2, 2], [3, 3]]);
  });

  test("with a user command running, a command call is refused and a direct call still answered", (t) => {
    const { ws, moi, log } = connected(t);
    moi.command.currentCommandName = "Fillet";
    ws.receive({ id: 1, op: "eval", script: "return 1;" });
    ws.receive({ id: 2, op: "eval", direct: true, script: "return 2;" });
    const [refusal, answer] = ws.frames();
    assert.equal(refusal.id, 1);
    assert.equal(refusal.error.code, "command_running");
    assert.match(refusal.error.message, /the Fillet command/);
    assert.deepEqual(answer, { id: 2, ok: true, value: 2 });
    assert.deepEqual(log, []);   // never dispatched: the user's command is not ended
  });

  test("a result arriving after its call timed out is discarded; the next call gets its own", (t) => {
    const { ws, window, runHeldCommands } = connected(t, { holdCommands: true });
    ws.receive({ id: 1, op: "eval", script: "return 'first';" });
    advance(t, 26_000);
    assert.deepEqual(replies(ws).map((f) => [f.id, f.ok]), [[1, false]]);
    assert.match(replies(ws)[0].error.message, /did not run the script within 25s/);
    ws.receive({ id: 2, op: "eval", script: "return 'second';" });
    // Call 1's command finishes late and leaves its answer where call 2 is looking.
    window.__moiMcpResult = JSON.stringify({ id: "1", ok: true, value: "first" });
    advance(t, 100);
    runHeldCommands();
    advance(t, 100);
    assert.deepEqual(replies(ws).slice(1), [{ id: 2, ok: true, value: "second" }]);
  });
});

describe("bridge units check", () => {
  test("a needsUnits call on a unitless document is refused with no_units and runs nothing", (t) => {
    const { ws, log, objects } = connected(t, { units: "No unit system" });
    ws.receive({ id: 1, op: "eval", needsUnits: true, script: "moi.__add({ id: 'x' }); return 1;" });
    ws.receive({ id: 2, op: "eval", needsUnits: true, direct: true, script: "return 2;" });
    advance(t, 100);
    assert.deepEqual(replies(ws).map((f) => [f.id, f.error?.code]), [[1, "no_units"], [2, "no_units"]]);
    assert.deepEqual(log, []);
    assert.equal(objects.length, 0);
  });

  test("a script returning the old no-units marker comes back as its value", (t) => {
    const { ws } = connected(t);
    ws.receive({ id: 1, op: "eval", needsUnits: true, script: "return { __moiMcpNoUnits: true };" });
    advance(t, 100);
    assert.deepEqual(replies(ws), [{ id: 1, ok: true, value: { __moiMcpNoUnits: true } }]);
  });

  test("findById is a prelude helper: a malformed id is null, never thrown", () => {
    const find = (id: string) => new Function("moi", `${prelude()}\nreturn findById(${JSON.stringify(id)});`)(fakeMoi().moi);
    assert.equal(find("not-a-guid"), null);
  });
});

describe("bridge liveness", () => {
  test("abandoning a connection drops its queue: nothing queued runs, and nothing is replied to the next one", (t) => {
    const fake = connected(t, { holdCommands: true });
    const { ws } = fake;
    ws.receive({ id: 1, op: "eval", script: "return 1;" });   // in flight, held
    ws.receive({ id: 2, op: "eval", script: "return 2;" });
    ws.receive({ id: 3, op: "eval", direct: true, script: "moi.__add({ id: 'x' }); return 3;" });
    ws.serverClose();
    advance(t, 20_000);
    fake.requests[fake.requests.length - 1].respond(200, "mcp-bridge-for-moi");
    const next = fake.sockets[1];
    next.open();
    fake.runHeldCommands();
    advance(t, 1000);
    fake.runHeldCommands();
    advance(t, 1000);
    assert.deepEqual(replies(ws), []);
    assert.deepEqual(replies(next), []);
    assert.deepEqual(fake.log, ["execCommand mcp-bridge-for-moi-eval"]);
    assert.equal(fake.objects.length, 0);
  });

  const ABANDONED = /abandoning/;

  test("45 s with no pong abandons the socket without calling close()", (t) => {
    const fake = connected(t);
    const { ws } = fake;
    advance(t, 30_000);
    assert.ok(ws.frames().some((f) => f.t === "ping"));
    assert.ok(!fake.logLines.some((l) => ABANDONED.test(l)));
    advance(t, 30_000);
    assert.ok(fake.logLines.includes("[mcp-bridge-for-moi] abandoning connection: no pong within 45s"));
    assert.equal(ws.closeCalled, false);
    assert.ok(fake.requests.length > 1, "back to polling the gate");
  });

  test("pongs keep the connection", (t) => {
    const fake = connected(t);
    for (let i = 0; i < 10; i++) {
      advance(t, 15_000);
      fake.ws.receive({ t: "pong" });
    }
    assert.ok(!fake.logLines.some((l) => ABANDONED.test(l)));
    assert.equal(fake.requests.length, 1);
  });

  test("a long gap between ticks is a wake from standby: the connection stays and the pong clock restarts", (t) => {
    const fake = connected(t);
    advance(t, 5000);   // first tick after open, at 6 s
    t.mock.timers.setTime(600_000);   // standby: the clock moves, no timer fires
    advance(t, 1);
    assert.ok(fake.logLines.some((l) => /resumed after \d+s; keeping connection/.test(l)));
    advance(t, 30_000);   // 30 s after wake: still inside the restarted 45 s
    assert.ok(!fake.logLines.some((l) => ABANDONED.test(l)));
    assert.equal(fake.sockets.length, 1);
    advance(t, 30_000);   // the server really is gone
    assert.ok(fake.logLines.some((l) => ABANDONED.test(l)));
  });

  test("messages arriving on an abandoned socket are not run", (t) => {
    const fake = connected(t);
    const { ws } = fake;
    advance(t, 60_000);
    const before = ws.sent.length;
    ws.receive({ id: 9, op: "eval", direct: true, script: "moi.__add({ id: 'x' }); return 9;" });
    ws.receive({ id: 10, op: "eval", script: "return 10;" });
    advance(t, 100);
    assert.equal(ws.sent.length, before);
    assert.deepEqual(fake.log, []);
    assert.equal(fake.objects.length, 0);
  });
});
