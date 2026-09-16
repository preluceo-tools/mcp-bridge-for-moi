/**
 * Test-only: points the server's app-data folder at a fresh temp folder, so no test writes the
 * real handshake file, and removes it when the file's tests end. Import it before anything that
 * reads a path. Never published.
 */
import { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const sandbox = mkdtempSync(join(tmpdir(), "mcp-bridge-for-moi-test-"));
process.env.MOI_MCP_APPDATA = sandbox;

after(() => rmSync(sandbox, { recursive: true, force: true }));
