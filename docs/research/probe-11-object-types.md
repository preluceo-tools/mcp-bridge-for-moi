# probe-11 — what MoI's object type numbers mean, and input type 9

Run against a live MoI 4 session through the bridge (`moi_eval`), 2026-09-14, with no user
command running and an empty document.

The questions: what does each object `type` number mean, so `get_scene` can name it; and what is
factory input type 9?

## Method

One `moi_eval` built one object of each kind with factories: `point`, `line`, `rectangle`,
`planarsrf` on that rectangle, `extrude` of the rectangle with `Cap ends` false (an open
polysurface), `box`, and `text` in each of its modes. Each object's `type` was read and
cross-checked against its own predicates, which are **properties, not methods** —
`o.isSolidBRep()` throws `true is not a constructor`; `o.isSolidBRep` reads the value. Sub-objects
were read through `getSubObjects()`, `getEdges()` and `getFaces()`. Everything built was deleted
afterwards; the document ended empty, as found.

## Findings — object types

| Code | Name reported | Built to produce it | Confirmed by |
|---|---|---|---|
| 1 | `curve segment` | the segment inside a line; each side of a rectangle; the segment inside a brep edge | `isCurveSegment` true, `isCurve` false |
| 2 | `curve` | `line` (open), `rectangle` (closed, planar), `text` in Curves mode; also every brep edge from `getEdges()` | `isCurve` true, `isBRep` false |
| 3 | `brep` | `planarsrf` (1 face), open `extrude` (4 faces), `box` (6 faces), `text` in Planar and Solids modes | `isBRep` true; `isSolidBRep` false for the surface and the open polysurface, true for the box and the solid text |
| 4 | `face` | a face of any brep, from `getFaces()` | returned by `getFaces()` |
| 6 | `point` | `point` | `isPointObject` true |

So a planar surface, an open polysurface and a closed solid all share code 3: the number does not
tell a solid from a surface. `isSolidBRep` does, and the name reported is therefore `brep`, not
`solid`.

MoI 4 has no separate text or annotation object: `text` produces curves (2) or breps (3).

Codes **5** and **7 and up were never observed**. `toJson` reports any code not in the table
as `typeName: "unknown"` rather than guessing.

## Findings — input type 9

Not settled. What was tried:

- `loft` with two line sections: `getInput(1).type` reads `9`, but `getInput(1).getValue()` throws
  `Operation failed` both before and after `update()`, so the value's shape could not be read.
- MoI's own `EditOrientations.js` calls the loft input "a factory's orientation list input" and
  edits it with `moi.ui.createOrientationEditor( curves, factory, 1 )`.
- But `chamfer`'s input 2, `Corners`, is also type 9, and corner settings are not orientations.
  One name would mislabel one of the two, so `moi_factory_help` keeps reporting `type9`.

The lead: both look like per-item lists edited by an interactive picker. A probe that drives
`createOrientationEditor` and then reads the value might settle it.

## What shipped

- Every object record from `get_scene`, `get_selection` and `capture()` keeps its numeric `type`
  and gains `typeName`, from the table above.
- `moi_factory_help` is unchanged: type 9 stays `type9`.
