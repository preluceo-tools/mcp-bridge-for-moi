import type { ZodRawShape } from "zod";

export type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/** Every tool's value is JSON; `get_view` is the one that renders it as something else. */
export const asJson = (value: unknown): Content[] => [
  { type: "text", text: JSON.stringify(value, null, 2) },
];

/** MCP hints for the client. */
export type Annotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: false;
};

/**
 * The four kinds, one per README **Kind** column value, as the MCP hints each one sends. A tool
 * picks one itself; its kind is never inferred from `direct`. A test holds the README to these.
 */
export const READ_ONLY: Annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const CHANGING: Annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const WRITES_FILE: Annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
export const DESTRUCTIVE: Annotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

/**
 * One MCP tool, whole: what the agent is told, what it may send, the ES5 that runs in MoI and
 * how MoI's reply becomes the answer. `runTool` in index.ts is the one path that runs it.
 */
export type Tool<Args, Reply> = {
  name: string;
  /** Without `REFUSES_NOTE`: the server appends it when `direct` is false. */
  description: string;
  /** The zod raw shape `registerTool` takes. */
  input: ZodRawShape;
  /** Runs in the bridge's context, answering while the user has a command running. */
  direct: boolean;
  /** One of the four kinds above, declared per tool and never derived from `direct`. */
  annotations: Annotations;
  /** Refused with `no_units` on a document with no unit system; the bridge makes the check, the server adds the note. */
  needsUnits?: boolean;
  /** A message refuses the call as `bad_request` before anything is sent to MoI. */
  precheck?(args: Args): string | undefined;
  /** An answer that needs no MoI; `undefined` goes on to the bridge. */
  local?(args: Args): Content[] | undefined;
  script(args: Args): string;
  /** Throws `BridgeError` to fail. Omitted means `asJson`. */
  reply?(value: Reply, args: Args): Content[];
};
