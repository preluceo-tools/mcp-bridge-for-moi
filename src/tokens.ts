import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SessionHost } from "./session.js";
import { buildServer } from "./index.js";

/** What a client is sent for one tool and pays for in context: the listing's name, description and schema. */
export type ToolDefinition = { name: string; description: string; inputSchema: unknown };

/**
 * The tool definitions exactly as the server lists them, read through an in-memory MCP client.
 * The host is never started: no port, no handshake file, no network.
 */
export async function toolDefinitions(): Promise<ToolDefinition[]> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = buildServer(new SessionHost());
  await server.connect(serverSide);
  const client = new Client({ name: "mcp-bridge-for-moi-tokens", version: "0" });
  await client.connect(clientSide);
  try {
    const { tools } = await client.listTools();
    return tools.map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema }));
  } finally {
    await client.close();
  }
}

/**
 * All tool definitions together stay at or under this many characters; a test holds them to it.
 * Set just above the total at the time. Growing past it is a decision: raise it here, on purpose.
 */
export const TOOL_DEFINITIONS_CEILING = 15_600;

/** Characters of one definition, as its JSON. */
export const sizeOf = (d: ToolDefinition) => JSON.stringify(d).length;

/** Tokens are estimated at 3.5 to 4 characters each; no tokenizer is consulted. */
export const estimate = (chars: number) => `~${Math.round(chars / 4)}-${Math.round(chars / 3.5)}`;

/** The `tokens` subcommand's output: a table of characters and estimated tokens, or with `json` the raw definitions. */
export async function tokensReport(json = false): Promise<string> {
  const defs = await toolDefinitions();
  if (json) return JSON.stringify(defs, null, 2);
  const width = Math.max(...defs.map((d) => d.name.length), "total".length);
  const row = (name: string, chars: number) =>
    `${name.padEnd(width)}  ${String(chars).padStart(6)}  ${estimate(chars).padStart(12)}`;
  const total = defs.reduce((sum, d) => sum + sizeOf(d), 0);
  return [
    `${"tool".padEnd(width)}  ${"chars".padStart(6)}  ${"est. tokens".padStart(12)}`,
    ...defs.map((d) => row(d.name, sizeOf(d))),
    row("total", total),
    "",
    "Token counts are estimates (characters / 3.5 to 4). For exact counts, send `tokens --json` to a token-counting service.",
  ].join("\n");
}
