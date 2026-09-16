/**
 * The framing arguments, shared by `set_view` and `get_view` so the two cannot drift apart:
 * the same words mean the same thing whether or not a picture comes back.
 */
import { z } from "zod";
import { NAMED_ANGLE_NAMES } from "./scripts.js";

export const FRAME_SCHEMA = z.union([z.array(z.string()), z.enum(["selection", "scene", "none"])]);
export const ANGLE_SCHEMA = z.union([
  z.enum(NAMED_ANGLE_NAMES),
  z.object({
    upDown: z.number().describe("Degrees from straight down: 0 is a top view, 90 the horizon."),
    leftRight: z.number().describe("Degrees around vertical: 0 is the front."),
  }),
]);
// Below zero the subject is framed tighter than itself, and past -1 the camera turns round
// and looks the other way. Refuse at the boundary rather than send MoI a camera that points
// at nothing.
export const PADDING_SCHEMA = z.number().min(0);

/**
 * Padding is air around a framed subject; with no frame, or frame 'none', there is no subject and
 * the padding would be silently ignored. Both view tools refuse it, so they refuse alike.
 */
export const paddingRefusal = ({ frame, padding }: { frame?: unknown; padding?: number }) =>
  padding !== undefined && (frame === undefined || frame === "none")
    ? "padding needs a frame: it is air around a framed subject, and with no frame (or frame " +
      "'none') nothing is framed. Name what to frame, or drop `padding`."
    : undefined;
