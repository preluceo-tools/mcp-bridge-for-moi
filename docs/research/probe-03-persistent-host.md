# Probe 03 — a persistent network host inside MoI, with no command running

Run on 2026-09-08 against MoI 4.0 (`4.0 Dec-22-2020`) on Windows 11. Follows
[probe-01-script-host.md](probe-01-script-host.md) (the command-line script host has no network)
and [probe-02-page-context.md](probe-02-page-context.md) (a command's `.htm` page has everything,
but lives only as long as the command). This probe hunts for a host that keeps a WebSocket alive
**without occupying the command slot**.

Scripts and captured output are kept as primary sources under
[`prototypes/probe-03-persistent-host/`](../../prototypes/probe-03-persistent-host/).

## Headline: found — the side pane's own window, reached from a startup script

A `.js` file in `<MoI app data>\startup\` runs at launch in the bare script host (no network, no
timers — see question D below), **but by the time it runs the main window and its panes already
exist**, and their live `window` objects are reachable:

```js
var w = moi.ui.sidePane.window;      // [object Window], moi://ui/SidePane.htm
w.setTimeout( fn, 1000 );            // fires
new w.WebSocket( 'ws://127.0.0.1:8765/…' );   // connects out
```

That timer kept firing for the full 40 s the probe scheduled it for, with MoI sitting idle, no
command active and no dialog open, and the socket reached the local server. The side pane is loaded
before any user interaction and stays loaded for the life of the process. **No command slot, no
picker, no patched install file.**

A second, independent host also worked: `moi.ui.createDialog( 'moi://commands/<name>.htm', … )`
called from the same startup script **loads the page immediately** and its timers keep running —
the form probe 02 explicitly left untested. It costs a small visible floating window.

---

## Question D — is `<MoI app data>\startup\` executed, and in which context?

### `.js` files there are executed. `.htm` files are not.

The first run is the cleanest proof, because the probe script had a syntax error and MoI said so:

> **SyntaxError: Unexpected EOF**
> `Probe3Startup.js`  line 5

(`prototypes/probe-03-persistent-host/scripterror-startup-syntax.png`.) MoI parsed the file, named
it, and numbered its lines. The folder is scanned and its `.js` files are run. Two `.js` files
dropped in together both ran in the same launch, so it is not a single fixed filename — any `.js`
in the folder is picked up. A `.htm` file placed in the same folder alongside it produced neither
output nor an error: **`.htm` in `startup\` is ignored.**

For the record, `moi_lib.dll` carries the bare wide string `startup` (adjacent to
`MainWindowLayout.xml`), and `moi.ini` has no key that turns the folder on or off — the only
`startup`-ish keys on this machine are `StartupWorkingDirectory=` and `Startup template=`, both
unrelated. No ini entry is needed; dropping the file in is enough.

### The context is the bare script host — probe 01's context, not probe 02's

Exact output, `prototypes/probe-03-persistent-host/probe3-startup-js.txt`:

| Global | Startup `.js` | (probe 01 script host) | (probe 02 command page) |
|---|---|---|---|
| `XMLHttpRequest` | `undefined` | `undefined` | `object` |
| `WebSocket` | `undefined` | `undefined` | `object` |
| `setTimeout` / `setInterval` | `undefined` | `undefined` | `function` |
| `window` / `document` | `undefined` | `undefined` | `object` |
| `localStorage` | `undefined` | `undefined` | `object` |
| `fetch` | `undefined` | `undefined` | `undefined` |
| `Promise`, `ActiveXObject` | `undefined` | `undefined` | — |
| `JSON` | `object` | `object` | — |
| `moi` | `function` | `function` | `function` |

So **nothing scheduled directly in a startup script can outlive it** — there is no timer API to
schedule with. The tick test was therefore skipped by its own guard and no tick file was written,
which is the unambiguous negative we wanted.

### But the UI is already up when it runs

Also from the same file:

```
moi.ui.commandUI = THREW: Operation failed
moi.ui.mainWindow = function
moi.ui.mainWindow.htmlWindow = undefined
moi.ui.sidePane = object
moi.ui.getUIPanels = function
moi.ui.getUIPanel = function
moi.ui.createDialog = function
moi.command.currentCommandName = []
getAppDataDir = <MoI app data>\
getCommandsDir = <MoI install folder>\commands\
```

No command is running (`currentCommandName` is empty, `commandUI` throws exactly as in probe 01),
but `moi.ui.sidePane` is a live object. That is the opening.

---

## Question C — what is always loaded in the main window, and can we reach it?

### The panes

`moi.ui.getUIPanels()` returned **7 panels**, and every one of them exposes a live document and
window (`prototypes/probe-03-persistent-host/probe3-ui.txt`):

```
panels.length = 7
panel[0].document = object :: [object HTMLDocument]
panel[0].window   = object :: [object Window]
…
moi.ui.sidePane.window = object :: [object Window]
moi.ui.sidePane.window.location.href = moi://ui/SidePane.htm
moi.ui.commandBar.window = object :: [object Window]
```

`.url`, `.htmlWindow`, `.htmlDocument`, `.visible` and `.title` are all `undefined` on a panel —
the accessors are the plain DOM names **`.window` and `.document`**, not the `htmlWindow` /
`htmlDocument` pair used on a command's UI. `.name` is present but empty on every panel, so panels
cannot be told apart by name. `moi.ui.getUIPanel( … )` returned an object for every argument tried
(`'sidepane'`, `'SidePane'`, `0`, `'moi://ui/SidePane.htm'`), so its lookup rule is **UNVERIFIED**
and it should not be trusted to select a specific pane; `moi.ui.sidePane` and `moi.ui.commandBar`
are the reliable named handles.

Which pages these are, from the install's `<MoI install folder>\ui\` folder and the `moi://ui/…`
strings in `moi_lib.dll`: `SidePane.htm` (confirmed by `location.href`), `CommandBar.htm`,
`BrowserPane.htm`, `ViewControls.htm`, plus others. `moi.ini` on this machine carries
`MainWindow::moi://ui/BrowserPane.htm=…` under the window-geometry section — that is a saved pane
size, not a registration hook.

### Their scripts are not redirectable

`SidePane.htm` has an inline `<script>` block and pulls in `<script src="SidePaneTabs.js">` and
`<script src="PropPanel.js">`, both resolved relative to `moi://ui/`, which maps to
`<MoI install folder>\ui\`. `BrowserPane.htm` has no script block at all — it is a `moi:Binder`
plus a `moi:SceneBrowser` element. Appending to either means editing a vendor file, which this
probe did not do and which the bridge should not require.

**A user `ui\` folder does not override the install one.** `<MoI app data>\ui\Probe3Host.htm` was
created and `moi.ui.createDialog( 'moi://ui/Probe3Host.htm', … )` loaded nothing, while the same
file under `<MoI app data>\commands\` loaded fine. `moi.filesystem.getUIDir()` reports only
`<MoI install folder>\ui\`. So `moi://ui/` is install-only.

`moi.ini` offers no documented hook for adding a page to the main window or side pane. The one
extension point in it is `[Commands] AdditionalCommandsDirs=`, which adds command folders, not UI.

### `createDialog` with a `moi://` URL — the untested form — works

This is the item probe 02 left open. From a startup script:

```js
moi.ui.createDialog( 'moi://commands/Probe3Host.htm', '', moi.ui.mainWindow );
```

The page's parse-time marker was written, so the page **really loaded**
(`prototypes/probe-03-persistent-host/probe3-hostpage.txt`, exact contents):

```
Probe3Host.htm parsed. href=moi://commands/Probe3Host.htm XHR=object WS=object setTimeout=function
Probe3Host.htm parsed. href=moi://appdata/commands/Probe3Host.htm XHR=object WS=object setTimeout=function
```

Two of the three URL forms loaded — `moi://commands/…` and `moi://appdata/commands/…` (there is a
`moi://appdata/` scheme host in `moi_lib.dll`, and it resolves to the user's MoI app data folder).
The third, `moi://ui/…`, did not. Note that `moi://commands/` finds a page in the **user's**
`commands\` folder even though `getCommandsDir()` reports only the install folder — the same
override probe 02 saw for command `.js` files.

The returned object exposes `.htmlWindow` and `.htmlDocument` as objects; it has **no** `show`,
`close` or `visible` member. `doModal()` was deliberately never called. The page loads and starts
running at `createDialog` time.

**It is a visible window.** Screen enumeration found a 93×59 px floating window titled `MoI`
rendering the page body, sitting over the app (`createdialog-window.png`). It is modeless — MoI
stayed usable — but it is not hidden, and no API for hiding it was found.

---

## The persistence test — both hosts survive with MoI idle

One startup script, two hosts, each writing its own tick file once a second
(`Probe3Tick.js` + `Probe3Tick.htm`). MoI was launched and left completely alone.

| Host | Result |
|---|---|
| `createDialog( 'moi://commands/Probe3Tick.htm' )` page, its own `setTimeout` loop | `ticks = 56`, `elapsed_ms = 56379` |
| `moi.ui.sidePane.window.setTimeout`, scheduled from the startup script | `ticks = 40`, `elapsed_ms = 40267` |

Both ran to the caps their scripts set (60 s and 40 s), one tick per second, no drift, with no
command active and no user interaction. Exact captured files: `probe3-dialog-ticks.txt`,
`probe3-sidepane-ticks.txt`.

Both also reached the network. The probe server's log, verbatim:

```
UPGRADE /sidepane origin=moi://ui      key=AxC58Ip23kIKioVPCLCsiQ==
UPGRADE /dialog   origin=moi://commands key=0R2hj2V50svgDveDxxzMRA==
```

Two genuine WebSocket upgrade requests — one from the side pane's own window at origin `moi://ui`,
one from the hidden-ish dialog page at origin `moi://commands`. Both origins are allowed out to
`127.0.0.1`, extending probe 02's finding to `moi://ui`.

Probe recorded from the startup script (`probe3-tick.txt`):

```
sidePane.window.setTimeout = function
sidePane.window.XMLHttpRequest = object
sidePane.window.WebSocket = object
sidePane.window.location.href = moi://ui/SidePane.htm
```

### One sharp edge: a failed socket raises a modal error dialog

The probe server accepts the upgrade and then drops the connection without completing the
handshake. MoI surfaced that as a modal **Script error** box, once per page
(`scripterror-ws-0.png`, `scripterror-ws-1.png`):

> WebSocket network error: The remote host closed the connection
> `moi://commands/Probe3Tick.htm`  line 0

> WebSocket network error: The remote host closed the connection
> `moi://ui/SidePane.htm`  line 0

The dialog page had `onerror` and `onclose` handlers installed and they did **not** suppress it —
its status field never advanced past `constructed, readyState=0`. So a WebSocket network failure
inside MoI is reported to the user as a modal dialog the bridge cannot swallow with a handler.
Timers kept ticking while the box was up, but the user gets a box. Whether a server that completes
the handshake cleanly and closes politely avoids this is **UNVERIFIED** — the probe server never
completed a handshake. Treat it as a hard requirement on the MCP server: complete the handshake,
and close cleanly.

---

## What this means for the bridge

Four parking options were on the table. Ranked by what was actually observed:

1. **Side pane window, driven from a startup script** — recommended. A `.js` in
   `<MoI app data>\startup\` takes `moi.ui.sidePane.window` and uses that window's `WebSocket`,
   `XMLHttpRequest` and `setTimeout`. Nothing is installed outside the user's own app data folder,
   no install file is patched, no command runs, no picker hijacks selection, no window appears, and
   it is armed automatically at every launch. Confirmed to survive 40 s idle and to reach the
   local server.
2. **Hidden-ish dialog page via `createDialog( 'moi://commands/<name>.htm' )`** — a working
   fallback, and the better choice if the bridge needs a page of its own rather than borrowing the
   side pane's. Costs a small visible floating window with no found way to hide it, and its page
   must be kept referenced (the probe held the dialog in a global; whether an unreferenced dialog
   survives is **UNVERIFIED**).
3. **Parked command with an object picker** (probe 02) — demoted. It works, but it occupies the
   command slot and hijacks the selection UI, and options 1 and 2 do not.
4. **Patched UI pane** — rejected. It requires editing a vendor file under the install folder;
   the user `ui\` override that would have made it safe does not exist.

The startup script itself is only the launcher: it has no network and no timers of its own, so all
bridge logic belongs in the borrowed window (or the dialog page), reached in that first call.

The probe-01 fallbacks (`shellExecute` with stdout capture; one MoI process per operation) remain
available and remain the right tool for stateless batch conversion.

## Still open

- Whether a WebSocket that completes its handshake and closes cleanly avoids the modal
  **Script error** box. The probe never completed a handshake, so this is untested and it is the
  single most important thing to confirm next.
- Whether injecting long-lived state into `moi.ui.sidePane.window` is safe across a pane reload —
  `moi.ui.reloadPanels` exists in the API surface, and if the side pane ever reloads, the socket
  and timers go with it. No re-arm path was tested.
- Whether the `createDialog` window can be hidden, moved offscreen or sized away. No `show`,
  `close` or `visible` member was found on the returned object.
- What `moi.ui.getUIPanel( … )` actually keys on — it returned an object for every argument tried,
  including nonsense ones.
- Whether an unreferenced `createDialog` result is collected and its page torn down.
- Carried over, still unverified: whether `fileExport()` suppresses the mesh dialog under a script,
  and whether launching a second `MoI.exe` with a script while MoI is running starts a new process
  or hands off.

## Method notes

- Everything installed went to `<MoI app data>\startup\`, `<MoI app data>\commands\` and a
  temporary `<MoI app data>\ui\`, all named with a `Probe3` prefix, and all removed afterwards.
  Nothing under the install folder was written to — question C was recon only.
- `moi.ini` was backed up before the first launch and restored byte-identical afterwards
  (MD5 verified). MoI was launched and terminated for each run; no instance was left running.
- Findings were written through `moi.filesystem.openFileStream( name, 'w' )` + `writeLine` +
  `close()` — the confirmed write path from probe 01, there being no console. Paths were built from
  `moi.filesystem.getAppDataDir()` rather than hard-coded, which also sidesteps backslash escaping.
