const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const WebSocket = require('ws');
test('existing and late viewers receive dedicated negotiation', async () => {
  const child = spawn(process.execPath, [__dirname + '/signaling.js'], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const sockets = [];
  try {
    const output = await Promise.race([once(child.stdout, 'data'), new Promise((_, reject) => setTimeout(() => reject(Error('server startup timeout')), 5000).unref())]);
    const port = String(output[0]).match(/porta (\d+)/)[1];
    async function connect() { const ws = new WebSocket('ws://127.0.0.1:' + port); sockets.push(ws); await once(ws, 'open'); return ws; }
    const host = await connect(), a = await connect(), b = await connect();
    const send = (ws, data) => ws.send(JSON.stringify({ channelId: 'room', ...data }));
    const message = ws => Promise.race([once(ws, 'message').then(([data]) => JSON.parse(data)), new Promise((_, reject) => setTimeout(() => reject(Error('message timeout')), 3000).unref())]);
    // Ping provides an ordering barrier for the first registration.
    send(a, { type: 'stream:subscribe', userId: 'a' }); const ack = message(a); send(a, { type: 'ping' }); await ack;
    let next = message(host); send(host, { type: 'stream:start', userId: 'host', protocolVersion: 2 });
    assert.equal((await next).subscriberUserId, 'a');
    next = message(host); send(b, { type: 'stream:subscribe', userId: 'b' });
    assert.equal((await next).subscriberUserId, 'b');
    next = message(b); send(host, { type: 'stream:offer', userId: 'host', targetUserId: 'b', sdpOffer: { type: 'offer', sdp: 'dedicated' } });
    assert.equal((await next).sdpOffer.sdp, 'dedicated');
  } finally { for (const ws of sockets) ws.terminate(); child.kill(); await once(child, 'exit'); }
});
