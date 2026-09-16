#!/usr/bin/env node
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { moiStartupDir } from "./paths.js";
import { serve } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const BRIDGE_SOURCE = join(here, "..", "assets", "bridge.js");
const BRIDGE_NAME = "mcp-bridge-for-moi-bridge.js";

function install(): void {
  if (process.platform !== "win32") {
    console.error(
      `mcp-bridge-for-moi is tested on Windows only. This is ${process.platform}.\n` +
        `The macOS path is believed to be ~/Library/Application Support/Moi/startup/, but nobody has\n` +
        `verified that MoI's side pane window behaves the same there. If you try it, please report back.\n` +
        `To install anyway, copy assets/bridge.js into MoI's startup folder by hand.`,
    );
    process.exit(1);
  }

  const dir = moiStartupDir();
  mkdirSync(dir, { recursive: true });
  const target = join(dir, BRIDGE_NAME);
  const updating = existsSync(target);
  copyFileSync(BRIDGE_SOURCE, target);

  console.log(`${updating ? "Updated" : "Installed"} the MoI bridge:\n  ${target}\n`);
  console.log("Restart MoI to arm it. Re-run this command after updating mcp-bridge-for-moi (rebuild first).");
}

const command = process.argv[2];

if (command === "install") {
  install();
} else if (!command || command === "serve") {
  void serve();
} else {
  console.error(`Unknown command: ${command}\n\nUsage:\n  node dist/cli.js          start the MCP server (stdio)\n  node dist/cli.js install  install the bridge into MoI's startup folder`);
  process.exit(1);
}
