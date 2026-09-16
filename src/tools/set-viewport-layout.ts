import { z } from "zod";
import { LAYOUTS, type Layout } from "../scripts.js";
import { CHANGING, type Tool } from "../tool.js";

/** A missing or unknown layout is refused with the valid ones named, before MoI ever sees it. */
export const LAYOUT_SCHEMA = z.enum(LAYOUTS, {
  errorMap: (issue) => ({
    message:
      (issue.code === "invalid_type" && issue.received === "undefined"
        ? "`layout` is required."
        : "Unknown layout.") + ` Valid layouts: ${LAYOUTS.join(", ")}.`,
  }),
});

/**
 * Changes which viewports are on screen and reports the layout MoI ended on. Only ever called
 * by the tool that says so — never from a render or a screen grab, because moving the user's
 * screen around must be something they see the agent decide to do. No auto-restore.
 */
function setViewportLayout(layout: Layout): string {
	return `
var panel = moi.ui.mainWindow.viewpanel;
panel.mode = ${JSON.stringify(layout)};
return { layout: panel.mode };
`;
}

export const setViewportLayoutTool: Tool<{ layout: Layout }, unknown> = {
  name: "set_viewport_layout",
  description:
    "Change which of MoI's viewports are on screen: 'split' shows all four, '3d', 'top', " +
    "'front' or 'right' shows that one alone. Not needed to see a pane — get_view renders " +
    "any pane whatever the layout, at any size. What it changes is the shot's aspect: a " +
    "pane alone takes the whole viewport area and so the window's shape, where its slot " +
    "in the split may be taller and narrower. This " +
    "moves the user's screen, and it stays changed until something changes it back. " +
    "Returns the layout MoI ended on. `layout` is required; a missing or unknown one is " +
    "refused with the valid layouts named.",
  input: { layout: LAYOUT_SCHEMA },
  direct: false,
  annotations: CHANGING,
  script: ({ layout }) => setViewportLayout(layout),
};
