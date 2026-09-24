import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { writeFileSync, unlinkSync, mkdirSync, readFileSync, openSync, closeSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { handshakePath } from "./paths.js";

/**
 * Wire protocol version. The bridge presents its own on connect and a mismatch is
 * refused, because a bridge one version behind is a file in MoI's startup folder that
 * nothing updates automatically. See docs/adr/0002.
 */
export const PROTOCOL = 6;

/** The origin a MoI command/UI page presents. Blocks browser-based attacks; the token blocks the rest. */
const ALLOWED_ORIGINS = ["moi://commands", "moi://ui"];

const CALL_TIMEOUT_MS = 30_000;
const PING_INTERVAL_MS = 15_000;
/**
 * A session silent this long is dead to us, matching the bridge's own PING_TIMEOUT_MS.
 * After standby the bridge may have abandoned it without a close the server can see.
 * Silence while one of our own calls is outstanding does not count: MoI is busy, not gone.
 */
const SILENCE_MS = 45_000;
/** A claim lock older than this belongs to a claim that died midway; a live one takes ~2 s. */
const LOCK_STALE_MS = 10_000;
/**
 * How long stop() waits for the bridge to finish closing. MoI answers a close frame about
 * 4 s after it arrives (probe 04); tearing the connection down sooner is, to MoI, an abrupt
 * death: a modal error box and a socket that reports OPEN until the ping gives up on it.
 */
const CLOSE_WAIT_MS = 10_000;

export type ErrorCode =
  | "no_session"
  | "timeout"
  | "script_error"
  | "moi_error"
  | "not_found"
  | "protocol_mismatch"
  // The bridge refused a command call because the user has a command running.
  | "command_running"
  // Another mcp-bridge-for-moi owns the handshake file; this one stands aside.
  | "server_conflict"
  // A modelling or export call on a document with no unit system; set_units settles it.
  | "no_units"
  // set_units on a document that already has units; MoI was asked, and nothing changed.
  | "units_set"
  // The server's own refusal, made before MoI is asked, of a call it will not make.
  | "bad_request";

export class BridgeError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: BridgeError) => void;
  timer: NodeJS.Timeout;
};

type Job = {
  request: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (err: BridgeError) => void;
};

/**
 * Listener the bridge dials into, plus the queue in front of it.
 *
 * Serves plain HTTP on the same port purely so the bridge's gate poll has something to
 * ask — a failed WebSocket connect inside MoI raises a modal box that no script can
 * suppress, so the bridge may never speculatively connect. See docs/adr/0002.
 */
export class SessionHost {
  private http: Server;
  private wss: WebSocketServer;
  private socket: WebSocket | null = null;
  private token = randomBytes(24).toString("hex");
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private queue: Job[] = [];
  private busy = false;
  private port = 0;
  private callTimeoutMs: number;
  private silenceMs: number;
  /** When the attached socket last sent anything, pings included. */
  private lastHeard = 0;
  /** True once this server owns the handshake file and listens for the bridge. */
  private listening = false;
  private claiming: Promise<void> | undefined;
  /** Set by stop(), so a claim still in flight does not bind a port afterwards. */
  private stopped = false;
  private client: string | undefined;
  private startedAt = new Date().toISOString();

  /** The options exist for tests; production uses the defaults. */
  constructor(opts: { callTimeoutMs?: number; silenceMs?: number } = {}) {
    this.callTimeoutMs = opts.callTimeoutMs ?? CALL_TIMEOUT_MS;
    this.silenceMs = opts.silenceMs ?? SILENCE_MS;
    this.http = createServer((req, res) => {
      // The gate poll. Anything reaching this proves the server is up; it deliberately
      // reveals nothing beyond "busy", since an unauthenticated caller may be any local
      // process. "busy" tells a second MoI not to open a socket that would be refused.
      if (req.url?.startsWith("/gate")) {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(this.live ? "mcp-bridge-for-moi busy" : "mcp-bridge-for-moi");
        return;
      }
      res.writeHead(404).end();
    });

    this.wss = new WebSocketServer({ noServer: true });

    this.http.on("upgrade", (req, socket, head) => {
      // A client we turn away often resets rather than closing politely. Without a
      // listener that reset is an uncaught exception and takes the server down.
      socket.on("error", () => {});

      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const origin = req.headers.origin ?? "";
      const ok =
        ALLOWED_ORIGINS.includes(origin) &&
        url.searchParams.get("token") === this.token &&
        url.searchParams.get("protocol") === String(PROTOCOL);

      if (!ok) {
        // Say why only for a version mismatch — that one is a legitimate user problem
        // with a fix. A bad token gets nothing.
        const versionMismatch =
          url.searchParams.get("token") === this.token &&
          url.searchParams.get("protocol") !== String(PROTOCOL);
        socket.end(
          versionMismatch
            ? "HTTP/1.1 426 Upgrade Required\r\n\r\nBridge is out of date. Re-run: node dist/cli.js install\r\n"
            : "HTTP/1.1 403 Forbidden\r\n\r\n",
        );
        return;
      }

      // First live bridge wins. A second MoI keeps gate-polling rather than stealing the
      // session out from under the window the user is looking at.
      if (this.live) {
        socket.end("HTTP/1.1 409 Conflict\r\n\r\nAnother MoI is already attached.\r\n");
        return;
      }

      // A silent session is one the bridge has abandoned (after standby, say) without a
      // close we could see. Replace it rather than lock the bridge out for good.
      const stale = this.socket;
      if (stale) {
        this.detach();
        stale.terminate();
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => this.attach(ws));
    });
  }

  /** Attached, and either answering one of our calls or heard from within the silence threshold. */
  private get live(): boolean {
    return this.socket !== null && (this.pending.size > 0 || Date.now() - this.lastHeard <= this.silenceMs);
  }

  private attach(ws: WebSocket) {
    this.socket = ws;
    this.lastHeard = Date.now();
    // Every handler checks it still belongs to the attached socket: a replaced one can
    // still deliver a message or its close, and must not touch the new session.
    ws.on("message", (data) => {
      if (this.socket !== ws) return;
      this.lastHeard = Date.now();
      this.onMessage(String(data));
    });
    ws.on("close", () => this.socket === ws && this.detach());
    ws.on("error", () => this.socket === ws && this.detach());
  }

  private detach() {
    this.socket = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new BridgeError("no_session", "The MoI session disconnected mid-call."));
    }
    this.pending.clear();
    const queued = this.queue.splice(0);
    for (const job of queued) {
      job.reject(new BridgeError("no_session", "The MoI session disconnected."));
    }
    this.busy = false;
  }

  private onMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg?.t === "ping") {
      this.socket?.send(JSON.stringify({ t: "pong" }));
      return;
    }
    const p = this.pending.get(msg?.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.value);
    else p.reject(new BridgeError(msg.error?.code ?? "moi_error", msg.error?.message ?? "Unknown MoI error."));
    this.busy = false;
    this.drain();
  }

  private drain() {
    if (this.busy || this.queue.length === 0) return;
    const ws = this.socket;
    if (!ws) return;
    const job = this.queue.shift()!;
    this.busy = true;
    const id = this.nextId++;
    const timer = setTimeout(() => {
      this.pending.delete(id);
      this.busy = false;
      // The silence during the call did not count; the threshold starts over from here.
      this.lastHeard = Date.now();
      job.reject(
        new BridgeError(
          "timeout",
          `No answer from MoI within ${this.callTimeoutMs / 1000}s. MoI may still be working, ` +
            `or a dialog may be waiting for a click.`,
        ),
      );
      this.drain();
    }, this.callTimeoutMs);
    this.pending.set(id, { resolve: job.resolve, reject: job.reject, timer });
    ws.send(JSON.stringify({ id, ...job.request }));
  }

  /** True when a MoI session is attached. */
  get connected(): boolean {
    return this.socket !== null;
  }

  /**
   * Resolves once this server owns the handshake file, claiming it if nobody else does.
   * Rejects with server_conflict while another live mcp-bridge-for-moi owns it. Checked on
   * every tool call, so the standing-aside server takes over as soon as the other is gone.
   */
  ensureOwner(): Promise<void> {
    if (this.listening) return this.checkStillOwner();
    // Concurrent calls share one attempt, so the port is never bound twice.
    this.claiming ??= this.claim().finally(() => (this.claiming = undefined));
    return this.claiming;
  }

  /**
   * Another process can overwrite a file we own (a build that predates the claim lock, say),
   * and MoI then dials it instead. Report that; if the overwriter is gone, take the file back.
   */
  private async checkStillOwner(): Promise<void> {
    if (readHandshake()?.token === this.token) return;
    const other = await liveOwner();
    if (other) throw conflict(other);
    this.writeHandshake();
  }

  private async claim(): Promise<void> {
    // Held for the whole check-then-listen, so two servers starting at once cannot both win.
    const lock = takeLock();
    try {
      const other = await liveOwner();
      if (other) throw conflict(other);
      if (this.stopped) return;
      await new Promise<void>((resolve) => this.http.listen(0, "127.0.0.1", resolve));
      const addr = this.http.address();
      if (!addr || typeof addr === "string") throw new Error("Failed to bind a port.");
      this.port = addr.port;
      this.listening = true;
      this.writeHandshake();
    } finally {
      try {
        unlinkSync(lock);
      } catch {
        // Already gone. Nothing to do.
      }
    }
  }

  /** The MCP client's name, known only after `initialize`; rewrites the file if we own it. */
  setClient(name: string | undefined) {
    this.client = name;
    if (this.listening) this.writeHandshake();
  }

  private writeHandshake() {
    const file = handshakePath();
    mkdirSync(dirname(file), { recursive: true });
    // One line, deliberately. MoI's readLine gives no end-of-file signal, so the bridge
    // reads a bounded number of lines and stops at the first empty one.
    writeFileSync(
      file,
      JSON.stringify({
        port: this.port,
        token: this.token,
        protocol: PROTOCOL,
        pid: process.pid,
        startedAt: this.startedAt,
        client: this.client,
      }) + "\n",
      "utf8",
    );
  }

  /**
   * Send one request to the bridge and await its answer. Strictly one call is in flight
   * at a time: MoI has one document and one UI thread, so there is no concurrency to win.
   */
  async call(request: Record<string, unknown>): Promise<unknown> {
    await this.ensureOwner();
    if (!this.socket) {
      return Promise.reject(
        new BridgeError(
          "no_session",
          "No MoI session is attached. Start MoI (with the bridge installed) and try again.",
        ),
      );
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject });
      this.drain();
    });
  }

  /**
   * Bind to loopback, then publish port and token where the bridge will look — unless
   * another live server owns the file, in which case stand aside and return 0.
   */
  async start(): Promise<number> {
    await this.ensureOwner().catch((err) => {
      if (!(err instanceof BridgeError)) throw err;
    });
    return this.port;
  }

  async stop(): Promise<void> {
    // A claim in flight finishes first, so its listen and file are cleaned up below.
    this.stopped = true;
    await this.claiming?.catch(() => {});
    // No longer the owner: a late call or setClient must not write the file back.
    this.listening = false;
    // Only our own file: deleting another server's would strand it.
    if (readHandshake()?.token === this.token) {
      try {
        unlinkSync(handshakePath());
      } catch {
        // Already gone. Nothing to do.
      }
    }
    for (const [, p] of this.pending) clearTimeout(p.timer);
    this.pending.clear();
    // http.close does not wait for an upgraded socket, so wait for the close itself.
    const ws = this.socket;
    if (ws) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          ws.terminate();
          resolve();
        }, CLOSE_WAIT_MS);
        ws.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
        ws.close(1000);
      });
    }
    this.wss.close();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }
}

type Handshake = {
  port?: number;
  token?: string;
  pid?: number;
  startedAt?: string;
  client?: string;
};

function readHandshake(): Handshake | null {
  try {
    return JSON.parse(readFileSync(handshakePath(), "utf8"));
  } catch {
    return null;
  }
}

function conflict(other: Handshake): BridgeError {
  return new BridgeError(
    "server_conflict",
    `MoI is already served by another mcp-bridge-for-moi (started by ${other.client ?? "an unknown client"}, ` +
      `process ${other.pid ?? "unknown"}, since ${other.startedAt ?? "an unknown time"}). ` +
      `Only one can run at a time. Close that application, or end process ${other.pid ?? "unknown"}, then call again.`,
  );
}

/**
 * Creates the claim lock beside the handshake file, exclusively; returns its path.
 * Throws server_conflict while another server holds it.
 */
function takeLock(): string {
  const lock = `${handshakePath()}.lock`;
  mkdirSync(dirname(lock), { recursive: true });
  try {
    // ponytail: two servers finding the same stale lock can both remove it; the window is one
    // crashed claim wide, so no owner-token check.
    if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) unlinkSync(lock);
  } catch {
    // No lock: the usual case.
  }
  try {
    closeSync(openSync(lock, "wx"));
    return lock;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    throw new BridgeError(
      "server_conflict",
      "Another mcp-bridge-for-moi is claiming MoI at this moment. Only one can run at a time. " +
        "Call again to see which one owns it.",
    );
  }
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The handshake file's owner if it is a live mcp-bridge-for-moi, else null (stale or absent). */
async function liveOwner(): Promise<Handshake | null> {
  const other = readHandshake();
  if (!other?.port) return null;
  if (typeof other.pid === "number" && !running(other.pid)) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${other.port}/gate`, { signal: AbortSignal.timeout(2000) });
    return (await res.text()).startsWith("mcp-bridge-for-moi") ? other : null;
  } catch {
    return null;
  }
}

export { PING_INTERVAL_MS, CALL_TIMEOUT_MS, SILENCE_MS };
