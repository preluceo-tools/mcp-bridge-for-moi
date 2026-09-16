/**
 * What several tools share: the ES5 snippets they splice in and the constants that must mean
 * the same thing in each. The framing schemas are in view-schemas.ts. A script only one tool sends lives in that tool's file.
 *
 * `toJson`, `listToJson`, `pt`, `bbox` and `findById` come from the bridge's prelude.
 */

/**
 * The one loop that turns a caller's ids into objects: `{ objects, found, missing }`, in the
 * order given. `found` holds the ids of `objects` as the caller wrote them, not as MoI spells
 * them back. An id given twice counts once. Built on the prelude's `findById`, so a malformed id
 * is reported missing rather than thrown. Spliced into each script that uses it.
 */
export const RESOLVE_IDS = `
function resolveIds( ids ) {
	var objects = [], found = [], missing = [];
	for ( var i = 0; i < ids.length; ++i ) {
		if ( found.indexOf( ids[i] ) >= 0 || missing.indexOf( ids[i] ) >= 0 ) continue;
		var o = findById( ids[i] );
		if ( o ) { objects.push( o ); found.push( ids[i] ); }
		else missing.push( ids[i] );
	}
	return { objects: objects, found: found, missing: missing };
}
`;

/**
 * Runs `fn` with exactly `objs` selected (an empty array: nothing selected), puts the user's
 * selection back in a `finally`, and returns what `fn` returned. Each object is deselected
 * one by one rather than with `deselectAll`, and nothing here redraws: a render taken inside
 * `fn` sees the selection change, the screen never does. See docs/research/probe-08-screenshot.md.
 * Spliced into each script that uses it.
 */
export const WITH_SELECTION = `
function withSelection( objs, fn ) {
	var held = [];
	var sel = moi.geometryDatabase.getSelectedObjects();
	for ( var s = 0; s < sel.length; ++s ) { var so = sel.item( s ); so.selected = false; held.push( so ); }
	try {
		for ( var t = 0; t < objs.length; ++t ) objs[t].selected = true;
		return fn();
	} finally {
		// Whatever happened above, even a MoI call that changed the selection itself, the user
		// gets back exactly the selection they had: whatever is selected now is cleared first.
		var now = moi.geometryDatabase.getSelectedObjects(), off = [];
		for ( var u = 0; u < now.length; ++u ) off.push( now.item( u ) );
		for ( var v = 0; v < off.length; ++v ) off[v].selected = false;
		for ( var r = 0; r < held.length; ++r ) held[r].selected = true;
	}
}
`;

/** The four panes a camera can be pointed at. The whole-window shot is not one of them. */
export const VIEW_PANES = ["3D", "Top", "Front", "Right"] as const;
export type ViewPane = (typeof VIEW_PANES)[number];

/** The four viewport panes MoI names, plus the whole-window shot. */
export const VIEWPORTS = ["3D", "Top", "Front", "Right", "window"] as const;
export type Viewport = (typeof VIEWPORTS)[number];

/**
 * MoI's app-data folder, always ending in the path delimiter. The bridge has its own copy of
 * this function (assets/bridge.js), because it runs before any server script can reach it;
 * change one, change both. Spliced, like `FIND_BY_ID`.
 */
export const APP_DATA_DIR = `
function appDataDir() {
	var dir = moi.filesystem.getAppDataDir();
	var sep = moi.filesystem.getPathDelimiter();
	return dir.charAt( dir.length - 1 ) === sep ? dir : dir + sep;
}
`;

/** MoI's `viewpanel.mode` values: all four panes, or one of them alone. */
export const LAYOUTS = ["split", "3d", "top", "front", "right"] as const;
export type Layout = (typeof LAYOUTS)[number];

/** The long edge a render defaults to, and the most it will draw. The cap is for the payload,
 * not for speed: 2400 x 2400 renders in 242 ms. */
export const DEFAULT_LONG_EDGE = 1024;
export const MAX_LONG_EDGE = 2048;

/**
 * Named angles, as `setAngles` wants them: `[ upDown, leftRight ]` - the reverse of the
 * property names, so `setAngles( 10, 70 )` reads back as `upDownAngle: 10, leftRightAngle: 70`.
 *
 * `upDownAngle` is measured from straight down: 0 looks along -Z (a top view) and 90 sits on
 * the horizon. At 0 the left/right angle is gimbal-locked and reads back as 0 whatever is
 * passed, which is why `top` pairs it with 0. `iso` is the front-left octant 35.264 degrees
 * above the horizon - MoI's own default - hence 90 - 35.264.
 *
 * Every row verified live: each one put the camera on the axis it names, with `iso` at equal
 * -x, -y, +z offsets. See docs/research/probe-08-screenshot.md.
 */
export const NAMED_ANGLES = {
	iso: [54.7356, -45],
	front: [90, 0],
	back: [90, 180],
	left: [90, -90],
	right: [90, 90],
	top: [0, 0],
} as const;
export type NamedAngle = keyof typeof NAMED_ANGLES;
export const NAMED_ANGLE_NAMES = Object.keys(NAMED_ANGLES) as [NamedAngle, ...NamedAngle[]];

/**
 * A parallel viewport's `fieldOfViewAngle` is not an angle at all. It is a scale knob:
 * **one degree is one world unit measured across the smaller of the render's two
 * dimensions**, and nothing else moves it - not the camera's distance, not the pane's pixel
 * size, not the size the render is asked for.
 *
 * That is why the perspective formula is wrong here. `distance * tan( fov / 2 )` is the
 * visible half-extent of a perspective view; in a parallel one it predicts an extent that has
 * nothing to do with what comes back.
 *
 * Calibrated against a 10-unit box in `Top` at four field-of-view and render-size
 * combinations, counted out of the rendered PNG; the smaller dimension read the field of view
 * back exactly every time. The measurements are in docs/research/probe-08-screenshot.md, and
 * this constant is pinned by a test because a measured number drifts if nobody watches it.
 */
export const PARALLEL_UNITS_PER_DEGREE = 1;

/** The `fieldOfViewAngle` that shows `radius` either side of a parallel viewport's target. */
export const parallelFieldOfView = (radius: number): number =>
	(2 * radius) / PARALLEL_UNITS_PER_DEGREE;

/**
 * How far a parallel camera stands from its target, in multiples of the framed radius. Any
 * distance clear of the geometry draws the same picture, because a parallel view's scale is
 * its field of view alone; four radii is comfortably clear.
 */
const PARALLEL_STANDOFF = 4;

/** Air around the subject, as a fraction of the framed radius (see the composed script below). */
export const DEFAULT_PADDING = 0.35;

/** What to point the camera at: some object ids, or one of the three standing subjects. */
export type FrameSubject = string[] | "selection" | "scene" | "none";

export type ViewAngle = NamedAngle | { upDown: number; leftRight: number };

/**
 * Points one viewport at something and reports where the camera ended up, as a function body:
 * `set_view` sends it as is, `get_view` wraps it ahead of its shot. No image - that is the
 * render's job - and no selection change: framing by id reads the bounding boxes
 * directly rather than going through `reset()`, which frames the selection and reads one
 * bridge call stale. See docs/adr/0005-the-agent-sees-by-rendering.md.
 */
export function frameScript(opts: {
	viewport: ViewPane;
	frame: FrameSubject;
	angle?: ViewAngle;
	padding?: number;
}): string {
	const padding = opts.padding ?? DEFAULT_PADDING;
	const angle =
		opts.angle === undefined
			? null
			: typeof opts.angle === "string"
				? NAMED_ANGLES[opts.angle]
				: [opts.angle.upDown, opts.angle.leftRight];

	const gather =
		opts.frame === "none"
			? ""
			: opts.frame === "selection"
				? `
var sel = db.getSelectedObjects();
if ( sel.length === 0 ) throw new Error( 'Nothing is selected in MoI, so there is nothing to frame. Name the object ids to frame, or frame "scene".' );
for ( var i = 0; i < sel.length; ++i ) { add( sel.item( i ) ); ++found; }
`
				: opts.frame === "scene"
					? `
var objs = db.getObjects();
for ( var i = 0; i < objs.length; ++i ) {
	var o = objs.item( i );
	if ( !o.hidden ) { add( o ); ++found; }
}
`
					: `${RESOLVE_IDS}
var hit = resolveIds( ${JSON.stringify(opts.frame)} );
missing = hit.missing;
for ( var i = 0; i < hit.objects.length; ++i ) { add( hit.objects[i] ); ++found; }
`;

	return `
var name = ${JSON.stringify(opts.viewport)};
var vp = moi.ui.mainWindow.viewpanel.getViewport( name );
if ( !vp ) throw new Error( 'MoI has no viewport named ' + name );
var parallel = ( vp.projection !== 'Perspective' );
var angle = ${angle === null ? "null" : `[ ${angle[0]}, ${angle[1]} ]`};

// Rejected rather than ignored: a parallel pane always looks down its own axis, and an agent
// that asks it to orbit has the wrong model of MoI's viewports. Silence lets it keep one.
if ( angle && parallel ) {
	throw new Error( 'The ' + name + ' viewport is a parallel projection and always looks down its own axis, so it cannot be given an angle. Ask the 3D viewport for an angle, or drop the angle here.' );
}

var db = moi.geometryDatabase;
var vm = moi.vectorMath;
var missing = [];
var found = 0;
var lo = null, hi = null;

function add( o ) {
	var b = bbox( o );
	if ( !b ) return;
	if ( !lo ) {
		lo = { x: b.min.x, y: b.min.y, z: b.min.z };
		hi = { x: b.max.x, y: b.max.y, z: b.max.z };
		return;
	}
	if ( b.min.x < lo.x ) lo.x = b.min.x;
	if ( b.min.y < lo.y ) lo.y = b.min.y;
	if ( b.min.z < lo.z ) lo.z = b.min.z;
	if ( b.max.x > hi.x ) hi.x = b.max.x;
	if ( b.max.y > hi.y ) hi.y = b.max.y;
	if ( b.max.z > hi.z ) hi.z = b.max.z;
}

function state( framed, note ) {
	return {
		viewport: name,
		projection: vp.projection,
		framed: framed,
		matched: found,
		missing: missing,
		note: note,
		camera: pt( vp.cameraPt ),
		target: pt( vp.targetPt ),
		fieldOfViewAngle: vp.fieldOfViewAngle,
		leftRightAngle: vp.leftRightAngle,
		upDownAngle: vp.upDownAngle,
		tiltAngle: vp.tiltAngle
	};
}

// Before the framing, so the framing reads the direction the agent asked for.
if ( angle ) vp.setAngles( angle[0], angle[1] );
${gather}
if ( !lo ) {
	moi.ui.redrawViewports();
	return state( false, ${
		opts.frame === "none"
			? "'The camera was left where it was.'"
			: "'There was nothing to frame, so the camera was left where it was.'"
	} );
}

var centre = vm.createPoint( ( lo.x + hi.x ) / 2, ( lo.y + hi.y ) / 2, ( lo.z + hi.z ) / 2 );
var dx = hi.x - lo.x, dy = hi.y - lo.y, dz = hi.z - lo.z;

var cam = vp.cameraPt, tgt = vp.targetPt;
var vx = cam.x - tgt.x, vy = cam.y - tgt.y, vz = cam.z - tgt.z;
var len = Math.sqrt( vx * vx + vy * vy + vz * vz );
// A degenerate camera is not something MoI produces, but dividing by it would be silent.
if ( len < 1e-9 ) { vx = 0; vy = 0; vz = 1; len = 1; }
vx /= len; vy /= len; vz /= len;

var radius;
if ( parallel ) {
	// A parallel pane looks down one axis, so the box it sees is the other two: fit the longer
	// side of that, the way a person would frame it.
	var ax = Math.abs( vx ), ay = Math.abs( vy ), az = Math.abs( vz );
	radius = ( az >= ax && az >= ay ? Math.max( dx, dy ) : ay >= ax ? Math.max( dx, dz ) : Math.max( dy, dz ) ) / 2;
} else {
	// The bounding sphere, so the subject stays in frame whatever the angle.
	radius = Math.sqrt( dx * dx + dy * dy + dz * dz ) / 2;
}
// A single point, or a line seen end-on: nothing to scale to, so pick a size rather than
// divide by zero.
if ( radius < 1e-9 ) radius = 1;
var wanted = radius * ( 1 + ${padding} );

var dist;
if ( parallel ) {
	// The field of view is the whole of it here: one degree is one world unit across the
	// render's smaller dimension. The distance only has to stand clear of the geometry.
	vp.fieldOfViewAngle = 2 * wanted / ${PARALLEL_UNITS_PER_DEGREE};
	dist = wanted * ${PARALLEL_STANDOFF};
} else {
	// Perspective: the distance is the whole of it, at whatever field of view the pane has.
	dist = wanted / Math.tan( vp.fieldOfViewAngle * Math.PI / 360 );
}

vp.setCameraAndTarget(
	vm.createPoint( centre.x + vx * dist, centre.y + vy * dist, centre.z + vz * dist ),
	centre
);
moi.ui.redrawViewports();
return state( true, null );
`;
}
