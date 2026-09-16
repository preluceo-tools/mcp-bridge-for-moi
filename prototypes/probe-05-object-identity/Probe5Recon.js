// Probe 5, recon pass. Install as <MoI app data>\startup\Probe5Recon.js.
// Answers only the mechanical questions the identity probe needs first:
// is the geometry database usable from a startup script, how do you build a
// frame without a point picker, and what shape does the 'box' factory have.
// ES5 only. No console - everything goes through openFileStream/writeLine.

var OUT = moi.filesystem.getAppDataDir() + 'probe5-recon.txt';
var lines = [];
function rec( k, v ) { lines.push( k + ' = ' + v ); flush(); }
function safe( k, fn ) { try { rec( k, fn() ); } catch ( e ) { rec( k, 'THREW: ' + e ); } }
function flush()
{
    try {
        var s = moi.filesystem.openFileStream( OUT, 'w' );
        if ( s ) { s.writeLine( lines.join( '\n' ) ); if ( s.close ) s.close(); }
    } catch ( e ) { }
}

rec( '# probe 5 recon', '' );
safe( 'moi.version', function () { return moi.version; } );
safe( 'geometryDatabase', function () { return typeof moi.geometryDatabase; } );
safe( 'getObjects() at startup', function () { return moi.geometryDatabase.getObjects().length; } );
safe( 'currentFileName', function () { return '[' + moi.geometryDatabase.currentFileName + ']'; } );

// --- how do you make a frame with no point picker? ------------------------
safe( 'vectorMath', function () { return typeof moi.vectorMath; } );
safe( 'createPoint(0,0,0)', function () { var p = moi.vectorMath.createPoint(0,0,0); return typeof p + ' :: ' + p; } );
safe( 'createTopFrame()', function () { return typeof moi.vectorMath.createTopFrame(); } );
safe( 'createTopFrame(pt)', function () { return typeof moi.vectorMath.createTopFrame( moi.vectorMath.createPoint(0,0,0) ); } );
safe( 'createFrame(pt,x,y)', function () {
    var vm = moi.vectorMath;
    return typeof vm.createFrame( vm.createPoint(0,0,0), vm.createPoint(1,0,0), vm.createPoint(0,1,0) );
} );
safe( 'frame.origin', function () {
    var f = moi.vectorMath.createTopFrame( moi.vectorMath.createPoint(1,2,3) );
    return '' + f.origin + ' / zaxis=' + f.zaxis;
} );

// --- what does the 'box' factory look like? -------------------------------
var f = null;
safe( 'createFactory(box)', function () { f = moi.command.createFactory( 'box' ); return typeof f; } );
safe( 'box.numInputs', function () { return f.numInputs; } );
for ( var i = 0; i < 8; ++i )
{
    (function ( n ) {
        safe( 'box.getInput(' + n + ')', function () {
            var inp = f.getInput( n );
            var t = typeof inp;
            var v = 'novalue';
            try { v = '' + inp.getValue(); } catch ( e ) { v = 'getValue THREW'; }
            return t + ' value=' + v;
        } );
    })( i );
}

// --- can we actually build a box with no picker? --------------------------
safe( 'build box', function () {
    var vm = moi.vectorMath;
    var frame = vm.createTopFrame( vm.createPoint( 0, 0, 0 ) );
    f.setInput( 0, frame );
    f.setInput( 1, vm.createPoint( 0, 0, 0 ) );
    f.setInput( 2, 10 );
    f.setInput( 3, 20 );
    f.setInput( 4, 30 );
    f.update();
    return 'update ok';
} );
safe( 'box getCreatedObjects before commit', function () { return f.getCreatedObjects().length; } );
safe( 'box commit', function () { f.commit(); return 'ok'; } );
safe( 'db count after commit', function () { return moi.geometryDatabase.getObjects().length; } );
safe( 'getLastCreated', function () { var l = moi.geometryDatabase.getLastCreated(); return typeof l + ' length=' + l.length; } );
safe( 'first object type', function () {
    var o = moi.geometryDatabase.getObjects().item(0);
    return o.type + ' name=[' + o.name + '] isSolidBRep=' + o.isSolidBRep();
} );

flush();
