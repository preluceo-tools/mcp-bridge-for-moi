# Probe 02 — a MoI command's HTML page has full networking

Run on 2026-09-08 against MoI 4.0 (`4.0 Dec-22-2020`) on Windows 11. Follows
[probe-01-script-host.md](probe-01-script-host.md), which found the command-line script host has no
network at all. This probe tests the other context: a command's `.htm` page.

Scripts and captured output are kept as primary sources under
[`prototypes/probe-02-page-context/`](../../prototypes/probe-02-page-context/).

## Result: the page context has everything the script host lacks

A custom command was installed to the user's `<MoI app data>\commands\` folder as an
`.htm` + `.js` pair, launched with `MoI.exe "<launcher>.js" /showwindow`, where the launcher called
`moi.command.execCommand( 'NetProbe2' )`. The page probed itself and a local HTTP server.

| Global | Script host (probe 01) | Command `.htm` page |
|---|---|---|
| `XMLHttpRequest` | `undefined` | **`object`** |
| `WebSocket` | `undefined` | **`object`** |
| `setTimeout` / `setInterval` | `undefined` | **`function`** |
| `window` / `document` | `undefined` | **`object`** |
| `localStorage` | `undefined` | **`object`** |
| `Blob`, `FileReader`, `Worker` | `undefined` | **`object`** |
| `fetch` | `undefined` | `undefined` |
| `moi` | `function` | `function` |

The page identifies as `moi://commands/NetProbe2.htm`, `document.domain` is `commands`, and the
user agent is `Mozilla/5.0 (N; Windows NT 10.0; Win64; x64) AppleWebKit/538.1 (KHTML, like Gecko)
MoI Safari/538.1`.

### All three network paths reached the server

Confirmed against a local server on `127.0.0.1:8765` responding with `Access-Control-Allow-Origin: *`:

- **Synchronous XHR** — `status 200`, correct response body. Server logged the GET.
- **Asynchronous XHR POST** — `status 200`, response body received, and the server logged the POST
  **with the request body intact**, from `origin: moi://commands`.
- **WebSocket** — the server logged a genuine upgrade request (`UPGRADE /socket origin=moi://commands
  key=w6IQf+PP67bRZ7Vn87sW+g==`). The handshake was not completed by the probe server, so the page saw
  `onclose`; the attempt itself proves the API works and the connection was allowed out.

So the `moi://` origin **is** permitted to reach `http://127.0.0.1`, and the server's CORS header was
accepted. `fetch` is absent, as expected for a 2015-era WebKit — use `XMLHttpRequest`.

### Command lifetime is what gates asynchronous work

The first attempt got `status 0` on the async request and no server hit, because the command's `.js`
returned immediately, ending the command and tearing the page down mid-flight. Parking the command on
the event loop fixed it — the stock MoI idiom, an object picker waited on in a loop:

```js
var picker = moi.ui.createObjectPicker();
while ( 1 ) {
    if ( !picker.waitForEvent() ) break;
    if ( picker.event == 'done' || picker.event == 'finished' ) break;
}
```

`waitForEvent()` pumps the event loop rather than blocking it, so page timers and async callbacks
run while the command is parked. `moi.exit( true )` called **from the page** ended the process
cleanly (exit code 0).

**The page lives exactly as long as its command does.** Any persistent bridge has to keep a command
parked, or find a longer-lived page — an open design question, not a settled one.

## Other confirmations

- Commands **are** picked up from the user's app data `commands\` folder with no registration step
  and no `AdditionalCommandsDirs` entry, even though `moi.filesystem.getCommandsDir()` reports only
  the install folder's `commands\`.
- `moi.command.execCommand( name )` works from a command-line script and does not throw; the command
  starts once the stack is clean, as the research predicted. The launcher must **not** call
  `moi.exit()` afterwards, or the command never runs.
- Inside a running command, `moi.ui.commandUI` is an `object` (in probe 01, with no command running,
  it threw `Operation failed`).
- `moi.ui.createDialog( '<absolute path>.htm', '', moi.ui.mainWindow )` returns an object, but the
  page **never loads** and `doModal()` blocks forever. Pages appear to resolve through the `moi://`
  scheme against MoI's own directories, not by filesystem path. The command route works; this one
  does not. **Untested:** passing a `moi://commands/<name>.htm` URL to `createDialog`.

## What this means for the bridge

The event-driven design is back on, and it is clearly the best of the three:

**MCP server (Node) ⇄ WebSocket ⇄ a parked MoI command whose `.htm` page holds the socket, calling
the `moi` API in response to messages.** One warm MoI instance, live model state between calls, and
the server can push — no polling, no process-per-operation.

The fallbacks from probe 01 (`shellExecute` with stdout capture; one MoI process per operation via
`MoI.exe script.js`) remain available and are worth keeping for batch conversion work, where a cold
process per file is fine.

## Still open

- How to keep the bridge command parked without the object picker hijacking user interaction — the
  picker is a real selection UI, not an inert wait.
- Whether a longer-lived page exists (side pane, browser pane, a modeless dialog) that could host the
  socket without occupying the command slot at all.
- Whether `fileExport()` suppresses the mesh dialog under a script, still unverified from probe 01.
- Whether launching `MoI.exe script.js` while MoI is already running starts a second process or
  hands off to the running one.
