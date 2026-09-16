// Probe server for the MoI bridge test.
// Answers /ping, accepts /report, logs every hit so we can see what MoI managed to reach.
const http = require('http');
const fs = require('fs');
const path = require('path');

const LOG = path.join(__dirname, 'server-log.txt');
fs.writeFileSync(LOG, '');

function log(line) {
  const stamp = new Date().toISOString();
  fs.appendFileSync(LOG, stamp + ' ' + line + '\n');
  console.log(stamp + ' ' + line);
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    log('HIT ' + req.method + ' ' + req.url +
        ' origin=' + (req.headers.origin || '-') +
        ' ua=' + (req.headers['user-agent'] || '-') +
        (body ? ' body=' + JSON.stringify(body.slice(0, 2000)) : ''));
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*',
    });
    res.end('PONG-FROM-SERVER');
  });
});

// A WebSocket attempt shows up here as an HTTP upgrade. We do not complete the
// handshake — just seeing the upgrade arrive proves the API exists and the
// origin was allowed to make the connection.
server.on('upgrade', (req, socket) => {
  log('UPGRADE ' + req.url +
      ' origin=' + (req.headers.origin || '-') +
      ' key=' + (req.headers['sec-websocket-key'] || '-'));
  socket.destroy();
});

server.listen(8765, '127.0.0.1', () => log('listening on 127.0.0.1:8765'));
