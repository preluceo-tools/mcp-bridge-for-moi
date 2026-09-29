# Changelog

What changed in each release of mcp-bridge-for-moi. Versions follow
[Semantic Versioning](https://semver.org/); the format follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [0.5.0] - 2026-09-29

No bridge change in this release: updating the server is enough.

### Added

- `mcp-bridge-for-moi tokens` estimates the tokens each tool definition costs an agent, and the
  total; `--json` prints the definitions as the server sends them. It needs no MoI session.
- A test fails when the tool definitions together pass 15,600 characters, so their cost cannot
  grow unnoticed.
- The README has a Token use section: what the tool definitions cost in an agent's context, tool
  by tool, and how to check it. A test keeps its table in step with the server.

### Changed

- A `moi_eval` that fails with `moi_error` ends its reply with a line pointing to
  `moi_factory_help('traps')`. Other failures and successful calls are unchanged.
- `moi_eval`'s description now fits Claude Code's 2,048-character cap on tool descriptions (it was
  6,324 characters, so the traps and refusal notes at its end were cut off). The MoI scripting traps
  and the helper details moved to `moi_factory_help('traps')` and `moi_factory_help('helpers')`.
  A test keeps every tool description within the cap.

## [0.4.0] - 2026-09-26

No bridge change in this release: updating the server is enough.

### Added

- `moi_factory_help` answers for `object`, `edge` and `style` with hand-written notes on their
  members (MoI's objects list none of their own), without a MoI session. The index names them.
- When a `moi_eval` result is `null` and the script has no `return`, the reply says the last
  expression was not returned.
- Nine more MoI scripting traps in the `moi_eval` description: `commit()` return values, mesh
  import through `fileImportSubD`, all-or-nothing imports, writable `obj.selected`, reading files,
  whole-list factory calls, `join` returning one object per connected group, `execCommand` on
  commands with a UI, and `isClosed` on breps.

### Changed

- The traps in the `moi_eval` description are one bullet per line instead of one paragraph.
- When a `moi_eval` script throws, each list of created or consumed ids names at most 10 ids and
  gives the count of the rest, so a script that fails on a large document no longer returns an
  oversized error.
- On a document with no unit system, the agent may set millimeters itself when it is only
  testing. Otherwise it still asks you. The refusal itself is unchanged.

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
