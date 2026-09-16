import { test, beforeEach, afterEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import "./sandbox.js";
import { readFileSync, writeFileSync } from "node:fs";
import { WebSocket } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { APPDATA_DIR, BRIDGE_PATH, advance, fakeMoi } from "./fake-moi.js";

const { SessionHost, BridgeError, PROTOCOL, CALL_TIMEOUT_MS, SILENCE_MS } = await import("./session.js");
const { handshakePath } = await import("./paths.js");
const { TOOLS, runTool, buildServer } = await import("./index.js");
const { getViewTool } = await import("./tools/get-view.js");

type Handshake = { port: number; token: string; protocol: number };

let host: InstanceType<typeof SessionHost>;
let info: Handshake;

/**
 * A fake bridge: a real WebSocket client that answers like the script inside MoI does.
 * `respond` decides what comes back, so a test can make MoI "fail" or go silent.
 */
function fakeBridge(
  respond: (msg: any) => object | null = (m) => ({ id: m.id, ok: true, value: { echoed: m.script } }),
  opts: { token?: string; protocol?: number; origin?: string } = {},
): Promise<WebSocket> {
  const token = opts.token ?? info.token;
  const protocol = opts.protocol ?? PROTOCOL;
  const url = `ws://127.0.0.1:${info.port}/bridge?token=${token}&protocol=${protocol}`;
  const ws = new WebSocket(url, { origin: opts.origin ?? "moi://ui" });
  // A refused upgrade produces both an error and a socket reset; without a standing
  // listener the second one lands as an uncaught exception after the test has ended.
  ws.on("error", () => {});
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.t === "ping") return;
    const reply = respond(msg);
    if (reply) ws.send(JSON.stringify(reply));
  });
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

beforeEach(async () => {
  host = new SessionHost();
  await host.start();
  info = JSON.parse(readFileSync(handshakePath(), "utf8"));
});

afterEach(async () => {
  await host.stop();
});

test("publishes a handshake file with a port and a token", () => {
  assert.ok(info.port > 0);
  assert.equal(info.token.length, 48);
  assert.equal(info.protocol, PROTOCOL);
});

test("the gate poll answers 200 on plain HTTP", async () => {
  const res = await fetch(`http://127.0.0.1:${info.port}/gate`);
  assert.equal(res.status, 200);
});

test("removes the handshake file on stop, so a stale one never invites a connection", async () => {
  await host.stop();
  assert.throws(() => readFileSync(handshakePath(), "utf8"));
});

test("stop waits for a slow bridge to finish closing, as MoI takes seconds to", async () => {
  const ws = await fakeBridge();
  // Hold the bridge's side of the TCP stream so its close reply is late, like MoI's.
  const raw = (ws as any)._socket;
  raw.pause();
  setTimeout(() => raw.resume(), 300);
  const code = new Promise((resolve) => ws.once("close", resolve));
  const t0 = Date.now();
  await host.stop();
  assert.ok(Date.now() - t0 >= 250, "stop returned before the bridge answered the close");
  assert.equal(await code, 1000);
});

test("a call round-trips through the bridge", async () => {
  const ws = await fakeBridge();
  const value = await host.call({ op: "eval", script: "return 1;" });
  assert.deepEqual(value, { echoed: "return 1;" });
  ws.close();
});

test("fails with no_session when no bridge is attached", async () => {
  await assert.rejects(
    () => host.call({ op: "eval", script: "return 1;" }),
    (err: unknown) => err instanceof BridgeError && err.code === "no_session",
  );
});

test("surfaces a MoI-side failure as a typed error", async () => {
  const ws = await fakeBridge((m) => ({
    id: m.id,
    ok: false,
    error: { code: "moi_error", message: "Invalid function argument 1" },
  }));
  await assert.rejects(
    () => host.call({ op: "eval", script: "bad" }),
    (err: unknown) =>
      err instanceof BridgeError && err.code === "moi_error" && /Invalid function/.test(err.message),
  );
  ws.close();
});

test("read-only tools run directly; every other tool takes the command path", () => {
  const direct = (name: string) => TOOLS.find((t) => t.name === name)?.direct;
  for (const tool of ["get_scene", "get_selection", "moi_factory_help"]) {
    assert.equal(direct(tool), true, `${tool} should run directly`);
  }
  for (const tool of ["moi_eval", "get_view", "set_selection", "set_view", "set_viewport_layout", "delete_objects", "export_objects"]) {
    assert.equal(direct(tool), false, `${tool} should take the command path`);
  }
});

test("a command_running refusal reaches the agent with its code and message", async () => {
  const message = "MoI is running the Line command. Finish or cancel it, then try again.";
  const ws = await fakeBridge((m) => ({ id: m.id, ok: false, error: { code: "command_running", message } }));
  await assert.rejects(
    () => host.call({ op: "eval", script: "return 1;", direct: false }),
    (err: unknown) => err instanceof BridgeError && err.code === "command_running" && err.message === message,
  );
  const result = (await runTool(host, getViewTool, { viewport: "3D" })) as { isError?: boolean; content: { text: string }[] };
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, `[command_running] ${message}`);
  ws.close();
});

test("rejects a bad token", async () => {
  await assert.rejects(() => fakeBridge(undefined, { token: "wrong" }));
});

test("rejects an unknown origin", async () => {
  await assert.rejects(() => fakeBridge(undefined, { origin: "https://evil.example" }));
});

test("rejects a bridge speaking a different protocol version", async () => {
  await assert.rejects(() => fakeBridge(undefined, { protocol: PROTOCOL + 1 }));
});

/**
 * Runs the shipped bridge in a fake window and carries its gate request and socket to the real
 * host. Mock timers must be on. `deliver` decides when a frame from the host reaches the bridge.
 */
async function shippedBridge(t: TestContext, deliver = (frame: string, pass: (f: string) => void) => pass(frame)) {
  const fake = fakeMoi();
  fake.files.set(`${APPDATA_DIR}mcp-bridge-for-moi-handshake.json`, readFileSync(handshakePath(), "utf8"));
  new Function("moi", readFileSync(BRIDGE_PATH, "utf8"))(fake.moi);
  advance(t, 1000);

  // The bridge's gate request and socket, carried to the real host.
  const gate = fake.requests[0];
  const res = await fetch(gate.url);
  gate.respond(res.status, await res.text());
  const sock = fake.sockets[0];
  const ws = new WebSocket(sock.url, { origin: "moi://ui" });
  ws.on("error", () => {});
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, r) => reject(new Error(`host refused the bridge: HTTP ${r.statusCode}`)));
  });
  sock.send = (text: string) => ws.send(text);
  ws.on("message", (raw) => deliver(String(raw), (data) => sock.onmessage?.({ data })));
  sock.open();
  return ws;
}

test("the shipped bridge, in a fake window, is accepted and answers a call", async (t) => {
  // Only setTimeout: the bridge's clock stops when the test ends, and the host keeps real time.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ws = await shippedBridge(t);
  assert.equal(await host.call({ op: "eval", direct: true, script: "return 40 + 2;" }), 42);
  ws.close();
});

test("a direct call held past 45 s keeps its session; a second MoI cannot take it", async (t) => {
  await host.stop();
  host = new SessionHost({ callTimeoutMs: 2 * SILENCE_MS }); // so only silence could end the session
  await host.start();
  info = JSON.parse(readFileSync(handshakePath(), "utf8"));
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  let holding = true;
  const held: (() => void)[] = [];
  const ws = await shippedBridge(t, (frame, pass) => (holding ? held.push(() => pass(frame)) : pass(frame)));

  const call = host.call({ op: "eval", direct: true, script: "return 40 + 2;" });
  while (!held.length) await new Promise((r) => setImmediate(r));
  // MoI is busy on the call, so no ping comes: jump the clock without firing any timer.
  t.mock.timers.setTime(Date.now() + SILENCE_MS + 1000);
  assert.equal(await gate(), "mcp-bridge-for-moi busy");
  await assert.rejects(() => fakeBridge(), /HTTP 409/);

  holding = false;
  for (const pass of held.splice(0)) pass();
  assert.equal(await call, 42);
  ws.close();
});

test("first bridge wins; a second MoI is turned away", async () => {
  const first = await fakeBridge();
  await assert.rejects(() => fakeBridge());
  first.close();
});

test("runs calls strictly one at a time", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const ws = await fakeBridge((m) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    setTimeout(() => {
      inFlight--;
      ws.send(JSON.stringify({ id: m.id, ok: true, value: m.script }));
    }, 20);
    return null;
  });
  const results = await Promise.all(
    ["a", "b", "c"].map((s) => host.call({ op: "eval", script: s })),
  );
  assert.deepEqual(results, ["a", "b", "c"]);
  assert.equal(maxInFlight, 1);
  ws.close();
});

test("a dropped session rejects in-flight and queued calls", async () => {
  const ws = await fakeBridge(() => null); // never answers
  const first = host.call({ op: "eval", script: "hangs" });
  const second = host.call({ op: "eval", script: "queued" });
  ws.close();
  await assert.rejects(
    () => first,
    (err: unknown) => err instanceof BridgeError && err.code === "no_session",
  );
  await assert.rejects(
    () => second,
    (err: unknown) => err instanceof BridgeError && err.code === "no_session",
  );
});

/** Swap the default host for one with a 100 ms call timeout. afterEach stops it. */
async function shortTimeoutHost() {
  await host.stop();
  host = new SessionHost({ callTimeoutMs: 100 });
  await host.start();
  info = JSON.parse(readFileSync(handshakePath(), "utf8"));
}

const isCode = (code: string) => (err: unknown) => err instanceof BridgeError && err.code === code;

test("the call timeout defaults to 30 s", () => {
  assert.equal(CALL_TIMEOUT_MS, 30_000);
});

test("a default-constructed host times a call out at the 30 s default, not before", async (t) => {
  let received!: () => void;
  const asked = new Promise<void>((r) => (received = r));
  const ws = await fakeBridge(() => (received(), null));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let outcome: unknown = "pending";
  const call = host.call({ op: "eval", script: "hangs" }).then(
    () => (outcome = "answered"),
    (e) => (outcome = e),
  );
  await asked;   // the call's timer is armed before its message is sent
  t.mock.timers.tick(CALL_TIMEOUT_MS - 1);
  await new Promise((r) => setImmediate(r));
  assert.equal(outcome, "pending");
  t.mock.timers.tick(1);
  await call;
  assert.ok(isCode("timeout")(outcome), String(outcome));
  assert.match((outcome as unknown as Error).message, /within 30s/);
  t.mock.timers.reset();
  ws.close();
});

test("a call the bridge never answers rejects with timeout; the next queued call still runs", async () => {
  await shortTimeoutHost();
  const ws = await fakeBridge((m) =>
    m.script === "hangs" ? null : { id: m.id, ok: true, value: m.script },
  );
  const first = host.call({ op: "eval", script: "hangs" });
  const second = host.call({ op: "eval", script: "next" });
  await assert.rejects(() => first, isCode("timeout"));
  assert.equal(await second, "next");
  ws.close();
});

test("a late answer to a timed-out call is not delivered to the next call", async () => {
  await shortTimeoutHost();
  let lateId = 0;
  const ws = await fakeBridge((m) => {
    if (m.script === "hangs") {
      lateId = m.id;
      return null;
    }
    // Send the stale answer first, then this call's own answer after a beat.
    ws.send(JSON.stringify({ id: lateId, ok: true, value: "stale" }));
    setTimeout(() => ws.send(JSON.stringify({ id: m.id, ok: true, value: m.script })), 20);
    return null;
  });
  await assert.rejects(() => host.call({ op: "eval", script: "hangs" }), isCode("timeout"));
  assert.equal(await host.call({ op: "eval", script: "own" }), "own");
  ws.close();
});

test("a non-JSON message from the bridge is ignored and the session stays usable", async () => {
  const ws = await fakeBridge();
  ws.send("not json {");
  assert.deepEqual(await host.call({ op: "eval", script: "x" }), { echoed: "x" });
  ws.close();
});

test("a message with an id nobody waits for is ignored and the session stays usable", async () => {
  const ws = await fakeBridge();
  ws.send(JSON.stringify({ id: 9999, ok: true, value: "orphan" }));
  assert.deepEqual(await host.call({ op: "eval", script: "x" }), { echoed: "x" });
  ws.close();
});

const gate = async () => (await fetch(`http://127.0.0.1:${info.port}/gate`)).text();

test("the silence threshold defaults to 45 s, matching the bridge's pong timeout", () => {
  assert.equal(SILENCE_MS, 45_000);
});

test("a live session makes the gate say busy and turns a second bridge away", async () => {
  assert.equal(await gate(), "mcp-bridge-for-moi");
  const first = await fakeBridge();
  first.send(JSON.stringify({ t: "ping" }));
  assert.equal(await gate(), "mcp-bridge-for-moi busy");
  await assert.rejects(() => fakeBridge(), /HTTP 409/);
  first.close();
});

test("a session silent past the threshold once its call timed out is replaced by a new bridge", async () => {
  await host.stop();
  host = new SessionHost({ silenceMs: 50, callTimeoutMs: 30 });
  await host.start();
  info = JSON.parse(readFileSync(handshakePath(), "utf8"));

  const old = await fakeBridge(() => null); // abandoned: never answers, never pings
  await assert.rejects(() => host.call({ op: "eval", script: "hangs" }), isCode("timeout"));
  // The threshold starts over when the call ends, so the session is still live just after.
  assert.equal(await gate(), "mcp-bridge-for-moi busy");
  await new Promise((r) => setTimeout(r, 100));

  assert.equal(await gate(), "mcp-bridge-for-moi");
  const fresh = await fakeBridge();
  // The old socket's own close arrives later and must not detach the new session.
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(await host.call({ op: "eval", script: "x" }), { echoed: "x" });
  old.close();
  fresh.close();
});

/** An in-process MCP client on `h`, to call tools the way an agent does. */
async function clientOn(h: InstanceType<typeof SessionHost>) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await buildServer(h).connect(serverSide);
  const client = new Client({ name: "second-client", version: "0" });
  await client.connect(clientSide);
  const text = async (name: string) => {
    const r = (await client.callTool({ name, arguments: {} })) as { content: { text: string }[] };
    return r.content[0].text;
  };
  return { client, text };
}

test("a second host stands aside, leaves the file alone and reports the conflict", async () => {
  host.setClient("first-client");
  const before = readFileSync(handshakePath());
  const second = new SessionHost();
  assert.equal(await second.start(), 0, "no bridge listener");
  assert.deepEqual(readFileSync(handshakePath()), before);
  const { client, text } = await clientOn(second);
  for (const tool of ["get_scene", "moi_factory_help"]) {
    const t = await text(tool);
    assert.match(t, /^\[server_conflict\]/);
    assert.match(t, new RegExp(`started by first-client, process ${process.pid}`));
  }
  assert.deepEqual(readFileSync(handshakePath()), before, "tool calls leave the file alone too");
  await client.close();
  await second.stop();
  assert.deepEqual(readFileSync(handshakePath()), before, "stop leaves the other's file");
});

test("once the first host stops, the second claims the file on its next call", async () => {
  const second = new SessionHost();
  await second.start();
  const { client, text } = await clientOn(second);
  await host.stop();
  host = second; // afterEach stops it
  assert.match(await text("get_scene"), /^\[no_session\]/);
  info = JSON.parse(readFileSync(handshakePath(), "utf8"));
  const ws = await fakeBridge();
  assert.deepEqual(await host.call({ op: "eval", script: "x" }), { echoed: "x" });
  ws.close();
  await client.close();
});

test("a handshake file naming a port nothing listens on is overwritten at start", async () => {
  await host.stop();
  writeFileSync(handshakePath(), JSON.stringify({ port: 1, token: "stale", pid: process.pid }) + "\n");
  host = new SessionHost();
  assert.ok((await host.start()) > 0);
  assert.notEqual(JSON.parse(readFileSync(handshakePath(), "utf8")).token, "stale");
});

test("a handshake file whose pid is not running is overwritten at start", async () => {
  // The gate still answers, so only the dead pid marks the file stale.
  writeFileSync(handshakePath(), JSON.stringify({ ...info, token: "dead", pid: 2 ** 22 + 1 }) + "\n");
  const second = new SessionHost();
  assert.ok((await second.start()) > 0);
  assert.notEqual(JSON.parse(readFileSync(handshakePath(), "utf8")).token, "dead");
  await second.stop();
});

test("two hosts starting in the same instant: exactly one claims the file", async () => {
  await host.stop();
  const pair = [new SessionHost(), new SessionHost()];
  const ports = await Promise.all(pair.map((h) => h.start()));
  assert.equal(ports.filter((p) => p > 0).length, 1, `ports ${ports}`);
  const loser = pair[ports.indexOf(0)];
  await assert.rejects(() => loser.call({ op: "eval", script: "x" }), isCode("server_conflict"));
  host = pair[ports.findIndex((p) => p > 0)]; // afterEach stops it
  await loser.stop();
});

test("an owner whose file another live server overwrote reports the conflict, and takes it back once gone", async () => {
  writeFileSync(handshakePath(), JSON.stringify({ ...info, token: "other", pid: process.pid }) + "\n");
  await assert.rejects(() => host.call({ op: "eval", script: "x" }), isCode("server_conflict"));
  writeFileSync(handshakePath(), JSON.stringify({ port: 1, token: "gone" }) + "\n");
  await assert.rejects(() => host.call({ op: "eval", script: "x" }), isCode("no_session"));
  assert.equal(JSON.parse(readFileSync(handshakePath(), "utf8")).token, info.token);
});

test("stop during an in-flight claim leaves no port bound and no handshake file", async () => {
  await host.stop();
  host = new SessionHost();
  const started = host.start();
  await host.stop();
  assert.equal(await started, 0);
  assert.throws(() => readFileSync(handshakePath(), "utf8"));
});

test("stop leaves a handshake file another host has overwritten", async () => {
  const other = JSON.stringify({ port: 1, token: "other" }) + "\n";
  writeFileSync(handshakePath(), other);
  await host.stop();
  assert.equal(readFileSync(handshakePath(), "utf8"), other);
});

test("the handshake file names the MCP client once it has initialised", async () => {
  const { client } = await clientOn(host);
  // The initialized notification is handled a tick after connect resolves.
  await new Promise((r) => setTimeout(r, 20));
  const file = JSON.parse(readFileSync(handshakePath(), "utf8"));
  assert.equal(file.client, "second-client");
  assert.equal(file.pid, process.pid);
  assert.ok(file.startedAt);
  await client.close();
});

test("answers the bridge's liveness ping", async () => {
  const ws = await fakeBridge();
  const pong = new Promise<string>((resolve) => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.t === "pong") resolve("pong");
    });
  });
  ws.send(JSON.stringify({ t: "ping" }));
  assert.equal(await pong, "pong");
  ws.close();
});
