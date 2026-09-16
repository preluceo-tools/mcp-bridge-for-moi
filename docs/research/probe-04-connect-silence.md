# Probe 04 — can a failed WebSocket connect be made silent?

Run on 2026-09-09 against MoI 4.0 (`4.0 Dec-22-2020`) on Windows 11. Follows
[probe-03-persistent-host.md](probe-03-persistent-host.md), which found the side pane's own window
is a working persistent host for a WebSocket but noticed one sharp edge: a socket that failed raised
a modal **Script error** box. Probe 03 closed with that as the single most important thing to
confirm next. This probe confirms it, and finds the way round it.

Scripts and captured output are kept as primary sources under
[`prototypes/probe-04-connect-silence/`](../../prototypes/probe-04-connect-silence/).

## Headline: a failed connect can never be silenced — but it can be avoided

**No handler, no wrapper and no scheduling trick suppresses the box.** `try`/`catch`, `onerror` and
`onclose` bound before any other property is touched, `window.onerror` returning `true`, a capturing
`addEventListener( 'error' )`, and deferring construction into the side pane's own `setTimeout` were
each tried against a port nothing is listening on. Every one produced the same modal box at the same
moment. Nothing in JavaScript ever fires — no `onerror`, no `onclose` — and `readyState` stays at
`0` (CONNECTING) forever.

**So an automatic WebSocket retry loop is not viable as written.** Five attempts at three-second
intervals produced **five stacked modal boxes** and five permanently hung sockets.

**But an `XMLHttpRequest` to the same dead port is completely silent**, and that is the whole answer.
Poll with XHR, construct the WebSocket only once the MCP server has actually answered, and the retry
loop is silent and automatic after all. Confirmed working in both directions: silent forever with no
server, connected in 265 ms once one is there.

---

## Evidence

Each row is one MoI launch — one client shape, one server behaviour — observed for 16–25 s with the
process's visible window list polled once a second. Verbatim in
`prototypes/probe-04-connect-silence/verdicts.txt`.

| # | Case | Server | Verdict | First box |
|---|---|---|---|---|
| 0 | Control: heartbeat only, no socket ever constructed | none | **SILENT** | — |
| 1 | Naive connect, `try`/`catch` round `new WebSocket`, handlers after | none | **BOX ×1** | +5.4 s |
| 2 | `onerror`/`onclose` bound first, before even reading `readyState` | none | **BOX ×1** | +5.3 s |
| 3 | `window.onerror` returning `true` + capturing `addEventListener('error')` | none | **BOX ×1** | +5.2 s |
| 3b | Both of the above together, plus deferred construction | none | **BOX ×1** | +5.2 s |
| 5 | Construction scheduled via the side pane's own `setTimeout( …, 500 )` | none | **BOX ×1** | +5.4 s |
| 4a | Happy path: real handshake, socket left open | `wsopen` | **SILENT** | — |
| 4b | Clean server-side `close(1000)` after 4 s | `wsclose` | **SILENT** | — |
| 4c | Abrupt server-side socket destroy after 4 s | `wskill` | **BOX ×1** | +5.2 s |
| 6a | Retry loop, 5 attempts every 3 s, no teardown | none | **BOX ×5** | +5.2 s |
| 6b | Retry loop, `close()` on the previous attempt first | none | **BOX ×2**, page died | +4.2 s |
| 6c | 6b repeated, to check it reproduces | none | **BOX ×2**, page died | +4.1 s |
| 7a | XHR poll every 2 s, socket gated behind a `200` | none | **SILENT** | — |
| 7b | The same XHR gate, server present | `wsopen` | **SILENT** | — |

Every case ran in `moi.ui.sidePane.window`, the host probe 03 recommended, driven from a single `.js`
in `<MoI app data>\startup\`.

## The exact box

Transcribed from `fullscreen-1b-refused-naive-timed.png` (refused connect) and
`fullscreen-4c-wskill.png` (abrupt drop). Window title **`Script error`**, one **OK** button.

> WebSocket network error: Connection refused
>
> `moi://ui/SidePane.htm`   line 0
>
> ```
> 1:    <html>
> 2:      <head>
> 3:        <script>
> 4:          var g_Version = 20181017; // 8 digit date based version YYYYMMDD
> ```

> WebSocket network error: The remote host closed the connection
>
> `moi://ui/SidePane.htm`   line 0
>
> (followed by the same four-line source excerpt)

Two things in that text decide the diagnosis:

- **It names the host page, not the bridge script.** The file is `SidePane.htm`, the line is `0`, and
  the four lines of source quoted are the *first four lines of the side pane's own HTML* — a generic
  head-of-file excerpt, not the failing statement. The reporter has a page and a message and no
  script location at all.
- **It is not a JavaScript exception.** No socket `onerror` fired, no `onclose` fired, no
  `window.onerror` fired, no capturing error listener fired, and the `try`/`catch` round the
  constructor caught nothing. The box is raised natively by the engine's error-reporting path for the
  page, below the level script can see. That is why every suppression idiom failed: there is nothing
  for them to suppress.

Confirming detail: `moi.getLog()` was sampled at 6 s and 15 s in every run and contained only
`Init.cpp 310: Moi starting up`. The failure never reaches MoI's own log — the modal box is the only
channel it uses.

### It is asynchronous, roughly four seconds late

The socket is constructed within ~5 ms of the startup script running. The box appears 4–5 s later,
consistently between the 4 s and 5 s poll, in every failing case. The heartbeat keeps ticking on
schedule right through it. It is not a construction-time throw, and there is no moment at which
script could pre-empt it.

The same ~4 s shows up on the XHR side: a request to the same dead port sits for **4.1 s** before
reporting `readyState=4 status=0`. So both APIs share a connect timeout of about four seconds rather
than reporting the refusal immediately, even on the loopback address. Whether that is a proxy lookup,
a name-resolution step, or a fixed timeout in the engine's socket layer is **UNVERIFIED**.

## The happy path is clean, and so is a polite close

This is the item probe 03 flagged as most important and could not test, because its server never
completed a handshake. Settled now, against a real WebSocket server:

- **Completed handshake, socket held open** — `onopen` at +137 ms, `send` accepted, the server's
  message received back at +139 ms, `readyState=1` still at the 15 s mark. **No box.** The server
  logged `OPEN /bridge origin=moi://ui` and the message body.
- **Clean server-side `close(1000)`** — `onclose` fired at +4229 ms with `code=1000 wasClean=true`
  and `readyState` settled at `3`. **No box.** A polite shutdown is fully handled in script.
- **Abrupt server-side socket destroy** — **box**, with the "remote host closed the connection" text
  above. And worse than the box: **no `onclose` ever fired and `readyState` stayed at `1` (OPEN) for
  the rest of the run.** The page goes on believing it holds a live socket that is gone.

So the MCP server closing politely is a hard requirement, exactly as probe 03 guessed — and the
bridge cannot detect a server that dies abruptly from `readyState` or from `onclose`. It needs its
own application-level heartbeat.

## Hung sockets accumulate, and tearing them down is worse

This turned out to matter more than the box.

In the retry run with no teardown (`result-6a-retry-noteardown.txt`) the heartbeat printed the
`readyState` of every socket ever constructed. Verbatim, at the last beat:

```
heartbeat = 20 at +20082ms, readyState=0, allSockets=[0,0,0,0,0]
```

All five failed sockets were still in state `0`, CONNECTING, twenty seconds in and long after each
had raised its box. **A failed connect never resolves.** It does not reach CLOSED, it does not notify
script, and it is not collected while it is referenced. A retry loop running for a working day
against an absent server would leave hundreds behind, one modal box each.

Calling `close()` on the previous attempt before starting the next one is **not** the fix. In both
runs of that case the page's own timers stopped dead at the heartbeat immediately before the first
`close()` call:

```
heartbeat = 2 at +2016ms, readyState=0, allSockets=[0]
```

— and nothing was ever written again. No `close() called` line, no `close() THREW` line: the result
file simply ends. The heartbeat, the retry timer and the file writes all stopped, while two boxes
still appeared. Reproduced identically on a second run (cases 6b and 6c). Calling `close()` on a
socket stuck in CONNECTING takes the side pane's script context down with it. The precise mechanism —
a native crash in the page's script engine versus a permanently blocked call — is **UNVERIFIED**;
what is verified is that the page stops running, so the bridge would be dead with no user-visible
signal beyond the boxes already on screen.

**Never call `close()` on a socket that has not reached OPEN.**

## The fix: gate the socket behind an XHR probe

An `XMLHttpRequest` to the same host and port raises nothing. Verbatim from
`result-7a-xhrgate-noserver.txt`, polling a dead port for the whole run:

```
+6ms     = xhr probe 1 sent to http://127.0.0.1:<port>/ping
+4100ms  = xhr probe 1 readyState=4 status=0
+6103ms  = xhr probe 2 sent to http://127.0.0.1:<port>/ping
+10144ms = xhr probe 2 readyState=4 status=0
…
```

`status=0`, handled entirely in script, **no box, ever** — and the heartbeat ran to its full 20 beats,
so nothing else broke either. With the server up (`result-7b-xhrgate-server.txt`) the same code
promotes itself immediately:

```
+207ms = xhr probe 1 readyState=4 status=200
+207ms = gate OPEN -> constructing WebSocket
+233ms = gated: constructed, readyState=0
+265ms = gated: onopen, readyState=1
+266ms = gated: sent
+267ms = gated: onmessage: HELLO-FROM-SERVER
```

Silent in both directions. The server saw the `GET /ping` and then the upgrade, both from origin
`moi://ui`, 230 ms apart.

## What this means for the bridge

**The automatic retry loop is viable, with one change: the thing that retries is an XHR poll, not a
WebSocket.** The shape:

1. A `.js` in `<MoI app data>\startup\` takes `moi.ui.sidePane.window` (probe 03).
2. In that window, `setInterval` an `XMLHttpRequest` GET against a health endpoint on the MCP server.
   Allow ~4 s per attempt, so poll no faster than roughly every 5 s.
3. On `status == 200`, and only then, construct **one** `WebSocket`. It will connect. Silent.
4. On a clean `onclose` (`wasClean == true`), drop the reference and go back to polling. Never
   `close()` anything that has not opened, and never construct a socket speculatively.
5. Carry an application-level ping, because an abruptly dead server leaves `readyState` at `1`
   forever with no `onclose`. A silent half-open socket is the failure mode to design against, and it
   is worse than the noisy one.

Requirements this places on the MCP server, all now evidence-backed:

- **Answer plain HTTP on the same port**, so the gate has something to probe. The probe server did
  both on one HTTP server object; no second port is needed.
- **Complete the WebSocket handshake.** An upgrade that is answered and then dropped is the probe 03
  failure, and it boxes.
- **Always close with a proper close frame** (`close(1000)`). Destroying the socket boxes the user
  and leaves the page holding a phantom open connection.

The explicit opt-in `StartBridge` command is **not** needed. It stays available as a fallback if the
gate ever proves unreliable in the field, but nothing observed here calls for it.

## Still open

- The cause of the ~4 s stall before a connect to a dead local port reports failure. It bounds how
  fast the gate can poll, and it is **UNVERIFIED**.
- Why calling `close()` on a CONNECTING socket stops the page — **UNVERIFIED** whether it is a crash
  in the script engine or a block. Untested, and needed by the bridge's own shutdown path: whether
  `close()` on an **open** socket is safe.
- Whether the box can be dismissed from script, and whether a stack of them blocks anything the user
  needs. Timers kept running with five boxes up, but no interaction with them was attempted.
- Whether the gate recovers when the MCP server restarts under a live socket. Only a cold start and a
  clean close were tested.
- Carried over from probe 03: whether long-lived state injected into `moi.ui.sidePane.window`
  survives a pane reload (`moi.ui.reloadPanels`), with no re-arm path tested; what
  `moi.ui.getUIPanel( … )` keys on; whether an unreferenced `createDialog` result is collected.
- Carried over from probe 01, still unverified: whether `fileExport()` suppresses the mesh dialog
  under a script, and whether launching a second `MoI.exe` with a script while MoI is already running
  starts a new process or hands off.

## Method notes

- One MoI launch per case, so every box is attributable to exactly one client shape and one server
  behaviour. The runner (`run-case.ps1`) kills any stray MoI and probe server, writes the case as a
  single line into `<MoI app data>`, copies the startup script in, launches MoI, enumerates that
  process's visible windows once a second for the observation window, captures the screen the first
  time a window titled with "error" appears, then kills MoI and removes the startup script.
- The per-second window poll is what gives the "first box" column; the per-case `timeline-*.txt`
  files hold the full second-by-second window list.
- Everything installed went to `<MoI app data>\startup\` as `Probe4Connect.js`, plus one case file and
  one result file directly in `<MoI app data>\`, all named with a `probe4` prefix and all removed
  afterwards. Nothing was written under the install folder. `moi.ini` was not touched at all, so no
  backup was needed. No MoI process was left running.
- Findings were written from the borrowed window through `moi.filesystem.openFileStream` +
  `writeLine` + `close()`, rewriting the whole file after every event, so a run that dies mid-way
  still leaves everything up to that point on disk — which is exactly how the `close()` freeze was
  caught.
- The probe server is Node with the `ws` package, with four selectable behaviours (`http400`,
  `wsopen`, `wsclose`, `wskill`), logging every request and upgrade to a per-mode file.
