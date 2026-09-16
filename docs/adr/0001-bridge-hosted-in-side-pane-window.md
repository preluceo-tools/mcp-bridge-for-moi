# The bridge lives in the side pane's window, armed by a startup script

The bridge needs a JavaScript context inside MoI that has networking and timers and that outlives
any single command, so the user can keep modelling normally while a session is connected. We put a
`.js` in the user's MoI startup folder that borrows `moi.ui.sidePane.window` and does all its work
there, because that is the only host we found meeting all three conditions with nothing installed
outside the user's own app data folder.

## Considered Options

The obvious design — ship the bridge as a custom MoI command — fails on lifetime: a command's page
is torn down the moment the command ends, and the only known way to keep one parked is an object
picker loop, which is a real selection UI and hijacks the user's mouse for as long as the session
lasts.

The startup folder alone is not enough either. It executes `.js` at launch (`.htm` there is
ignored), but in the bare script host: no `WebSocket`, no `XMLHttpRequest`, no `setTimeout`, no
`window`. Nothing scheduled directly there can outlive it. What makes the design work is that the
UI is already up by the time the startup script runs — `moi.ui.sidePane.window` is a live WebKit
window with all of it, so the startup script's job is only to schedule work into that window and
exit.

Patching the side pane's own HTML was rejected: a user-level `ui\` folder does not override the
install one, so it would mean editing a vendor file that every MoI upgrade overwrites.

`moi.ui.createDialog` with a `moi://` URL does load a page immediately and is a viable host, but it
creates a small visible floating window with no discoverable way to hide it. It remains the
fallback if the bridge ever needs a page of its own.

## Consequences

Installing the bridge means placing one file in the user's MoI startup folder, and it arms itself on
every MoI launch with no user action. Nothing is written to the MoI install folder, so upgrades do
not disturb it.

The bridge shares a window with MoI's own side pane UI. It must not disturb that page: no global
namespace collisions, no unhandled exceptions. See [ADR-0002](./0002-gate-poll-before-websocket.md)
for what happens when it does.
