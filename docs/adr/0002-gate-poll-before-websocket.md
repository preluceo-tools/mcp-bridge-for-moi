# The bridge gate-polls with XMLHttpRequest before constructing a WebSocket

The bridge starts with every MoI launch, but the server is usually not running yet, so it has to
keep looking for one. It may not do that by retrying the connection. Instead it polls the server's
port with an ordinary `XMLHttpRequest` every few seconds and constructs exactly one WebSocket once
that poll succeeds. This looks like pointless indirection and is not: a failed WebSocket connect
inside MoI cannot be made silent, and a retry loop is a modal-dialog generator.

## Why the obvious retry loop is not available

A refused WebSocket connect raises a modal MoI error box roughly four seconds after the attempt:

```
WebSocket network error: Connection refused
moi://ui/SidePane.htm   line 0
```

It is the engine's own page-level error reporter, below anything script can reach. Every suppression
idiom was tried and every one failed identically: `try`/`catch` around the constructor,
`onerror`/`onclose` bound before any other property, `window.onerror` returning `true`, a capturing
`addEventListener('error')`, and deferring construction into the host window's own `setTimeout`. No
JavaScript handler fires at all, and MoI's own log never records it.

Two further findings make a retry loop worse than it first appears. Failed sockets never leave
CONNECTING — they do not time out, do not notify, and are not collected while referenced, so a loop
accumulates hung sockets and stacks one modal box per attempt. And `close()` on a socket that has
not reached OPEN killed the host window's entire script context in two independent runs: timers,
retry and all further work stopped dead, with no exception. **Never call `close()` on a socket that
is not OPEN.**

An `XMLHttpRequest` to the same dead port, by contrast, is completely silent — it reports failure to
script and raises nothing — which is what makes the gate poll the whole answer.

## Consequences

The server must serve plain HTTP on the same port as the WebSocket, purely so the gate poll has
something to ask. This is why the server binds an HTTP server and attaches the WebSocket to it
rather than listening for WebSocket connections alone.

The gate poll interval must exceed the connect stall (~4 s observed), or polls overlap.

A cleanly closed connection is silent and reports `wasClean`, but an abruptly killed server raises
the same modal box and leaves the socket reporting OPEN forever with no `onclose`. The bridge
therefore cannot rely on socket state to know the server is alive; it needs an application-level
liveness ping, and its recovery is to abandon the socket reference and return to gate polling —
never to close it.
