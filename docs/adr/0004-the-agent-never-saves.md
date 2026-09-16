# The agent never saves the user's file

The agent works in a document the user has open in front of them. It may create, modify and delete
objects, but it has no tool that writes over the user's file: `save` and `incrementalSave` are not
exposed, and neither are `deleteAll` or `fileNew`. `saveAs` to an explicit new path is the single
exception, because it cannot destroy anything. Each tool call is wrapped in one undo unit.

This is not an oversight or a feature waiting to be added. It is the whole safety model, and it is
worth stating plainly because a reader will otherwise assume saving was simply forgotten.

## Why this is enough

Two properties together mean an agent session can always be undone completely. Every action the
agent takes is one undo unit, so the user's own Ctrl+Z walks back through the agent's work one step
at a time, in the application they are already looking at. And because nothing is ever written to
disk, the file on disk stays exactly as the user last left it — closing MoI without saving discards
the entire session, however badly it went.

The alternative designs all cost more and protect less. A confirmation prompt per mutation makes the
tool useless for anything multi-step. A backup-before-write scheme is a second thing to get right,
and it only helps if someone notices in time to use it. Restricting the agent to a scratch document
gives up the point of the tool, which is that the model is on the user's screen while the agent
works on it.

## Consequences

Anything the user wants to keep, the user saves. This should be said out loud in the README, because
an agent that has spent twenty minutes modelling has produced work that a crash would lose.

`saveAs` to a new path is allowed, so "save a copy of this for me" remains possible without any path
to overwriting the original.

Undo granularity is a hard requirement on the implementation, not a nicety: a tool call that commits
several factories must still be one undo unit, or the safety story is only approximately true. MoI
records an undo unit around a command and nowhere else, so the bridge runs every call as one — see
[probe-09](../research/probe-09-undo.md).
