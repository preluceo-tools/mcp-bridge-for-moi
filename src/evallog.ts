import { appendFileSync, statSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { evalLogPath } from "./paths.js";

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Appends one JSON line per eval: the script the agent wrote and what MoI said back.
 *
 * This exists to make the next version cheap. There is no automatic learning anywhere in
 * this system — the log is a corpus a human reads to decide which factory deserves a
 * typed tool and what the prelude is missing. Local file, never uploaded.
 */
export function logEval(entry: {
  tool: string;
  script: string;
  ok: boolean;
  code?: string;
  message?: string;
  ms: number;
}): void {
  try {
    const file = evalLogPath();
    mkdirSync(dirname(file), { recursive: true });
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, file + ".1");
    } catch {
      // No file yet, or rotation lost a race. Either way, just append.
    }
    appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n", "utf8");
  } catch {
    // Logging is a debugging aid. It must never break a tool call.
  }
}
