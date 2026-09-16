# Probe 08 — the agent can see, and it costs one call

Run on 2026-09-09 against MoI 4.0 (`4.0 Dec-22-2020`) on Windows 11, through the live bridge. The
question: is `moi.view.screenshot` usable, and can it close the modelling loop — model, look,
compare, correct?

Scripts and captured output are kept under
[`prototypes/probe-08-screenshot/`](../../prototypes/probe-08-screenshot/).

## Headline: it works, silently, with no dialog

`moi.view.screenshot( name )` takes one required string, returns an image object whose only member
is `save( path )`, and writes a PNG of what is on screen. No modal dialog appeared at any point,
the bridge stayed parked in the side pane with no command running throughout, and every call
returned well inside the 30s timeout.

That was the one thing that could have killed this ticket — the export dialog problem that keeps
mesh export [out of scope](../../README.md#limitations) is a modal freezing the window
the bridge lives in. `screenshot` has no such problem.

```
moi.view.screenshot( '3D' ).save( 'C:\\...\\shot.png' );
```

## The symbol is real, and undocumented everywhere

`typeof moi.view.screenshot` is `'function'`, and the same probe on `saveImage`, `captureImage`,
`width` and `height` returns `'undefined'` — so the binding distinguishes names it knows from
names it does not, and this one it knows.

It sits in `moi_lib.dll`'s method table, stored UTF-16, in the middle of the `moi.view` group:

```
projectToCPlaneAll, projectToCPlaneOrtho, resetAll, getBackgroundImages,
screenshot, resetCPlane, axisLabels, getCPlane, setCPlaneInteractive,
setCPlane, spinInteractive
```

That is the entire `moi.view` surface, and there is no zoom-to-fit, camera setter or frame sizer
anywhere on it. **That is a fact about `moi.view`, not about MoI** — see the correction at the
bottom of this page: the camera lives on the viewport object, which this probe did not look at.

No stock command script mentions `screenshot` at all — grepping the whole install turns up only the
help HTML and a `docs/screenshots/` folder. So unlike every factory in
[probe-07](probe-07-factory-coverage.md), this one has no worked example to read. Everything below
was established by calling it.

## Argument one is a viewport name, and an unknown name means "the whole window"

Called bare it throws `Required function argument 1 (string) missing.` Called with a name it
captures that pane:

| Argument | Result |
|---|---|
| `'3D'`, `'Top'`, `'Front'`, `'Right'` | that pane alone, 386 x 465 |
| `'3d'` | byte-identical to `'3D'` — matching is case-insensitive |
| `''`, `'window'`, `'All'`, `'bogus'` | the whole MoI window, 982 x 1000 |

The whole-window shot is the entire application: four panes, the bottom toolbar and the side pane.
See [`probe08-window.png`](../../prototypes/probe-08-screenshot/probe08-window.png).

There is no positive way to *ask* for the whole window — it is what you get when the name is not a
viewport. `moi.ui.getActiveViewport().name` returns `'3D'`, so the four names are discoverable from
the running MoI rather than guessed. (`getLastClickedViewport()` returned `null` and is no help.)

## What `screenshot` itself will not do

**Take a resolution.** `screenshot( '3D', 800, 600 )` returns a file byte-identical to the
one-argument call. Extra arguments are ignored; the image is the pane at whatever size it happens
to be on screen. Whether some *other* call can render a pane at a chosen size is open — the
viewport object has `render()` and a settable-looking `pixelWidth`/`pixelHeight`, untested.

**Point a camera.** Nothing on `moi.view` sets one, and the image object exposes no `scaled` or
`copy`. The viewport object does; again, see the correction below.

**Choose a format, except through the extension.** `save( '...jpg' )` writes a real JPEG (`ff d8`), and at
21 KB against the PNG's 116 KB. The extension is the only control there is.

## Two silent failures

**`save()` reports nothing.** It returns `null` on success and `null` on failure. Saving into a
folder that does not exist wrote no file, returned `null`, and threw nothing. The only way to know
a screenshot happened is `fileExists` afterwards.

**A minimized window photographs as blank.** With `moi.ui.mainWindow.minimize()`, the same call
writes a valid 386 x 465 PNG of 622 bytes — an empty frame — with no error of any kind. The
on-screen equivalent is 93 KB. `moi.ui.mainWindow.isMinimized` reads `true` in that state, so this
one is at least detectable before the fact.

Both are handled in the shipped tool: it refuses when `isMinimized`, and it checks the file exists
before reporting success.

## View changes are animated, and the shot does not wait

This is the finding most likely to mislead an agent. With a box in the document:

```
moi.view.resetAll();
moi.ui.redrawViewports();
moi.view.screenshot( '3D' ).save( … );
```

produces [`probe08-3d-midanimation.png`](../../prototypes/probe-08-screenshot/probe08-3d-midanimation.png)
— the camera caught mid-flight, the box cut off at the frame edge. The identical call issued as a
*later* bridge call produces
[`probe08-3d-settled.png`](../../prototypes/probe-08-screenshot/probe08-3d-settled.png), the whole
box, framed.

The zoom animates, and a script cannot wait for it. The script host has no timers, `eval` is
synchronous, and a busy-wait would block the very UI thread the animation runs on. **The only
settle is the gap between two bridge calls.** The `get_screenshot` tool takes no view arguments
partly for this reason: it photographs, it does not steer.

## What shipped

`get_screenshot`, with one optional `viewport` — `3D` (the default), `Top`, `Front`, `Right`, or
`window`. `'window'` is sent to MoI as the empty string, since "the whole window" is only ever
reachable as a name MoI does not recognise, and the empty string is the most honest way to say
"not a viewport" without pretending `'window'` is a documented value.

The image cannot come back over the socket — the bridge speaks JSON — so MoI writes a PNG into the
temp folder and returns the path, the server reads it and deletes it, and the agent gets an image
content block. Server and MoI are always on the same machine: the bridge only ever connects over
loopback.

Two guards came out of the silent failures above. The script refuses when
`moi.ui.mainWindow.isMinimized`, which is the one blank-frame cause that is detectable before the
fact; and the server flags any frame under 4 KB in its reply, which catches the shape of a blank
frame whatever caused it — the hidden-pane case below included.

The PNG goes out at whatever size the pane is, with no downscaling. An empty 386 x 465 3D pane is
126 KB, because MoI's dithered grid compresses badly; a maximised window on a 4K display would be a
good deal more. Past 6 MB the tool refuses and says to shoot a single pane instead, rather than
handing an MCP client a payload it will reject with nothing the agent can act on.

## Correction: the camera is on the viewport object, not on `moi.view`

Added 2026-09-09, after this probe shipped, and revised the same day — see the numbers note at the
end of this section. The paragraphs above are corrected in place; this section records why.

This probe enumerated `moi.view` and concluded MoI had no scriptable camera. It does — the probe
looked in the wrong place. `moi.ui.getActiveViewport()` returns an object with its own method
table, confirmed live:

```
pan()  zoom()  rotate()  reset()  wheelZoom()  setAngles()
setCameraAndTarget()  cameraPt  targetPt  cameraFrame  targetFrame
fieldOfViewAngle  leftRightAngle  upDownAngle  tiltAngle
pixelWidth  pixelHeight  is3DView  projection
render()  renderToClipboard()  interactiveViewChange()
```

`reset()` frames the **selection** when there is one, and the whole scene when there is not. With a
10-unit box at the origin selected and an 80-unit box at (200, 200)–(280, 280, 80):

```
selected, reset()    -> targetPt (5, 5, 5)          the small box
deselected, reset()  -> targetPt (127, 166, 34)     both boxes in frame
```

So the two shots an agent actually wants — the part tight in frame, and the part in its assembly —
are both reachable today. Neither is exposed as a tool yet.

**`reset()` reads a selection that lags one bridge call behind.** Setting `o.selected = true` and
calling `reset()` in the same script frames the *previous* selection: the run above returned
(127, 166, 34), the whole-scene framing, until the selection was left to settle and `reset()` called
again in the next call. A redraw does not help. This is separate from the animation finding, and it
is the reason the shipped design frames by arithmetic rather than through `reset()` — see
[ADR-0005](../adr/0005-the-agent-sees-by-rendering.md).

### `render( width, height )` is a real offscreen render

The most useful thing on that table, and the one that moved the whole design. It takes a width and a
height, returns the same image object with a single `save( path )`, and draws the viewport without
reference to what is on screen:

```
pane is 386 x 465
render( 1600, 1200 )        -> 1600 x 1200, 112212 bytes
render( 800, 600 ) minimized ->  800 x 600,  84442 bytes   (a screen grab gives 622 bytes of nothing)
render( 300, 300 ) on a hidden pane -> the correct view of that pane
```

Three further properties, each of which removes a constraint this probe reported:

- **It reads the camera, not the screen.** `reset()` followed by `render()` in the same bridge call
  is byte-identical to rendering a call later (`fb1aad89…`, 64155 bytes both). The animation
  problem is a screen-grab problem. Framing and capturing can be one call.
- **A deselect takes effect immediately.** Clearing the selection and rendering in the same call
  produces the clean image, no redraw needed — which matters because selected geometry renders as
  a flat yellow silhouette that hides the shading an agent is trying to judge. Only `reset()`'s
  framing lags; rendering does not.
- **It fits by height and extends sideways.** At 900 x 400 from a 386 x 465 pane the subject keeps
  its vertical size and gains air left and right. An aspect *narrower* than the pane crops.

Speed is not a constraint: 35 ms at 700 x 700, 57 ms at 772 x 930, 242 ms at 2400 x 2400.

Two things it does not do. It cannot capture the whole application window — side pane, toolbar and
all — which is the one job left to `moi.view.screenshot`. And its framing arithmetic is
perspective-only; see Still open.

### Naming a viewport: `viewpanel.getViewport( name )`

`moi.ui.mainWindow.viewpanel.getViewport( name )` takes `3D`, `Top`, `Front` or `Right`. MoI's own
`Silhouette.js` and `Make2D.htm` use it, so it is a supported path rather than a discovery. The
`getViewport` / `split` / `mode` cluster in `moi_lib.dll` belongs to this object.

This matters more than it looks. `moi.ui.getActiveViewport()` **follows the mouse pointer** — it
reported `Right` for an entire session purely because that is where the cursor sat — and
`getLastClickedViewport()` returned `null`. Any tool built on the active viewport does not know
what it photographed.

### Camera moves do not enter the undo stack

`moi.command.lastCommandRevisionStart` / `End` read 38 / 41 before a `reset()` and a `setAngles()`,
and 38 / 41 after. Framing is not a command, so it cannot interfere with
[the undo granularity gap](../../README.md#limitations), which is a live concern elsewhere.

One trap: **`setAngles` takes its arguments in the reverse of the property names.**
`setAngles( 10, 70 )` yields `leftRightAngle: 70, upDownAngle: 10` — it is
`setAngles( upDown, leftRight )`.

### An earlier version of this section had the wrong numbers

It cited an 80-unit box "out at (200, 200)" and a deselected framing of (40, 40, 40). Neither
happened. The helper that built the test geometry ignored its offset arguments, so both boxes were
built at the origin, nested — a 10-unit box inside an 80-unit one. The conclusion survived
re-testing against genuinely separated geometry, which is what the figures above are, but the
original run did not show what it claimed to. Recorded rather than quietly edited, because a probe
that silently corrects itself is not evidence of anything.

## Answered: a hidden pane photographs as a *different* pane

This probe left open whether a viewport hidden by a single-viewport layout would come back blank
the way a minimized window does, and said a human would have to click the toolbar to find out. Not
so — `moi.ui.mainWindow.viewpanel.mode` is a readable and writable string taking
`split | 3d | top | front | right`, so the layout is scriptable after all.

The answer is worse than blank. With `mode` set to `'3d'`:

```
screenshot( 'Top' )            -> 772 x 931, 101037 bytes   ... of the 3D pane
getViewport('Top').render(...) ->  300 x 300,   3598 bytes   ... a correct Top view
```

A blank frame is detectable. A confident, correctly-sized image of the wrong viewport is not, and
the blank-frame size warning shipped with `get_screenshot` would never catch it. This is the
finding that moved the tool onto `render()` — see
[ADR-0005](../adr/0005-the-agent-sees-by-rendering.md).

## The parallel-projection extent, calibrated

Camera distance sets what a perspective viewport sees; `distance * tan( fov / 2 )` framed the 3D
pane correctly at 35% padding. It does **not** hold for `Top` / `Front` / `Right`. What does:

> In a parallel viewport, **`fieldOfViewAngle` is world units across the smaller of the render's
> two dimensions** — one unit per degree, exactly.

Measured against the solid 10-unit box that ships in the probe document, camera on the box centre
in `Top`, rendered with `viewport.render( w, h )` and the box's extent counted out of the PNG. The
box's own edge stroke adds one pixel on each side, so the fill spans `pixels + 2`; the figures
below subtract it.

| `fieldOfViewAngle` | render | box fill | units across width | units across height |
| --- | --- | --- | --- | --- |
| 20 | 400 x 400 | 200 px | 20.0 | 20.0 |
| 20 | 800 x 400 | 200 px | 40.0 | 20.0 |
| 20 | 400 x 800 | 200 px | 20.0 | 40.0 |
| 40 | 400 x 400 | 100 px | 40.0 | 40.0 |
| 10 | 600 x 300 | 300 px | 20.0 | 10.0 |

The smaller dimension reads the field of view back exactly in every row, and the larger one scales
with the render's aspect. Two things it does *not* depend on:

- **The camera's distance.** The same field of view rendered from 5 units away and from 500 gave
  byte-identical framing (202-pixel fill both times). In a parallel view the camera position only
  has to stand clear of the geometry.
- **The pane's own pixel size.** The pane was 386 x 465 throughout; renders at 400 x 400, 800 x 400,
  400 x 800 and 600 x 300 all obeyed the same rule.

So framing a subject of half-extent `r` in a parallel viewport is `fieldOfViewAngle = 2 * r`, and
the fallback to `reset()` that [ADR-0005](../adr/0005-the-agent-sees-by-rendering.md) held in
reserve is not needed. The constant lives in `PARALLEL_UNITS_PER_DEGREE` in `src/scripts.ts` and is
pinned by a test, because it is a measured number and measured numbers drift.

One caveat left standing: the document that produced these figures has no unit system set. Whether
a document in millimetres or inches changes the ratio is untested.

## Still open

- **Occlusion.** Whether another window covering MoI affects a screen grab. Moot for renders, which
  work minimized and hidden.
- **`getBackgroundImages`**, the symbol next door, is untouched.
- **DPI scaling.** Every measurement here is from one display at one scaling factor.
