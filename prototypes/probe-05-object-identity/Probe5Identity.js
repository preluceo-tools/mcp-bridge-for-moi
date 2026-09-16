// Probe 5 run A - questions 1, 2, 3: is there a per-object id, is `name` usable
// as identity, is object ordering stable. Plus the one thing the bridge really
// cares about: does a JavaScript reference to a geometry object, held in the
// borrowed side pane window, still work minutes and operations later.
// Install as <MoI app data>\startup\Probe5Identity.js. ES5 only.

var OUT = moi.filesystem.getAppDataDir() + 'probe5-identity.txt';
var lines = [];
function say( s ) { lines.push( s ); flush(); }
function rec( k, v ) { say( k + ' = ' + v ); }
function safe( k, fn ) { try { rec( k, fn() ); } catch ( e ) { rec( k, 'THREW: ' + e ); } }
function flush()
{
    try {
        var s = moi.filesystem.openFileStream( OUT, 'w' );
        if ( s ) { s.writeLine( lines.join( '\n' ) ); if ( s.close ) s.close(); }
    } catch ( e ) { }
}

// Where to drop a .3dm, handed in by the harness so no path is baked in here.
var HERE = '';
try {
    var cs = moi.filesystem.openFileStream( moi.filesystem.getAppDataDir() + 'probe5-case.txt', 'r' );
    if ( cs ) { HERE = cs.readLine(); if ( cs.close ) cs.close(); }
} catch ( e ) { }

var vm = moi.vectorMath;
var db = moi.geometryDatabase;

function makeBox( x, y, w, h, d )
{
    var f = moi.command.createFactory( 'box' );
    f.setInput( 0, vm.createTopFrame( vm.createPoint( 0, 0, 0 ) ) );
    f.setInput( 1, vm.createPoint( x, y, 0 ) );
    f.setInput( 2, w );
    f.setInput( 3, h );
    f.setInput( 4, d );
    f.update();
    var created = f.getCreatedObjects();
    var obj = created.length > 0 ? created.item( 0 ) : null;
    f.commit();
    return obj;
}

function names()
{
    var l = db.getObjects();
    var out = [];
    for ( var i = 0; i < l.length; ++i ) out.push( i + ':' + l.item( i ).name );
    return '[' + out.join( ' ') + ']';
}

// ---------------------------------------------------------------- question 1
say( '## question 1 - is there a stable per-object identifier?' );

var A = null;
safe( 'create box A', function () { A = makeBox( 0, 0, 10, 10, 10 ); return A ? 'ok, type=' + A.type : 'NULL'; } );

var CANDIDATES = [ 'id', 'objectId', 'objectID', 'objectid', 'Id', 'ID', 'uid', 'uuid', 'guid',
                   'handle', 'index', 'objectIndex', 'databaseIndex', 'serialNumber', 'serial',
                   'getId', 'getObjectId', 'getSerialNumber', 'getUniqueId', 'uniqueId',
                   'key', 'hash', 'ptr', 'pointer', 'address', 'runtimeId', 'tag',
                   'userData', 'getUserData', 'setUserData', 'revision', 'objectNumber' ];

say( '' );
say( '# id-like members, probed by name (MoI objects do not enumerate - probe 01)' );
for ( var ci = 0; ci < CANDIDATES.length; ++ci )
{
    (function ( nm ) {
        safe( '  A.' + nm, function () {
            var t = typeof A[nm];
            if ( t === 'undefined' ) return 'undefined';
            var v = '';
            try { v = ' value=' + A[nm]; } catch ( e ) { v = ' value THREW'; }
            var called = '';
            if ( t === 'function' ) { try { called = ' called=' + A[nm](); } catch ( e ) { called = ' called THREW: ' + e; } }
            return t + v + called;
        } );
    })( CANDIDATES[ci] );
}

say( '' );
say( '# documented members, for contrast' );
var DOCUMENTED = [ 'type', 'name', 'selected', 'hidden', 'locked', 'styleIndex', 'displayMode' ];
for ( var di = 0; di < DOCUMENTED.length; ++di )
{
    (function ( nm ) {
        safe( '  A.' + nm, function () { return typeof A[nm] + ' value=' + A[nm]; } );
    })( DOCUMENTED[di] );
}
safe( '  String(A)', function () { return '' + A; } );
safe( '  A.toString', function () { return typeof A.toString; } );

say( '' );
say( '# findObject - what does it take and what does it give back?' );
safe( '  findObject(0)', function () { var r = db.findObject( 0 ); return typeof r + ' :: ' + r; } );
safe( '  findObject(1)', function () { var r = db.findObject( 1 ); return typeof r + ' :: ' + r; } );
safe( '  findObject(-1)', function () { var r = db.findObject( -1 ); return typeof r + ' :: ' + r; } );
safe( '  findObject(999)', function () { var r = db.findObject( 999 ); return typeof r + ' :: ' + r; } );
safe( '  findObject("")', function () { var r = db.findObject( '' ); return typeof r + ' :: ' + r; } );
safe( '  findObject("Box")', function () { var r = db.findObject( 'Box' ); return typeof r + ' :: ' + r; } );
safe( '  findObject(A)', function () { var r = db.findObject( A ); return typeof r + ' :: ' + r; } );
safe( '  findObject()', function () { var r = db.findObject(); return typeof r + ' :: ' + r; } );

// ---------------------------------------------------------------- question 2
say( '' );
say( '## question 2 - is `name` viable as the identity?' );
safe( 'set A.name', function () { A.name = 'Probe5Alpha'; return 'assigned'; } );
safe( 'read A.name back', function () { return '[' + A.name + ']'; } );
safe( 'name via a fresh getObjects()', function () { return '[' + db.getObjects().item( 0 ).name + ']'; } );

var B = null;
safe( 'create box B, same name', function () {
    B = makeBox( 30, 0, 10, 10, 10 );
    B.name = 'Probe5Alpha';
    return 'B.name=[' + B.name + '] A.name=[' + A.name + ']';
} );
safe( 'duplicate names allowed?', function () { return names(); } );
safe( 'selectNamed("Probe5Alpha")', function () {
    db.deselectAll();
    db.selectNamed( 'Probe5Alpha' );
    return 'selected count = ' + db.getSelectedObjects().length;
} );
safe( 'rename B unique', function () { B.name = 'Probe5Beta'; db.deselectAll(); return names(); } );
safe( 'findObject("Probe5Alpha")', function () { var r = db.findObject( 'Probe5Alpha' ); return typeof r + ' :: ' + r + ' name=' + ( r ? r.name : '-' ); } );

// ---------------------------------------------------------------- question 3
say( '' );
say( '## question 3 - is object ordering stable?' );
safe( 'getObjects() call 1', function () { return names(); } );
safe( 'getObjects() call 2', function () { return names(); } );
safe( 'same wrapper across calls? (== )', function () {
    var a1 = db.getObjects().item( 0 ), a2 = db.getObjects().item( 0 );
    return 'a1==a2 -> ' + ( a1 == a2 ) + ' ; a1===a2 -> ' + ( a1 === a2 ) + ' ; a1==A -> ' + ( a1 == A );
} );

var C = null;
safe( 'add box C, re-list', function () { C = makeBox( 60, 0, 10, 10, 10 ); C.name = 'Probe5Gamma'; return names(); } );
safe( 'add box D at front-ish, re-list', function () { var D = makeBox( 90, 0, 5, 5, 5 ); D.name = 'Probe5Delta'; return names(); } );
safe( 'delete the middle one (Beta), re-list', function () {
    var l = db.getObjects();
    for ( var i = 0; i < l.length; ++i ) { if ( l.item( i ).name == 'Probe5Beta' ) { db.removeObject( l.item( i ) ); break; } }
    return names();
} );
safe( 'index of Gamma now', function () {
    var l = db.getObjects();
    for ( var i = 0; i < l.length; ++i ) if ( l.item( i ).name == 'Probe5Gamma' ) return i;
    return 'gone';
} );

// ----------------------------------------------- held references, over time
// The bridge is a long-lived page. Can it just keep the object in a JS table?
say( '' );
say( '## held JS references - the bridge\'s own option' );
safe( 'A still usable after all of the above', function () { return 'A.name=[' + A.name + '] A.type=' + A.type; } );
safe( 'B (deleted) still usable?', function () { return 'B.name=[' + B.name + '] B.type=' + B.type; } );
safe( 'is deleted B still in getObjects()?', function () {
    var l = db.getObjects();
    for ( var i = 0; i < l.length; ++i ) if ( l.item( i ) == B ) return 'yes at ' + i;
    return 'no';
} );

var w = null;
safe( 'borrow side pane window', function () { w = moi.ui.sidePane.window; return typeof w; } );

if ( w && w.setTimeout )
{
    w.probe5held = { A: A, C: C };
    w.setTimeout( function () {
        var held = w.probe5held;
        say( '' );
        say( '## +4s, from a side pane timer - held references' );
        safe( 'held.A.name', function () { return '[' + held.A.name + ']'; } );
        safe( 'held.A == getObjects().item(0)', function () { return held.A == moi.geometryDatabase.getObjects().item( 0 ); } );
        safe( 'set held.A.name from the timer', function () { held.A.name = 'Probe5AlphaRenamed'; return names(); } );
        safe( 'held.C.name', function () { return '[' + held.C.name + ']'; } );

        // ------------------------------------------- question 2, save/reopen
        say( '' );
        say( '## question 2 continued - does `name` survive save and reopen?' );
        var path = HERE + '\\probe5-names.3dm';
        safe( 'saveAs', function () { moi.geometryDatabase.saveAs( path ); return 'saved to <prototypes>\\probe5-names.3dm'; } );
        safe( 'names before fileNew', function () { return names(); } );
        safe( 'fileNew', function () { moi.geometryDatabase.fileNew(); return 'count=' + moi.geometryDatabase.getObjects().length; } );
        safe( 'open the saved file', function () { moi.geometryDatabase.open( path ); return 'count=' + moi.geometryDatabase.getObjects().length; } );
        safe( 'names after reopen', function () { return names(); } );
        safe( 'held.A after reopen - still valid?', function () { return '[' + held.A.name + '] type=' + held.A.type; } );
        safe( 'held.A == any reopened object?', function () {
            var l = moi.geometryDatabase.getObjects();
            for ( var i = 0; i < l.length; ++i ) if ( l.item( i ) == held.A ) return 'yes at ' + i;
            return 'no';
        } );
        safe( 'findObject("Probe5Gamma") after reopen', function () {
            var r = moi.geometryDatabase.findObject( 'Probe5Gamma' );
            return typeof r + ' :: ' + r;
        } );
        say( '' );
        say( '## done' );
    }, 4000 );
    rec( 'stage 2 scheduled', 'yes, +4000ms in the side pane window' );
}
else
{
    rec( 'stage 2 scheduled', 'NO - side pane window or its setTimeout missing' );
}

flush();
