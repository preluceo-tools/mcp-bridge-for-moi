# Probe 07 — the factory surface is 110, and it documents itself

Run on 2026-09-09 against MoI 4.0 (`4.0 Dec-22-2020`) on Windows 11, driven through the live bridge
rather than a standalone probe script. The question: can an MCP server reach every tool in MoI, and
how would anyone know?

Scripts and captured output are kept under
[`prototypes/probe-07-factory-coverage/`](../../prototypes/probe-07-factory-coverage/).

## Headline: 110 factories, every one self-describing

`moi.command.createFactory` throws `Invalid function argument 1` on an unknown name and returns a
factory with a `numInputs` on a real one, so the set is **empirically enumerable**. Feeding it 433
candidate names — every lowercase identifier in `moi_lib.dll` plus every name appearing at a
`createFactory` call site in the stock commands — yields **110 factories** and rejects 323.

That is more than any published source lists. Six were previously unrecorded: `arrow3d`, `label`,
`objectframerotate`, `objectframerotatewheel`, `objectframescale`, and `scale` itself.

**More useful still: factory inputs describe themselves.** `getInput(i)` returns an object with a
human-readable `name` and a numeric `type`:

```
box → 0 Base pt (frame), 1 Corner pt (point), 2 Width (number),
      3 Height (number), 4 Extrusion (number), 5 Extrusion pt (point)
```

Type codes, read off the labels across all 110:

| Code | Meaning | Seen on |
|---|---|---|
| 1 | point | `Corner pt`, `Start pt`, `RefPt` |
| 2 | frame / cplane | `Frame`, `From edge cplane`, box's `Base pt` |
| 3 | bool | `Make copies`, `Cap ends`, `Enable mirror copy` |
| 4 | number | `Width`, `Area`, `Volume`, `Distance from edge` |
| 5 | int / enum | `WhichGrip`, `Dim`, `Num Profile Points` |
| 6 | string | `Label`, `Style` |
| 8 | object list | `Objects`, `Sections` |
| 9 | **UNVERIFIED** | `loft`'s `Orientations` only |

So the coverage question has a better answer than a hand-written table: **the running MoI is the
documentation**, and it is complete by construction.

## Why a call-site grep is not enough

Searching the stock commands for `createFactory( 'name' )` finds only 91 of the 110, and the gap is
misleading — most of the "missing" ones *are* used, through two layers of indirection:

- **The name is passed as a parameter.** `Scale1D.js` is five lines: `DoScale( 'scale1d', false,
  true )`. Every `setInput` lives in `DoScale.js`, which never mentions `scale1d`.
- **The helper arrives by `#include`.** `Polyline.js` is `#include "DoCurve.js"` followed by
  `DoCurve( 'polyline', false )`.

A lookup that searches for the name **as a string anywhere** and then **follows `#include` one
level** recovers these. After that, only **9** factories have no worked example anywhere: `arrow3d`,
`calcarea`, `calclength`, `calcvolume`, `drag`, `label`, `objectframerotate`,
`objectframerotatewheel`, `objectframescale` — and introspection documents all nine regardless.

## Two corrections to earlier findings

### `getCreatedObjects()` is not reliable, in either direction

[probe-05](probe-05-object-identity.md) established that `getCreatedObjects()` is populated only
**before** `commit()`. That holds for `box` and `fillet`. It does **not** generalise: for the curve
family the list is empty before commit *and* the object appears only after it. `getLastCreated()`
returned an empty list in the same situation.

Confirmed by counting the scene: `polyline` committed, `getCreatedObjects()` gave 0, and the object
count went 1 → 2 with a correct curve at `{0,0,0}`–`{40,40,0}`.

The reliable capture is a **scene diff** — snapshot the ids before, snapshot after, subtract. That
is now a `capture( fn )` helper in the bridge prelude, and it works for every factory without
per-factory knowledge.

### `readLine` is worse than probe-06 recorded

probe-06 found that `readLine` gives no end-of-file signal. The full behaviour: past the end it
returns **`''` forever**, there is **no `size` member** on the stream to bound the read, and real
scripts contain isolated blank lines. So neither "stop at the first empty line" nor a byte count
works for reading a source file. The rule that does: **stop after a long run of empty lines (ten),
then trim the trailing empties.** The single-line handshake file is unaffected.

## Curve family: how to drive it

`polyline`, `curve` and `interpcurve` report `numInputs: 0` because their inputs are built at
runtime. From `DoCurve.js`: call `createInput( 'point' )` once per vertex and set each one. The
`bool` corner flags exist **only** when `docurves` is called with `docorners` true — `Polyline.js`
passes `false`, so a polyline takes points alone. Adding bools produced nothing.

`sketchcurve` is bound to a point-stream picker (`createPointStreamPicker().bind( factory )`) and is
not usefully scriptable.

## A note for the undo gap

`DoCurve.js` opens with `moi.command.setCommandSpecificUndo( true )`. That looked like the API behind
"one undo unit per tool call". It is not — see [probe-09](probe-09-undo.md), which settles the
question and closes the gap.

## What this means for the bridge

`moi_factory_help` returns, for any factory: its `numInputs`, its inputs as `index / name / type`
read live from the running MoI, and worked example lines from MoI's own scripts with `#include`
followed. Called with no name it lists all 110 from a bundled table. Nothing is hand-maintained
except notes for the nine factories with no stock example.

## Still open

- Input **type 9** (`loft`'s `Orientations`, `chamfer`'s `Corners`) — meaning still unknown after
  [probe-11](probe-11-object-types.md).
- The object `type` number to name mapping — settled by [probe-11](probe-11-object-types.md).
- The enumeration is candidate-limited: a factory whose name never appears as a standalone
  lowercase string in the DLL or a stock script would not have been found.
