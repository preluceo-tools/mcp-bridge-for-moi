// Probe 3 / question C: is there a long-lived page in the main window we can
// reach, or inject, from a startup script - without patching any install file?
// Install as <MoI app data>\startup\Probe3UI.js.
// Runs in the bare script host (probe 3 / question D), but the main window and
// its panes already exist by the time it runs.

var DIR = moi.filesystem.getAppDataDir();
var OUT = DIR + 'probe3-ui.txt';

var lines = [];
function rec( k, v ) { lines.push( k + ' = ' + v ); }
function safe( k, fn ) { try { rec( k, fn() ); } catch ( e ) { rec( k, 'THREW: ' + e ); } }

function writeOut( tag )
{
    try
    {
        var s = moi.filesystem.openFileStream( OUT, 'w' );
        if ( s )
        {
            s.writeLine( ['# probe 3 - main window UI surface, from a startup script (' + tag + ')'].concat( lines ).join( '\n' ) );
            if ( s.close ) s.close();
        }
    }
    catch ( e ) { }
}

// ---- 1. the panels the main window already holds -------------------------
safe( 'typeof getUIPanels', function () { return typeof moi.ui.getUIPanels; } );
var panels = null;
safe( 'getUIPanels()', function () { panels = moi.ui.getUIPanels(); return typeof panels; } );
safe( 'panels.length', function () { return panels.length; } );
safe( 'panels.numItems', function () { return panels.numItems; } );

var PROPS = [ 'name', 'url', 'htmlWindow', 'htmlDocument', 'document', 'window', 'visible', 'title' ];

function describe( label, obj )
{
    if ( obj === null || typeof obj == 'undefined' ) { rec( label, '' + obj ); return; }
    rec( label, typeof obj );
    for ( var i = 0; i < PROPS.length; i++ )
    {
        var p = PROPS[i];
        try { rec( label + '.' + p, typeof obj[p] + ' :: ' + obj[p] ); }
        catch ( e ) { rec( label + '.' + p, 'THREW: ' + e ); }
    }
}

if ( panels )
{
    var n = 0;
    try { n = panels.length; } catch ( e ) { }
    if ( !n ) { try { n = panels.numItems; } catch ( e ) { } }
    rec( 'panel count used', n );
    for ( var i = 0; i < n && i < 12; i++ )
    {
        var p = null;
        try { p = panels[i]; } catch ( e ) { }
        if ( p === null || typeof p == 'undefined' ) { try { p = panels.item( i ); } catch ( e ) { } }
        describe( 'panel[' + i + ']', p );
    }
}

safe( 'typeof getUIPanel', function () { return typeof moi.ui.getUIPanel; } );
safe( 'getUIPanel("sidepane")', function () { return typeof moi.ui.getUIPanel( 'sidepane' ); } );
safe( 'getUIPanel("SidePane")', function () { return typeof moi.ui.getUIPanel( 'SidePane' ); } );
safe( 'getUIPanel(0)', function () { return typeof moi.ui.getUIPanel( 0 ); } );
safe( 'getUIPanel("moi://ui/SidePane.htm")', function () { return typeof moi.ui.getUIPanel( 'moi://ui/SidePane.htm' ); } );

describe( 'moi.ui.sidePane', moi.ui.sidePane );
try { describe( 'moi.ui.commandBar', moi.ui.commandBar ); } catch ( e ) { rec( 'moi.ui.commandBar', 'THREW: ' + e ); }
try { describe( 'moi.ui.propertiesPanel', moi.ui.propertiesPanel ); } catch ( e ) { rec( 'moi.ui.propertiesPanel', 'THREW: ' + e ); }
try { describe( 'moi.ui.sceneBrowser', moi.ui.sceneBrowser ); } catch ( e ) { rec( 'moi.ui.sceneBrowser', 'THREW: ' + e ); }
safe( 'typeof moi.ui.findElement', function () { return typeof moi.ui.findElement; } );
safe( 'findElement("MiddleBody")', function () { return typeof moi.ui.findElement( 'MiddleBody' ); } );

writeOut( 'panels' );

// ---- 2. createDialog with a moi:// URL, the form probe 02 left untested ----
// doModal() is deliberately NOT called: probe 02 found it blocks forever.
// The dialog pages write their own marker file at parse time, so the marker is
// the evidence that the page actually loaded.

function tryDialog( label, url )
{
    try
    {
        var d = moi.ui.createDialog( url, '', moi.ui.mainWindow );
        rec( label, 'createDialog returned ' + typeof d );
        if ( d )
        {
            var M = [ 'htmlWindow', 'htmlDocument', 'show', 'doModal', 'close', 'visible' ];
            for ( var j = 0; j < M.length; j++ )
            {
                try { rec( label + '.' + M[j], typeof d[M[j]] ); }
                catch ( e ) { rec( label + '.' + M[j], 'THREW: ' + e ); }
            }
            try { if ( typeof d.show == 'function' ) { d.show(); rec( label + '.show()', 'called' ); } }
            catch ( e ) { rec( label + '.show()', 'THREW: ' + e ); }
        }
    }
    catch ( e ) { rec( label, 'THREW: ' + e ); }
    writeOut( label );
}

tryDialog( 'createDialog moi://commands/', 'moi://commands/Probe3Host.htm' );
tryDialog( 'createDialog moi://appdata/', 'moi://appdata/commands/Probe3Host.htm' );
tryDialog( 'createDialog moi://ui/', 'moi://ui/Probe3Host.htm' );

// ---- 3. does a user ui\ folder override the install ui\ folder? -----------
safe( 'appdata ui\ exists', function () { return moi.filesystem.dirExists( DIR + 'ui' ); } );
safe( 'getUIDir', function () { return moi.filesystem.getUIDir(); } );

writeOut( 'final' );
