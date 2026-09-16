import { homedir } from "node:os";
import { join } from "node:path";

/**
 * MoI's per-user application data folder — the writable place holding `commands\`,
 * `startup\` and `moi.ini`.
 *
 * Windows is the supported platform. The macOS location is the conventional one for
 * a Qt application of this vintage but is UNVERIFIED; see README.
 */
export function moiAppDataDir(): string {
  // Overridable so the tests never write into a real MoI installation.
  const override = process.env.MOI_MCP_APPDATA;
  if (override) return override;
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (!appData) throw new Error("APPDATA is not set; cannot locate MoI's app data folder.");
    return join(appData, "Moi");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Moi");
  }
  throw new Error(
    `mcp-bridge-for-moi supports Windows (and, untested, macOS). This platform is ${process.platform}.`,
  );
}

/** Scripts here are executed by MoI at launch. This is where the bridge is installed. */
export function moiStartupDir(): string {
  return join(moiAppDataDir(), "startup");
}

/** Where the server publishes its port and token for the bridge to find. */
export function handshakePath(): string {
  return join(moiAppDataDir(), "mcp-bridge-for-moi-handshake.json");
}

/** Where eval calls are logged, so a later version can learn from what actually broke. */
export function evalLogPath(): string {
  return join(moiAppDataDir(), "mcp-bridge-for-moi-eval.log");
}
