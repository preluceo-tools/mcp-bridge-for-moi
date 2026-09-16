/**
 * The live-run bracket shared by `npm run e2e` and `npm run e2e:factories`: take the handshake
 * file, wait for MoI's bridge, settle units, record the layout, run the body, put layout and
 * units back, check the document ends as it began, and exit non-zero on any failure.
 */
import { SessionHost } from "./session.js";
import { runTool } from "./index.js";
import type { Tool } from "./tool.js";
import { handshakePath } from "./paths.js";
import { moiEvalTool } from "./tools/moi-eval.js";
import { getSceneTool } from "./tools/get-scene.js";
import { setViewportLayoutTool } from "./tools/set-viewport-layout.js";
import { NO_UNITS, setUnitsTool } from "./tools/set-units.js";
import type { Layout } from "./scripts.js";

/**
 * Runs one step and prints `PASS  name  detail` or `FAIL  name  why`; never throws. `fail`
 * records a failure found outside a step, printed the same way.
 */
export type Step = ((name: string, fn: () => Promise<unknown>) => Promise<void>) & {
  fail(name: string, why: string): void;
};

/**
 * One live run. The body gets the host and a step reporter, and reports every failure through
 * it. With `emptyDocument`, a document holding objects is refused before anything is touched.
 * Never returns: exits 0 only when nothing failed.
 */
export async function liveRun(
  body: (host: SessionHost, step: Step) => Promise<void>,
  { emptyDocument = false } = {},
): Promise<never> {
  const host = await connect();
  let failures = 0;
  const fail = (name: string, why: string) => {
    failures++;
    console.log(`FAIL  ${name}  ${why}`);
  };
  const step: Step = Object.assign(
    async (name: string, fn: () => Promise<unknown>) => {
      try {
        const detail = await fn();
        console.log(`PASS  ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);
      } catch (err) {
        fail(name, err instanceof Error ? err.message : String(err));
      }
    },
    { fail },
  );

  // Start checks: nothing is touched until they pass, so a failure here only stops the run.
  const refuse = async (why: string): Promise<never> => {
    console.error(`FAIL  ${why}`);
    await host.stop();
    process.exit(1);
  };
  let begin: { objectCount: number; unitsCode: string } = { objectCount: 0, unitsCode: "" };
  let layout: Layout | null = null;
  try {
    begin = await call(host, getSceneTool, {});
    console.log(`START  ${begin.objectCount} object(s), units ${begin.unitsCode}`);
  } catch (err) {
    await refuse(`start: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (emptyDocument && begin.objectCount > 0)
    await refuse(
      `the document holds ${begin.objectCount} object(s). This run needs an empty document: ` +
        `open a new one, then run this again.`,
    );

  let settled = false;
  try {
    // Every moi_eval is refused on a unitless document: settle it, as an agent would.
    const refusal = await settleUnits(host);
    settled = refusal !== null;
    console.log(settled ? `UNITS  ${refusal!.slice(0, 60)}... set_units Millimeters` : `UNITS  already ${begin.unitsCode}`);
    layout = (await call(host, moiEvalTool, { script: "return moi.ui.mainWindow.viewpanel.mode;" })) as Layout;
    console.log(`LAYOUT  ${layout}`);
    await body(host, step);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    // A failed step must not leave the layout moved or the units changed.
    if (layout) await runTool(host, setViewportLayoutTool, { layout }).catch(() => {});
    if (settled) await unsettleUnits(host).catch(() => {});
  }

  await step("end: the document ends with the object count and units it started with", async () => {
    const end = await call(host, getSceneTool, {});
    if (end.objectCount !== begin.objectCount)
      throw new Error(`started with ${begin.objectCount} object(s), ended with ${end.objectCount}`);
    if (end.unitsCode !== begin.unitsCode) throw new Error(`started in ${begin.unitsCode}, ended in ${end.unitsCode}`);
    return { objects: end.objectCount, units: end.unitsCode };
  });

  await host.stop();
  console.log(failures ? `\n${failures} failure(s).` : "\nEvery step passed.");
  process.exit(failures ? 1 : 0);
}

/**
 * On a unitless document: shows moi_eval refused with `[no_units]`, then settles Millimeters
 * with set_units, as an agent would. Returns the refusal, or `null` when the document already
 * had units and nothing was done. Throws when either step goes otherwise.
 */
export async function settleUnits(host: SessionHost): Promise<string | null> {
  if ((await call(host, getSceneTool, {})).unitsCode !== NO_UNITS) return null;
  const { text } = await reply(host, moiEvalTool, { script: "return 1;" });
  if (!text.startsWith("[no_units]")) throw new Error(`a unitless document's moi_eval answered ${text}`);
  const set = await call(host, setUnitsTool, { units: "Millimeters" });
  if (set.units !== "Millimeters") throw new Error(`set_units left the document in ${set.units}`);
  return text;
}

/** Puts a document `settleUnits` settled back to no unit system; allowed once units are set. */
export const unsettleUnits = (host: SessionHost) =>
  call(host, moiEvalTool, {
    script: `moi.geometryDatabase.units = '${NO_UNITS}'; return moi.geometryDatabase.units;`,
  });

// Inside the 90 s the tickets allow, with room for startup and shutdown.
const WAIT_MS = 85_000;

/** A host with MoI's bridge connected. Exits the process if it cannot get one. */
export async function connect(): Promise<SessionHost> {
  const host = new SessionHost();
  console.log(
    `Only one server can own MoI (${handshakePath()}). Close your MCP client first, and restart ` +
      `it afterwards.`,
  );
  if ((await host.start()) === 0) {
    // Stood aside: another live server owns the handshake file. ensureOwner says which one.
    const err = await host.ensureOwner().catch((e: unknown) => e);
    console.error(`FAIL  [server_conflict] ${err instanceof Error ? err.message : String(err)}`);
    // No stop(): nothing listens and the file is not ours. Exiting in the same tick as the
    // owner check trips a libuv assertion on Windows (a socket still closing), so let it settle.
    await new Promise(() => setTimeout(() => process.exit(1), 100));
  }
  console.log(`Waiting up to ${WAIT_MS / 1000} s for MoI's bridge to dial in...`);
  const deadline = Date.now() + WAIT_MS;
  while (!host.connected && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  if (!host.connected) {
    console.error(
      `FAIL  no MoI bridge connected within ${WAIT_MS / 1000} s. Start MoI with the bridge ` +
        `installed (node dist/cli.js install), then run this again.`,
    );
    await host.stop();
    process.exit(1);
  }
  return host;
}

/** The agent's answer as text; a failure is `[code] message`, the way the agent reads it. */
export async function reply<Args>(host: SessionHost, tool: Tool<Args, any>, args: Args) {
  const r = await runTool(host, tool, args);
  return { r, text: r.content.map((c) => ("text" in c ? c.text : "")).join("") };
}

/** A JSON-answering tool's value; a failure throws with the agent's text. */
export async function call<Args>(host: SessionHost, tool: Tool<Args, any>, args: Args): Promise<any> {
  const { r, text } = await reply(host, tool, args);
  if (r.isError) throw new Error(text);
  return JSON.parse(text);
}

/** Runs a script that throws; `ok` when it comes back as `script_error` or `moi_error`, not a hang. */
export async function throwingScript(host: SessionHost) {
  const { r, text } = await reply(host, moiEvalTool, { script: "throw new Error( 'deliberate' );" });
  const code = /^\[(\w+)\]/.exec(text)?.[1];
  return { ok: r.isError === true && (code === "script_error" || code === "moi_error"), code, text };
}
