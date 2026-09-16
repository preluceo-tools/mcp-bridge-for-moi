# Probe 05 — how an agent refers to the same MoI object across two tool calls

Run on 2026-09-09 against MoI 4.0 (`4.0 Dec-22-2020`) on Windows 11. Follows
[probe-04-connect-silence.md](probe-04-connect-silence.md), which settled how the bridge connects.
This probe settles the last unknown blocking the modelling tool surface: what the agent says when it
means "the box I made in the previous call".

Scripts and captured output are kept as primary sources under
[`prototypes/probe-05-object-identity/`](../../prototypes/probe-05-object-identity/).

## Headline: every object has a GUID, and it is a session handle, not a name

**`obj.id` exists.** It is not in the published API surface, not in `moi.idl`, and not in any forum
post we found — but every geometry object carries it, and it is a brace-wrapped GUID string:

```
A.id = string value={87103e36-f6e9-4ed8-8710-e9046e657af5}
```

**`moi.geometryDatabase.findObject()` is its lookup, and takes nothing else.** It demands a string
and rejects every string that is not a GUID. Given a live id it returns the object; given a
well-formed id nobody holds it returns `null`.

**But it does not survive an operation.** A factory does not edit its inputs — it *removes* them and
*creates* replacements. `move`, `fillet` and `booleanunion` all did exactly that, and every result
came back with a fresh GUID. It does not survive a save-and-reopen either: reopening the same `.3dm`
regenerated all three ids in the file.

So the answer has two halves, and the bridge needs both:

1. **Within a session, address objects by `obj.id`.** It is stable across `getObjects()` calls, it is
   read-only, it is unaffected by renaming, hiding or restyling, and `findObject` turns it back into
   an object or into `null` if the object is gone. It is exactly the handle a tool call needs.
2. **Re-stamp it after every operation.** Read `factory.getCreatedObjects()` **before** `commit()` —
   after commit the list is empty — and point the agent's name at the new object's id. The wrapper
   captured before the commit stays valid afterwards and refers to the committed object, so the
   bridge can also write `obj.name` on it at that moment.

`name` is the second half of the answer and not a replacement for the first: it is freely settable,
it is **inherited by the output of an operation**, and it survives save-and-reopen — but it is not
unique, MoI happily holds two objects with the same name, and `findObject` will not take one.

---

## Question 1 — is there a stable per-object identifier?

Probed by name, not by enumeration (probe 01 established MoI objects do not enumerate under
`for...in`). Verbatim from `prototypes/probe-05-object-identity/probe5-identity.txt`:

| Candidate | Result |
|---|---|
| **`id`** | **`string` `{87103e36-f6e9-4ed8-8710-e9046e657af5}`** |
| `Id`, `ID` | the same string — MoI's member lookup is case-insensitive, this is one property |
| `objectId`, `objectID`, `objectid` | `undefined` |
| `uid`, `uuid`, `guid` | `undefined` |
| `handle`, `index`, `objectIndex`, `databaseIndex` | `undefined` |
| `serialNumber`, `serial`, `objectNumber` | `undefined` |
| `getId`, `getObjectId`, `getSerialNumber`, `getUniqueId`, `uniqueId` | `undefined` |
| `key`, `hash`, `ptr`, `pointer`, `address`, `runtimeId`, `tag` | `undefined` |
| `userData`, `getUserData`, `setUserData`, `revision` | `undefined` |

For contrast, the documented members on the same object: `type` = `3` (a **number**, not a string),
`name` = `''`, `selected`/`hidden`/`locked` = booleans, `styleIndex`/`displayMode` = numbers.
`String(obj)` is `[object MoiObj]` — no address, no id, nothing to parse.

Note also that MoI's predicates are **properties, not methods**: `obj.isSolidBRep` is a boolean, and
`obj.isSolidBRep()` throws `TypeError: true is not a constructor`.

### `id` behaves like a proper identifier

From `probe5-history.txt` and `probe5-trace.txt`:

| Test | Observed |
|---|---|
| Read twice off the same wrapper | identical |
| Same object via a fresh `getObjects()` wrapper | wrapper `==` fails, **`id` is equal** |
| Two different objects | ids differ |
| Assign to it (`A.id = '{000…}'`) | silently ignored — value unchanged. **Read-only** |
| Rename the object | `id same? true` |
| Hide / unhide | `id same? true` |
| Change `styleIndex` | `id same? true` |
| `clone()` | new object, **new id**, and `inDb=no` — a clone is not added to the database |

The `==` result matters: **`getObjects()` hands back a new JavaScript wrapper every call**, so
`db.getObjects().item(0) == db.getObjects().item(0)` is `false`. Wrapper equality is useless for
identity; `id` equality is the comparison to use.

### `findObject` takes a GUID string and nothing else

| Argument | Result |
|---|---|
| `0`, `1`, `-1`, `999` | `THREW: Invalid function argument 1` |
| `''`, `'Box'`, `'Probe5A'` (a real object name) | `THREW: Invalid function argument 1` |
| the object itself | `THREW: Invalid function argument 1` |
| no argument | `THREW: Required function argument 1 (string) missing.` |
| **`A.id`** | **the object** — `[object MoiObj]`, `Probe5A` |
| `A.id` with the braces stripped | **also works** — `[object MoiObj]` |
| a well-formed GUID nobody holds | **`null`** |
| the id of an object an operation consumed | **`null`** |

That last row is the useful one: `findObject` is also the liveness test. A stale handle returns
`null` rather than throwing, so the bridge can answer "that object is gone" without a guard.

## Question 2 — is `name` viable as the identity?

Partly. It is settable and durable, but it is not unique and it is not a lookup key.

| Test | Observed |
|---|---|
| `obj.name = 'Probe5Alpha'` on a fresh object | assigned, reads back `[Probe5Alpha]`, and is visible through a fresh `getObjects()` |
| Two objects given the same name | **allowed** — `[0:Probe5Alpha 1:Probe5Alpha]` |
| `selectNamed('Probe5Alpha')` with two matches | `selected count = 2` |
| `findObject('Probe5Alpha')` | `THREW: Invalid function argument 1` |
| Name set from a side-pane timer, seconds later | works — `[0:Probe5AlphaRenamed …]` |
| `saveAs` → `fileNew` → `open` | names come back **unchanged and in the same order** |
| Name after a `fillet` consumed the object | **inherited by the result** — result of filleting `Probe5P` is named `Probe5P` |
| Name after a `move` | inherited — `Probe5E` in, `Probe5E` out |
| Name after `booleanunion` of `Probe5S` + `Probe5T` | result is named **`Probe5S`** — the first input's name wins |

So a name the bridge stamps at creation time follows the object through the operations we tested and
through the file. That makes it a good *label* — the thing the user sees in the scene browser, and
the thing that survives a reopen when the ids do not. It is not a key: MoI will not look one up, and
nothing stops the user, or the bridge itself, from creating a collision.

## Question 3 — is object ordering stable? No, and index addressing is dead

`getObjects()` returns a consistent order across back-to-back calls, and new objects append. But a
deletion compacts the list:

```
getObjects() call 1                   = [0:Probe5Alpha 1:Probe5Beta]
getObjects() call 2                   = [0:Probe5Alpha 1:Probe5Beta]
add box C, re-list                    = [0:Probe5Alpha 1:Probe5Beta 2:Probe5Gamma]
add box D, re-list                    = [0:Probe5Alpha 1:Probe5Beta 2:Probe5Gamma 3:Probe5Delta]
delete the middle one (Beta), re-list = [0:Probe5Alpha 1:Probe5Gamma 2:Probe5Delta]
index of Gamma now                    = 1
```

`Probe5Gamma` moved from index 2 to index 1 because an unrelated object was deleted. Since every
factory operation deletes its inputs, indices shift constantly during normal modelling. **An index is
not an address.**

Worth noting for the tool surface: the order after `saveAs` → `open` was identical to the order
before, so ordering is at least stable through the file.

## Question 4 — what identity survives an operation?

**Nothing that MoI generates.** Every factory we ran replaced its inputs. Captured pre-commit, when
the factory's lists are populated:

| Operation | `getInputObjects()` | `getCreatedObjects()` | `getRemovedObjects()` | Result id |
|---|---|---|---|---|
| `move` `Probe5E` | `Probe5E/af272dfa` | `Probe5E/9de97509` | `Probe5E/af272dfa` | new |
| `fillet` `Probe5P` r=1 | `Probe5P/667dbfe8` | `Probe5P/24c62d0a` | `Probe5P/667dbfe8` | new |
| `booleanunion` `Probe5S`+`Probe5T` | both | `Probe5S/f1733af4` | **both** | new |
| `copy` `Probe5Q` | `Probe5Q/884014b9` | `Probe5Q/61dfdc69` | `Probe5Q/884014b9` | new; **original survives with its id** |

A `move` — an operation with no conceptual "new object" at all — still produces a new GUID. That
settles it: **the id is a handle onto a database entry, not a stable identity for a thing the user
thinks of as persisting.**

The `copy` row carries a caveat: `getRemovedObjects()` listed the original, yet after commit the
original was still in the database with its id intact (`Q keeps its id? same=true inDb=yes`) and the
copy was there too. The pre-commit removed-list appears to describe the update *preview*, not what
commit will do. **Treat `getRemovedObjects()` as advisory** — re-check with `findObject` if it
matters.

### History does carry the link, and `getHistoryData()` names the parents by GUID

This is the part worth the effort. `getHistoryData()` returns a **serialised string** that records
the factory name and the input object ids verbatim. Exact output for the fillet:

```
6 fillet V1
2
60 objectlist 7 Objects1 {667dbfe8-665e-45e2-81be-3dbe9dba0e66}
35 double 6 Radius3ff0000000000000 (1)
```

`{667dbfe8-…}` is precisely `Probe5P`'s id before the fillet consumed it. The same for the union,
naming both consumed inputs:

```
12 booleanunion V1
1
99 objectlist 7 Objects2 {2bee388c-cc88-4612-bbd0-448f889cd50b} {95da44de-917f-476d-b095-2efa87cc8b85}
```

and for a `move`, where the numeric inputs are stored as hex doubles with a decimal gloss:

```
4 copy V1
3
60 objectlist 7 Objects1 {884014b9-0955-4236-92ac-ca135f39c9f0}
32 point 7 Base pt0 (0) 0 (0) 0 (0)
50 point 9 Offset pt0 (0) 404e000000000000 (60) 0 (0)
```

So a backward link from a result to its inputs **does** exist, as text. The format is undocumented,
length-prefixed and version-stamped (`V1`), and parsing it would be building on a private
serialisation — but for the narrow purpose of *reading the parent GUIDs out of it*, a GUID regex over
the string is enough, and it is a genuine traceability backstop.

The object-level history accessors are thinner:

| Member | Consuming op (`fillet` result) | Non-consuming op (`copy`) |
|---|---|---|
| `getHistoryParents()` | `(0) []` | **`(1) [Probe5Q/884014b9]`** — the original |
| `getHistoryChildren()` | `(0) []` | on the *original*: **`(1) [Probe5Q/61dfdc69]`** — the copy |
| `getHistoryData()` | the string above | the string above |
| `updateWithHistory` | a **boolean property**, `false` — not a method |
| `deleteHistoryData()` | returns `null` |

The pattern is clear: `getHistoryParents()` / `getHistoryChildren()` return live `ObjectList`s and can
only point at objects that still exist. For `fillet` and `booleanunion` the parents were consumed, so
both lists are empty even though `getHistoryData()` still names them. **The GUIDs in the history
string outlive the objects; the history object lists do not.**

## Question 5 — the practical fallback, and it is better than a fallback

**`getCreatedObjects()` hands back exactly the new objects, but only before `commit()`.**

| Moment | `getCreatedObjects()` | `getRemovedObjects()` | `getInputObjects()` |
|---|---|---|---|
| After `update()`, before `commit()` | **`(1) [Probe5P/24c62d0a]`** | `(1) [Probe5P/667dbfe8]` | `(1) [Probe5P/667dbfe8]` |
| After `commit()` | **`(0) []`** | `(0) []` | `(1) [Probe5P/667dbfe8]` — stale, the input is gone |

The id in the pre-commit created list **is** the id the object has in the database after commit
(`24c62d0a` in both), and the wrapper captured before the commit stays usable afterwards:

```
captured R still valid after commit = Probe5P/24c62d0a/t3 inDb=yes
```

Every box in these probes was created that way — capture `getCreatedObjects().item(0)` after
`update()`, `commit()`, then assign `.name` — and the names all landed. Run B tried it the other way
round, reading `getCreatedObjects()` after the commit, and got nothing:

```
stamp a name on the union result           = (3) [Probe5E/… Probe5A/… Probe5F/…]   (unchanged)
stamped name readable from a fresh getObjects() = NO
stamp a style index too                    = THREW: Invalid index: 0   length = 0
```

That is the whole rule: **capture before commit, stamp after.** With that in hand the end-to-end
idiom works exactly as the design wants:

```
stamp U                            = (4) [… moi-mcp-0007/f1733af4/t3]
address it later by id             = moi-mcp-0007/f1733af4/t3
address it later by name (selectNamed) = selected=(1) [moi-mcp-0007/f1733af4/t3]
```

### Held JavaScript references are not a substitute

The bridge is a long-lived page, so it could simply keep the object in a table. It should not. A
wrapper for an object that has been **deleted from the database** goes on answering as if nothing
happened. `Probe5Beta` was passed to `db.removeObject()` and vanished from `getObjects()`
(`[0:Probe5Alpha 1:Probe5Gamma 2:Probe5Delta]`), and its wrapper still read back cleanly:

```
B (deleted) still usable? = B.name=[Probe5Beta] B.type=3
```

The same held wrapper survived a `fileNew` + `open` and still reported a name and a type
(`held.A after reopen - still valid? = [Probe5AlphaRenamed] type=3`) — though whether that wrapper
was stale or had been rebound to the reopened object is **UNVERIFIED**, because the only test we ran
for it compared wrappers with `==`, and wrapper equality is `false` even for two wrappers onto the
same live object.

The deleted-object case is enough on its own. **A stale wrapper fails silently by continuing to
work**, which is the worst possible failure mode for a tool call. `findObject(id)` returning `null`
is the check that actually tells the truth.

## What this means for the bridge

The bridge keeps a **handle table**: agent-facing token → current MoI `id`. Concretely:

1. **Mint a token at creation.** After `update()` and before `commit()`, read
   `factory.getCreatedObjects()`; keep the wrappers. `commit()`. Then, on each captured object, set
   `obj.name` to the token (`moi-mcp-0007` above, or something the user will recognise) and record
   `token -> obj.id`.
2. **Resolve a token to an object** with `moi.geometryDatabase.findObject( id )`. `null` means the
   object no longer exists — report that to the agent as a stale handle rather than guessing.
3. **Re-point the table after every operation.** The inputs are consumed and their ids die with them;
   the token must be moved onto the id of whatever the factory created. Because MoI already inherits
   the input's `name` onto the result, the token's *name* survives the operation on its own — the
   id is the only thing that needs rewriting.
4. **Never address by index**, and never compare wrappers with `==`. Compare `id` strings.
5. **Never trust a held wrapper across tool calls.** Store the id string, not the object.
6. **On reopen, rebuild the table from names.** Ids are regenerated by `open()`; names are not. A
   session that reopens a file walks `getObjects()` once and re-derives `token -> id` from `obj.name`.
   This is the reason to stamp the name at all, and it is why the token should be something unlikely
   to collide with a name a user typed.

`getHistoryData()` is the backstop, not the mechanism: if the bridge ever needs to explain what an
object came from, the parent GUIDs are in that string and can be matched against ids the table saw
earlier in the session. It is not needed for ordinary addressing.

One thing this does **not** require: `getLastCreated()` / `selectLastCreated()`. `getLastCreated()`
returned `length=0` immediately after a scripted factory commit (`probe5-recon.txt`), so it appears
to track user commands rather than script-driven factories. Do not build on it.

## Still open

- **Whether `obj.id` is written into the `.3dm` at all.** We observed only that the ids after
  `open()` differ from the ids before `saveAs()`. Whether MoI stores no id, stores one and ignores
  it on load, or stores one that we are reading before it is applied, is **UNVERIFIED**.
- **Undo and redo.** `moi.command.undo()` was never called. Whether undoing an operation restores the
  input object's *original* id or mints a third one is **UNVERIFIED**, and it decides whether the
  handle table can be repaired after a user undo or must be rebuilt from names.
- **Whether the user renaming an object in the scene browser is detectable.** The bridge's name-based
  recovery path assumes its stamped names survive the user. Nothing tested that.
- **The `getRemovedObjects()` anomaly on `copy`** — it listed an object that commit did not remove.
  Whether that is specific to `copy`, or a general property of the pre-commit preview, is
  **UNVERIFIED**.
- **The `getHistoryData()` format.** Length-prefixed, `V1`-stamped, doubles as raw hex. Only the
  embedded GUIDs and the leading factory name were interpreted here; the rest is **UNVERIFIED** and
  is a private serialisation that could change between MoI builds.
- **Sub-objects.** Only top-level BReps were probed. Whether faces and edges from `getFaces()` /
  `getEdges()` carry their own `id`, and whether `findObject` resolves one, is **UNVERIFIED** — and it
  matters for any tool that fillets specific edges rather than a whole solid.
- **Id collisions across sessions.** GUIDs, so collisions are not a practical worry, but nothing
  confirms MoI generates them per-database rather than reusing a counter.
- Carried over and still unverified: whether `fileExport()` suppresses the mesh dialog under a
  script; whether a second `MoI.exe` with a script hands off to a running instance; whether state
  injected into `moi.ui.sidePane.window` survives `moi.ui.reloadPanels`.

## Method notes

- Four MoI launches, one per script, driven by
  `prototypes/probe-05-object-identity/run.ps1` — a trimmed copy of probe 04's `run-case.ps1`: kill
  any stray MoI, copy the script into `<MoI app data>\startup\`, launch, poll that process's visible
  windows once a second for the observation window, screenshot the first time a window titled with
  "error" appears, copy the results back, kill MoI, remove the script. **No error box appeared in any
  of the four runs** (`timeline-*.txt`).
- `Probe5Recon.js` — is the geometry database usable from a startup script, how to build a frame with
  no point picker, the shape of the `box` factory. `Probe5Identity.js` — questions 1–3 and held
  references. `Probe5History.js` — first pass at questions 4–5. `Probe5Trace.js` — questions 4–5
  redone, because run B identified the fillet result by elimination and picked the wrong object; run C
  captures every result from the factory instead. Where the two disagree, run C is the evidence.
- Factory input indices were read off the stock commands under the MoI install folder's `commands\`
  directory, as the research says they must be: `box` from `Box.js` + `GetRect.js` +
  `GetBoxExtrusion.js` (0 = frame, 1 = corner point, 2 = width, 3 = height, 4 = extrusion distance;
  `numInputs` is 6), `fillet` from `Fillet.js` (0 = objects, 3 = radius), `booleanunion` from
  `BooleanUnion.js` (0 = objects), `move` and `copy` from `Move.js` (0 = objects, 1 = base point,
  2 = target point).
- The geometry database **is** fully usable from a startup script, with an empty document and no
  command running. Objects were selected by setting `obj.selected = true` and passing
  `moi.geometryDatabase.getSelectedObjects()` as the factory's object-list input — no picker needed.
- Everything installed went to `<MoI app data>\startup\` prefixed `Probe5`, plus one case file and
  one result file directly in `<MoI app data>\`, all removed afterwards; the folder was verified empty
  of probe files at the end. Nothing was written under the install folder. `moi.ini` was not touched,
  so no backup was needed. No MoI process was left running.
- The two `.3dm` files the save/reopen tests produced were written into the prototypes folder, not the
  user's documents, by handing the script a destination through a case file rather than baking a path
  into the JavaScript.
- Findings were written through `moi.filesystem.openFileStream( name, 'w' )` + `writeLine` + `close()`
  — probe 01's confirmed write path, there being no console — rewriting the whole file after every
  line, so a run that died mid-way would still leave everything up to that point on disk.
