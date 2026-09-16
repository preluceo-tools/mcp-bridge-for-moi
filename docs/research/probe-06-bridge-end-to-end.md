# Probe 06 — the bridge works end to end, and two API facts were wrong

Run on 2026-09-09 against MoI 4.0 (`4.0 Dec-22-2020`) on Windows 11. Unlike probes 01-05 this was
not an exploratory probe but the first end-to-end run of the real bridge and the real server:
`npx moi-mcp install`, MoI launched normally, the server driving a live session over the WebSocket.

Scripts and captured output are kept under
[`prototypes/probe-06-bridge-end-to-end/`](../../prototypes/probe-06-bridge-end-to-end/).

## Result: the full chain works

Handshake file → gate poll → WebSocket → `eval` inside MoI → result back over the socket. Verified
in one run:

| Step | Result |
|---|---|
| Bridge armed from the startup folder, borrowed the side pane's window | attached |
| `moi.version` through the bridge | `4.0 Dec-22-2020`, major `4` |
| Prelude helpers present in the eval scope | `pt`, `bbox`, `toJson` all `function` |
| Scene readback of an empty document | `objectCount: 0` |
| Box created through the `box` factory, ids captured before `commit()` | `{b90fe025-…}`, count 1 |
| Scene readback after creation | correct id, `type: 3`, `bbox` `{0,0,0}`-`{10,20,5}` |
| Selection set by id, read back | `selected: 1`, object reports `selected: true` |
| Delete by id | `removed: 1` |
| `findObject` on the deleted id | `null` — confirms probe-05's liveness check |
| A deliberately throwing script | returned as a typed error, connection survived |
| `moi.exit( true )` from the page | MoI closed, process gone |

**`getBoundingBox()` returns `min`/`max` points.** Probe-05 left this unverified because no stock
command uses it; the defensive helper was not needed after all, though it is harmless.

**`box` factory inputs, confirmed by use:** `0` a frame (`vectorMath.createTopFrame( point )`),
`2` width, `3` height, `4` extrusion height. Read off `GetRect.js` / `GetBoxExtrusion.js` and then
exercised.

## Two corrections to the API research

Both were found by things failing, and both matter to anyone scripting MoI.

### `readLine` gives no end-of-file signal

`moi.filesystem.openFileStream( path, 'r' )` works, and `readLine` exists as
[moi-external-scripting.md](moi-external-scripting.md) predicted from the symbol table. But at end of
file it **does not return `null` or `undefined`** — it keeps returning empty strings, indefinitely.

The obvious read loop therefore never terminates:

```js
var line = stream.readLine();
while ( line !== null && line !== undefined ) {   // never false
    text += line;
    line = stream.readLine();
}
```

In the bridge this was silent and total: the first gate poll never returned, so nothing was ever
attempted again and no error appeared anywhere. Stop on the first falsy line, and keep a hard
iteration guard behind that.

`openFileStream` also returns something whose `typeof` is `function`, not `object` — harmless, but
a truthiness check is the only safe test.

### `redrawViewports` is on `moi.ui`, not `moi`

The API notes list `redrawViewports` among the root `moi` members. It is not there. Calling
`moi.redrawViewports()` throws `undefined is not a constructor (evaluating
'moi.redrawViewports()')`. The stock commands use `moi.ui.redrawViewports()`, which works.

Worth noting how this failed: the surrounding work — setting the selection, deleting the objects —
had already succeeded. Only the trailing redraw threw, so the operation reported failure while
having done exactly what was asked. A script that ends in a bad call misreports everything before it.

## Other observations

- `moi.geometryDatabase.units` returns a **string**, `"No unit system"` on a default document, not a
  numeric code. `unitsShortLabel` is `""` for that document.
- Object `type` is a number (`3` for the box's solid BRep). The mapping to names is not established.
- `moi.exit( true )` called through the bridge closes MoI cleanly, which the server sees as a normal
  disconnect.

## What this means for the bridge

Nothing in the design changed. Both bugs were in the implementation, and both are fixed: the
handshake is now written as a single line, the bridge's read loop stops on the first empty line
behind a guard of 16, and the canned scripts call `moi.ui.redrawViewports()`.

## Still open

- Whether `fileExport()` suppresses the mesh dialog under a script — unchanged from probe-01, and
  still the gate on shipping export.
- The `type` number to name mapping.
