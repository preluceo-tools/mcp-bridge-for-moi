import { sandbox } from "./sandbox.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WebSocket } from "ws";

const { SessionHost } = await import("./session.js");
const { handshakePath } = await import("./paths.js");
const { LAYOUTS, VIEW_PANES, DEFAULT_LONG_EDGE } = await import("./scripts.js");
const { A, B, fakeMoi, guid, runScript, sceneOf } = await import("./fake-moi.js");
const { runTool } = await import("./index.js");
const { getViewTool } = await import("./tools/get-view.js");
const { setViewportLayoutTool, LAYOUT_SCHEMA } = await import("./tools/set-viewport-layout.js");

/** Runs get_view's script on the fake and returns what MoI would reply, plus the fake. */
function shoot(args: Parameters<typeof getViewTool.script>[0], fake = fakeMoi()) {
  return { fake, shot: runScript(getViewTool.script(args), fake.moi) };
}

test("a named pane is rendered offscreen, never screen-grabbed, even when the layout hides it", () => {
  // The finding that decides the whole design: a screen grab of a pane the layout is hiding
  // returns a different viewport's image and reports no error. See docs/adr/0005.
  for (const viewport of VIEW_PANES) {
    const { fake, shot } = shoot({ viewport }, fakeMoi({ mode: "top" }));
    assert.equal(fake.renders.length, 1);
    assert.equal(fake.renders[0].viewport, viewport);
    assert.ok(!fake.log.some((l) => l.startsWith("screenshot")), `the ${viewport} pane was screen-grabbed`);
    assert.equal(shot.mechanism, "render");
    assert.equal(shot.fallback, null);
    assert.ok(fake.files.has(shot.path), "the reply names a file MoI did not write");
    // The layout is reported as it stood, and left that way.
    assert.equal(shot.layout, "top");
    assert.equal(fake.moi.ui.mainWindow.viewpanel.mode, "top");
  }
});

test("the window shot asks MoI for the empty name, which is what grabs the whole window", () => {
  // An unrecognised viewport name is what makes MoI grab the whole window; sending the
  // literal string 'window' would work today only by being unrecognised, which is not a
  // contract. See docs/research/probe-08-screenshot.md.
  const { fake, shot } = shoot({ viewport: "window" }, fakeMoi({ objects: [{ id: guid(1), selected: true }] }));
  assert.deepEqual(fake.log, ["screenshot "], "the window shot rendered, or touched the selection");
  assert.equal(shot.mechanism, "screen grab");
  assert.ok(fake.files.has(shot.path));

  const minimized = fakeMoi({ minimized: true });
  assert.throws(() => runScript(getViewTool.script({ viewport: "window" }), minimized.moi), /minimized/);
  assert.deepEqual(minimized.log, []);
});

test("the window grab keeps its minimized guard; a render does not carry one", () => {
  // A minimized MoI screen-grabs a blank frame and reports no error at all. A render of the
  // same window comes back correct, so the guard there would be dead code that reads as safety.
  assert.ok(getViewTool.script({ viewport: "window" }).includes("isMinimized"));
  for (const name of VIEW_PANES) {
    assert.ok(!getViewTool.script({ viewport: name }).includes("isMinimized"), `the ${name} render carries a screen-grab guard`);
  }
});

test("the long edge is the one asked for and lands on the pane's longer side", () => {
  // Fits by height and extends sideways, so the requested edge must land on the longer side.
  const drawn = (pixelWidth: number, pixelHeight: number, size?: number) => {
    const { fake, shot } = shoot({ viewport: "3D", size }, fakeMoi({ viewports: { "3D": { pixelWidth, pixelHeight } } }));
    assert.deepEqual([fake.renders[0].width, fake.renders[0].height], [shot.width, shot.height]);
    return [shot.width, shot.height];
  };
  assert.deepEqual(drawn(800, 600, 900), [900, 675]);
  assert.deepEqual(drawn(600, 800, 900), [675, 900]);
  assert.deepEqual(drawn(800, 600), [DEFAULT_LONG_EDGE, 768]);
  // A pane MoI has never laid out reports no size: square, rather than a division by zero.
  assert.deepEqual(drawn(0, 0, 900), [900, 900]);
});

test("a failed render falls back to a screen grab, says so, and hands the selection back", () => {
  const { fake, shot } = shoot({ viewport: "3D" }, fakeMoi({ renderThrows: true, objects: [{ id: guid(1), selected: true }] }));
  assert.equal(shot.mechanism, "screen grab");
  assert.match(shot.fallback, /render failed/);
  assert.deepEqual([shot.width, shot.height], [null, null]);
  assert.ok(fake.log.indexOf("screenshot 3D") > fake.log.findIndex((l) => l.startsWith("render 3D")));
  assert.ok(fake.files.has(shot.path));
  assert.deepEqual(fake.selectedIds(), [guid(1)]);

  // And when the grab writes nothing either, that is an error, with the selection still back.
  const nothing = fakeMoi({ saveWritesNothing: true, objects: [{ id: guid(1), selected: true }] });
  assert.throws(
    () => runScript(getViewTool.script({ viewport: "3D" }), nothing.moi),
    /The render failed \(.*\) and the screen grab that followed wrote no image/,
  );
  assert.deepEqual(nothing.selectedIds(), [guid(1)]);
});

test("a render draws the geometry unhighlighted, and hands the selection back before any redraw", () => {
  // Selected geometry renders as a flat yellow silhouette over the subject the agent framed.
  // A deselect takes effect on a render with no redraw, so the selection is put back before
  // anything can repaint and the user never sees it go. See docs/research/probe-08-screenshot.md.
  for (const framing of [{}, { frame: "scene" as const }]) {
    const fake = sceneOf({ id: A, selected: true }, B);
    shoot({ viewport: "3D", ...framing }, fake);
    assert.deepEqual(fake.renders[0].selected, [], "the render saw a selection");
    assert.deepEqual(fake.selectedIds(), [A], "the user's selection did not come back");
    const cleared = fake.log.indexOf(`deselect ${A}`);
    const drawn = fake.log.indexOf("render 3D 1024x768");
    const restored = fake.log.lastIndexOf(`select ${A}`);
    assert.ok(cleared >= 0 && cleared < drawn && drawn < restored, fake.log.join(" | "));
    assert.ok(!fake.log.slice(cleared).includes("redraw"), "a redraw came while the selection was away");
  }
});

/**
 * A fake bridge that answers a screenshot request with a path of our choosing, so the
 * server half — read, size-check, hand back, clean up — can be exercised without MoI.
 */
async function withFakeShot(
  bytes: Buffer,
  body: (result: Awaited<ReturnType<typeof runTool>>, shotPath: string) => void,
  viewport: "3D" | "Top" | "Front" | "Right" | "window" = "3D",
  value: Record<string, unknown> = {},
  framing: Omit<Parameters<typeof getViewTool.script>[0], "viewport" | "size"> = {},
) {
  const host = new SessionHost();
  await host.start();
  const info = JSON.parse(readFileSync(handshakePath(), "utf8"));
  const shotPath = join(sandbox, `pretend-shot-${Date.now()}-${Math.random()}.png`);
  writeFileSync(shotPath, bytes);

  const ws = new WebSocket(
    `ws://127.0.0.1:${info.port}/bridge?token=${info.token}&protocol=${info.protocol}`,
    { origin: "moi://ui" },
  );
  ws.on("error", () => {});
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.t === "ping") return;
    ws.send(
      JSON.stringify({
        id: msg.id,
        ok: true,
        value: { path: shotPath, viewport, mechanism: "render", width: 1024, height: 768, layout: "split", ...value },
      }),
    );
  });
  await new Promise((resolve) => ws.once("open", resolve));

  try {
    body(await runTool(host, getViewTool, { viewport, ...framing }), shotPath);
  } finally {
    ws.close();
    await host.stop();
  }
}

/** A real PNG of a plausible size, so the blank-frame floor is not tripped. */
function fakePng(bytes: number): Buffer {
  const oneByOne = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  return Buffer.concat([oneByOne, Buffer.alloc(Math.max(0, bytes - oneByOne.length))]);
}

test("the image comes back as base64 PNG and the temp file is cleaned up", async () => {
  const png = fakePng(20_000);
  await withFakeShot(png, (result, shotPath) => {
    const image = result.content.find((c) => c.type === "image") as
      | { type: "image"; data: string; mimeType: string }
      | undefined;
    assert.ok(image, "no image content block came back");
    assert.equal(image.mimeType, "image/png");
    assert.equal(image.data, png.toString("base64"));
    assert.equal(existsSync(shotPath), false, "the temp file was left behind");

    const caption = result.content.find((c) => c.type === "text") as { text: string };
    assert.match(caption.text, /MoI's 3D viewport, 1024 x 768, 20000 bytes of PNG, by render, under layout 'split'\./);
    assert.doesNotMatch(caption.text, /blank/, "a full-size frame was called blank");
  });
});

test("a blank-looking window grab is called out rather than passed off as a picture", async () => {
  // MoI photographs a window that is not on screen as a valid, tiny, empty PNG and reports
  // no error. The agent must not read that as "the document is empty".
  await withFakeShot(
    fakePng(622),
    (result) => {
      const caption = result.content.find((c) => c.type === "text") as { text: string };
      assert.match(caption.text, /almost certainly blank/);
      assert.ok(result.content.some((c) => c.type === "image"), "the image was withheld");
    },
    "window",
    { mechanism: "screen grab", width: null, height: null },
  );
});

test("a small render is not called blank — that guard belongs to the screen grab alone", async () => {
  await withFakeShot(fakePng(622), (result) => {
    const caption = result.content.find((c) => c.type === "text") as { text: string };
    assert.doesNotMatch(caption.text, /blank/);
  });
});

test("a render that fell back to a screen grab says so", async () => {
  await withFakeShot(
    fakePng(20_000),
    (result) => {
      const caption = result.content.find((c) => c.type === "text") as { text: string };
      assert.match(caption.text, /by screen grab/);
      assert.match(caption.text, /The render failed \(no such thing\)/);
    },
    "3D",
    { mechanism: "screen grab", fallback: "no such thing", width: null, height: null },
  );
});

test("an oversized window grab is refused; an oversized render is not, having been sized by us", async () => {
  await withFakeShot(
    fakePng(7 * 1024 * 1024),
    (result, shotPath) => {
      assert.equal(result.isError, true);
      const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      assert.match(text, /ceiling/);
      assert.equal(existsSync(shotPath), false, "the temp file was left behind on the error path");
    },
    "window",
    { mechanism: "screen grab", width: null, height: null },
  );

  await withFakeShot(fakePng(7 * 1024 * 1024), (result) => {
    assert.notEqual(result.isError, true, "a render was refused by a screen-grab guard");
  });
});

test("a size alongside the window shot is refused, not ignored", async () => {
  const { SessionHost: Host } = await import("./session.js");
  const host = new Host();
  const result = await runTool(host, getViewTool, { viewport: "window", size: 1024 });
  assert.equal(result.isError, true);
  const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  assert.match(text, /cannot be sized/);
});

test("an unreadable image names the likely cause instead of leaking an errno", async () => {
  const host = new SessionHost();
  await host.start();
  const info = JSON.parse(readFileSync(handshakePath(), "utf8"));
  const missing = join(sandbox, "never-written.png");

  const ws = new WebSocket(
    `ws://127.0.0.1:${info.port}/bridge?token=${info.token}&protocol=${info.protocol}`,
    { origin: "moi://ui" },
  );
  ws.on("error", () => {});
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.t === "ping") return;
    ws.send(
      JSON.stringify({
        id: msg.id,
        ok: true,
        value: { path: missing, viewport: "3D", mechanism: "render", width: 1024, height: 768 },
      }),
    );
  });
  await new Promise((resolve) => ws.once("open", resolve));

  const result = await runTool(host, getViewTool, { viewport: "3D" });
  assert.equal(result.isError, true);
  const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  assert.match(text, /\[not_found\]/);
  assert.match(text, /elevated/);

  ws.close();
  await host.stop();
});

test("framing and drawing travel as one script: the camera moves, then the render, one reply", () => {
  // A render draws from the camera's state, not from the animating pane, so one call is
  // enough — see docs/adr/0005-the-agent-sees-by-rendering.md.
  const { fake, shot } = shoot({ viewport: "3D", frame: [A] }, sceneOf(A));
  const moved = fake.log.indexOf("setCameraAndTarget 3D");
  assert.ok(moved >= 0 && moved < fake.log.findIndex((l) => l.startsWith("render 3D")));
  assert.equal(shot.mechanism, "render");
  assert.equal(shot.framing.framed, true);
  assert.equal(shot.framing.matched, 1);
});

test("no framing argument means no camera move at all", () => {
  const { fake, shot } = shoot({ viewport: "3D" });
  assert.ok(!fake.log.some((l) => /^(setCameraAndTarget|setAngles)/.test(l)), "an unasked-for render moved the camera");
  assert.deepEqual(fake.viewports["3D"].cameraPt, { x: 0, y: -10, z: 0 });
  assert.equal(shot.framing, undefined);
});

test("the framing is reported in the caption, missing ids included", async () => {
  await withFakeShot(
    fakePng(20_000),
    (result) => {
      const caption = result.content.find((c) => c.type === "text") as { text: string };
      assert.match(caption.text, /Framed 1 object\(s\)\./);
      assert.match(caption.text, /Not found, so not framed: \{gone\}\./);
    },
    "3D",
    { framing: { framed: true, matched: 1, missing: ["{gone}"] } },
    { frame: ["{a}", "{gone}"] },
  );
});

test("framing arguments alongside the window shot are refused, not ignored", async () => {
  const host = new SessionHost();
  for (const args of [{ frame: "scene" as const }, { angle: "iso" as const }, { padding: 1 }]) {
    const result = await runTool(host, getViewTool, { viewport: "window", ...args });
    assert.equal(result.isError, true, `${JSON.stringify(args)} was accepted on the window shot`);
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    assert.match(text, /\[bad_request\]/);
    assert.match(text, /no camera to aim/);
  }
});

test("the window shot with frame 'none' is accepted and aims nothing", () => {
  assert.equal(getViewTool.precheck!({ viewport: "window", frame: "none" }), undefined);
  const { fake, shot } = shoot({ viewport: "window", frame: "none" });
  assert.ok(!fake.log.some((l) => /^(setCameraAndTarget|setAngles)/.test(l)), "the window shot moved a camera");
  assert.equal(shot.framing, undefined);
});

test("set_viewport_layout sets each of the five layouts and reports the one MoI ended on", () => {
  for (const layout of LAYOUTS) {
    // A panel that reads back its own spelling: the reply is what MoI ended on, not what was sent.
    const fake = fakeMoi({ mode: "split", modeReadsBack: (v) => v.toUpperCase() });
    assert.deepEqual(runScript(setViewportLayoutTool.script({ layout }), fake.moi), { layout: layout.toUpperCase() });
    assert.equal(fake.moi.ui.mainWindow.viewpanel.mode, layout.toUpperCase());
  }
});

test("an unknown layout is refused with the valid ones named", () => {
  const result = LAYOUT_SCHEMA.safeParse("quad");
  assert.equal(result.success, false);
  assert.ok(result.error!.issues[0].message.includes(LAYOUTS.join(", ")));
});

test("no capture path assigns the layout", () => {
  // Moving the user's screen must be something they see the agent decide to do.
  for (const script of [...VIEW_PANES.map((p) => getViewTool.script({ viewport: p })), getViewTool.script({ viewport: "window" })]) {
    assert.doesNotMatch(script, /\.mode\s*=[^=]/, "a capture path assigns the layout");
  }
});
