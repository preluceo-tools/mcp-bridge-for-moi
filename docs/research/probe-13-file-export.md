# probe-13 — does a scripted `fileExport` open the mesh dialog?

Run against a live MoI 4 session through the bridge (`moi_eval`), 2026-09-14, with the
maintainer at the desk to dismiss any dialog. Ticket 11.

The question, carried since probe-01: does `moi.geometryDatabase.fileExport( name )` open
MoI's modal mesh dialog when a script calls it? A modal dialog freezes the side pane the
bridge lives in, so an export tool can only ship if the dialog can be kept shut.

## Method

A 10×10×10 box (and later a radius-10 sphere) was built with factories. Each export went to
a file in the session scratchpad, and every file was checked on disk afterwards. The call's
return value and duration were read inside the script. MoI's own `Export.js` and
`MeshDialog.htm` and the strings in `moi_lib.dll` were read to find an option that turns the
dialog off.

## Findings

| # | Call | Selection | Dialog | Result | Time | Bridge afterwards |
|---|---|---|---|---|---|---|
| 1 | `fileExport( '<scratchpad>\\probe11.step' )` | nothing | no | returned `null`, **no file written** | 0 ms | answered |
| 2 | same | box | no (maintainer saw no flash) | `null`, valid STEP written (19.5 KB) | 70 ms | answered |
| 3 | `fileExport( '<scratchpad>\\probe11.obj' )` | box | **yes, after a few seconds** | call timed out at 25 s (`MoI did not run the script within 25s.`); maintainer clicked Cancel; no file written | — | `get_scene` answered at once after the cancel; selection unchanged |
| 4 | `fileExport( '<scratchpad>\\probe11.obj', 'NoUI=true' )` | box | **no** | `null`, OBJ written (8 vertices, 12 triangles) plus a `.mtl` | 8 ms | answered |
| 5 | same, `'NoUI=true;Angle=45'` | sphere | no | `null`, OBJ with 38 vertices, 72 triangles | 19 ms | answered |
| 6 | same, `'NoUI=true;Angle=5'` | sphere | no | `null`, OBJ with 2814 vertices, 5624 triangles | 46 ms | answered |

What this shows:

- **`fileExport` exports the selection, and only the selection.** MoI's own
  `<MoI install folder>\commands\Export.js` picks the objects first, then calls
  `fileExport( moi.command.getCommandLineParams() )`. With nothing selected the call writes
  nothing and still returns `null` with no error. The return value is `null` in every case,
  success or not, so the only proof of an export is the file on disk.
- **A non-mesh format (STEP) exports with no dialog.**
- **A mesh format (OBJ) opens the modal mesh dialog** when called with the file name alone.
  The bridge hangs until a person dismisses it; after Cancel it recovers by itself and nothing
  is written.
- **A second argument, an options string, suppresses the dialog.** `NoUI=true` exports OBJ
  with no dialog. Mesh settings travel in the same string as `key=value` pairs separated by
  `;`: `Angle` measurably changed the mesh (72 faces at 45°, 5624 at 5°). Without `Angle`
  the export used the persisted settings.
- The other keys the mesh dialog persists under `[Mesh Export]`, found as strings in
  `moi_lib.dll`, are `OutputType`, `AspectRatioLimit`, `DivideLargerThan`,
  `DivideLargerThanApplyTo`, `AvoidSmallerThan` and `Weld`. Only `Angle` was tested. Whether
  the others are honoured through the options string, and what values `OutputType` takes, is
  not established.
- `moi.settings` cannot be enumerated from a script (`for…in` yields no keys), so the options
  cannot be discovered at run time.

IGES, STL and the other formats were not tried. STEP stands in for the non-mesh formats and
OBJ for the mesh ones; STL goes through the same mesh dialog in MoI's UI.

## `saveAs` as the alternative

`saveAs` needs no selection: it writes the whole scene, in any format MoI exports, chosen by
extension. MoI's own `SaveAs.js` is the single line
`moi.geometryDatabase.saveAs( moi.command.getCommandLineParams() )`. ADR-0004 allows `saveAs`
to a new path. It was tried on an untitled document holding one 10×10×10 box, with nothing
selected.

| # | Call | Dialog | Result | Time | File name afterwards |
|---|---|---|---|---|---|
| 7 | `saveAs( '<scratchpad>\\probe11-saveas.step' )` | no | `null`, STEP written (20 KB) | 3 ms | `""` (unchanged) |
| 8 | `saveAs( '<scratchpad>\\probe11-saveas.obj', 'NoUI=true' )` | no | `null`, OBJ written (8 vertices, 12 triangles) | 11 ms | `""` (unchanged) |

- `saveAs` takes the same options string as `fileExport`, and `NoUI=true` keeps the mesh dialog
  shut. `saveAs` to a mesh format with the file name alone was not tried; by analogy with call
  3 it would open the dialog.
- The document was **not** renamed to the written file, read both inside the call and in a
  later call. So a later Ctrl+S would not have written a mesh file.
- **Not established:** what `currentFileChanged` does. It read `false` even straight after the
  box was added through the bridge, before any `saveAs`, so it did not reflect that change
  and says nothing about `saveAs`. MoI shows no modified marker in its window frame, so the
  maintainer could not check it by eye.
Then the same box was saved to a `.3dm` first, giving the document a file name, and saved
again to OBJ, nothing selected:

| # | Call | Dialog | Result | Time | File name afterwards |
|---|---|---|---|---|---|
| 9 | `saveAs( '<scratchpad>\\probe11.3dm' )` | no | 3DM written (32 KB) | 10 ms | **`<scratchpad>\probe11.3dm`** (renamed) |
| 10 | `saveAs( '<scratchpad>\\probe11-named.obj', 'NoUI=true' )` | no | OBJ written (8 vertices, 12 triangles) | 23 ms | `<scratchpad>\probe11.3dm` (unchanged) |

The file name was read inside the call and again in a later call; both agreed.

- **`saveAs` to an export format does not rename the document**, titled or untitled. A later
  Ctrl+S still writes the `.3dm` the user had open.
- **`saveAs` to `.3dm` does rename it**, as File > Save As does. That destroys nothing, but
  every later Ctrl+S by the user goes to the agent's copy, and the original on disk quietly
  stops receiving their work. A tool should not write `.3dm` through `saveAs` for that reason.

## Answer

**An export tool can ship without risking a hung session, provided it always passes
`NoUI=true`.** It must select exactly the objects to export (and restore the user's selection
afterwards), and it must confirm the file exists rather than trust the return value. Follow-up:
`.scratch/moi-mcp-v2/issues/22-export-tool.md`.

A call without `NoUI=true` to a mesh format hangs the bridge until someone clicks the dialog
away, so the tool must never build the options string from caller input without forcing that
key.

For "the whole scene", `saveAs( path, 'NoUI=true' )` does the same with no select-and-restore
step, and leaves the document's file name alone for export formats. It must not be used for
`.3dm`, which renames the document.

## Cleanup

The probe's boxes and sphere were deleted by id; the document ended empty, as it started.
Nothing was saved (ADR-0004).
