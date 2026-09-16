# MoI MCP

An MCP server that lets an agent inspect and model in a live Moment of Inspiration (MoI3D) v4
session, by talking to a script running inside MoI itself.

## Language

### The two processes

**Server**:
The Node process. Speaks MCP to the agent on one side and hosts the listener the bridge dials into
on the other. There is exactly one, and it outlives any particular MoI.
_Avoid_: MCP server (when the context is already clear), host, daemon, backend

**Agent**:
The MCP client at the far end of the server — the thing deciding what to model.
_Avoid_: Claude, client, LLM, user

**Bridge**:
The script running inside MoI that holds the connection to the server and calls the `moi` API on
its behalf. Installed by the user; one per MoI process.
_Avoid_: plugin, addon, client, shim

**Session**:
One live MoI process with a connected bridge, plus the document open in it. Tool calls either
have a session or fail; there is no queue of work waiting for one to appear.
_Avoid_: connection, instance, context

**Cold call**:
Work done by launching a throwaway `MoI.exe script.js` process with no GUI and no session — the
batch path. Distinct from anything a session does, and never a silent substitute for it.
_Avoid_: headless run, batch job, one-shot

**Tool**:
One operation the agent can call: its input, whether it runs direct or as a command, the script
it sends and how its reply reads.
_Avoid_: handler, endpoint, command (that is a MoI command)

**Kind**:
What a tool can do to the user's work — one of four: **read-only** (only looks), **changing**
(alters what the user sees or a document setting, never geometry), **writes a file** (leaves
MoI as it was and writes a new file to disk), **destructive** (can create, alter or remove
geometry). Each tool states its kind itself; it is never inferred from whether the tool runs
direct or as a command, which is a separate question.
_Avoid_: safety level, category, permission

### Where the bridge lives

**Host window**:
The window inside MoI whose JavaScript context the bridge runs in. It must outlive any single
command, so that the bridge survives the user modelling normally.
_Avoid_: page, frame, panel

**Script host**:
MoI's bare JavaScript context — the one a `MoI.exe script.js` run and a startup script get. Has
`moi` and `JSON` and nothing else: no networking, no timers, no `window`.
_Avoid_: sandbox, interpreter, JS host

**Gate poll**:
The plain HTTP request the bridge makes to check whether the server is up, before it will
construct a connection. Exists because a failed connection cannot be made silent, and a failed
poll can.
_Avoid_: health check, heartbeat, ping

**Handshake file**:
The file the server writes on startup, holding where to reach it and the secret needed to do so.
The bridge re-reads it on every gate poll, so it is the single source of truth for how a session
gets established — not configuration the user maintains.
_Avoid_: config file, lockfile, discovery file

**Liveness ping**:
The application-level exchange over an established connection that tells the bridge the server is
still alive. Separate from the gate poll: the gate poll decides whether to connect, the liveness
ping decides whether a connection still means anything.
_Avoid_: heartbeat, keepalive, health check

### Modelling

**Factory**:
MoI's own unit of geometry creation — a named operation with positional inputs, updated and then
committed. The modelling surface is built on these, not on MoI's user-facing commands.
_Avoid_: operation, builder, tool

**Command**:
A user-facing MoI action, invoked by name. Dispatched, never awaited: MoI runs it once the call
stack is clean, so nothing can be sequenced after it. Starting one ends any running command.
_Avoid_: factory, action, function, changing call (a tool call that runs as a command is a
command call; "changing" is a kind)

**Running command**:
A command the user has started and not yet finished or cancelled. A tool call never interrupts
one.
_Avoid_: active command, busy state, pending command

**Stock caller**:
One of MoI's own command scripts, read as the worked example for how to drive a factory. The
install folder is treated as documentation, not as code to modify.
_Avoid_: builtin, sample, reference script

**Capture**:
Establishing which objects an operation produced and which it consumed, by comparing the document
before and after it. Necessary because no factory reliably reports its own output — and a factory
that cannot do what it was asked commits without an error and changes nothing, so a capture in
which nothing changed is the only sign of that failure.
_Avoid_: created objects, result, diff

**Unit system**:
What the numbers in the document mean — one of MoI's named systems (`Millimeters` … `Miles`), or
none. A document with none can be looked at but not modelled in or exported through the tools:
the agent asks the user and settles it first. The agent settles a unit system; it never
converts one, because converting rescales geometry and replaces every object's id.
_Avoid_: units setting, scale, measurement system

### Seeing

**Viewport**:
One of MoI's four named panes — `3D`, `Top`, `Front`, `Right` — always addressed by that name.
Never "the active viewport": `moi.ui.getActiveViewport()` follows the mouse pointer, so an agent
using it does not know what it is looking at.
_Avoid_: view, pane, window, camera

**Render**:
An offscreen drawing of a viewport at a size of the caller's choosing. Works whether or not that
viewport is on screen, and whether or not MoI is. This is how the agent sees.
_Avoid_: screenshot, capture, image, snapshot

**Screen grab**:
A copy of what is literally on screen. Reserved for the whole MoI window, which a render cannot
produce. It cannot address a viewport that is hidden — asked for one, it returns a different
viewport's image and reports no error — which is why it is never the way the agent sees geometry.
_Avoid_: screenshot, capture, render

**Framing**:
Moving a viewport's camera so that named objects, the selection, or the whole scene fill it. A
calculation over bounding boxes, not a MoI command: it never changes the selection and never
enters the undo stack.
_Avoid_: zoom, fit, zoom to fit, reset

**Layout**:
Which viewports are on screen — all four, or one of them alone. The user's arrangement, changed
only when the agent says so outright, never as a side effect of looking at something.
_Avoid_: split, view mode, arrangement

### Testing

**Fake moi**:
A stateful stand-in for the `moi` object that the scripts a tool sends are run against in
`npm test`, with the bridge's real prelude ahead of them. It models only what the scripts touch,
records every call in order, and is kept honest by the live e2e run, never by itself.
_Avoid_: mock, stub, simulator

**Fake window**:
The side pane's window as the fake moi presents it: a clock the test moves, a `WebSocket` and an
`XMLHttpRequest` the test answers. The shipped `bridge.js` runs against it unchanged in `npm test`,
so what the bridge does is tested, not what its source says.
_Avoid_: mock window, test harness, DOM stub

**Live run**:
An opt-in run against a real MoI — `npm run e2e` or the factory sweep. It checks the document it
is given, does its steps, and hands the document back as it found it: the same objects, units
and layout.
_Avoid_: integration test, e2e test (that is the script name, not the concept)

**Factory sweep**:
The live run that drives every factory MoI has through the bridge, one at a time, and checks
after each that the bridge still answers. Its question is whether the bridge breaks, not whether
the geometry is right.
_Avoid_: factory test, smoke test (that is `npm run e2e`), coverage run
