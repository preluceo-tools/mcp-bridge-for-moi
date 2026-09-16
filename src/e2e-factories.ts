/**
 * `npm run e2e:factories`: the factory sweep. Creates, reads and cancels every factory in
 * `FACTORY_TABLE` through the real bridge, commits each one that has an `expect` and checks
 * the outcome, and checks after each that the bridge still answers.
 * Opt-in and outside the `*.test` glob. Runs in the live-run bracket, which refuses a non-empty
 * document and puts units and layout back; the sweep deletes anything a factory leaves behind.
 */
import { call, liveRun, reply, throwingScript } from "./e2e-start.js";
import { FACTORIES } from "./tools/moi-factory-help.js";
import { runTool } from "./index.js";
import { CALL_TIMEOUT_MS, type SessionHost } from "./session.js";
import { moiEvalTool } from "./tools/moi-eval.js";
import { getSceneTool } from "./tools/get-scene.js";
import { deleteObjectsTool } from "./tools/delete-objects.js";
import { FACTORY_TABLE, checkCommit, commitScript, probeScript } from "./e2e-factories-table.js";
import type { FactoryEntry } from "./e2e-factories-table.js";

type Scene = { objectCount: number; objects: { id: string }[]; unitsCode: string };

/** One script through the bridge: its parsed reply, or why there is none. */
async function run(host: SessionHost, script: string, problems: string[]): Promise<{ text: string; value?: any }> {
  const started = Date.now();
  const { r, text } = await reply(host, moiEvalTool, { script });
  const ms = Date.now() - started;
  if (ms >= CALL_TIMEOUT_MS) problems.push(`reply took ${ms} ms`);
  if (r.isError) {
    problems.push(text);
    return { text };
  }
  try {
    return { text, value: JSON.parse(text) };
  } catch {
    problems.push(`reply is not JSON: ${text.slice(0, 120)}`);
    return { text };
  }
}

/** Why the bridge is not healthy after one factory, or its commit is wrong; empty when all is well. */
async function sweep(host: SessionHost, entry: FactoryEntry): Promise<{ problems: string[]; detail?: unknown }> {
  const { name } = entry;
  const problems: string[] = [];
  const running = (text: string) => text.startsWith("[command_running]");
  const probe = await run(host, probeScript(name), problems);
  const detail = probe.value;
  if (detail && detail.numInputs !== FACTORIES.factories[name])
    problems.push(`numInputs ${detail.numInputs}, assets/factories.json says ${FACTORIES.factories[name]}`);
  const texts = [probe.text];
  if (entry.expect) {
    const commit = await run(host, commitScript(entry), problems);
    texts.push(commit.text);
    if (commit.value) {
      problems.push(...checkCommit(entry, commit.value));
      (detail ?? {}).committed = commit.value;
    }
  }
  const ping = await reply(host, moiEvalTool, { script: "return 1;" });
  texts.push(ping.text);
  if (ping.text !== "1") problems.push(`follow-up \`return 1;\` answered ${ping.text}`);
  if (texts.some(running)) problems.push("a command is still running (modal dialog left open?)");
  const scene = (await call(host, getSceneTool, {})) as Scene;
  if (scene.objectCount > 0) {
    problems.push(`left ${scene.objectCount} object(s) behind; deleted`);
    await runTool(host, deleteObjectsTool, { ids: scene.objects.map((o) => o.id) });
  }
  return { problems, detail };
}

await liveRun(
  async (host, step) => {
    const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
    for (const entry of FACTORY_TABLE) {
      if (entry.commit === false) {
        counts.SKIP++;
        console.log(`SKIP  ${entry.name}: ${entry.reason ?? "no reason given"}`);
        continue;
      }
      try {
        const { problems, detail } = await sweep(host, entry);
        if (problems.length) {
          counts.FAIL++;
          step.fail(entry.name, problems.join("; "));
          continue;
        }
        counts.PASS++;
        const d = detail as { numInputs?: number; committed?: { created: string[] } } | undefined;
        const record = d?.committed ? `, committed, created [${d.committed.created.join(", ")}]` : ", create-and-cancel only (unverified)";
        console.log(`PASS  ${entry.name}  numInputs ${d?.numInputs}${record}`);
      } catch (err) {
        counts.FAIL++;
        step.fail(entry.name, err instanceof Error ? err.message : String(err));
      }
    }
    console.log(`\n${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.SKIP} SKIP of ${FACTORY_TABLE.length} factories`);

    // A bridge check, not a factory: kept out of the per-factory counts.
    const thrown = await throwingScript(host);
    if (thrown.ok) console.log(`BRIDGE PASS  a throwing script comes back as ${thrown.text}`);
    else step.fail("BRIDGE a throwing script", `came back as ${thrown.text}`);
  },
  { emptyDocument: true },
);
