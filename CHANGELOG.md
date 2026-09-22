# Changelog

What changed in each release of mcp-bridge-for-moi. Versions follow
[Semantic Versioning](https://semver.org/); the format follows
[Keep a Changelog](https://keepachangelog.com/).

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
