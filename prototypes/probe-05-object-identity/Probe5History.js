// Probe 5 run B - questions 4 and 5: what identity survives a factory
// operation, and can the bridge stamp its own identity on getCreatedObjects()
// right after commit. Also nails down `obj.id`, which run A discovered.
// Install as <MoI app data>\startup\Probe5History.js. ES5 only.

var OUT = moi.filesystem.getAppDataDir() + 'probe5-history.txt';
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

var HERE = '';
try {
    var cs = moi.filesystem.openFileStream( moi.filesystem.getAppDataDir() + 'probe5-case.txt', 'r' );
    if ( cs ) { HERE = cs.readLine(); if ( cs.close ) cs.close(); }
} catch ( e ) { }

var vm = moi.vectorMath;
var db = moi.geometryDatabase;

function shortId( o ) { try { return ( '' + o.id ).substr( 1, 8 ); } catch ( e ) { return '?'; } }
function describe( o ) { try { return o.name + '/' + shortId( o ) + '/t' + o.type; } catch ( e ) { return 'THREW'; } }
function listOf( l )
{
    if ( l == null ) return 'null';
    var out = [];
    try { for ( var i = 0; i < l.length; ++i ) out.push( describe( l.item( i ) ) ); }
    catch ( e ) { return 'THREW: ' + e; }
    return '(' + l.length + ') [' + out.join( ' ' ) + ']';
}
function dbList() { return listOf( db.getObjects() ); }

function makeBox( x, y, w, h, d, nm )
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
    if ( obj && nm ) obj.name = nm;
    return obj;
}

function selectOnly( arr )
{
    db.deselectAll();
    for ( var i = 0; i < arr.length; ++i ) arr[i].selected = true;
    return db.getSelectedObjects();
}

// ------------------------------------------------ obj.id, nailed down first
say( '## obj.id - run A found it; is it stable and is it findObject\'s key?' );

var A = null, E = null;
safe( 'box A', function () { A = makeBox( 0, 0, 10, 10, 10, 'Probe5A' ); return describe( A ) + ' full id=' + A.id; } );
safe( 'box E', function () { E = makeBox( 30, 0, 10, 10, 10, 'Probe5E' ); return describe( E ) + ' full id=' + E.id; } );
safe( 'A.id read twice off the same wrapper', function () { return ( A.id == A.id ) + ' ' + A.id; } );
safe( 'A.id vs a fresh getObjects() wrapper', function () {
    var o = db.getObjects().item( 0 );
    return 'wrapper == A -> ' + ( o == A ) + ' ; id equal -> ' + ( o.id == A.id ) + ' ; ' + o.id;
} );
safe( 'ids are distinct between A and E', function () { return ( A.id != E.id ); } );
safe( 'is A.id writable?', function () { var was = A.id; A.id = '{00000000-0000-0000-0000-000000000000}'; return 'after assign = ' + A.id + ' (was ' + was + ')'; } );

say( '' );
say( '# findObject wants a string - is that string the id?' );
safe( 'findObject(A.id)', function () { var r = db.findObject( A.id ); return typeof r + ' :: ' + r + ' -> ' + describe( r ); } );
safe( 'findObject(A.id without braces)', function () {
    var bare = ( '' + A.id ).replace( '{', '' ).replace( '}', '' );
    var r = db.findObject( bare ); return typeof r + ' :: ' + r;
} );
safe( 'findObject(name)', function () { var r = db.findObject( 'Probe5A' ); return typeof r + ' :: ' + r; } );
safe( 'findObject(unknown guid)', function () { var r = db.findObject( '{11111111-2222-3333-4444-555555555555}' ); return typeof r + ' :: ' + r; } );

// --------------------------------------------------------------- question 4
say( '' );
say( '## question 4 - what identity survives an operation?' );

say( '' );
say( '# 4a. move - does it edit in place or replace?' );
safe( 'before move', function () { return dbList(); } );
safe( 'move E by (0,40,0)', function () {
    var f = moi.command.createFactory( 'move' );
    f.setInput( 0, selectOnly( [ E ] ) );
    f.setInput( 1, vm.createPoint( 0, 0, 0 ) );
    f.setInput( 2, vm.createPoint( 0, 40, 0 ) );
    f.update();
    var r = 'inputObjects=' + listOf( f.getInputObjects() ) +
            ' created=' + listOf( f.getCreatedObjects() ) +
            ' removed=' + listOf( f.getRemovedObjects() );
    f.commit();
    db.deselectAll();
    return r;
} );
safe( 'after move', function () { return dbList(); } );
safe( 'E.id unchanged by move?', function () { return E.id; } );

say( '' );
say( '# 4b. fillet - the consuming case' );
var filletFactory = null, filletCreated = null;
safe( 'A before fillet', function () { return describe( A ); } );
safe( 'fillet A radius 1', function () {
    filletFactory = moi.command.createFactory( 'fillet' );
    filletFactory.setInput( 0, selectOnly( [ A ] ) );
    filletFactory.setInput( 3, 1.0 );
    filletFactory.update();
    try { filletFactory.waitForAsyncUpdate(); } catch ( e ) { }
    return 'update ok';
} );
safe( 'fillet, pre-commit inputObjects', function () { return listOf( filletFactory.getInputObjects() ); } );
safe( 'fillet, pre-commit createdObjects', function () { return listOf( filletFactory.getCreatedObjects() ); } );
safe( 'fillet, pre-commit removedObjects', function () { return listOf( filletFactory.getRemovedObjects() ); } );
safe( 'fillet, pre-commit uiObjects', function () { return listOf( filletFactory.getUIObjects() ); } );
safe( 'fillet commit', function () { filletFactory.commit(); db.deselectAll(); return 'ok'; } );
safe( 'fillet, POST-commit createdObjects', function () {
    filletCreated = filletFactory.getCreatedObjects();
    return listOf( filletCreated );
} );
safe( 'fillet, POST-commit removedObjects', function () { return listOf( filletFactory.getRemovedObjects() ); } );
safe( 'fillet, POST-commit inputObjects', function () { return listOf( filletFactory.getInputObjects() ); } );
safe( 'db after fillet', function () { return dbList(); } );
safe( 'A (the input wrapper) after fillet', function () { return describe( A ) + ' ; still in db? ' + ( db.findObject( A.id ) ? 'yes' : 'no' ); } );

var R = null;
safe( 'the fillet result object', function () {
    var l = db.getObjects();
    for ( var i = 0; i < l.length; ++i ) if ( l.item( i ).id != E.id ) { R = l.item( i ); return describe( R ); }
    return 'not found';
} );
safe( 'result id == A id?', function () { return ( R.id == A.id ); } );
safe( 'result name == A name?', function () { return '[' + R.name + '] vs [Probe5A]'; } );

say( '' );
say( '# 4c. history members on the fillet result' );
var HIST = [ 'getHistoryChildren', 'getHistoryParents', 'getHistoryData', 'updateWithHistory', 'deleteHistoryData' ];
for ( var hi = 0; hi < HIST.length; ++hi )
{
    (function ( nm ) {
        safe( '  R.' + nm, function () {
            var t = typeof R[nm];
            if ( t === 'undefined' ) return 'undefined';
            var called = '';
            try {
                var v = R[nm]();
                called = ' called -> ' + typeof v + ' :: ' + v;
                try { if ( v && v.length !== undefined ) called += ' ' + listOf( v ); } catch ( e ) { }
            } catch ( e ) { called = ' called THREW: ' + e; }
            return t + called;
        } );
    })( HIST[hi] );
}
safe( '  R.getHistoryData() members', function () {
    var d = R.getHistoryData();
    if ( !d ) return 'null';
    var probe = [ 'id', 'name', 'length', 'commandName', 'factoryName', 'type' ];
    var out = [];
    for ( var i = 0; i < probe.length; ++i ) { try { out.push( probe[i] + '=' + typeof d[probe[i]] + ':' + d[probe[i]] ); } catch ( e ) { out.push( probe[i] + '=THREW' ); } }
    return out.join( ' ' );
} );

say( '' );
say( '# 4d. boolean union - two named inputs, one output' );
var F = null, G = null, U = null;
safe( 'boxes F and G (overlapping)', function () {
    F = makeBox( 100, 0, 20, 20, 20, 'Probe5F' );
    G = makeBox( 110, 10, 20, 20, 20, 'Probe5G' );
    return describe( F ) + ' ' + describe( G );
} );
var unionFactory = null;
safe( 'booleanunion F+G', function () {
    unionFactory = moi.command.createFactory( 'booleanunion' );
    unionFactory.setInput( 0, selectOnly( [ F, G ] ) );
    unionFactory.update();
    try { unionFactory.waitForAsyncUpdate(); } catch ( e ) { }
    return 'inputObjects=' + listOf( unionFactory.getInputObjects() ) +
           ' created=' + listOf( unionFactory.getCreatedObjects() ) +
           ' removed=' + listOf( unionFactory.getRemovedObjects() );
} );
safe( 'union commit', function () { unionFactory.commit(); db.deselectAll(); return 'ok'; } );
safe( 'union POST-commit created', function () { return listOf( unionFactory.getCreatedObjects() ); } );
safe( 'union POST-commit removed', function () { return listOf( unionFactory.getRemovedObjects() ); } );
safe( 'db after union', function () { return dbList(); } );
safe( 'F and G still in db?', function () {
    return 'F ' + ( db.findObject( F.id ) ? 'yes' : 'no' ) + ' / G ' + ( db.findObject( G.id ) ? 'yes' : 'no' );
} );
safe( 'union result identity', function () {
    var created = unionFactory.getCreatedObjects();
    if ( created.length == 0 ) return 'no created objects post-commit';
    U = created.item( 0 );
    return describe( U ) + ' ; id==F ' + ( U.id == F.id ) + ' ; id==G ' + ( U.id == G.id );
} );
safe( 'union result history parents', function () {
    var p = U.getHistoryParents();
    return typeof p + ' :: ' + p + ( p && p.length !== undefined ? ' ' + listOf( p ) : '' );
} );

// --------------------------------------------------------------- question 5
say( '' );
say( '## question 5 - can the bridge stamp identity on getCreatedObjects() after commit?' );
safe( 'stamp a name on the union result', function () {
    var created = unionFactory.getCreatedObjects();
    for ( var i = 0; i < created.length; ++i ) created.item( i ).name = 'Probe5Stamped' + i;
    return dbList();
} );
safe( 'stamped name readable from a fresh getObjects()', function () {
    var l = db.getObjects();
    for ( var i = 0; i < l.length; ++i ) if ( l.item( i ).name == 'Probe5Stamped0' ) return 'yes at ' + i + ' id=' + l.item( i ).id;
    return 'NO';
} );
safe( 'stamp a style index too', function () {
    var created = unionFactory.getCreatedObjects();
    created.item( 0 ).styleIndex = 1;
    return 'styleIndex now ' + db.findObject( created.item( 0 ).id ).styleIndex;
} );

// ------------------------------------- does id survive save and reopen? (+4s)
var w = moi.ui.sidePane.window;
if ( w && w.setTimeout )
{
    w.probe5ids = { A: A, E: E, R: R, U: U };
    w.setTimeout( function () {
        var held = w.probe5ids;
        say( '' );
        say( '## does `id` survive save and reopen?' );
        var path = HERE + '\\probe5-history.3dm';
        var before = [];
        safe( 'ids before save', function () {
            var l = db.getObjects();
            for ( var i = 0; i < l.length; ++i ) before.push( l.item( i ).name + '=' + l.item( i ).id );
            return before.join( ' | ' );
        } );
        safe( 'saveAs', function () { db.saveAs( path ); return 'saved to <prototypes>\\probe5-history.3dm'; } );
        safe( 'fileNew', function () { db.fileNew(); return 'count=' + db.getObjects().length; } );
        safe( 'open', function () { db.open( path ); return 'count=' + db.getObjects().length; } );
        var after = [];
        safe( 'ids after reopen', function () {
            var l = db.getObjects();
            for ( var i = 0; i < l.length; ++i ) after.push( l.item( i ).name + '=' + l.item( i ).id );
            return after.join( ' | ' );
        } );
        safe( 'ids identical across save/reopen?', function () { return ( before.join() == after.join() ); } );
        safe( 'findObject(old id) after reopen', function () {
            var r = db.findObject( held.U ? held.U.id : '{}' );
            return typeof r + ' :: ' + r + ( r ? ' -> ' + describe( r ) : '' );
        } );
        safe( 'history survives reopen? R.getHistoryParents()', function () {
            var l = db.getObjects();
            for ( var i = 0; i < l.length; ++i ) {
                var o = l.item( i );
                if ( o.name == 'Probe5Stamped0' ) { var p = o.getHistoryParents(); return typeof p + ' :: ' + p; }
            }
            return 'stamped object not found';
        } );
        say( '' );
        say( '## done' );
    }, 4000 );
    rec( 'stage 2 scheduled', 'yes' );
}

flush();
