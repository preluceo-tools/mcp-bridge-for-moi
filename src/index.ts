import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SessionHost, BridgeError } from "./session.js";
import { logEval } from "./evallog.js";
import { asJson, type Content, type Tool } from "./tool.js";
import { moiEvalTool } from "./tools/moi-eval.js";
import { getSceneTool } from "./tools/get-scene.js";
import { getSelectionTool } from "./tools/get-selection.js";
import { setSelectionTool } from "./tools/set-selection.js";
import { deleteObjectsTool } from "./tools/delete-objects.js";
import { exportObjectsTool } from "./tools/export-objects.js";
import { getViewTool } from "./tools/get-view.js";
import { setViewTool } from "./tools/set-view.js";
import { setViewportLayoutTool } from "./tools/set-viewport-layout.js";
import { moiFactoryHelpTool } from "./tools/moi-factory-help.js";
import { NO_UNITS_MESSAGE, NO_UNITS_NOTE, setUnitsTool } from "./tools/set-units.js";

const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

/** Every tool the server lists, in the order it lists them. `any`: each has its own Args and Reply. */
export const TOOLS: Tool<any, any>[] = [
  moiEvalTool,
  setUnitsTool,
  getSceneTool,
  getSelectionTool,
  setSelectionTool,
  deleteObjectsTool,
  exportObjectsTool,
  getViewTool,
  setViewTool,
  setViewportLayoutTool,
  moiFactoryHelpTool,
];

const REFUSES_NOTE =
  " Refused with command_running while the user has a MoI command running — ask them to " +
  "finish or cancel it.";

/**
 * A `Tool`, run: its precheck refuses before MoI is asked, its local answer (if any) needs no
 * MoI but still reports a server conflict, and everything else is one script through the
 * bridge, logged either way.
 *
 * Tools that change nothing the user can see are `direct`: they run in the bridge's context, so
 * they answer while the user is in the middle of a command. Everything else runs as a MoI
 * command — one undo unit — and the bridge refuses it while a command is running, because
 * starting one would end the user's. The server decides by tool; the bridge never guesses from
 * the script. See docs/research/probe-10-running-command.md.
 *
 * Anything `reply` throws is reported exactly like a MoI-side failure, because from the agent's
 * side it is one — the call did not produce a usable answer.
 */
export async function runTool<Args, Reply>(
  host: SessionHost,
  tool: Tool<Args, Reply>,
  args: Args,
): Promise<{ isError?: boolean; content: Content[] }> {
  const refusal = tool.precheck?.(args);
  if (refusal !== undefined) return failure(new BridgeError("bad_request", refusal));
  if (tool.local) {
    try {
      await host.ensureOwner();
    } catch (err) {
      if (err instanceof BridgeError) return failure(err);
      throw err;
    }
    const content = tool.local(args);
    if (content) return { content };
  }
  const reply = tool.reply ?? asJson;
  const script = tool.script(args);
  const started = Date.now();
  try {
    // With `needsUnits` the bridge checks the live document before it runs anything, and refuses
    // with no_units; the check costs no round trip and no script can forge its answer.
    const value = await host.call({ op: "eval", script, direct: tool.direct, needsUnits: tool.needsUnits === true });
    const content = reply(value as Reply, args);
    logEval({ tool: tool.name, script, ok: true, ms: Date.now() - started });
    return { content };
  } catch (err) {
    let e = err instanceof BridgeError ? err : new BridgeError("moi_error", String(err));
    if (e.code === "no_units") e = new BridgeError("no_units", NO_UNITS_MESSAGE);
    logEval({
      tool: tool.name,
      script,
      ok: false,
      code: e.code,
      message: e.message,
      ms: Date.now() - started,
    });
    return failure(e);
  }
}

/** What the agent is told: every refusal the server may make, it says it can make. */
export const descriptionOf = (tool: Tool<never, unknown>) =>
  tool.description + (tool.needsUnits ? NO_UNITS_NOTE : "") + (tool.direct ? "" : REFUSES_NOTE);

const failure = (e: BridgeError) => ({
  isError: true,
  content: [{ type: "text" as const, text: `[${e.code}] ${e.message}` }],
});

export function buildServer(host: SessionHost): McpServer {
  const server = new McpServer({ name: "mcp-bridge-for-moi", version: VERSION });
  // The handshake file names the client that owns this server, for the other server's
  // conflict message. Known only once the client has initialised.
  server.server.oninitialized = () => host.setClient(server.server.getClientVersion()?.name);

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: descriptionOf(tool), inputSchema: tool.input, annotations: tool.annotations },
      async (args) => runTool(host, tool, args),
    );
  }
  return server;
}

export async function serve(): Promise<void> {
  const host = new SessionHost();
  await host.start();
  const server = buildServer(host);
  await server.connect(new StdioServerTransport());

  const shutdown = () => {
    void host.stop().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // An MCP client that closes stdio rather than signalling still gets the handshake file
  // cleaned up, so a stale one never points the bridge at a recycled port.
  process.stdin.on("close", shutdown);
  process.on("exit", () => {
    void host.stop();
  });
}
