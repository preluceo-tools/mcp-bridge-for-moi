// Probe 5 run C - the crux, done properly. Run B identified the fillet result
// by elimination and picked the wrong object; here every result object is
// captured from the factory itself, before commit, which run B showed is the
// only moment getCreatedObjects() is populated.
// Install as <MoI app data>\startup\Probe5Trace.js. ES5 only.

var OUT = moi.filesystem.getAppDataDir() + 'probe5-trace.txt';
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

var vm = moi.vectorMath;
var db = moi.geometryDatabase;

function idOf( o ) { try { return '' + o.id; } catch ( e ) { return '?'; } }
function describe( o ) { try { return o.name + '/' + idOf( o ).substr( 1, 8 ) + '/t' + o.type; } catch ( e ) { return 'THREW'; } }
function listOf( l )
{
    if ( l == null ) return 'null';
    var out = [];
    try { for ( var i = 0; i < l.length; ++i ) out.push( describe( l.item( i ) ) ); }
    catch ( e ) { return 'THREW: ' + e; }
    return '(' + l.length + ') [' + out.join( ' ' ) + ']';
}
function dbList() { return listOf( db.getObjects() ); }
function inDb( o ) { try { return db.findObject( idOf( o ) ) ? 'yes' : 'no'; } catch ( e ) { return 'THREW: ' + e; } }

function makeBox( x, y, w, h, d, nm )
{
    var f = moi.command.createFactory( 'box' );
    f.setInput( 0, vm.createTopFrame( vm.createPoint( 0, 0, 0 ) ) );
    f.setInput( 1, vm.createPoint( x, y, 0 ) );
    f.setInput( 2, w ); f.setInput( 3, h ); f.setInput( 4, d );
    f.update();
    var c = f.getCreatedObjects();
    var obj = c.length > 0 ? c.item( 0 ) : null;
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

// ------------------------------------------------------------------- fillet
say( '## fillet, result captured from the factory before commit' );
var P = null, Q = null, R = null;
safe( 'box P, box Q', function () {
    P = makeBox( 0, 0, 10, 10, 10, 'Probe5P' );
    Q = makeBox( 40, 0, 10, 10, 10, 'Probe5Q' );
    return describe( P ) + ' ' + describe( Q );
} );
var pid = '';
safe( 'P.id', function () { pid = idOf( P ); return pid; } );
safe( 'fillet P r=1, capture created pre-commit', function () {
    var f = moi.command.createFactory( 'fillet' );
    f.setInput( 0, selectOnly( [ P ] ) );
    f.setInput( 3, 1.0 );
    f.update();
    try { f.waitForAsyncUpdate(); } catch ( e ) { }
    var c = f.getCreatedObjects();
    R = c.length > 0 ? c.item( 0 ) : null;
    var pre = 'created=' + listOf( c ) + ' removed=' + listOf( f.getRemovedObjects() ) + ' input=' + listOf( f.getInputObjects() );
    f.commit();
    db.deselectAll();
    return pre;
} );
safe( 'db after fillet', function () { return dbList(); } );
safe( 'captured R still valid after commit', function () { return describe( R ) + ' inDb=' + inDb( R ); } );
safe( 'R.id vs P.id', function () { return 'R=' + idOf( R ) + ' P=' + pid + ' equal=' + ( idOf( R ) == pid ); } );
safe( 'R.name (was P named Probe5P?)', function () { return '[' + R.name + ']'; } );
safe( 'findObject(P.id) - the consumed input', function () { var r = db.findObject( pid ); return typeof r + ' :: ' + r; } );

say( '' );
say( '# history on the fillet result' );
safe( 'R.getHistoryParents()', function () { return listOf( R.getHistoryParents() ); } );
safe( 'R.getHistoryChildren()', function () { return listOf( R.getHistoryChildren() ); } );
safe( 'R.updateWithHistory', function () { return typeof R.updateWithHistory + ' value=' + R.updateWithHistory; } );
safe( 'R.getHistoryData()', function () { var d = R.getHistoryData(); return typeof d + '\n----8<----\n' + d + '\n----8<----'; } );
safe( 'does R.getHistoryData() contain P.id?', function () {
    var d = '' + R.getHistoryData();
    return ( d.indexOf( pid ) >= 0 );
} );

// -------------------------------------------------- id under plain edits
say( '' );
say( '## does `id` survive plain property edits?' );
var rid = '';
safe( 'R.id before edits', function () { rid = idOf( R ); return rid; } );
safe( 'rename R', function () { R.name = 'Probe5Renamed'; return 'id same? ' + ( idOf( R ) == rid ); } );
safe( 'hide R', function () { R.hidden = true; R.hidden = false; return 'id same? ' + ( idOf( R ) == rid ); } );
safe( 'restyle R', function () { R.styleIndex = 1; R.styleIndex = 0; return 'id same? ' + ( idOf( R ) == rid ); } );
safe( 'findObject(rid) still finds it', function () { var o = db.findObject( rid ); return o ? describe( o ) : 'null'; } );

// -------------------------------------------------- copy: does the original keep its id
say( '' );
say( '## copy - a factory that does NOT consume its input' );
var qid = '', COPY = null;
safe( 'Q.id before copy', function () { qid = idOf( Q ); return qid; } );
safe( 'copy Q by (0,60,0)', function () {
    var f = moi.command.createFactory( 'copy' );
    f.setInput( 0, selectOnly( [ Q ] ) );
    f.setInput( 1, vm.createPoint( 0, 0, 0 ) );
    f.setInput( 2, vm.createPoint( 0, 60, 0 ) );
    f.update();
    try { f.waitForAsyncUpdate(); } catch ( e ) { }
    var c = f.getCreatedObjects();
    COPY = c.length > 0 ? c.item( 0 ) : null;
    var pre = 'created=' + listOf( c ) + ' removed=' + listOf( f.getRemovedObjects() ) + ' input=' + listOf( f.getInputObjects() );
    f.commit();
    db.deselectAll();
    return pre;
} );
safe( 'db after copy', function () { return dbList(); } );
safe( 'Q keeps its id?', function () { return 'Q.id=' + idOf( Q ) + ' same=' + ( idOf( Q ) == qid ) + ' inDb=' + inDb( Q ); } );
safe( 'copy has a new id', function () { return COPY ? describe( COPY ) + ' inDb=' + inDb( COPY ) : 'null'; } );
safe( 'Q.getHistoryChildren() - forward link to the copy?', function () { return listOf( Q.getHistoryChildren() ); } );
safe( 'COPY.getHistoryParents()', function () { return COPY ? listOf( COPY.getHistoryParents() ) : 'null'; } );
safe( 'COPY.getHistoryData() contains Q.id?', function () {
    var d = '' + COPY.getHistoryData();
    return ( d.indexOf( qid ) >= 0 ) + '\n----8<----\n' + d + '\n----8<----';
} );

// -------------------------------------------------- boolean union naming rule
say( '' );
say( '## boolean union - which input name does the result inherit?' );
var S = null, T = null, U = null, sid = '', tid = '';
safe( 'boxes S and T (overlapping, distinct names)', function () {
    S = makeBox( 100, 0, 20, 20, 20, 'Probe5S' );
    T = makeBox( 110, 10, 20, 20, 20, 'Probe5T' );
    sid = idOf( S ); tid = idOf( T );
    return describe( S ) + ' ' + describe( T );
} );
safe( 'booleanunion S+T, capture created pre-commit', function () {
    var f = moi.command.createFactory( 'booleanunion' );
    f.setInput( 0, selectOnly( [ S, T ] ) );
    f.update();
    try { f.waitForAsyncUpdate(); } catch ( e ) { }
    var c = f.getCreatedObjects();
    U = c.length > 0 ? c.item( 0 ) : null;
    var pre = 'created=' + listOf( c ) + ' removed=' + listOf( f.getRemovedObjects() ) + ' input=' + listOf( f.getInputObjects() );
    f.commit();
    db.deselectAll();
    return pre;
} );
safe( 'db after union', function () { return dbList(); } );
safe( 'U identity', function () { return describe( U ) + ' inDb=' + inDb( U ) + ' id==S ' + ( idOf( U ) == sid ) + ' id==T ' + ( idOf( U ) == tid ); } );
safe( 'S/T still in db', function () { return 'S=' + ( db.findObject( sid ) ? 'yes' : 'no' ) + ' T=' + ( db.findObject( tid ) ? 'yes' : 'no' ); } );
safe( 'U.getHistoryParents()', function () { return listOf( U.getHistoryParents() ); } );
safe( 'U.getHistoryData() - contains S.id? T.id?', function () {
    var d = '' + U.getHistoryData();
    return 'S ' + ( d.indexOf( sid ) >= 0 ) + ' / T ' + ( d.indexOf( tid ) >= 0 ) + '\n----8<----\n' + d + '\n----8<----';
} );

// -------------------------------------------------- the stamping idiom, end to end
say( '' );
say( '## question 5 - stamp our own name at creation time, then address by it' );
safe( 'stamp U', function () { U.name = 'moi-mcp-0007'; return dbList(); } );
safe( 'address it later by id', function () { var o = db.findObject( idOf( U ) ); return o ? describe( o ) : 'null'; } );
safe( 'address it later by name (selectNamed)', function () {
    db.deselectAll();
    db.selectNamed( 'moi-mcp-0007' );
    var sel = db.getSelectedObjects();
    var r = 'selected=' + listOf( sel );
    db.deselectAll();
    return r;
} );
safe( 'clone U - new id?', function () {
    var c = U.clone();
    return typeof c + ' :: ' + ( c ? describe( c ) + ' sameId=' + ( idOf( c ) == idOf( U ) ) + ' inDb=' + inDb( c ) : 'null' );
} );

say( '' );
say( '## done' );
flush();
