/**
 * The factory sweep's table: one entry per factory in assets/factories.json, run in this order.
 *
 * - `commit: false` is skipped with its `reason`.
 * - An entry with `expect` is committed: `setup` builds what the factory needs, `inputs` sets
 *   them on `f`, and the reply is checked against `expect`.
 * - Any other entry is created, read and cancelled, and is marked `unverified`: it has not
 *   been proved to commit live, so the table does not claim it does.
 *
 * `setup` and `inputs` are ES5 run inside MoI, with these helpers in scope:
 *   P(x, y, z)        a point
 *   F(x, y, z)        a top (world XY) frame with its origin at the point
 *   make(name, set)   commits factory `name` after `set(g)` has set its inputs; returns the
 *                     one object it created (throws on any other count)
 *   L(a, b, ...)      an object list of the given objects (or of their edges/faces)
 *   box(x, y, z, w)   a w-sided box (default 10) with its corner at the point
 *   line(a, b)        a line between two points
 *   circle(frame, r)  a circle in the frame's plane
 *   plane(x)          a 10 × 6 plane with its corner at (x, 0, 0)
 *   IMG               the path of a PNG that ships with MoI
 *   bg0               the number of background images before the run
 */
export type Expect = {
  /** Objects the commit created, and the typeName (see toJson in the prelude) of every one. */
  created?: { count: number; typeName: string };
  /** Names of `setup` variables whose objects the commit must have consumed. */
  consumed?: string[];
  /** An ES5 expression read after commit(); must be true. */
  value?: string;
};

export type FactoryEntry = {
  name: string;
  commit?: false;
  reason?: string;
  setup?: string;
  inputs?: string;
  /** Call calculate() instead of update(): the calc* factories fail update() with "Operation failed". */
  calc?: true;
  expect?: Expect;
};

/** Creates the factory, reads its inputs, and cancels it whatever happens. */
export const probeScript = (name: string) => `var f = moi.command.createFactory( ${JSON.stringify(name)} );
try {
  var inputs = [];
  for ( var i = 0; i < f.numInputs; ++i ) {
    var inp = f.getInput( i );
    inputs.push( { name: inp.name, type: inp.type } );
  }
  return { numInputs: f.numInputs, inputs: inputs };
} finally {
  f.cancel();
}`;

/**
 * Runs `setup`, commits the factory, and deletes everything the run added (objects and
 * background images), whatever happens.
 * Replies `{ error, created: [typeName], consumed: { var: bool }, value }`.
 */
export const commitScript = (e: FactoryEntry) => `var db = moi.geometryDatabase, V = moi.vectorMath;
function idMap() {
  var o = db.getObjects(), m = {};
  for ( var i = 0; i < o.length; ++i ) m[ o.item( i ).id ] = o.item( i );
  return m;
}
function P( x, y, z ) { return V.createPoint( x, y, z || 0 ); }
function F( x, y, z ) { var fr = V.createTopFrame(); fr.origin = P( x || 0, y || 0, z || 0 ); return fr; }
function L() {
  var l = db.createObjectList();
  for ( var i = 0; i < arguments.length; ++i ) l.addObject( arguments[ i ] );
  return l;
}
function make( name, set ) {
  var b = idMap();
  var g = moi.command.createFactory( name );
  try { set( g ); g.commit(); } catch ( ex ) { g.cancel(); throw ex; }
  var a = idMap(), made = [];
  for ( var id in a ) if ( !b[ id ] ) made.push( a[ id ] );
  if ( made.length !== 1 ) throw new Error( 'setup: ' + name + ' made ' + made.length + ' objects' );
  return made[ 0 ];
}
function box( x, y, z, w ) { return make( 'box', function ( g ) { g.setInput( 0, F( x, y, z ) ); g.setInput( 2, w || 10 ); g.setInput( 3, w || 10 ); g.setInput( 4, w || 10 ); } ); }
function line( a, b ) { return make( 'line', function ( g ) { g.setInput( 0, a ); g.setInput( 1, b ); g.setInput( 2, false ); } ); }
function circle( fr, r ) { return make( 'circle', function ( g ) { g.setInput( 0, true ); g.setInput( 1, fr ); g.setInput( 3, r ); g.setInput( 4, false ); } ); }
function plane( x ) { return make( 'plane', function ( g ) { g.setInput( 0, F( x || 0, 0 ) ); g.setInput( 2, 10 ); g.setInput( 3, 6 ); } ); }
var IMG = moi.filesystem.getCommandsDir().replace( /commands\\\\?$/i, '' ) + 'docs\\\\icons\\\\LineIcon.png';
var bg0 = moi.view.getBackgroundImages().length;
var before = idMap(), out = { error: null, created: [], consumed: {}, value: null };
try {
${e.setup ?? ""}
  var held = { ${(e.expect?.consumed ?? []).map((v) => `${JSON.stringify(v)}: ${v}.id`).join(", ")} };
  var mid = idMap();
  var f = moi.command.createFactory( ${JSON.stringify(e.name)} );
  try {
${e.inputs ?? ""}
    f.${e.calc ? "calculate" : "update"}();
    f.commit();
  } catch ( ex ) { f.cancel(); throw ex; }
  ${e.expect?.value ? `out.value = ( ${e.expect.value} );` : ""}
  var after = idMap();
  for ( var id in after ) if ( !mid[ id ] ) out.created.push( toJson( after[ id ] ).typeName );
  for ( var k in held ) out.consumed[ k ] = !after[ held[ k ] ];
} catch ( ex ) {
  out.error = String( ex );
} finally {
  var end = idMap();
  for ( var d in end ) if ( !before[ d ] ) db.removeObject( end[ d ] );
  for ( var n = 0; n < 8 && moi.view.getBackgroundImages().length > bg0; ++n ) {
    var imgs = moi.view.getBackgroundImages();
    imgs.item( imgs.length - 1 ).remove();
  }
}
return out;`;

/** Why a commitScript reply does not match its entry's `expect`; empty when it does. */
export function checkCommit(
  e: FactoryEntry,
  r: { error: string | null; created: string[]; consumed: Record<string, boolean>; value: unknown },
): string[] {
  if (r.error) return [r.error];
  const problems: string[] = [];
  const want = e.expect ?? {};
  if (want.created) {
    const { count, typeName } = want.created;
    const bad = r.created.filter((t) => t !== typeName);
    if (r.created.length !== count || bad.length)
      problems.push(`created [${r.created.join(", ")}], expected ${count} × ${typeName}`);
  }
  for (const v of want.consumed ?? []) if (!r.consumed[v]) problems.push(`${v} was not consumed`);
  if (want.value && r.value !== true) problems.push(`value check \`${want.value}\` gave ${JSON.stringify(r.value)}`);
  return problems;
}

/** `f.setInput( i, v );` for each index → ES5 value. */
const si = (m: Record<number, string>) =>
  Object.entries(m)
    .map(([i, v]) => `f.setInput( ${i}, ${v} );`)
    .join(" ");

/** The curve family: one createInput( 'point' ) per vertex (probe-07). */
const pts = (...p: string[]) => p.map((v, i) => `f.createInput( 'point' ); f.setInput( ${i}, ${v} );`).join(" ");

const one = (typeName: string) => ({ count: 1, typeName });
const BOX = "var a = box( 0, 0, 0 );";
const TWO_BOXES = "var a = box( 0, 0, 0 ), b = box( 5, 5, 5 );";
const RECT = "var a = make( 'rectangle', function ( g ) { g.setInput( 0, F() ); g.setInput( 2, 10 ); g.setInput( 3, 6 ); g.setInput( 4, false ); } );";
const SPHERE = (r: number, z = 0) =>
  `make( 'sphere', function ( g ) { g.setInput( 0, true ); g.setInput( 1, F( 0, 0, ${z} ) ); g.setInput( 3, ${r} ); } )`;
const BG_IMAGE = "var g0 = moi.command.createFactory( 'backgroundimage' ); g0.setInput( 0, IMG ); g0.setInput( 1, F() ); g0.setInput( 2, P( 10, 10 ) ); g0.commit(); var imgs0 = moi.view.getBackgroundImages(); var im = imgs0.item( imgs0.length - 1 );";
const MOVED = { created: one("brep"), consumed: ["a"] };
const BOX_SIZES = si({ 0: "F()", 2: "10", 3: "6", 4: "4" });
const PLANE_SIZES = si({ 0: "F()", 2: "10", 3: "6" });
const RECT_SIZES = si({ 0: "F()", 2: "10", 3: "6", 4: "false" });
const CYLINDER = si({ 0: "true", 1: "F()", 3: "2", 4: "P( 0, 0, 5 )" }); // End pt, not Height (probe-12)
const POLYGON = si({ 0: "F()", 1: "P( 5, 0 )", 2: "6", 3: "false" });
const DIM = (end: string) => si({ 0: "F()", 1: end, 2: "P( 5, 5 )", 3: "0" });
const BOOL2 = si({ 0: "L( a )", 1: "L( b )", 2: "false" });
const GIZMO = (grip: number, drag: string, ref: string) =>
  si({ 0: "L( a )", 1: "F()", 2: "10", 3: "10", 4: `${grip}`, 5: drag, 6: ref, 7: "2", 8: "false", 9: "false", 10: "false" });
const CALC = (expected: number) => `Math.abs( f.getInput( 1 ).getValue() - ${expected} ) < 1e-6`;
const PICKED = (what: string) =>
  `Its ${what} must come from a point picker snapped onto a curve (GetPointOsnappedOnCurve); a plain point carries no curve.`;

export const FACTORY_TABLE: FactoryEntry[] = [
  {
    name: "addpoint",
    commit: false,
    reason:
      "Takes its point from a point picker bound with setSnapFunc(); it has no point input to set. Tried: a selected circle with Is corner false, nothing created.",
  },
  { name: "addpointsrf", setup: "var a = plane();", inputs: si({ 0: "a.getFaces().item( 0 )", 1: "P( 5, 3 )", 2: "'u'", 3: "false" }), expect: MOVED },
  { name: "align", setup: "var a = box( 0, 0, 0 ), b = box( 20, 5, 0, 4 );", inputs: si({ 0: "L( a, b )", 1: "F()", 2: "'left'", 3: "false" }), expect: { created: { count: 2, typeName: "brep" }, consumed: ["a", "b"] } },
  // Moves an image, not an object: nothing is created, and the image must still be there.
  { name: "alignbackgroundimage", setup: BG_IMAGE, inputs: `f.setImage( im ); ${si({ 0: "P( 0, 0 )", 1: "P( 10, 0 )", 2: "P( 0, 0 )", 3: "P( 20, 0 )" })}`, expect: { created: { count: 0, typeName: "none" }, value: "moi.view.getBackgroundImages().length === bg0 + 1" } },
  { name: "annotationtext", inputs: si({ 0: "F()", 1: "'hi'", 2: "0" }), expect: { created: one("unknown") } },
  { name: "arc3pt", inputs: si({ 0: "P( 0, 0 )", 1: "P( 10, 0 )", 2: "P( 5, 3 )" }), expect: { created: one("curve") } },
  { name: "arccenter", inputs: si({ 0: "F()", 1: "P( 5, 0 )", 2: "P( 0, 5 )", 4: "false" }), expect: { created: one("curve") } },
  { name: "arccontinue", commit: false, reason: `${PICKED("start point")} Tried: a start point at the end of a line, with and without Angle, nothing created.` },
  { name: "arctangent", commit: false, reason: `${PICKED("two tangent points")} Tried: points on two lines, nothing created.` },
  { name: "arraycircular", setup: BOX, inputs: si({ 0: "L( a )", 1: "F( -20, 0 )", 2: "4", 3: "360" }), expect: { created: { count: 3, typeName: "brep" } } },
  { name: "arraycurve", setup: "var a = box( 0, 0, 0, 1 ), b = line( P( 0, 0 ), P( 20, 0 ) );", inputs: si({ 0: "L( a )", 1: "b", 3: "3" }), expect: { created: { count: 2, typeName: "brep" } } },
  { name: "arraydir", setup: BOX, inputs: si({ 0: "L( a )", 1: "3", 2: "P( 0, 0 )", 3: "P( 20, 0 )" }), expect: { created: { count: 2, typeName: "brep" } } },
  // A gem plus its base circle, placed along a curve on a surface (MoI's command reference).
  { name: "arraygem", setup: `var g = ${SPHERE(0.5, 0.5)}, c = circle( F(), 0.5 ), p = plane(), l = line( P( 1, 3 ), P( 9, 3 ) );`, inputs: si({ 0: "L( g, c )", 1: "L( p, l )", 2: "0.2" }), expect: { created: { count: 7, typeName: "brep" } } },
  { name: "arraygrid", setup: BOX, inputs: si({ 0: "F()", 2: "20", 3: "20", 4: "20", 6: "2", 7: "2", 8: "1", 9: "L( a )" }), expect: { created: { count: 3, typeName: "brep" } } },
  { name: "arrow3d", inputs: si({ 0: "P( 0, 0 )", 1: "P( 10, 0 )" }), expect: { created: one("unknown") } },
  { name: "backgroundimage", inputs: si({ 0: "IMG", 1: "F()", 2: "P( 10, 10 )" }), expect: { created: { count: 0, typeName: "none" }, value: "moi.view.getBackgroundImages().length === bg0 + 1" } },
  { name: "blend", setup: "var a = line( P( 0, 0 ), P( 10, 0 ) ), b = line( P( 15, 5 ), P( 25, 5 ) );", inputs: si({ 0: "L( a, b )" }), expect: { created: one("curve") } },
  { name: "booleandifference", setup: TWO_BOXES, inputs: BOOL2, expect: { created: one("brep"), consumed: ["a", "b"] } },
  { name: "booleanintersection", setup: TWO_BOXES, inputs: BOOL2, expect: { created: one("brep"), consumed: ["a", "b"] } },
  { name: "booleanmerge", setup: TWO_BOXES, inputs: si({ 0: "L( a, b )" }), expect: { created: { count: 3, typeName: "brep" }, consumed: ["a", "b"] } },
  { name: "booleanunion", setup: TWO_BOXES, inputs: si({ 0: "L( a, b )" }), expect: { created: one("brep"), consumed: ["a", "b"] } },
  { name: "boundingbox", setup: BOX, inputs: si({ 0: "L( a )" }), expect: { created: one("brep") } },
  { name: "boundingboxcenter", setup: BOX, inputs: si({ 0: "L( a )" }), expect: { created: one("point") } },
  { name: "box", inputs: BOX_SIZES, expect: { created: one("brep") } },
  { name: "box3pts", inputs: si({ 0: "P( 0, 0 )", 1: "P( 10, 0 )", 2: "P( 10, 6 )", 6: "P( 10, 6, 4 )" }), expect: { created: one("brep") } },
  { name: "boxcenter", inputs: BOX_SIZES, expect: { created: one("brep") } },
  { name: "calcarea", setup: BOX, inputs: si({ 0: "L( a )" }), calc: true, expect: { created: { count: 0, typeName: "none" }, value: CALC(600) } },
  { name: "calclength", setup: "var a = line( P( 0, 0 ), P( 10, 0 ) );", inputs: si({ 0: "L( a )" }), calc: true, expect: { created: { count: 0, typeName: "none" }, value: CALC(10) } },
  { name: "calcvolume", setup: BOX, inputs: si({ 0: "L( a )" }), calc: true, expect: { created: { count: 0, typeName: "none" }, value: CALC(1000) } },
  // Corners (type 9) stays unset.
  { name: "chamfer", setup: BOX, inputs: si({ 0: "L( a.getEdges().item( 0 ) )", 1: "false", 3: "1", 4: "1" }), expect: MOVED },
  { name: "circle", inputs: si({ 0: "true", 1: "F()", 3: "2", 4: "false" }), expect: { created: one("curve") } },
  { name: "circle3pt", inputs: si({ 0: "P( 0, 0 )", 1: "P( 4, 0 )", 2: "P( 2, 2 )" }), expect: { created: one("curve") } },
  { name: "circlediameter", inputs: si({ 0: "F()", 1: "P( 4, 0 )", 2: "false" }), expect: { created: one("curve") } },
  { name: "circletangent", commit: false, reason: `${PICKED("two tangent points")} Tried: points on two lines with a radius, nothing created.` },
  { name: "cone", inputs: CYLINDER, expect: { created: one("brep") } },
  { name: "conic", inputs: si({ 0: "P( 0, 0 )", 1: "P( 10, 0 )", 2: "P( 5, 5 )", 4: "0.5" }), expect: { created: one("curve") } },
  { name: "copy", setup: BOX, inputs: si({ 0: "L( a )", 1: "P( 0, 0 )", 2: "P( 20, 0 )", 3: "true" }), expect: { created: one("brep") } },
  { name: "curve", inputs: pts("P( 0, 0 )", "P( 10, 0 )", "P( 10, 10 )", "P( 0, 10 )"), expect: { created: one("curve") } },
  { name: "cylinder", inputs: CYLINDER, expect: { created: one("brep") } },
  { name: "delete", setup: BOX, inputs: si({ 0: "L( a )" }), expect: { created: { count: 0, typeName: "none" }, consumed: ["a"] } },
  { name: "dimaligned", inputs: si({ 0: "F()", 1: "P( 10, 10 )", 2: "P( 0, 10 )", 3: "0" }), expect: { created: one("unknown") } },
  { name: "dimangle", inputs: si({ 0: "F()", 1: "P( 10, 0 )", 2: "P( 0, 10 )", 3: "P( 5, 5 )", 4: "0" }), expect: { created: one("unknown") } },
  { name: "dimhorizontal", inputs: DIM("P( 10, 0 )"), expect: { created: one("unknown") } },
  {
    name: "dimradius",
    commit: false,
    reason:
      "calculate() returns nothing from a script. Tried: a circle, alone and in a list, with type Radius, Diameter and FromPreset; the stock command restricts its point picker to the circle's plane, which a script cannot supply.",
  },
  { name: "dimvertical", inputs: DIM("P( 0, 10 )"), expect: { created: one("unknown") } },
  { name: "drag", setup: BOX, inputs: si({ 0: "L( a )", 1: "P( 0, 0 )", 2: "P( 20, 0 )", 3: "false" }), expect: MOVED },
  { name: "ellipse", inputs: si({ 0: "P( 0, 0 )", 1: "P( 5, 0 )", 2: "P( 0, 3 )" }), expect: { created: one("curve") } },
  { name: "ellipsecorner", inputs: PLANE_SIZES, expect: { created: one("curve") } },
  { name: "ellipsediameter", inputs: si({ 0: "P( -5, 0 )", 1: "P( 5, 0 )", 2: "P( 0, 3 )" }), expect: { created: one("curve") } },
  { name: "explodemove", setup: TWO_BOXES, inputs: si({ 0: "L( a, b )", 1: "2", 2: "P( 0, 0 )" }), expect: { created: { count: 2, typeName: "brep" }, consumed: ["a", "b"] } },
  { name: "extend", setup: "var a = line( P( 0, 0 ), P( 5, 0 ) ), b = line( P( 10, -5 ), P( 10, 5 ) );", inputs: si({ 0: "L( a )", 1: "L( b )" }), expect: { created: one("curve"), consumed: ["a"] } },
  { name: "extrude", setup: RECT, inputs: si({ 0: "L( a )", 2: "5", 5: "true", 6: "false" }), expect: { created: one("brep") } },
  // Corners (type 9) stays unset.
  { name: "fillet", setup: BOX, inputs: si({ 0: "L( a.getEdges().item( 0 ) )", 1: "false", 3: "1" }), expect: MOVED },
  { name: "flip", setup: "var a = plane();", inputs: si({ 0: "L( a )" }), expect: MOVED },
  { name: "flow", setup: "var a = box( 0, 0, 0, 2 ), b = line( P( 0, 0 ), P( 10, 0 ) ), c = line( P( 0, 5 ), P( 10, 15 ) );", inputs: si({ 0: "L( a )", 1: "b", 2: "c", 3: "false" }), expect: { created: one("brep") } },
  // Helix start point (2) is needed; without it nothing is created.
  { name: "helix", inputs: si({ 0: "F()", 1: "P( 0, 0, 10 )", 2: "P( 3, 0 )", 3: "3", 5: "3", 8: "'turns'", 6: "5", 9: "false" }), expect: { created: one("curve") } },
  { name: "inset", setup: BOX, inputs: si({ 0: "L( a.getFaces().item( 0 ) )", 1: "1" }), expect: MOVED },
  { name: "interpcurve", inputs: pts("P( 0, 0 )", "P( 10, 0 )", "P( 10, 10 )", "P( 0, 10 )"), expect: { created: one("curve") } },
  { name: "intersect", setup: TWO_BOXES, inputs: si({ 0: "L( a, b )" }), expect: { created: one("curve") } },
  { name: "isocurve", setup: "var a = plane();", inputs: si({ 0: "a.getFaces().item( 0 )", 1: "P( 5, 3 )", 2: "'u'" }), expect: { created: one("curve") } },
  { name: "join", setup: "var a = line( P( 0, 0 ), P( 10, 0 ) ), b = line( P( 10, 0 ), P( 10, 10 ) );", inputs: si({ 0: "L( a, b )" }), expect: { created: one("curve"), consumed: ["a", "b"] } },
  { name: "label", inputs: si({ 0: "P( 0, 0 )", 1: "'hi'" }), expect: { created: one("point") } },
  // Leader points are built at runtime, as in Leader.js.
  { name: "leader", inputs: `${si({ 0: "F()", 1: "'hi'", 2: "0" })} f.createInput( 'point' ); f.setInput( 3, P( 10, 5 ) );`, expect: { created: one("unknown") } },
  { name: "line", inputs: si({ 0: "P( 0, 0 )", 1: "P( 10, 0 )", 2: "false" }), expect: { created: one("curve") } },
  // Orientations (type 9) stays unset.
  { name: "loft", setup: "var a = circle( F(), 3 ), b = circle( F( 0, 0, 10 ), 5 );", inputs: si({ 0: "L( a, b )", 3: "false", 4: "false" }), expect: { created: one("brep") } },
  { name: "make2d", setup: BOX, inputs: si({ 0: "L( a )", 1: "'Top'", 3: "false" }), expect: { created: { count: 4, typeName: "curve" } } },
  { name: "merge", setup: "var a = plane( 0 ), b = plane( 10 );", inputs: si({ 0: "L( a, b )" }), expect: { created: { count: 2, typeName: "brep" }, consumed: ["a", "b"] } },
  { name: "mirror", setup: BOX, inputs: si({ 0: "L( a )", 1: "F( -5, 0 )", 2: "P( -5, 10 )", 3: "true" }), expect: MOVED },
  { name: "move", setup: BOX, inputs: si({ 0: "L( a )", 1: "P( 0, 0 )", 2: "P( 20, 0 )", 3: "false" }), expect: MOVED },
  {
    name: "network",
    setup: "var a = line( P( 0, 0 ), P( 10, 0 ) ), b = line( P( 0, 10 ), P( 10, 10 ) ), c = line( P( 0, 0 ), P( 0, 10 ) ), d = line( P( 10, 0 ), P( 10, 10 ) );",
    inputs: si({ 0: "L( a, b )", 1: "L( c, d )" }),
    expect: { created: one("brep") },
  },
  {
    name: "nsided",
    commit: false,
    reason:
      "calculate() returns nothing from a script. Tried: loops of 3, 4 and 5 lines, a joined closed curve and four box edges, with Bulge 1 and 20 × 20 points.",
  },
  // Only WhichGrip 4 of 0-9 commits with these inputs.
  { name: "objectframerotate", setup: BOX, inputs: GIZMO(4, "P( 10, 0 )", "P( 0, 10 )"), expect: MOVED },
  { name: "objectframerotatewheel", setup: BOX, inputs: si({ 0: "L( a )", 1: "F()", 2: "false" }), expect: MOVED },
  { name: "objectframescale", setup: BOX, inputs: GIZMO(0, "P( 10, 10 )", "P( 20, 20 )"), expect: MOVED },
  // Offset pt (2) picks the side; without it nothing is created.
  { name: "offset", setup: RECT, inputs: si({ 0: "L( a )", 1: "1", 2: "F( 5, 3 )", 3: "'sharp'", 4: "false", 5: "false", 6: "false", 7: "false" }), expect: { created: { count: 4, typeName: "curve" } } },
  { name: "orient", setup: BOX, inputs: si({ 0: "L( a )", 1: "F()", 2: "F( 30, 0 )", 3: "false" }), expect: MOVED },
  { name: "orientlinetoline", setup: BOX, inputs: si({ 0: "L( a )", 1: "P( 0, 0 )", 2: "P( 10, 0 )", 3: "P( 30, 0 )", 4: "P( 30, 20 )", 5: "false" }), expect: MOVED },
  { name: "planarsrf", setup: RECT, inputs: si({ 0: "L( a )" }), expect: { created: one("brep") } },
  { name: "plane", inputs: PLANE_SIZES, expect: { created: one("brep") } },
  { name: "plane3pts", inputs: si({ 0: "P( 0, 0 )", 1: "P( 10, 0 )", 2: "P( 10, 6 )" }), expect: { created: one("brep") } },
  { name: "planecenter", inputs: PLANE_SIZES, expect: { created: one("brep") } },
  { name: "point", inputs: si({ 0: "P( 1, 2, 3 )" }), expect: { created: one("point") } },
  { name: "polygon", inputs: POLYGON, expect: { created: one("curve") } },
  { name: "polygonedge", inputs: POLYGON, expect: { created: one("curve") } },
  { name: "polygonstar", inputs: si({ 0: "F()", 1: "P( 5, 0 )", 2: "6", 3: "P( 2, 1 )" }), expect: { created: one("curve") } },
  { name: "polyline", inputs: pts("P( 0, 0 )", "P( 10, 0 )", "P( 10, 10 )"), expect: { created: one("curve") } },
  // Onto the construction plane, as Project.js does for its 'usecplane' button.
  { name: "project", setup: "var a = circle( F( 0, 0, 10 ), 2 );", inputs: si({ 0: "L( a )", 5: "false", 6: "moi.view.getCPlane()" }), expect: { created: one("curve") } },
  { name: "railrevolve", setup: "var a = line( P( 5, 0 ), P( 5, 0, 5 ) ), b = circle( F(), 5 );", inputs: si({ 0: "a", 1: "b", 2: "P( 0, 0 )", 3: "P( 0, 0, 10 )", 4: "false" }), expect: { created: one("brep") } },
  { name: "rebuildcurve", setup: "var a = circle( F(), 5 );", inputs: si({ 0: "L( a )", 1: "'numpoints'", 2: "0.01", 3: "12", 4: "false", 5: "false", 6: "5" }), expect: { created: one("curve") } },
  { name: "rect3pts", inputs: si({ 0: "P( 0, 0 )", 1: "P( 10, 0 )", 2: "P( 10, 6 )", 5: "false" }), expect: { created: one("curve") } },
  { name: "rectangle", inputs: RECT_SIZES, expect: { created: one("curve") } },
  { name: "rectcenter", inputs: RECT_SIZES, expect: { created: one("curve") } },
  { name: "removeduplicates", setup: "var a = line( P( 0, 0 ), P( 10, 0 ) ), b = line( P( 0, 0 ), P( 10, 0 ) );", inputs: si({ 0: "L( a, b )", 1: "0.001" }), expect: { created: { count: 0, typeName: "none" }, consumed: ["b"] } },
  { name: "revolve", setup: "var a = line( P( 5, 0 ), P( 5, 10 ) );", inputs: si({ 0: "L( a )", 1: "P( 0, 0 )", 2: "P( 0, 10 )", 3: "360", 4: "false" }), expect: { created: one("brep") } },
  { name: "rotate", setup: BOX, inputs: si({ 0: "L( a )", 1: "F()", 2: "45", 5: "false" }), expect: MOVED },
  { name: "rotateaxis", setup: BOX, inputs: si({ 0: "L( a )", 1: "P( 0, 0 )", 2: "P( 0, 0, 1 )", 3: "45", 6: "false" }), expect: MOVED },
  { name: "scale", setup: BOX, inputs: si({ 0: "L( a )", 1: "P( 0, 0 )", 2: "2", 5: "false" }), expect: MOVED },
  { name: "scale1d", setup: BOX, inputs: si({ 0: "L( a )", 1: "P( 0, 0 )", 2: "2", 3: "P( 0, 0 )", 4: "P( 10, 0 )", 5: "false" }), expect: MOVED },
  { name: "scale2d", setup: BOX, inputs: si({ 0: "L( a )", 1: "F()", 2: "2", 5: "false" }), expect: MOVED },
  { name: "scalenonuniform", setup: BOX, inputs: si({ 0: "L( a )", 1: "F()", 2: "2", 3: "1", 4: "3" }), expect: MOVED },
  { name: "separate", setup: BOX, inputs: si({ 0: "L( a )" }), expect: { created: { count: 6, typeName: "brep" }, consumed: ["a"] } },
  { name: "shell", setup: BOX, inputs: si({ 0: "L( a )", 1: "1", 2: "'Inside'" }), expect: MOVED },
  { name: "shrinktrimmedsrf", setup: "var c = circle( F(), 3 ); var a = make( 'planarsrf', function ( g ) { g.setInput( 0, L( c ) ); } );", inputs: si({ 0: "L( a )" }), expect: MOVED },
  { name: "silhouette", setup: `var a = ${SPHERE(2)};`, inputs: si({ 0: "L( a )", 1: "P( 0, -50, 0 )", 2: "P( 0, 1, 0 )", 3: "false", 4: "false" }), expect: { created: { count: 3, typeName: "curve" } } },
  { name: "sketchcurve", commit: false, reason: "Driven by a point-stream picker (createPointStreamPicker().bind(factory)), not by setInput. Not usefully scriptable." },
  { name: "sphere", inputs: si({ 0: "true", 1: "F()", 3: "2" }), expect: { created: one("brep") } },
  // A circle in the XZ plane swept along Y. Orientations (type 9) stay unset; the string
  // inputs must be set, or nothing is created.
  {
    name: "sweep",
    setup: "var a = circle( V.createFrame( P( 0, 0 ), P( 1, 0, 0 ), P( 0, 0, 1 ) ), 1 ), b = line( P( 1, 0 ), P( 1, 20 ) );",
    inputs: si({ 0: "L( a )", 1: "L( b )", 4: "'none'", 5: "'freeform'", 6: "false", 7: "false", 8: "false", 10: "'Auto'", 11: "20" }),
    expect: { created: one("brep") },
  },
  { name: "text", inputs: si({ 0: "F()", 1: "'Hi'", 2: "'Arial'", 3: "false", 4: "false", 5: "'Curves'", 6: "5" }), expect: { created: { count: 3, typeName: "curve" } } },
  // generateFragments() adds the fragments to the document; pick the 0-5 piece to remove.
  // Trim pts (type 9) stays unset.
  {
    name: "trim",
    setup: "var a = line( P( 0, 0 ), P( 10, 0 ) ), b = line( P( 5, -5 ), P( 5, 5 ) );",
    inputs: `${si({ 0: "L( a )", 1: "L( b )", 3: "'remove'" })} var fb = idMap(); f.generateFragments(); var fa = idMap(), piece = null; for ( var fid in fa ) { if ( fb[ fid ] ) continue; var bb = fa[ fid ].getBoundingBox(); if ( bb.max.x - bb.min.x > 1 && bb.max.x < 5.001 ) piece = fa[ fid ]; } ${si({ 2: "L( piece )", 7: "false", 8: "false" })} f.finishedPickingFragments();`,
    expect: { created: one("curve"), consumed: ["a"] },
  },
  { name: "twist", setup: BOX, inputs: si({ 0: "L( a )", 1: "P( 5, 5, 0 )", 2: "P( 5, 5, 10 )", 3: "45", 4: "false" }), expect: MOVED },
];
