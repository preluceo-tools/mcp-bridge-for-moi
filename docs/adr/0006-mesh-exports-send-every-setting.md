# Mesh exports send every mesh setting, and overwrite the user's

MoI holds one set of mesh settings for the whole session, shared by its mesh dialog and by every
scripted export. A script can set them through the export's options string, but cannot read them:
`moi.settings` does not enumerate, and `moi.ini` is not updated by a scripted export. A key a
script leaves out takes whatever value was used last, by the user or by an earlier call. See
[probe-14](../research/probe-14-mesh-export-options.md).

So `export_objects` sends all seven mesh settings on every export to a mesh format, filling the
ones the caller did not give with fixed defaults — MoI's own factory values (angle 12°, quads &
triangles, weld on, no dividing, no minimum length, no aspect ratio limit). The same call always
produces the same mesh.

The price is that the user's mesh dialog afterwards shows the agent's settings, for the rest of
the MoI session. There is no way to put theirs back, because there is no way to read them first.
The tool description says so.

## Considered options

- **Send only what the caller gave (inherit the rest).** Leaves the user's other settings alone,
  but the mesh then depends on state the agent cannot see: two identical calls can write different
  files, and the agent cannot explain why. This is what `angle` did alone before; it is replaced.
- **Read, export, restore.** The right answer if MoI allowed it. It does not: the settings are not
  readable from a script.

## Consequences

The reply echoes the full set of settings used, so the agent knows exactly what produced the file.

If a later MoI makes the settings readable, restoring them after each export becomes possible and
this decision should be revisited.
