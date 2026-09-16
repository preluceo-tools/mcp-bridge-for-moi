# Probe 01 — what MoI 4's command-line script host can actually do

Run on 2026-09-08 against MoI 4.0 (`4.0 Dec-22-2020`) installed at `<MoI install folder>`
(`e.g. ...\MoI 4.0`), on Windows 11. Companion to
[moi-external-scripting.md](moi-external-scripting.md), which raised these as unverified.

Method: a probe script executed via `MoI.exe "<script>.js"`, with a local HTTP server listening on
`127.0.0.1:8765` (permissive CORS) to catch any outbound request. The script wrote its findings
through `moi.filesystem.openFileStream`, with a `shellExecute` echo as a fallback channel in case
the stream API was not what we assumed.

## Headline: the script host has no network, but it can shell out and read stdout

Two results decide the architecture.

**1. There is no networking in the bare script host.** Every one of these is `undefined`:

| Global | Result |
|---|---|
| `XMLHttpRequest` | `undefined` |
| `WebSocket` | `undefined` |
| `window`, `document` | `undefined` |
| `setTimeout`, `setInterval` | `undefined` |
| `localStorage` | `undefined` |
| `Promise` | `undefined` |
| `ActiveXObject` | `undefined` |
| `JSON` | **`object`** — available |

The probe server logged no request from MoI, only the `curl` used to verify it was up. So the
long-poll-over-HTTP design is **not available** from a `.js` run this way, and the identifiers found
inside `Qt5WebKit.dll` are indeed the engine shipping them, not the script host exposing them.

The global scope is a bare sandbox — enumerating it returned only the script's own variables plus
`moi`. There is no host object beyond `moi`.

**2. `shellExecute` with `waitForFinished` returns the child's stdout. Confirmed.**

```js
var res = moi.filesystem.shellExecute( 'cmd.exe', '/c echo HELLO_FROM_CHILD', true );
res.output    // "HELLO_FROM_CHILD\r\n"
```

This is a working synchronous bidirectional channel between MoI and any external program, and with
no network available it is the primary bridge candidate.

## Other confirmations

- **`MoI.exe "<script>.js"` runs with the window never shown and exits cleanly** (exit code 0 when
  the script ends with `moi.exit(true)`). Bridge 1 works end to end.
- **`openFileStream` works; the write method is `writeLine`.** Of the candidates tried
  (`write`, `writeLine`, `writeString`, `print`, `puts`, `writeText`), `writeLine` was the one
  present. `close()` exists.
- **`moi.getExecutableCommandLineArgs` is a function** and returns a MoI list object — so a
  command-line script can read its own arguments, and Bridge 1 can be parameterised without
  rewriting the script file per call.
- **Directory getters all work**: `getTempDir`, `getAppDataDir`, `getCommandsDir`, `getProcessDir`
  return native paths (`getAppDataDir` gives the user's `...\Roaming\Moi\` folder — the writable
  place for custom commands and startup scripts).
- **`moi.ui.commandUI` throws `Operation failed`** when no command is running, which is expected in
  a command-line script. `moi.ui.mainWindow.htmlWindow` is `undefined` in this context.
- **MoI objects do not enumerate.** `for...in` over `moi.ui`, `moi.filesystem`, and the
  `shellExecute` result all returned an empty key list, even though the members work when named
  directly. Introspection is not available: the API surface has to come from the docs, the
  `moi.idl`, and the binary's name table, not from runtime reflection.

## What this means for the bridge

The clean event-driven design is off the table for a bare command-line script. What remains:

- **`shellExecute(helper, args, true)`** — MoI drives, calling out to a helper that talks to the MCP
  server and answers on stdout. Confirmed working. Inverted control: MoI must ask, the server
  cannot push.
- **A line-oriented file mailbox** under `getTempDir()` via `openFileStream` — text only, no binary,
  and with no `setTimeout` any polling loop in the script host has to be a busy loop.
- **One MoI process per operation** via Bridge 1 — simple, stateless, no live session. The cost is
  process startup per call and no persistent model state between calls.

## Still open

The probe could not test the one remaining path: whether a **command's `.htm` page** — a genuine
WebKit document context, unlike the script host — exposes `XMLHttpRequest` / `WebSocket` and is
allowed to reach `127.0.0.1`. If it does, a persistent event-driven bridge inside a running MoI
becomes possible. Testing it needs the GUI running and a custom command invoked interactively.

Also still unverified: whether `fileExport()` suppresses the mesh dialog under a command-line
script, and whether launching `MoI.exe script.js` while MoI is already running starts a second
process or hands off to the running instance.
