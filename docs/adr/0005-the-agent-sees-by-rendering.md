# The agent sees by rendering, not by grabbing the screen

MoI offers two ways to turn a viewport into a PNG, and they look interchangeable. They are not. The
agent's eyes are `viewport.render( width, height )` — an offscreen drawing at a size we choose.
`moi.view.screenshot( name )`, which copies what is literally on screen, is kept for exactly one job:
the whole-window shot, which a render cannot produce. Everywhere else it is a trap.

## Why the obvious one is the wrong one

`moi.view.screenshot` is the easier call, it was shipped first, and it is what "take a screenshot"
means. Four measured differences overrule that.

**It photographs a different viewport than the one you asked for.** With the layout set so that only
the 3D pane is visible, `moi.view.screenshot( 'Top' )` returned a 772x931 image *of the 3D pane*. No
error, no clue, and a perfectly plausible picture. This is the finding that settles the decision:
every other failure mode announces itself somehow, and this one hands the agent a confident answer
to a question it did not ask. `getViewport( 'Top' ).render( 300, 300 )` in the same state returned a
correct Top view.

**It cannot be sized.** `screenshot( '3D', 800, 600 )` ignores the extra arguments and returns the
pane at whatever size it happens to be — 386 x 465 in a split layout. `render( 1600, 1200 )` from
that same pane produced a correct 1600 x 1200 image. A tool that can only photograph a 386-pixel-wide
slot cannot show an agent a fillet.

**It needs the window on screen.** Minimized, `screenshot` writes a valid, empty, 622-byte PNG and
reports nothing. `render( 800, 600 )` in the same state produced a correct 84 KB image. The bridge is
meant to survive the user working normally, and that includes the user minimizing MoI.

**It catches the camera mid-animation.** MoI animates view changes, so a screen grab taken in the
same bridge call as a camera move photographs the camera in flight. A render taken in the same call
as a camera move is byte-identical to one taken a call later, because it draws from the camera's
state rather than from the animating widget. This is what makes framing and capturing a single tool
call rather than two.

The measurements are in [probe-08](../research/probe-08-screenshot.md).

## What follows from it

**Viewports are named, never "active".** A render is addressed through
`moi.ui.mainWindow.viewpanel.getViewport( name )`, which takes `3D`, `Top`, `Front` or `Right`.
`moi.ui.getActiveViewport()` exists and must not be used: it follows the mouse pointer, so it
reported `Right` throughout the session that established all of this, purely because that is where
the cursor sat. An agent built on it cannot know which viewport it photographed.

**Framing is arithmetic, not a command.** Because a render reads the camera directly, framing is
done by computing a camera position from the bounding box of whatever the agent named and calling
`setCameraAndTarget`. Notably this does *not* go through `reset()`, MoI's own zoom-to-fit, for two
reasons: `reset()` frames the current selection, so using it would mean mutating the user's
selection to say what to look at; and its framing reads a selection that lags one bridge call
behind, so selecting and framing in one call frames the previous selection. Arithmetic has neither
problem, and it lets the agent frame by object id without touching the selection at all.

**The guards a screen grab needs are not general.** The `isMinimized` refusal, the blank-frame size
warning and the payload ceiling all exist because of screen-grab failure modes. They belong on the
window path only. Carried onto the render path they would be dead code that reads like safety.

**The whole-window shot stays a screen grab**, because there is no other way to get one, and it
keeps every one of those guards. It is also the only remaining caller, which is the point: the
dangerous mechanism has exactly one use and is named after what it does.

## What this costs

Two mechanisms instead of one, and a vocabulary that has to be kept straight — hence the **Render**
and **Screen grab** entries in [`CONTEXT.md`](../../CONTEXT.md). A render also falls back to a screen
grab if it throws, and the reply says which one produced the image, so a regression here is visible
rather than silent.

Parallel viewports need work a perspective one does not: camera distance sets the visible extent in
a perspective view, but not in a parallel one, where `fieldOfViewAngle` controls it and the mapping
from angle to world extent has to be calibrated against real geometry. If that constant turns out
not to hold, the fallback is `reset()` for the parallel panes alone — accepting the selection lag
there — and that outcome belongs in the probe write-up rather than in this decision.
