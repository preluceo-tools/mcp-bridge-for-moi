# probe-10 — can the bridge see a running command?

Run against a live MoI 4 session through the bridge, 2026-09-11.

The question: before it dispatches `moi-mcp-eval`, can the bridge tell that the user is in the
middle of a command? Dispatching one ends the running command (issue 09), so without a signal
every changing call throws the user's half-finished command away.

## Method

One `moi_eval` call ran `moi.command.execCommand( 'Line' )`. Line starts once that call's own
command ends, and waits for its first point. The same call scheduled a `setTimeout` on the side
pane window, 800 ms out, to read `moi.command.currentCommandName` from the bridge's context — the
place the bridge's dispatcher runs — and park the value on the window. A second call read it back.

The same sampling with no command started gave the idle value.

## Findings

| Where it was read | `moi.command.currentCommandName` |
|---|---|
| Window context, Line waiting for its start point | `"Line"` (a string) |
| Window context, nothing running | `""` |
| Inside the bridge's own command | `"moi-mcp-eval"` |

So the signal exists and is the plain property. The bridge's own command name can still read
briefly after that command has left its result, so the bridge treats `moi-mcp-eval` as "nothing
running".

The second call, like any dispatched call before this fix, ended Line.

## What shipped

- Read-only tools (`get_scene`, `get_selection`, `moi_factory_help`) run directly in the
  bridge's context, synchronously, never through the command path.
- Every other tool is refused with `command_running` while `currentCommandName` names a command
  other than the bridge's own. If the property cannot be read at all, the call is refused too,
  naming "a command".
