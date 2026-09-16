# probe-12 — which primitive factories ignore their numeric size input

Run against a live MoI 4 session through the bridge (`moi_eval`), 2026-09-14, with no user
command running.

The question: driven from a script, which primitive factories ignore a numeric size input
when the point input for the same dimension is left unset — and so quietly build the wrong
kind of geometry?

## Method

One `moi_eval` read every candidate's inputs (`getInput(i).name` / `.type`), then a second
built each factory, set **only** the listed inputs, called `calculate()`, read each output's
`type`, `isSolidBRep` and bounding box, and called `cancel()`. Nothing was committed. The
frame input was `moi.vectorMath.createTopFrame()` (origin, world XY); points were set only where
noted. Cylinder and cone were run a second time with `End pt` set instead of `Height`, as a
control.

## Findings

| Factory | Inputs set | Output | Z extent | Verdict |
|---|---|---|---|---|
| `box` | 0 frame, 2 Width 10, 3 Height 6, 4 Extrusion 4 | type 3, solid | 0 – 4 | honours numbers |
| `boxcenter` | same as box | type 3, solid | 0 – 4 | honours numbers |
| `cylinder` | 0 true, 1 frame, 3 Radius 2, 5 Height 5 | **type 2 (flat circle)** | **0 – 0** | **ignores Height** |
| `cylinder` | 0 true, 1 frame, 3 Radius 2, 4 End pt (0,0,5) | type 3, solid | 0 – 5 | control: End pt works |
| `cone` | 0 true, 1 frame, 3 Radius 2, 5 Height 5 | **type 2 (flat circle)** | **0 – 0** | **ignores Height** |
| `cone` | 0 true, 1 frame, 3 Radius 2, 4 End pt (0,0,5) | type 3, solid | 0 – 5 | control: End pt works |
| `sphere` | 0 true, 1 frame, 3 Radius 2 | type 3, solid | -2 – 2 | honours numbers |
| `plane` | 0 frame, 2 Width 10, 3 Height 6 | type 3, surface | 0 – 0 | honours numbers |
| `planecenter` | same as plane | type 3, surface | 0 – 0 | honours numbers |
| `rectangle` | 0 frame, 2 Width 10, 3 Height 6, 4 false | type 2 | 0 – 0 | honours numbers |
| `rectcenter` | same as rectangle | type 2 | 0 – 0 | honours numbers |
| `circle` | 0 true, 1 frame, 3 Radius 2, 4 false | type 2 | 0 – 0 | honours numbers |
| `ellipsecorner` | 0 frame, 2 Width 10, 3 Height 6 | type 2 | 0 – 0 | honours numbers |
| `box3pts` | 0 Pt A origin, 3/4/5 numbers | nothing (0 objects) | — | needs its points |
| `plane3pts` | 0 Pt A origin, 3/4 numbers | nothing (0 objects) | — | needs its points |
| `rect3pts` | 0 Pt A origin, 3/4 numbers, 5 false | nothing (0 objects) | — | needs its points |
| `ellipse` | 0 Center pt origin, 3/4 numbers | nothing (0 objects) | — | needs its points |

The X/Y extents all matched the numbers set (e.g. box 0–10 × 0–6, cylinder ±2).

So only **`cylinder` and `cone`** go silently wrong: they return a plausible-looking object of
the wrong kind with no error. The three-point factories and `ellipse` fail loudly instead —
`calculate()` returns an empty list. `helix`, `polygon*` and `arccenter` were read but not
run: they have no numeric input standing in for a point on the same dimension.

This confirms the 2026-09-11 finding from the ticket 03 prototype.

## Incident during the run

MoI was restarted mid-run and the user drew two objects. A cleanup call in this probe
removed everything in the document, which took those two with it. One `moi.command.undo()`
restored both, with the same ids and bounding boxes. Lesson: a probe's cleanup deletes only
the ids it created, never "everything in the document".

## What shipped

- `assets/factories.json` notes for `cylinder` and `cone`, naming `End pt` (input 4).
- One sentence in the `moi_eval` tool description and in the README's Known gaps.
- A test pinning both notes.
