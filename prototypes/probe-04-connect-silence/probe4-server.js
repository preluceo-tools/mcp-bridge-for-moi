// Probe 4 server. One mode per launch, so each MoI run faces exactly one
// server behaviour and any error box can be attributed to it.
//
//   node probe4-server.js http400   plain HTTP, answers the upgrade with 400
//   node probe4-server.js wsopen    real WebSocket, accepts and stays open
//   node probe4-server.js wsclose   real WebSocket, accepts then close(1000) after 4s
//   node probe4-server.js wskill    real WebSocket, accepts then destroys the socket after 4s
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const mode = process.argv[2];
const PORT = 8766;
const LOG = path.join(__dirname, 'server-log-' + mode + '.txt');
fs.writeFileSync(LOG, '');
const log = (s) => {
  const line = new Date().toISOString() + ' ' + s + '\n';
  fs.appendFileSync(LOG, line);
  process.stdout.write(line);
};

const server = http.createServer((req, res) => {
  log('HTTP ' + req.method + ' ' + req.url);
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('PONG');
});

if (mode === 'http400') {
  server.on('upgrade', (req, socket) => {
    log('UPGRADE refused with 400 ' + req.url + ' origin=' + (req.headers.origin || '-'));
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
} else {
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => {
    log('OPEN ' + req.url + ' origin=' + (req.headers.origin || '-'));
    ws.on('message', (m) => log('MSG ' + m));
    ws.on('close', (c, r) => log('CLIENT CLOSED code=' + c + ' reason=' + r));
    ws.on('error', (e) => log('WS ERROR ' + e.message));
    ws.send('HELLO-FROM-SERVER');
    if (mode === 'wsclose') setTimeout(() => { log('server close(1000)'); ws.close(1000, 'bye'); }, 4000);
    if (mode === 'wskill') setTimeout(() => { log('server socket destroy'); ws._socket.destroy(); }, 4000);
  });
}

server.listen(PORT, '127.0.0.1', () => log('listening mode=' + mode + ' on 127.0.0.1:' + PORT));
