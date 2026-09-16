# Objects are addressed by raw GUID, with no handle table

Every MoI geometry object carries an undocumented read-only `id` — a brace-wrapped GUID string —
and `moi.geometryDatabase.findObject( id )` accepts that and nothing else. The agent addresses
objects by that GUID directly. The bridge keeps no handle table, mints no friendly tokens, and
never writes to an object's `name`.

## Why not friendly names

A future reader will want `box_1` instead of `{87103e36-f6e9-4ed8-8710-e9046e657af5}`, and there
are three separate reasons they cannot have it.

`findObject` refuses anything else. An integer, an object, or a real object *name* all throw
`Invalid function argument 1`. The GUID is the only key the database accepts.

No identifier survives an operation anyway. `move`, `fillet`, `booleanunion` and `copy` all remove
their inputs and create replacements with fresh GUIDs — a plain `move` included. A table mapping a
friendly token to a current id would therefore need re-pointing after every single operation, and
there is no dependable hook to do it on: `getCreatedObjects()` is populated only *before* `commit()`
for some factories, never populated at all for others, and `getLastCreated()` is unreliable too
(probe-07). The only capture that works everywhere is diffing the scene around the operation, which
is what the bridge's `capture( fn )` helper does. Every tool already returns the ids it created, so
the agent can carry them itself and the table earns nothing.

`name` is not ours to use. It is the label the user sees and edits in the scene browser. It is also
inherited by an operation's output — the union of two named objects takes the first one's name — so
stamping tokens into it would both clobber the user's naming and quietly propagate stale tokens onto
new geometry. Duplicates are allowed, so it was never a key to begin with.

The one thing a stamped name would buy is surviving a save-and-reopen, which regenerates every id in
the file. That case cannot arise: the agent never saves, and a session dies with the MoI process.

## Consequences

The bridge is stateless with respect to geometry, which matters because it shares a window with
MoI's own UI.

Handles are resolved through `findObject` at the moment of use, not cached. An id nobody holds
returns `null`, so a handle invalidated by the user deleting or moving something by hand is detected
exactly when it matters and reported as a typed error.

GUIDs are 38 characters and they appear in the transcript. That is a real token cost, accepted
deliberately in exchange for having one addressing scheme instead of two — objects the user created
have no token by construction, so a token layer would never have covered them.
