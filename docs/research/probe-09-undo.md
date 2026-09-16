# probe-09 — one undo unit per tool call

Run against a live MoI 4 session through the bridge, in an empty document.

The question: can a script that commits three factories be made to produce exactly one undo
step, from the bridge's own context — parked in the side pane, no command running?

## What the undo surface actually is

Every undo-related symbol in `moi_lib.dll`'s string table:

    undo   redo   setCommandSpecificUndo   addSelectedObjectsStateUndoUnit
    revision   lastCommandRevisionStart   lastCommandRevisionEnd   MinNumberOfUndos

There is no begin/end-undo-record pair, and nothing that takes a range of revisions.

## The lead in probe-07 was a red herring

`setCommandSpecificUndo( true )` is used by exactly three stock commands — `Copy.js`,
`DoCurve.js`, `Image.js` — and `Copy.js` shows what it is for: it keeps a stack of the
objects each step created, and when the point picker reports an `'undo'` event it pops the
last entry and removes those objects with `moi.geometryDatabase.removeObjects`.

It hands Ctrl+Z *inside a running command* to the command script as an event, so a polyline
can back up one point instead of the whole command being thrown away. It makes granularity
**finer**, script-managed. It is not a grouping API. Called from the bridge it does not throw
and does nothing observable.

`addSelectedObjectsStateUndoUnit()` is callable from the bridge and does push a unit onto the
stack — but the unit restores selection state only. Undoing it bumps `revision` and leaves
every object in place.

## The real finding: bridge edits were not on the undo stack at all

Three `line` factories committed straight from the bridge each bumped
`geometryDatabase.revision` by one — and then `moi.command.undo()` removed none of them. A
second `undo()` reached *past* them into an older state from the user's own history.

So the gap was worse than "several undo units per call". A tool call produced **zero** undo
units, and the user's Ctrl+Z after agent work would walk back the user's work while leaving
the agent's geometry standing.

`moi.command.undo()` itself is fine from the bridge — it is what MoI's own toolbar button
calls — but it takes effect after the calling script returns, so its result has to be read in
a later call.

## Undo units come from commands

Dispatching a real command proves it. With three objects in the document:

    moi.geometryDatabase.selectAll();
    moi.command.execCommand( 'Delete' );      // runs on a clean call stack, deferred

`lastCommandRevisionStart`/`End` bracketed the run, and one `undo()` brought all three back.
`Delete.js` commits a factory exactly like the bridge does; the difference is only that MoI's
command dispatcher wrapped the run.

So a script placed in the commands folder and dispatched by plain name gets the same wrapper.
A probe command committing three `line` factories took the document from 9 objects to 12, and
a single `undo()` took it back to 9 — **one undo step for three factories**.

## Two traps found on the way there

- **`execCommand` with a full path does not dispatch a command.** It evaluates the file
  inline, synchronously, before the call returns, and produces no undo unit. Only a plain
  command name resolved out of the commands or scripts folder goes through the dispatcher.
- **MoI caches a command script by name on first use.** Overwriting the file afterwards has
  no effect — a rewritten file re-ran its previous contents. So the design cannot be "write
  this call's script into the commands folder and dispatch it": the command file has to have
  fixed contents, and the script to run has to travel some other way.

## How the script and its result travel

On the side pane window, as strings. An object assigned onto that window from MoI's bare
script host does not survive the trip — the property reads back `null` — but a string does.

The bridge therefore parks `PRELUDE + script` in `w.__moiMcpScript`, dispatches
`moi-mcp-eval`, and polls `w.__moiMcpResult` for the JSON the command leaves behind. The result
carries the call id it belongs to, so a call that timed out and finished late cannot have its
answer read as the next call's. The command file's contents never change, so MoI's caching is
harmless; the bridge rewrites it at startup so an upgrade takes effect on the next MoI launch.

Dispatching is asynchronous, which changes two things beyond undo:

- Starting the bridge's command ends any command the user is in the middle of; it does not
  wait for it. So the bridge checks for a running command first and refuses a changing call
  while one is running, and read-only calls skip the command path altogether — see
  probe-10-running-command.md. The bridge still gives up after 25s, inside the server's 30s
  call timeout, as a safety net.
- Requests have to be handled one at a time on the bridge side too, or a second one would
  overwrite the first one's script. The server already serialises calls, but it releases its
  own slot on a timeout, so the guard is not redundant.

## Verified

With the shipped command source in place, one tool call committing three factories, undone by
a single `moi.command.undo()`: 3 objects to 0.
