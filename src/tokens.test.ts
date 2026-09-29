import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SessionHost } from "./session.js";
import { buildServer, TOOLS } from "./index.js";
import { toolDefinitions, tokensReport, sizeOf, TOOL_DEFINITIONS_CEILING } from "./tokens.js";

test("tokens --json prints the tools, names, descriptions and schemas the server lists", async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await buildServer(new SessionHost()).connect(serverSide);
  const client = new Client({ name: "tokens-test", version: "0" });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  await client.close();
  assert.deepEqual(
    JSON.parse(await tokensReport(true)),
    tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  );
});

test("tokens prints one row per tool and a total, with the token ranges marked as estimates", async () => {
  const defs = await toolDefinitions();
  const report = await tokensReport();
  const lines = report.split("\n");
  for (const d of defs) {
    const row = lines.find((l) => l.startsWith(`${d.name} `));
    assert.ok(row, `no row for ${d.name}`);
    assert.match(row, new RegExp(` ${sizeOf(d)} +~\\d+-\\d+$`), `${d.name} row`);
  }
  assert.equal(defs.length, TOOLS.length);
  const total = defs.reduce((s, d) => s + sizeOf(d), 0);
  assert.match(report, new RegExp(`^total +${total} +~\\d+-\\d+$`, "m"));
  assert.match(report, /estimates/);
});

test("the README's Token use table gives each tool's characters as the server lists it", async () => {
  const readme = readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8");
  const section = readme.split("\n## Token use")[1].split("\n### ")[0];
  const table = new Map(
    [...section.matchAll(/^\| `(\w+)` \| ([\d,]+) \|/gm)].map(([, name, chars]) => [name, Number(chars.replace(/,/g, ""))]),
  );
  const defs = await toolDefinitions();
  assert.deepEqual([...table.keys()].sort(), defs.map((d) => d.name).sort(), "README Token use table: tools");
  for (const d of defs)
    assert.equal(table.get(d.name), sizeOf(d), `README Token use table: ${d.name} is now ${sizeOf(d)} characters`);
  const total = defs.reduce((s, d) => s + sizeOf(d), 0);
  const listed = section.match(/^\| \*\*Total\*\* \| \*\*([\d,]+)\*\* \|/m)?.[1];
  assert.equal(Number(listed?.replace(/,/g, "")), total, `README Token use table: the total is now ${total} characters`);
});

test("all tool definitions together stay under the ceiling", async () => {
  const total = (await toolDefinitions()).reduce((s, d) => s + sizeOf(d), 0);
  assert.ok(
    total <= TOOL_DEFINITIONS_CEILING,
    `The tool definitions total ${total} characters, over TOOL_DEFINITIONS_CEILING (${TOOL_DEFINITIONS_CEILING}). ` +
      `Trim them, or raise the constant in src/tokens.ts deliberately.`,
  );
});
