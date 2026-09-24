import { readFileSync, unlinkSync } from "node:fs";
import { z } from "zod";
import { BridgeError } from "../session.js";
import {
  frameScript,
  WITH_SELECTION,
  VIEWPORTS,
  DEFAULT_PADDING,
  DEFAULT_LONG_EDGE,
  MAX_LONG_EDGE,
  type Layout,
  type Viewport,
  type ViewPane,
  type FrameSubject,
  type ViewAngle,
} from "../scripts.js";
import { FRAME_SCHEMA, ANGLE_SCHEMA, PADDING_SCHEMA, paddingRefusal } from "../view-schemas.js";
import { READ_ONLY, type Content, type Tool } from "../tool.js";

type Args = {
  viewport?: Viewport;
  size?: number;
  frame?: FrameSubject;
  angle?: ViewAngle;
  padding?: number;
};

/** What the shot scripts return, with the framing's state when one ran first. */
type Reply = {
  path: string;
  mechanism: "render" | "screen grab";
  layout?: Layout;
  fallback?: string | null;
  width?: number | null;
  height?: number | null;
  framing?: { framed: boolean; matched: number; missing: string[]; note?: string | null } | null;
};

/**
 * A frame this small is not a picture of anything. MoI photographs a window that is not on
 * screen as a valid, empty PNG with no error of any kind — 622 bytes against 93 KB for the
 * same window visible. The `isMinimized` guard in the script catches the cause we verified;
 * this catches the shape, whatever the cause. A screen-grab guard only: a render of a window
 * that is not on screen is a correct image. See docs/research/probe-08-screenshot.md.
 */
const BLANK_FRAME_BYTES = 4096;

/**
 * Past this an MCP client is liable to reject the whole tool result, and a protocol-level
 * failure tells the agent nothing it can act on. Refusing with advice does. A screen-grab
 * guard only: a render is drawn at a size we chose and capped.
 */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

/** Picks a PNG path both processes can see, into `path`. The bridge speaks JSON; images do not. */
const TEMP_PNG = `
var fs = moi.filesystem;
var dir = fs.getTempDir();
var sep = fs.getPathDelimiter();
if ( dir.charAt( dir.length - 1 ) !== sep ) dir += sep;
var path = dir + 'mcp-bridge-for-moi-view-' + ( new Date() ).getTime() + '.png';
`;

/**
 * Screen-grabs the whole MoI window to a PNG under the temp folder and returns where it
 * went, for the server to read and delete.
 *
 * The one job a render cannot do, and the only remaining caller of the dangerous
 * mechanism — see docs/adr/0005-the-agent-sees-by-rendering.md. It keeps the
 * `isMinimized` refusal, because a screen grab of a window that is not on screen is a
 * valid, empty PNG with no error at all.
 *
 * `moi.view.screenshot( name )` returns an image object with a single `save( path )`
 * method; the format comes from the extension. Both halves fail silently — an
 * unwritable path just returns null — so the file is checked before the path is handed
 * back. An unrecognised viewport name captures the whole window, which is how the
 * window shot is asked for: the empty string. See docs/research/probe-08-screenshot.md.
 */
function screenGrab(): string {
	return `
if ( moi.ui.mainWindow.isMinimized ) {
	throw new Error( 'MoI is minimized. Its screen grab would come back blank — restore the window and try again.' );
}
${TEMP_PNG}
moi.view.screenshot( '' ).save( path );
if ( !fs.fileExists( path ) ) throw new Error( 'MoI reported no error but wrote no image to ' + path );
return { path: path, viewport: 'window', mechanism: 'screen grab', layout: moi.ui.mainWindow.viewpanel.mode };
`;
}

/**
 * Renders one named viewport offscreen at `longEdge` on its longer side and returns the PNG's
 * path. Works with the window minimized and with the pane hidden by the layout, which is why
 * this — not a screen grab — is how the agent sees. See docs/adr/0005-the-agent-sees-by-rendering.md.
 *
 * The short side comes from the pane's own aspect, because a render fits by height and extends
 * sideways: an aspect narrower than the pane crops the subject.
 *
 * If the render throws, this falls back to a screen grab rather than failing, and says which
 * mechanism produced the image so a regression here is visible rather than silent.
 *
 * The selection is cleared for the duration of the draw and restored before the call returns,
 * because selected geometry renders as a flat yellow silhouette over the subject.
 */
function render(viewport: ViewPane, longEdge: number = DEFAULT_LONG_EDGE): string {
	return `
var name = ${JSON.stringify(viewport)};
var size = ${Math.min(Math.round(longEdge), MAX_LONG_EDGE)};
var vp = moi.ui.mainWindow.viewpanel.getViewport( name );
if ( !vp ) throw new Error( 'MoI has no viewport named ' + name );
${TEMP_PNG}${WITH_SELECTION}
// Selected geometry draws as a flat yellow silhouette that hides exactly the shading the
// agent is trying to judge — and the agent framed this subject itself, so a highlight the
// user put there is noise over it. The selection is cleared for the draw and put straight
// back: a deselect takes effect on a render immediately, with no redraw, so the user never
// sees it go. See docs/research/probe-08-screenshot.md.
var w = size, h = size, fallback = null;
withSelection( [], function () {
	try {
		var pw = vp.pixelWidth, ph = vp.pixelHeight;
		// A pane MoI has never laid out reports no size; a square render is a fair guess and
		// beats dividing by zero.
		if ( pw > 0 && ph > 0 ) {
			if ( pw >= ph ) h = Math.round( size * ph / pw );
			else w = Math.round( size * pw / ph );
		}
		vp.render( w, h ).save( path );
		if ( !fs.fileExists( path ) ) throw new Error( 'MoI reported no error but wrote no image to ' + path );
	} catch ( e ) {
		fallback = String( e );
		w = null; h = null;
		moi.view.screenshot( name ).save( path );
		if ( !fs.fileExists( path ) ) throw new Error( 'The render failed (' + fallback + ') and the screen grab that followed wrote no image to ' + path );
	}
} );
return {
	path: path,
	viewport: name,
	mechanism: fallback ? 'screen grab' : 'render',
	fallback: fallback,
	width: w,
	height: h,
	layout: moi.ui.mainWindow.viewpanel.mode
};
`;
}

const aims = ({ frame, angle, padding }: Args) =>
  frame !== undefined || angle !== undefined || padding !== undefined;

/**
 * Draws the view inside MoI, then reads the file the server and MoI both can see.
 *
 * The bridge speaks JSON, so the image cannot come back over the socket — MoI writes it
 * to the temp folder and hands back the path. Same machine always: the bridge only ever
 * connects over loopback.
 *
 * Two mechanisms, and the reply names which one drew the image. A named viewport is
 * rendered offscreen and carries none of the screen-grab guards, because none of the
 * failures they defend against can happen to a render. `window` is screen-grabbed and
 * keeps all three. See docs/adr/0005-the-agent-sees-by-rendering.md.
 */
export const getViewTool: Tool<Args, Reply> = {
  name: "get_view",
  description:
    "Look at the model: returns a PNG of one of MoI's four viewports, rendered " +
    "offscreen at the size you ask for. This is how you check what you built against " +
    "what was asked for — model, look, compare, correct. The render draws from the " +
    "viewport's camera rather than from the screen, so it works with the MoI window " +
    "minimized and with the pane hidden by the current layout, and it does not catch " +
    "MoI's view animation mid-flight. 'window' is the exception: there is no way to " +
    "render the whole application window, so that one is a screen grab of what is " +
    "literally on screen, at whatever size the window happens to be. A render draws the " +
    "geometry unhighlighted — selected objects would otherwise come back as a flat " +
    "yellow silhouette hiding the shading — and the user's selection is left as it was. " +
    "The reply names the layout in force when the shot was taken; get_view never changes it.",
  input: {
    viewport: z
      .enum(VIEWPORTS)
      .optional()
      .describe(
        "Which pane to draw. 'window' is the whole MoI window including all four " +
          "panes and the side pane, and is screen-grabbed rather than rendered. " +
          "Defaults to '3D'.",
      ),
    size: z
      .number()
      .int()
      .positive()
      .max(MAX_LONG_EDGE)
      .optional()
      .describe(
        "The render's longer edge in pixels; the other edge follows the pane's aspect. " +
          `Defaults to ${DEFAULT_LONG_EDGE}, at most ${MAX_LONG_EDGE}. Not accepted with ` +
          "viewport 'window', which cannot be sized.",
      ),
    frame: FRAME_SCHEMA.optional().describe(
      "What to fill the frame with before drawing: object ids, 'selection', 'scene' " +
        "(every visible object), or 'none'. Omitted is 'none': the camera is left " +
        "exactly where the user had it. Framing by ids leaves the user's selection " +
        "untouched; ids not found are named in the caption, and if none is found the call " +
        "is an error, with no picture and nothing moved. With viewport 'window', which has " +
        "no camera, only 'none' is accepted.",
    ),
    angle: ANGLE_SCHEMA.optional().describe(
      "Which way to look from before drawing. Only the 3D viewport can be given one — " +
        "Top, Front and Right are parallel projections that always look down their own " +
        "axis. Not accepted with viewport 'window'.",
    ),
    padding: PADDING_SCHEMA.optional().describe(
      `Air around the framed subject as a fraction of its size: half its box diagonal in the 3D view, ` +
        `half its longer visible side in Top, Front or Right. Defaults to ${DEFAULT_PADDING}. ` +
        "Refused with bad_request without a frame (or with frame 'none'), and with viewport 'window'.",
    ),
  },
  direct: false,
  annotations: READ_ONLY,

  precheck: (args) => {
    if (args.viewport !== "window") return paddingRefusal(args);
    // Rejected rather than ignored: an agent that asks for a sized window shot has the wrong
    // model of what the window path is, and a silently unsized image lets it keep one.
    if (args.size !== undefined) {
      return (
        "The whole-window shot is a screen grab, not a render, so it cannot be sized — it comes " +
        "back at whatever size the MoI window is. Drop `size`, or ask for a named viewport, " +
        "which can be sized."
      );
    }
    // Same reason: the window shot photographs all four panes as they stand and has no camera
    // of its own to point. A dropped `frame` would hand back a plausible picture of the wrong
    // thing. `frame: "none"` asks for no aiming, so it is the one frame the window takes.
    if (aims({ ...args, frame: args.frame === "none" ? undefined : args.frame })) {
      return (
        "The whole-window shot is a screen grab of all four panes as they stand, so it has no " +
        "camera to aim — `angle`, `padding` and any `frame` but 'none' mean nothing to it. Ask " +
        "for a named viewport to frame something, or drop them."
      );
    }
    return undefined;
  },

  script: (args) => {
    const viewport = args.viewport ?? "3D";
    const shot =
      viewport === "window" ? screenGrab() : render(viewport, args.size ?? DEFAULT_LONG_EDGE);
    if (viewport === "window" || !aims(args)) return shot;
    // One call, one framed picture. A render draws from the camera's state rather than from the
    // animating pane, so framing and drawing in the same bridge call is byte-identical to doing
    // them a call apart — which is what lets these be one tool call rather than two. See
    // docs/adr/0005-the-agent-sees-by-rendering.md.
    const framing = frameScript({
      viewport: viewport as ViewPane,
      frame: args.frame ?? "none",
      angle: args.angle,
      padding: args.padding,
    });
    return `var framing = ( function() {${framing}} )();
var shot = ( function() {${shot}} )();
shot.framing = framing;
return shot;`;
  },

  reply: (value, args) => {
    const isWindow = args.viewport === "window";
    const subject = isWindow ? "The whole MoI window" : `MoI's ${args.viewport ?? "3D"} viewport`;
    const { path, mechanism, layout, fallback, width, height, framing: framed } = value;
    let png: Buffer;
    try {
      png = readFileSync(path);
    } catch (err) {
      throw new BridgeError(
        "not_found",
        `MoI wrote an image to ${path} but the server could not read it: ${String(err)}. ` +
          `Both run on the same machine, so this usually means they disagree about the temp ` +
          `folder — check whether one of them is running elevated and the other is not.`,
      );
    } finally {
      // The read can fail on a file MoI really did write (a scanner holding it, say), and
      // leaving it behind would orphan it for good. Cleanup runs either way.
      try {
        unlinkSync(path);
      } catch {
        // Temp file, and the OS will get it eventually. Never fail a good image over it.
      }
    }

    if (isWindow && png.length > MAX_IMAGE_BYTES) {
      throw new BridgeError(
        "moi_error",
        `${subject} came to ${png.length} bytes of PNG, past the ${MAX_IMAGE_BYTES}-byte ceiling ` +
          `an MCP client will carry. Ask for a single viewport, which is rendered at a size you ` +
          `choose, or make the MoI window smaller.`,
      );
    }

    const blank =
      isWindow && png.length < BLANK_FRAME_BYTES
        ? ` This frame is almost certainly blank — MoI photographs a window that is not on ` +
          `screen as an empty image and reports no error. Check that the MoI window is restored.`
        : "";

    // A render that fell back is a regression, not a detail, so it is said where the agent reads.
    const fellBack = fallback
      ? ` The render failed (${fallback}), so this is a screen grab instead — it shows what is ` +
        `on screen, which for a pane the layout is hiding may be a different viewport entirely.`
      : "";

    const dimensions = width && height ? `${width} x ${height}, ` : "";

    // What was aimed at, said where the agent reads: an id that no longer exists is the
    // difference between "the part looks wrong" and "the part is not in this picture".
    const aimed = !framed
      ? ""
      : (framed.framed ? ` Framed ${framed.matched} object(s).` : ` ${framed.note ?? ""}`) +
        (framed.missing && framed.missing.length
          ? ` Not found, so not framed: ${framed.missing.join(", ")}.`
          : "");

    const content: Content[] = [
      {
        type: "text",
        text: `${subject}, ${dimensions}${png.length} bytes of PNG, by ${mechanism}, under layout '${layout}'.${aimed}${blank}${fellBack}`,
      },
      { type: "image", data: png.toString("base64"), mimeType: "image/png" },
    ];
    return content;
  },
};
