// probe-08 — everything asked of moi.view.screenshot, in the order it was asked.
//
// Run through the live bridge with moi_eval, one section at a time. Kept whole here so
// the sequence is readable; running it top to bottom also works and leaves its output in
// the MoI app data folder.
//
// ES5 only. See docs/research/probe-08-screenshot.md for what each answer turned out to be.

var out = {};
var fs = moi.filesystem;
var dir = fs.getAppDataDir();

// --- 1. Does the symbol exist, and what is it? ---------------------------------------
// Control names alongside it: MoI's binding returns undefined for a name it does not
// know, so 'function' here is meaningful rather than a catch-all stub.
var names = [ 'screenshot', 'saveImage', 'captureImage', 'width', 'height' ];
out.viewMembers = {};
for ( var i = 0; i < names.length; ++i ) {
	out.viewMembers[ names[i] ] = typeof moi.view[ names[i] ];
}

// --- 2. What does it take, and what does it give back? -------------------------------
try {
	moi.view.screenshot();
} catch ( e ) {
	out.noArgs = String( e.message || e );   // 'Required function argument 1 (string) missing.'
}

var img = moi.view.screenshot( '3D' );
var imgNames = [ 'save', 'saveAs', 'toDataURL', 'toBase64', 'data', 'width', 'height', 'format' ];
out.imageMembers = {};
for ( var j = 0; j < imgNames.length; ++j ) {
	out.imageMembers[ imgNames[j] ] = typeof img[ imgNames[j] ];
}

// --- 3. Which viewport, and what does an unknown name do? ----------------------------
var viewports = [ '3D', 'Top', 'Front', 'Right', '3d', 'bogus', '', 'window' ];
out.viewports = {};
for ( var k = 0; k < viewports.length; ++k ) {
	var label = ( viewports[k] === '' ) ? 'empty' : viewports[k];
	var p = dir + 'probe08-' + label + '.png';
	moi.view.screenshot( viewports[k] ).save( p );
	out.viewports[ label ] = fs.fileExists( p );
}
out.activeViewportName = moi.ui.getActiveViewport().name;

// --- 4. Can the size or the format be asked for? -------------------------------------
moi.view.screenshot( '3D', 800, 600 ).save( dir + 'probe08-sized.png' );  // extra args ignored
moi.view.screenshot( '3D' ).save( dir + 'probe08-3D.jpg' );               // extension honoured

// --- 5. How does it fail? ------------------------------------------------------------
var bad = dir + 'no-such-folder-probe08' + fs.getPathDelimiter() + 'x.png';
out.badPath = {
	returned: String( moi.view.screenshot( '3D' ).save( bad ) ),
	exists: fs.fileExists( bad )
};

// --- 6. Does it need a window on screen? ---------------------------------------------
var mw = moi.ui.mainWindow;
mw.minimize();
out.isMinimizedReadsTrue = mw.isMinimized;
moi.view.screenshot( '3D' ).save( dir + 'probe08-minimized.png' );
mw.restore();

// --- 7. Does a view change land before the shot? -------------------------------------
// Run this section, then take a second shot in a LATER call and compare the two.
moi.view.resetAll();
moi.ui.redrawViewports();
moi.view.screenshot( '3D' ).save( dir + 'probe08-box3d.png' );

return out;
