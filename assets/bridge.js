// mcp-bridge-for-moi bridge — install into <MoI app data>\startup\
//
// Runs at MoI launch in the bare script host, which has `moi` and `JSON` and nothing
// else: no networking, no timers, no window. By the time it runs the UI is up, so it
// borrows the side pane's window — a live WebKit context with XMLHttpRequest,
// WebSocket and setTimeout — and does all its work there.
//
// ES5 only. No let/const, no arrow functions, no Promise.
//
// Two rules here are not style, they are load-bearing (see docs/adr/0002):
//   1. Never construct a WebSocket speculatively. A refused connect raises a modal MoI
//      error box that no handler can suppress, and the socket never leaves CONNECTING.
//      Always gate on a plain XMLHttpRequest first, which fails silently.
//   2. Never call close() on a socket that is not OPEN. It kills this window's entire
//      script context: timers, retries and all.
//
// MIT licensed — see LICENSE-bridge. The server it talks to is GPL v3.

/* global moi */
( function () {
	'use strict';

	var PROTOCOL = 5;   // 5: object records carry isSolid
	var GATE_POLL_MS = 5000;   // must exceed the ~4s connect stall, or polls overlap
	var PING_MS = 15000;
	var PING_TIMEOUT_MS = 45000;

	var w = null;              // the side pane's window
	var socket = null;
	var connecting = false;
	var lastPong = 0;
	var lastTick = 0;          // when tick() last ran, to tell a wake from a dead server

	function log( message ) {
		try {
			// moi.log adds no line break of its own; without one, messages run together in the log.
			moi.log( '[mcp-bridge-for-moi] ' + message + '\n' );
		} catch ( e ) {
			// moi.log is best-effort; never let logging break the bridge.
		}
	}

	// --- handshake file ------------------------------------------------------

	// MoI's app-data folder, always ending in the path delimiter. The server splices its own
	// copy into scripts (APP_DATA_DIR in src/scripts.ts); change one, change both.
	function appDataDir() {
		var dir = moi.filesystem.getAppDataDir();
		var sep = moi.filesystem.getPathDelimiter();
		return dir.charAt( dir.length - 1 ) === sep ? dir : dir + sep;
	}

	function handshakePath() {
		return appDataDir() + 'mcp-bridge-for-moi-handshake.json';
	}

	// Returns { port, token, protocol } or null. Null is the normal case: the server is
	// simply not running. Never throws.
	function readHandshake() {
		var path = handshakePath();
		var stream = null;
		try {
			if ( !moi.filesystem.fileExists( path ) ) return null;
			stream = moi.filesystem.openFileStream( path, 'r' );
			if ( !stream ) return null;
			// readLine does NOT signal end of file — at EOF it keeps returning empty
			// strings rather than null, so an unguarded loop here never returns and the
			// bridge goes silent forever. Stop on the first empty line, and keep a hard
			// guard behind that. The server writes the handshake as a single line.
			var text = '';
			var guard = 0;
			while ( guard < 16 ) {
				var line = stream.readLine();
				if ( !line ) break;
				text += line;
				guard++;
			}
			stream.close();
			stream = null;
			var parsed = JSON.parse( text );
			if ( !parsed || !parsed.port || !parsed.token ) return null;
			return parsed;
		} catch ( e ) {
			if ( stream ) { try { stream.close(); } catch ( e2 ) {} }
			return null;
		}
	}

	// --- the eval prelude ----------------------------------------------------
	// Injected ahead of every script the agent sends, so it has house helpers and does
	// not have to rediscover that MoI objects do not enumerate.

	// prelude-begin: the tests read the prelude from here to prelude-end.
	var PRELUDE = [
		'function pt( p ) {',
		'  if ( !p ) return null;',
		'  return { x: p.x, y: p.y, z: p.z };',
		'}',
		// The one way a script turns a caller's id into an object. findObject returns null for
		// an unknown id but throws on one that is not a GUID, or is the all-zero one; either
		// way the object is not there, so both come back null.
		'function findById( id ) {',
		'  try { return moi.geometryDatabase.findObject( id ); } catch ( e ) { return null; }',
		'}',
		// The bounding box object\'s members are not used anywhere in the stock commands,
		// so its shape is unverified. Report null rather than throwing if it is not min/max.
		'function bbox( o ) {',
		'  try {',
		'    var b = o.getBoundingBox();',
		'    if ( !b || !b.min || !b.max ) return null;',
		'    return { min: pt( b.min ), max: pt( b.max ) };',
		'  } catch ( e ) {',
		'    return null;',
		'  }',
		'}',
		// Object type codes, established by live probe (docs/research/probe-11-object-types.md).
		// A code the probe never observed is reported as 'unknown', never guessed.
		'var TYPE_NAMES = { 1: \'curve segment\', 2: \'curve\', 3: \'brep\', 4: \'face\', 6: \'point\' };',
		'function toJson( o ) {',
		'  if ( !o ) return null;',
		'  return {',
		'    id: o.id,',
		'    name: o.name,',
		'    type: o.type,',
		'    typeName: TYPE_NAMES[ o.type ] || \'unknown\',',
		'    styleIndex: o.styleIndex,',
		'    hidden: o.hidden,',
		'    locked: o.locked,',
		'    selected: o.selected,',
		// A property, not a method (probe-11). True only for a closed solid.
		'    isSolid: o.isSolidBRep === true,',
		'    bbox: bbox( o )',
		'  };',
		'}',
		// Capture what a factory produced by diffing the scene around it.
		// getCreatedObjects() is only valid before commit() for some factories and
		// never populated for others (the curve family), and getLastCreated() is not
		// reliable either - so neither can be used generally. A diff always works.
		// MoI commits a factory that cannot do what it was asked without any error and
		// changes nothing, so an empty diff warns. Never an error: the calc* factories and
		// backgroundimage succeed empty. Every capture in this run is counted, and its
		// warning recorded, for moi_eval to repeat after the script's value; the record
		// is a local of this one script run, so it never leaks into the next call.
		'var __moiMcpCaptures = { count: 0, warnings: [] };',
		'function capture( fn ) {',
		'  var db = moi.geometryDatabase;',
		'  var before = {};',
		'  var objs = db.getObjects();',
		'  for ( var i = 0; i < objs.length; ++i ) before[ objs.item( i ).id ] = true;',
		'  var index = ++__moiMcpCaptures.count;',
		'  var result = fn();',
		'  var after = db.getObjects();',
		'  var made = [];',
		'  for ( var j = 0; j < after.length; ++j ) {',
		'    var o = after.item( j );',
		'    if ( before[ o.id ] ) delete before[ o.id ];',
		'    else made.push( toJson( o ) );',
		'  }',
		'  var consumed = [];',
		'  for ( var id in before ) consumed.push( id );',
		'  var out = { result: ( result === undefined ? null : result ), created: made, consumed: consumed };',
		'  if ( !made.length && !consumed.length ) {',
		'    out.warning = \'Nothing was created or consumed. If this committed a factory, it most likely failed: \' +',
		'      \'MoI commits a factory that cannot do what it was asked without any error \' +',
		'      \'(e.g. a fillet radius larger than the edge allows). Factories that only measure \' +',
		'      \'(the calc* factories) or add a background image create nothing when they succeed.\';',
		'    __moiMcpCaptures.warnings.push( { index: index, text: out.warning } );',
		'  }',
		'  return out;',
		'}',
		'function listToJson( list ) {',
		'  var out = [];',
		'  if ( !list ) return out;',
		'  for ( var i = 0; i < list.length; ++i ) out.push( toJson( list.item( i ) ) );',
		'  return out;',
		'}',
		// An object's faces or edges as { index, bbox }; index is the position in
		// getFaces() / getEdges(), so obj.getEdges().item( index ) gets the edge back.
		'function subRows( list ) {',
		'  var out = [];',
		'  if ( !list ) return out;',
		'  for ( var i = 0; i < list.length; ++i ) out.push( { index: i, bbox: bbox( list.item( i ) ) } );',
		'  return out;',
		'}',
		'function faces( o ) { return ( o && o.getFaces ) ? subRows( o.getFaces() ) : []; }',
		'function edges( o ) { return ( o && o.getEdges ) ? subRows( o.getEdges() ) : []; }',
		''
	].join( '\n' );
	// prelude-end

	// --- one undo unit per call ----------------------------------------------
	// MoI only records an undo unit around a *command*. Factories committed straight
	// from here change the document but never reach the undo stack at all, so Ctrl+Z
	// walks past the agent's work into the user's own history. The fix is to run the
	// agent's script as a command: `moi.command.execCommand( name )` on a script in the
	// commands folder, whose whole run — however many factories it commits — collapses
	// into exactly one undo step. See docs/research/probe-09-undo.md.
	//
	// The command file's contents never change, because MoI caches a command script by
	// name on first use and rewriting the file has no effect afterwards. The script to
	// run and its result travel on the side pane window instead, as strings: objects do
	// not survive the trip between the bare script host and this WebKit context, strings
	// do.

	var COMMAND_NAME = 'mcp-bridge-for-moi-eval';
	var POLL_MS = 25;
	var EVAL_TIMEOUT_MS = 25000;   // under the server's 30s call timeout, so this message wins

	var COMMAND_SOURCE = [
		'// Written by the mcp-bridge-for-moi bridge at MoI startup. Do not edit: it is overwritten.',
		'// Runs the agent\'s script as a command, so everything it commits is one undo unit.',
		'( function () {',
		'	var w = moi.ui.sidePane.window;',
		'	var src = w.__moiMcpScript;',
		'	var id = w.__moiMcpId;',
		'	if ( !src ) return;   // repeat-last-command with nothing pending',
		'	w.__moiMcpScript = null;',
		'	try {',
		'		var fn = new w.Function( "moi", src );',
		'		var value = fn( moi );',
		'		// Prove it survives the wire here, where we can still name the offender.',
		'		w.__moiMcpResult = JSON.stringify( { id: id, ok: true, value: ( value === undefined ? null : value ) } );',
		'	} catch ( e ) {',
		'		w.__moiMcpResult = JSON.stringify( { id: id, ok: false, message: ( e && e.message ) ? String( e.message ) : String( e ) } );',
		'	}',
		'}() );'
	];

	function installCommand() {
		var fs = moi.filesystem;
		var path = appDataDir() + 'commands' + fs.getPathDelimiter() + COMMAND_NAME + '.js';
		var stream = null;
		try {
			stream = fs.openFileStream( path, 'w' );
			if ( !stream ) return false;
			for ( var i = 0; i < COMMAND_SOURCE.length; ++i ) stream.writeLine( COMMAND_SOURCE[i] );
			stream.close();
			return fs.fileExists( path );
		} catch ( e ) {
			if ( stream ) { try { stream.close(); } catch ( e2 ) {} }
			return false;
		}
	}

	// --- request queue -------------------------------------------------------
	// Dispatching is asynchronous now, so two overlapping requests would trample each
	// other's script and result. One at a time.

	var queue = [];
	var busy = false;

	// A reply goes only to the socket its request came in on. Once that socket is abandoned
	// nobody is waiting for it, and a newer socket's server never asked.
	function sendReply( msg, reply ) {
		if ( !socket || msg.from !== socket ) return;
		try {
			socket.send( JSON.stringify( reply ) );
		} catch ( e ) {
			log( 'failed to send reply: ' + e );
		}
	}

	function refuse( msg, code, message ) {
		sendReply( msg, { id: msg.id, ok: false, value: null, error: { code: code, message: message } } );
	}

	function failReply( msg, message ) {
		refuse( msg, 'moi_error', message );
	}

	function handleRequest( msg, from ) {
		msg.from = from;
		queue.push( msg );
		pump();
	}

	// Checked here rather than by the script, so no script can answer as if it were this.
	function noUnits() {
		try {
			return moi.geometryDatabase.units === 'No unit system';
		} catch ( e ) {
			return false;
		}
	}

	// Runs a read straight here, synchronously, so it never goes through the command path
	// and never ends a command the user is in. Synchronous is what keeps it serialised with
	// dispatched calls: nothing else can run until it returns.
	function runDirect( msg ) {
		var value;
		try {
			var fn = new w.Function( 'moi', PRELUDE + '\n' + msg.script );
			value = fn( moi );
		} catch ( e ) {
			failReply( msg, ( e && e.message ) ? String( e.message ) : String( e ) );
			return;
		}
		sendReply( msg, { id: msg.id, ok: true, value: ( value === undefined ? null : value ) } );
	}

	// The command the user is in, or '' for none. Starting a command ends the running one,
	// so a command call must not dispatch while this is set. Our own command's name can
	// still read here for a moment after it has left its result, and is not the user's.
	// See docs/research/probe-10-running-command.md.
	function runningCommand() {
		var name;
		try {
			name = moi.command.currentCommandName;
		} catch ( e ) {
			return null;   // cannot tell: refuse rather than risk ending the user's command
		}
		if ( !name || name === COMMAND_NAME ) return '';
		return String( name );
	}

	function pump() {
		if ( busy || !queue.length ) return;
		var msg = queue.shift();
		if ( msg.op !== 'eval' ) {
			refuse( msg, 'script_error', 'Unknown op: ' + msg.op );
			pump();
			return;
		}
		if ( msg.needsUnits && noUnits() ) {
			// The server words the message; the code is what it goes by.
			refuse( msg, 'no_units', 'The open document has no unit system.' );
			pump();
			return;
		}
		if ( msg.direct ) {
			runDirect( msg );
			pump();
			return;
		}
		var running = runningCommand();
		if ( running !== '' ) {
			refuse( msg, 'command_running',
				'MoI is running ' + ( running ? 'the ' + running + ' command' : 'a command' ) +
				'. Finish or cancel it, then try again.' );
			pump();
			return;
		}
		busy = true;
		w.__moiMcpScript = PRELUDE + '\n' + msg.script;
		w.__moiMcpId = String( msg.id );
		w.__moiMcpResult = null;
		try {
			moi.command.execCommand( COMMAND_NAME );
		} catch ( e ) {
			w.__moiMcpScript = null;
			busy = false;
			failReply( msg, 'could not start ' + COMMAND_NAME + ': ' + e );
			pump();
			return;
		}
		awaitResult( msg, ( new Date() ).getTime() );
	}

	function awaitResult( msg, startedAt ) {
		var id = msg.id;
		var raw = w.__moiMcpResult;
		if ( raw === null || raw === undefined ) {
			// A safety net only: a running command is refused before dispatch, never waited on.
			if ( ( new Date() ).getTime() - startedAt > EVAL_TIMEOUT_MS ) {
				// The command clears the script when it picks it up, so a script still here
				// never started: withdrawing it means it never will.
				var started = !w.__moiMcpScript;
				w.__moiMcpScript = null;
				busy = false;
				var secs = EVAL_TIMEOUT_MS / 1000;
				refuse( msg, 'timeout', started
					? 'The script started but did not finish within ' + secs + 's. It may still finish and ' +
						'change the document: check the scene (e.g. a narrow moi_eval query or get_scene) ' +
						'before running it again.'
					: 'MoI did not start the script within ' + secs + 's. It did not run and nothing changed.' );
				pump();
				return;
			}
			w.setTimeout( function () { awaitResult( msg, startedAt ); }, POLL_MS );
			return;
		}
		w.__moiMcpResult = null;
		var parsed = null;
		try {
			parsed = JSON.parse( raw );
		} catch ( e ) {
			parsed = null;
		}
		// A call that timed out can still finish later and drop its answer here, where
		// the next call would otherwise read it as its own. Every result carries the id
		// it belongs to; anything else is somebody's late reply and is discarded.
		if ( parsed && String( parsed.id ) !== String( id ) ) {
			w.setTimeout( function () { awaitResult( msg, startedAt ); }, POLL_MS );
			return;
		}
		busy = false;
		if ( !parsed ) failReply( msg, 'the bridge command returned something that is not JSON' );
		else if ( parsed.ok ) sendReply( msg, { id: id, ok: true, value: ( parsed.value === undefined ? null : parsed.value ) } );
		else failReply( msg, parsed.message );
		pump();
	}

	// --- connection ----------------------------------------------------------

	// Abandon the socket without closing it. close() on anything not OPEN freezes this
	// whole script context, and an abruptly dead server leaves a socket reporting OPEN
	// forever, so there is no state in which closing is worth the risk.
	function abandon( why ) {
		if ( socket ) log( 'abandoning connection: ' + why );
		// Its server has given up on everything it sent: run none of it. A call already in
		// flight finishes, but its reply is dropped (see sendReply).
		queue.length = 0;
		socket = null;
		connecting = false;
	}

	function connect( info ) {
		connecting = true;
		var url = 'ws://127.0.0.1:' + info.port + '/bridge?token=' +
			encodeURIComponent( info.token ) + '&protocol=' + PROTOCOL;
		var ws;
		try {
			ws = new w.WebSocket( url );
		} catch ( e ) {
			connecting = false;
			return;
		}
		ws.onopen = function () {
			socket = ws;
			connecting = false;
			lastPong = ( new Date() ).getTime();
			log( 'attached to server on port ' + info.port );
		};
		ws.onmessage = function ( ev ) {
			// An abandoned socket may still be delivering. Its requests are not run: their
			// replies would go to whatever `socket` is now, or nowhere.
			if ( socket !== ws ) return;
			var msg;
			try {
				msg = JSON.parse( ev.data );
			} catch ( e ) {
				return;
			}
			if ( msg && msg.t === 'pong' ) {
				lastPong = ( new Date() ).getTime();
				return;
			}
			if ( msg && typeof msg.id === 'number' ) handleRequest( msg, ws );
		};
		ws.onclose = function () {
			if ( socket === ws ) abandon( 'server closed' );
			connecting = false;
		};
		ws.onerror = function () {
			// Reached only for errors after a successful open; a failed connect never
			// gets here (the engine raises its own box instead, which is why we gate).
			if ( socket === ws ) abandon( 'socket error' );
			connecting = false;
		};
	}

	// --- the loop ------------------------------------------------------------

	function gatePoll() {
		var info = readHandshake();
		if ( !info ) return;
		var xhr = new w.XMLHttpRequest();
		// An XHR to a dead port is completely silent, which is the entire reason it
		// stands in front of the WebSocket.
		xhr.onreadystatechange = function () {
			if ( xhr.readyState !== 4 ) return;
			// Check the body, not just the status. A stale handshake file can name a port
			// that some unrelated local service has since been given, and answering 200 is
			// not enough to earn a WebSocket — a wrong guess costs a modal error box.
			if ( xhr.status !== 200 ) return;
			if ( String( xhr.responseText ).indexOf( 'mcp-bridge-for-moi' ) !== 0 ) return;
			// Another MoI holds a live session: a WebSocket now would be refused, with a box.
			if ( String( xhr.responseText ) === 'mcp-bridge-for-moi busy' ) return;
			if ( !socket && !connecting ) connect( info );
		};
		try {
			xhr.open( 'GET', 'http://127.0.0.1:' + info.port + '/gate', true );
			xhr.send( null );
		} catch ( e ) {
			// Silent by design.
		}
	}

	function tick() {
		try {
			var now = ( new Date() ).getTime();
			// Standby freezes timers, so the first tick after wake sees a huge gap. That is
			// a resume, not a dead server: loopback TCP survives standby. Restart the pong
			// clock from now; a server that is really gone still misses the next 45 s.
			var resumed = lastTick && now - lastTick > 2 * PING_MS;
			lastTick = now;
			if ( socket ) {
				if ( resumed ) {
					log( 'resumed after ' + Math.round( ( now - lastPong ) / 1000 ) + 's; keeping connection' );
					lastPong = now;
				}
				if ( now - lastPong > PING_TIMEOUT_MS ) {
					// An abruptly killed server leaves the socket reporting OPEN with no
					// close event, so socket state cannot be trusted. The ping is the
					// only liveness signal there is.
					abandon( 'no pong within ' + ( PING_TIMEOUT_MS / 1000 ) + 's' );
				} else {
					try {
						socket.send( JSON.stringify( { t: 'ping' } ) );
					} catch ( e ) {
						abandon( 'ping failed' );
					}
				}
			}
			if ( !socket && !connecting ) gatePoll();
		} catch ( e ) {
			log( 'tick error: ' + e );
		}
		w.setTimeout( tick, socket ? PING_MS : GATE_POLL_MS );
	}

	function start() {
		try {
			w = moi.ui.sidePane.window;
			if ( !w || !w.WebSocket || !w.XMLHttpRequest || !w.setTimeout ) {
				log( 'side pane window is not usable; bridge not started' );
				return;
			}
			if ( moi.majorVersionNumber !== 4 ) {
				log( 'this bridge supports MoI 4 only; found version ' + moi.version );
				return;
			}
			// Without the command file every call is unundoable, so this is not optional
			// and there is no fallback path that quietly gives up the undo guarantee.
			if ( !installCommand() ) {
				log( 'could not write ' + COMMAND_NAME + '.js into the MoI commands folder; bridge not started' );
				return;
			}
			w.setTimeout( tick, 1000 );
			log( 'bridge armed' );
		} catch ( e ) {
			log( 'failed to start: ' + e );
		}
	}

	start();
}() );
