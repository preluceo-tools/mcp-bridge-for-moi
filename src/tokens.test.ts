import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SessionHost } from "./session.js";
import { buildServer, TOOLS } from "./index.js";
import { readmeSection } from "./readme-section.js";
import { toolDefinitions, tokensReport, sizeOf, totalSize, estimate, TOOL_DEFINITIONS_CEILING } from "./tokens.js";

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
  const total = totalSize(defs);
  assert.match(report, new RegExp(`^total +${total} +~\\d+-\\d+$`, "m"));
  assert.match(report, /estimates/);
});

type Defs = Awaited<ReturnType<typeof toolDefinitions>>;

/** Asserts a Token use `section` matches `defs`; a tokens cell that is not one range fails as a wrong value, not a missing row. */
function assertTokenTable(section: string, defs: Defs) {
  // README cells carry thousands commas and an en dash; the tokens subcommand prints neither.
  const plain = (cell = "") => cell.replace(/,/g, "").replace("–", "-");
  const table = new Map(
    [...section.matchAll(/^\| `(\w+)` \| ([\d,]+) \| ([^|]+?) \|/gm)].map(([, name, chars, tokens]) => [
      name,
      { chars: Number(plain(chars)), tokens: plain(tokens) },
    ]),
  );
  assert.deepEqual([...table.keys()].sort(), defs.map((d) => d.name).sort(), "README Token use table: tools");
  for (const d of defs) {
    const row = table.get(d.name);
    assert.equal(row?.chars, sizeOf(d), `README Token use table: ${d.name} is now ${sizeOf(d)} characters`);
    const tokens = estimate(sizeOf(d));
    assert.equal(row?.tokens, tokens, `README Token use table: ${d.name} is now ${tokens} estimated tokens`);
  }
  const total = totalSize(defs);
  const listed = section.match(/^\| \*\*Total\*\* \| \*\*([\d,]+)\*\* \| \*\*([^|*]+?)\*\* \|/m);
  assert.equal(Number(plain(listed?.[1])), total, `README Token use table: the total is now ${total} characters`);
  assert.equal(plain(listed?.[2]), estimate(total), `README Token use table: the total is now ${estimate(total)} estimated tokens`);
}

test("the README's Token use table gives each tool's characters and estimated tokens as the server lists it", async () => {
  assertTokenTable(readmeSection("## Token use"), await toolDefinitions());
});

test("a tokens cell with an inner space fails naming the tool and the range it should hold", async () => {
  const defs = await toolDefinitions();
  const section = readmeSection("## Token use");
  const [lo, hi] = estimate(sizeOf(defs.find((d) => d.name === "set_units")!)).slice(1).split("-");
  const cell = `~${lo}–${hi}`;
  assert.ok(section.includes(cell), "fixture: set_units cell found in the README");
  assert.throws(
    () => assertTokenTable(section.replace(cell, `~${lo} – ${hi}`), defs),
    (e: Error) => e.message.includes("set_units is now") && e.message.includes(`~${lo}-${hi}`),
  );
});

test("all tool definitions together stay under the ceiling", async () => {
  const total = totalSize(await toolDefinitions());
  assert.ok(
    total <= TOOL_DEFINITIONS_CEILING,
    `The tool definitions total ${total} characters, over TOOL_DEFINITIONS_CEILING (${TOOL_DEFINITIONS_CEILING}). ` +
      `Trim them, or raise the constant in src/tokens.ts deliberately.`,
  );
});
