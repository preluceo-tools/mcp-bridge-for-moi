// MoI bridge probe. ES5 only (JavaScriptCore, Qt 5.4.1 WebKit).
// Run as: MoI.exe "<this file>"
// Writes findings to probe-result.txt. Nothing here modifies any model or setting.

var DIR = '<scratch folder>\\moiprobe\\';
var OUT = DIR + 'probe-result.txt';

var lines = [];

function rec(key, val) {
    lines.push(key + ' = ' + val);
}

function safe(label, fn) {
    try {
        rec(label, fn());
    } catch (e) {
        rec(label, 'THREW: ' + e);
    }
}

function keysOf(obj) {
    var ks = [];
    try {
        for (var k in obj) { ks.push(k); }
    } catch (e) {
        return 'enumeration threw: ' + e;
    }
    return ks.join(',');
}

// ---- does the script host even run, and what is it? ----
safe('moi.version', function () { return moi.version; });
safe('moi.majorVersionNumber', function () { return moi.majorVersionNumber; });
rec('this-is-global typeof', typeof this);
rec('global keys', keysOf(this));

// ---- the networking question ----
rec('typeof XMLHttpRequest', typeof XMLHttpRequest);
rec('typeof WebSocket', typeof WebSocket);
rec('typeof window', typeof window);
rec('typeof document', typeof document);
rec('typeof setTimeout', typeof setTimeout);
rec('typeof setInterval', typeof setInterval);
rec('typeof localStorage', typeof localStorage);
rec('typeof ActiveXObject', typeof ActiveXObject);
rec('typeof JSON', typeof JSON);
rec('typeof Promise', typeof Promise);

safe('moi.ui exists', function () { return typeof moi.ui; });
safe('moi.ui keys', function () { return keysOf(moi.ui); });
safe('moi.ui.commandUI', function () { return typeof moi.ui.commandUI; });
safe('moi.ui.commandUI.htmlWindow', function () {
    var c = moi.ui.commandUI;
    if (!c) { return 'no commandUI (expected: no command is running)'; }
    return typeof c.htmlWindow;
});
safe('moi.ui.mainWindow', function () { return typeof moi.ui.mainWindow; });
safe('moi.ui.mainWindow keys', function () { return keysOf(moi.ui.mainWindow); });
safe('mainWindow.htmlWindow', function () { return typeof moi.ui.mainWindow.htmlWindow; });
safe('mainWindow.htmlWindow.XMLHttpRequest', function () {
    var w = moi.ui.mainWindow.htmlWindow;
    return w ? typeof w.XMLHttpRequest : 'no htmlWindow';
});
safe('mainWindow.htmlWindow.WebSocket', function () {
    var w = moi.ui.mainWindow.htmlWindow;
    return w ? typeof w.WebSocket : 'no htmlWindow';
});
safe('mainWindow.htmlWindow keys', function () {
    var w = moi.ui.mainWindow.htmlWindow;
    return w ? keysOf(w) : 'no htmlWindow';
});

// ---- filesystem surface ----
safe('moi.filesystem keys', function () { return keysOf(moi.filesystem); });
safe('getTempDir', function () { return moi.filesystem.getTempDir(); });
safe('getAppDataDir', function () { return moi.filesystem.getAppDataDir(); });
safe('getCommandsDir', function () { return moi.filesystem.getCommandsDir(); });
safe('getProcessDir', function () { return moi.filesystem.getProcessDir(); });
safe('getExecutableCommandLineArgs', function () {
    var a = moi.getExecutableCommandLineArgs;
    if (typeof a === 'function') { return 'function -> ' + a(); }
    return typeof a + ' -> ' + a;
});

// ---- Bridge 2: shell out and capture stdout ----
safe('shellExecute echo', function () {
    var res = moi.filesystem.shellExecute('cmd.exe', '/c echo HELLO_FROM_CHILD', true);
    if (res === undefined || res === null) { return 'returned ' + res; }
    return 'keys=[' + keysOf(res) + '] output=' + JSON.stringify(String(res.output));
});

// ---- write what we have BEFORE trying anything that might block ----
function writeOut(tag) {
    var report = ['# MoI probe result (' + tag + ')'].concat(lines).join('\n') + '\n';
    var notes = [];
    try {
        var s = moi.filesystem.openFileStream(OUT, 'w');
        if (!s) {
            notes.push('openFileStream returned ' + s);
        } else {
            notes.push('stream keys=[' + keysOf(s) + ']');
            var names = ['write', 'writeLine', 'writeString', 'print', 'puts', 'writeText'];
            var wrote = false;
            for (var i = 0; i < names.length; i++) {
                if (typeof s[names[i]] === 'function') {
                    try {
                        s[names[i]](report + '# writer: ' + names[i] + '\n# notes: ' + notes.join(' | ') + '\n');
                        wrote = true;
                        break;
                    } catch (e) {
                        notes.push(names[i] + ' threw ' + e);
                    }
                }
            }
            if (!wrote) { notes.push('NO WORKING WRITE METHOD'); }
            if (typeof s.close === 'function') { s.close(); }
        }
    } catch (e) {
        notes.push('openFileStream threw ' + e);
    }

    // Belt and braces: echo a marker through the shell so we learn something
    // even if the file stream API is not what we assumed.
    try {
        moi.filesystem.shellExecute(
            'cmd.exe',
            '/c echo ' + tag + ' streamnotes: ' + notes.join(' ~ ').replace(/[<>|&^"]/g, '_') +
                ' > "' + DIR + 'probe-fallback-' + tag + '.txt"',
            true
        );
    } catch (e2) { /* nothing left to try */ }
}

writeOut('phase1');

// ---- the risky part: synchronous XHR to the local probe server ----
var X = null;
if (typeof XMLHttpRequest !== 'undefined') {
    X = XMLHttpRequest;
    rec('XHR source', 'global');
} else {
    try {
        var w = moi.ui.mainWindow ? moi.ui.mainWindow.htmlWindow : null;
        if (w && w.XMLHttpRequest) {
            X = w.XMLHttpRequest;
            rec('XHR source', 'mainWindow.htmlWindow');
        }
    } catch (e) {
        rec('XHR source', 'lookup threw: ' + e);
    }
}
if (!X) { rec('XHR source', 'NONE FOUND'); }

if (X) {
    try {
        var x = new X();
        x.open('GET', 'http://127.0.0.1:8765/ping?from=moi-script-host', false);
        x.send(null);
        rec('XHR sync status', x.status);
        rec('XHR sync responseText', x.responseText);
    } catch (e) {
        rec('XHR sync', 'THREW: ' + e);
    }
}

writeOut('phase2');

moi.exit(true);
