import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parallelFieldOfView,
  PARALLEL_UNITS_PER_DEGREE,
  NAMED_ANGLES,
  VIEW_PANES,
  DEFAULT_PADDING,
  type FrameSubject,
  type ViewAngle,
  type ViewPane,
} from "./scripts.js";
import { A, B, fakeMoi, guid, runScript, type Pt } from "./fake-moi.js";
import { setViewTool } from "./tools/set-view.js";
import { getViewTool } from "./tools/get-view.js";

/**
 * The calibration this ticket turned on, pinned so it cannot drift unnoticed.
 *
 * A parallel viewport's `fieldOfViewAngle` is world units across the smaller of the render's
 * two dimensions, one unit per degree. Measured in `Top` against a 10-unit box: at
 * fieldOfViewAngle 20 the box filled 200 of a 400-pixel render (20 units across), at 40 it
 * filled 100 (40 units), and at 10 in a 600 x 300 render it filled the 300-pixel height (10
 * units). Independent of camera distance and of the pane's own pixel size. The full table is
 * in docs/research/probe-08-screenshot.md.
 *
 * If MoI ever changes this, these numbers are what says so.
 */
test("the parallel-projection constant still means one unit per degree", () => {
  assert.equal(PARALLEL_UNITS_PER_DEGREE, 1);
  // A 10-unit box, centred: half-extent 5, so the pane must show 10 units across.
  assert.equal(parallelFieldOfView(5), 10);
  assert.equal(parallelFieldOfView(20), 40);
});

type FrameArgs = { viewport: ViewPane; frame: FrameSubject; angle?: ViewAngle; padding?: number };

/** Both tools that frame, run on the fake: set_view returns the framing, get_view carries it. */
const VIA = {
  set_view: (args: FrameArgs, moi: unknown) => runScript(setViewTool.script(args), moi),
  get_view: (args: FrameArgs, moi: unknown) => runScript(getViewTool.script(args), moi).framing,
};

/** Centre (10, 10, 1); a 6 x 8 face, so the bounding sphere's radius is 5. */
const BOX = { min: { x: 7, y: 6, z: 1 }, max: { x: 13, y: 14, z: 1 } };
const CENTRE = { x: 10, y: 10, z: 1 };

function near(actual: Pt, expected: Pt, what: string) {
  for (const k of ["x", "y", "z"] as const) {
    assert.ok(Math.abs(actual[k] - expected[k]) < 1e-9, `${what}.${k} is ${actual[k]}, expected ${expected[k]}`);
  }
}

for (const [via, frame] of Object.entries(VIA)) {
  test(`${via}: a perspective pane stands back radius * (1 + padding) / tan(fov / 2) along its line of sight`, () => {
    // 3D starts at (0, -10, 0) looking at the origin with a 90-degree field of view, so tan is 1.
    const fake = fakeMoi({ objects: [{ id: A, bbox: BOX }] });
    const state = frame({ viewport: "3D", frame: [A], padding: 1 }, fake.moi);
    assert.equal(state.framed, true);
    assert.equal(state.matched, 1);
    near(state.target, CENTRE, "target");
    near(state.camera, { x: 10, y: 10 - 5 * 2, z: 1 }, "camera");
    assert.equal(state.fieldOfViewAngle, 90, "a perspective framing moved the field of view");
  });

  test(`${via}: a parallel pane fits the longer side of the box it sees, not the sphere`, () => {
    // Top sees 6 x 8, so half the longer side is 4; the sphere would have been 5.
    const fake = fakeMoi({ objects: [{ id: A, bbox: BOX }] });
    const state = frame({ viewport: "Top", frame: "scene" }, fake.moi);
    const wanted = 4 * (1 + DEFAULT_PADDING);
    assert.equal(state.fieldOfViewAngle, parallelFieldOfView(wanted));
    assert.equal(fake.viewports.Top.fieldOfViewAngle, 2 * wanted / PARALLEL_UNITS_PER_DEGREE);
    near(state.target, CENTRE, "target");
    // Stands clear of the geometry, looking down its own axis.
    near(state.camera, { x: 10, y: 10, z: 1 + wanted * 4 }, "camera");
  });

  test(`${via}: Front and Right each drop their own depth axis`, () => {
    const TALL = { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 10, z: 4 } };
    const fov = (viewport: "Front" | "Right") =>
      frame({ viewport, frame: "scene", padding: 0 }, fakeMoi({ objects: [{ id: A, bbox: TALL }] }).moi).fieldOfViewAngle;
    assert.equal(fov("Front"), parallelFieldOfView(2)); // sees x 2, z 4
    assert.equal(fov("Right"), parallelFieldOfView(5)); // sees y 10, z 4
  });

  test(`${via}: a named angle is applied before the framing, as setAngles( upDown, leftRight )`, () => {
    // setAngles( 10, 70 ) reads back as upDownAngle 10, leftRightAngle 70 — verified live.
    assert.deepEqual(NAMED_ANGLES.front, [90, 0]);
    const fake = fakeMoi({
      objects: [{ id: A, bbox: BOX }],
      viewports: { "3D": { cameraPt: { x: 10, y: 0, z: 0 }, leftRightAngle: 90 } },
    });
    const state = frame({ viewport: "3D", frame: [A], angle: "front", padding: 1 }, fake.moi);
    assert.ok(fake.log.indexOf("setAngles 90,0") >= 0, "front was not sent as setAngles( 90, 0 )");
    assert.ok(fake.log.indexOf("setAngles 90,0") < fake.log.indexOf("setCameraAndTarget 3D"));
    // Framed from the front, whatever side the camera started on.
    near(state.camera, { x: 10, y: 0, z: 1 }, "camera");
    assert.equal(state.upDownAngle, 90);
    assert.equal(state.leftRightAngle, 0);

    const custom = fakeMoi();
    frame({ viewport: "3D", frame: "none", angle: { upDown: 10, leftRight: 70 } }, custom.moi);
    assert.deepEqual(custom.log.filter((l) => l.startsWith("setAngles")), ["setAngles 10,70"]);
  });

  test(`${via}: an angle on a parallel pane is refused, not quietly dropped`, () => {
    for (const viewport of ["Top", "Front", "Right"] as const) {
      const fake = fakeMoi({ objects: [{ id: A, bbox: BOX }] });
      assert.throws(() => frame({ viewport, frame: "scene", angle: "iso" }, fake.moi), /cannot be given an angle/);
      assert.deepEqual(fake.log, [], `${viewport} moved before refusing`);
    }
  });

  test(`${via}: framing the selection with nothing selected is an error; an empty scene is not`, () => {
    assert.throws(
      () => frame({ viewport: "3D", frame: "selection" }, fakeMoi({ objects: [{ id: A }] }).moi),
      /Nothing is selected/,
    );
    const selected = frame({ viewport: "3D", frame: "selection" }, fakeMoi({ objects: [{ id: A, selected: true }] }).moi);
    assert.equal(selected.matched, 1);

    const empty = fakeMoi();
    const state = frame({ viewport: "3D", frame: "scene" }, empty.moi);
    assert.equal(state.framed, false);
    assert.match(state.note, /There was nothing to frame, so the camera was left where it was/);
    near(state.camera, { x: 0, y: -10, z: 0 }, "camera");
    assert.ok(!empty.log.includes("setCameraAndTarget 3D"));
  });

  test(`${via}: the scene is every visible object`, () => {
    const fake = fakeMoi({
      objects: [
        { id: A, bbox: BOX },
        { id: B, hidden: true, bbox: { min: { x: -99, y: -99, z: -99 }, max: { x: 99, y: 99, z: 99 } } },
      ],
    });
    const state = frame({ viewport: "Top", frame: "scene" }, fake.moi);
    assert.equal(state.matched, 1);
    near(state.target, CENTRE, "target");
  });

  test(`${via}: ids that are not there are reported missing, and the rest framed`, () => {
    const fake = fakeMoi({ objects: [{ id: A, bbox: BOX }] });
    const state = frame({ viewport: "3D", frame: [A, guid(99), "not-a-guid"] }, fake.moi);
    assert.equal(state.matched, 1);
    assert.deepEqual(state.missing, [guid(99), "not-a-guid"]);
    near(state.target, CENTRE, "target");
  });

  test(`${via}: framing by id leaves the selection untouched`, () => {
    const fake = fakeMoi({ objects: [{ id: A, bbox: BOX }, { id: B, selected: true }] });
    frame({ viewport: "3D", frame: [A] }, fake.moi);
    assert.deepEqual(fake.selectedIds(), [B]);
    // The framing ends at its redraw; get_view's render borrows the selection after that.
    const framing = fake.log.slice(0, fake.log.indexOf("redraw"));
    assert.deepEqual(framing.filter((l) => /select/i.test(l)), [], "framing by id touched the selection");
  });

  test(`${via}: a single point is framed at radius 1 rather than divided by`, () => {
    const p = { x: 2, y: 3, z: 4 };
    const fake = fakeMoi({ objects: [{ id: A, bbox: { min: p, max: p } }] });
    const state = frame({ viewport: "3D", frame: [A], padding: 0 }, fake.moi);
    near(state.target, p, "target");
    near(state.camera, { x: 2, y: 3 - 1, z: 4 }, "camera");
  });

  test(`${via}: a camera sitting on its target looks down from above rather than dividing by zero`, () => {
    const fake = fakeMoi({ objects: [{ id: A, bbox: BOX }], viewports: { "3D": { cameraPt: { x: 0, y: 0, z: 0 } } } });
    const state = frame({ viewport: "3D", frame: [A], padding: 1 }, fake.moi);
    near(state.camera, { x: 10, y: 10, z: 1 + 10 }, "camera");
  });
}
