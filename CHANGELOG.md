# Changelog

What changed in each release of mcp-bridge-for-moi. Versions follow
[Semantic Versioning](https://semver.org/); the format follows
[Keep a Changelog](https://keepachangelog.com/).

## [0.3.0] - 2026-09-24

The bridge protocol changes in this release: install the bridge again after updating (see
Updating in the README). The server refuses the old bridge until you do.

### Added

- A `boolean(kind, targets, tools)` helper in every `moi_eval` script, for `difference`,
  `union` and `intersection`. It returns every result object, gives the results the first
  target's name and style, and warns when a difference or union left the face count unchanged
  (the cutter most likely missed), when a union left separate objects, or when nothing was
  created.
- When a `moi_eval` script throws, the error lists the ids of the objects it created or
  consumed before the throw, so they can be deleted with `delete_objects`.
- The `moi_eval` description lists the MoI scripting traps the bridge cannot change (factory
  inputs, object lists, frame directions, gaps between parallel faces, non-destructive
  intersection tests, and more), and says to read `isSolidBRep` on a live object.
- The `export_objects` description says to give each re-export a new file name.

### Changed

- `get_scene` replies with compact JSON. On a document of more than 100 objects, it lists every
  object with its id, name and type only, and says to query the details with `moi_eval`.
- A `moi_eval` timeout has the error code `timeout`. It says whether the script never started
  and nothing changed, or may still finish, in which case the agent checks the scene before
  running it again.
- `get_view` and `set_view` fail when none of the ids to frame exist, before any angle or
  camera changes and without a render. When some ids exist, those are framed and the rest are
  listed, as before.

## [0.2.0] - 2026-09-22

### Added

- `export_objects` takes the full set of MoI's mesh settings for mesh formats (OBJ, STL, 3DS,
  FBX, LWO, SKP): `angle`, `output` (`ngons`, `quads`, `triangles`), `weld`,
  `divideLargerThan`, `divideLargerThanApplyTo`, `avoidSmallerThan` and `aspectRatioLimit`.
  Every mesh export sends all of them, defaults filling any left out, so the same call always
  writes the same mesh. See [ADR-0006](docs/adr/0006-mesh-exports-send-every-setting.md).
- The reply of a mesh export lists the settings used, as `meshSettings`.
- The server reports its version from `package.json`.

### Changed

- A mesh export no longer inherits whatever was last set in MoI's mesh dialog; it overwrites
  the dialog's values for the rest of the MoI session.

### Fixed

- `export_objects` refuses `.dwg`, which MoI 4 cannot write and fails on silently, and points
  to `.dxf` instead.
- `export_objects` refuses a path in a folder that does not exist, which left MoI stuck on an
  error box.
- Mesh settings on a format that is not meshed, and an STL `output` other than `triangles`,
  are refused instead of ignored.

## [0.1.0] - 2026-09-16

First public release: an MCP server and a bridge script that let an agent inspect and model
in a live MoI 4 session.
