import { z } from "zod";
import {
  frameScript,
  VIEW_PANES,
  DEFAULT_PADDING,
  type ViewPane,
  type FrameSubject,
  type ViewAngle,
} from "../scripts.js";
import { FRAME_SCHEMA, ANGLE_SCHEMA, PADDING_SCHEMA, paddingRefusal } from "../view-schemas.js";
import { CHANGING, type Tool } from "../tool.js";

type Args = { viewport: ViewPane; frame: FrameSubject; angle?: ViewAngle; padding?: number };

export const setViewTool: Tool<Args, unknown> = {
  name: "set_view",
  description:
    "Point one of MoI's four viewports at whatever you name, without touching the " +
    "user's selection and without taking a picture. Framing is computed from bounding " +
    "boxes, so naming object ids frames exactly those objects and leaves the selection " +
    "exactly as the user left it. Returns the resulting camera state as text; ask for " +
    "the picture separately.",
  input: {
    viewport: z.enum(VIEW_PANES).describe("Which pane to move. '3D' is the perspective one."),
    frame: FRAME_SCHEMA.describe(
      "What to fill the frame with: object ids (those not found are listed in the reply; " +
        "if none is found it is an error and nothing moves), 'selection' (what the user has " +
        "selected — an error if that is nothing), 'scene' (every visible object), or " +
        "'none' to leave the camera where it is and just report, or just change the angle.",
    ),
    angle: ANGLE_SCHEMA.optional().describe(
      "Which way to look from. Only the 3D viewport can be given one — Top, Front and " +
        "Right always look down their own axis, and asking them for an angle is an error.",
    ),
    padding: PADDING_SCHEMA.optional().describe(
      `Air around the subject as a fraction of its size: half its box diagonal in the 3D view, ` +
        `half its longer visible side in Top, Front or Right. Defaults to ${DEFAULT_PADDING}. ` +
        "Refused with bad_request alongside frame 'none', which frames nothing.",
    ),
  },
  direct: false,
  annotations: CHANGING,
  precheck: paddingRefusal,
  script: ({ viewport, frame, angle, padding }) => frameScript({ viewport, frame, angle, padding }),
};
