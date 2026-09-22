# probe-14 — can a script set every option in MoI's mesh dialog?

Run against a live MoI 4.0 session through the bridge (`moi_eval`), 2026-09-22. Follows
probe-13, which showed that `NoUI=true;Angle=…` exports a mesh with no dialog but left the
other mesh-dialog options untested.

The question: can `export_objects` reach the rest of the Meshing options dialog — output
type (n-gons / quads & triangles / triangles only), weld vertices along edges, divide larger
than (and what it applies to), avoid smaller than, aspect ratio limit?

## Method

A radius-10 sphere (one face) and a 10×10×10 box, later filleted at radius 2 on every edge
(many faces meeting tangentially), were built with factories. Each export was
`moi.geometryDatabase.saveAs( '<scratchpad>\\<name>.obj', <options> )`. Every OBJ was then
counted on disk: vertices, faces, and faces by polygon size, per object.

Candidate key names came from two places: the element ids and option values in
`<MoI install folder>\ui\MeshDialog.htm`, and the `[Mesh Export]` names probe-13 found in
`moi_lib.dll`. Each key was tried alone, with every run bracketed by an export that set all
keys to known values, so that a change could be put down to that key alone.

## Findings

Sphere at `Angle=12`, reference export with all keys set: 482 vertices, 512 faces
(64 triangles, 448 quads).

| Option string (after `NoUI=true;`) | Result | Honoured |
|---|---|---|
| `Output=triangles` | 960 faces, all triangles | **yes** |
| `OutputType=triangles` | same as reference | no |
| `MinLength=3` | 322 v, 352 f | **yes** |
| `AvoidSmallerThan=3` | same as reference | no |
| `MaxLength=1` | 1794 v, 1920 f | **yes** |
| `DivideLargerThan=1` | same as reference | no |
| `AspectRatio=2` | 546 v, 576 f | **yes** |
| `AspectRatioLimit=2` | same as reference | no |
| `Output=banana` | same as reference | ignored silently, no error |
| `Output=quads;Angle=-5` | **120 903 v, 121 280 f** | accepted, no error |

Box (6 flat faces), all other keys at their reference values:

| Option string | Box result |
|---|---|
| `MaxLength=3;MaxLengthApplyTo=curved` | 6 quads (flat faces not divided) |
| `MaxLength=3;MaxLengthApplyTo=planes` | 96 quads |
| `MaxLength=3;MaxLengthApplyTo=all` | 96 quads |

Weld, on the sphere and the filleted box:

| Option string | Sphere | Filleted box |
|---|---|---|
| `Weld=false` | 559 v | 880 v |
| `Weld=true` | 482 v | 584 v |
| `WeldVertices=true` / `=false` | no effect | no effect |

Face counts are the same with and without weld; only shared vertices change. On a plain box
(sharp edges only) weld made no difference: 24 vertices either way.

What this shows:

- **Every option in the dialog is reachable through the options string, with no dialog.**
  The keys are `Angle`, `Output` (`ngons` | `quads` | `triangles`), `Weld` (`true` |
  `false`), `MaxLength`, `MaxLengthApplyTo` (`curved` | `planes` | `all`), `MinLength` and
  `AspectRatio`. `0` means "off" for the three lengths and the ratio, as an empty field does
  in the dialog.
- **The `moi_lib.dll` names are not option-string keys.** They are the names the settings are
  persisted under; MoI ignores them in the options string.
- **The options are sticky.** A key that is left out takes the value last used, whether
  that came from the dialog or from an earlier script. Seen for `Output` (a call with
  `NoUI=true` alone after `Output=triangles` still wrote triangles) and `Weld` (it carried over
  between calls both ways). The first round of this probe was spoiled by exactly this. A
  script's values also become the dialog's values for the user's next manual export.
- **MoI validates nothing.** An unknown key or an unknown value is ignored without an error, and
  the previous value stays in effect. A negative angle is accepted and produced a
  120 000-vertex mesh from a sphere. Validation has to happen in the tool.
- **Not established:** `Output=ngons`. The sphere and box have no faces that n-gons would
  change, so it gave the same result as `quads`. The value is the dialog's own, so it is very
  likely honoured, but no run demonstrated it. The dialog's `Display` field is a viewport
  preview and has no bearing on the file.

## Which formats are meshed

The same radius-10 sphere was exported to each format twice with `saveAs`, once at `Angle=45`
and once at `Angle=5`, all other keys identical, one format per call with the maintainer
watching for dialogs. A format whose file grows at the finer angle is one MoI meshes.

| Format | Angle 45 | Angle 5 | Meshed | Time |
|---|---|---|---|---|
| obj | 5 762 B | 447 197 B | yes | 81 ms |
| stl | 3 684 B | 281 284 B | yes | 27 ms |
| 3ds | 1 471 B | 101 407 B | yes | 34 ms |
| fbx | 17 872 B | 120 336 B | yes | 66 ms |
| lwo | 5 760 B | 393 270 B | yes | 44 ms |
| skp | 12 774 B | 470 620 B | yes | 128 ms |
| dxf | 50 602 B | 50 602 B | no | 3.7 s |
| igs, stp, sat | unchanged | unchanged | no | ≤ 12 ms |
| ai, eps, pdf | unchanged (± 4 B) | unchanged | no | 5–7 s |
| dwg | not written | not written | — | 1 ms, no error |

No dialog appeared for any of them. The mesh formats are **obj, stl, 3ds, fbx, lwo, skp**.
MoI 4 does not write DWG, and says nothing when asked to.

An earlier attempt at this sweep sent all the exports in one call to a folder that did not
exist. That call timed out at 25 s, and the maintainer found dialogs and error boxes open in
MoI, blocking every later command until they were dismissed. So a missing target folder is
**not** silent, whatever probe-13 inferred from a single export: at least for some formats it
opens a modal box and hangs the bridge.

The dialog hides the output control for STL (`window.nopolyoutput`), which is always triangles.

## Answer

**Yes: `export_objects` can offer every option in the mesh dialog.** It should:

- validate each value before building the string (angle > 0, lengths and ratio ≥ 0, the two
  enums from their fixed lists), since MoI will accept anything;
- send **every** key on **every** mesh export, with defaults for the ones the caller leaves
  out, so the result doesn't depend on whatever the user or an earlier call last used. Whether
  to leave the user's own dialog settings as they were is a design decision. A tool that
  sends all keys still overwrites them.

## Cleanup

The test objects were deleted by id, and the document ended empty as it started. The mesh
settings were set back to what the user's dialog showed before the probe (`Angle=12`, quads &
triangles, weld on, the other fields empty). Nothing was saved.
