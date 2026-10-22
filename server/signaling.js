'use strict';

/**
 * Servidor de SinalizaÃ§Ã£o WebRTC para o Discord Mod
 * Permite que usuÃ¡rios transmitam e assistam telas em 1080p60
 * de forma 100% desacoplada dos gateways de mÃ­dia da Discord Inc.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
    return;
  }

  if (req.url === '/api/mod/update') {
    try {
      const candidates = [
        path.join(__dirname, '..', 'mod'),
        'D:\\discord\\mod',
        path.join(__dirname, 'mod')
      ];
      const modDir = candidates.find(d => fs.existsSync(d)) || candidates[0];
      let version = '1.0.0';
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(modDir, 'config.json'), 'utf8'));
        if (cfg.version) version = cfg.version;
      } catch {}

      const files = {};
      for (const name of ['renderer.js', 'webrtcService.js', 'main.cjs']) {
        const filePath = path.join(modDir, name);
        if (fs.existsSync(filePath)) {
          files[name] = fs.readFileSync(filePath, 'utf8');
        }
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      });
      res.end(JSON.stringify({
        version,
        updatedAt: new Date().toISOString(),
        files
      }));
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Discord Mod Signaling Server - Online');
});

const wss = new WebSocketServer({ server });

const signalingChannels = new Map(); // channelId -> Map(userId -> ws)
const activeOffers = new Map();      // channelId -> { broadcasterUserId, sdpOffer }

wss.on('connection', (ws) => {
  ws.__alive = true;
  let registeredChannel = null;
  let registeredUser = null;

  ws.on('pong', () => { ws.__alive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'ping') {
      try { ws.send(JSON.stringify({ type: 'pong' })); } catch {}
      return;
    }

    const { type, channelId, userId, sdpOffer, sdpAnswer, candidate, targetUserId } = msg;

    if (type === 'stream:start') {
      registeredChannel = channelId;
      registeredUser = userId;
      if (!signalingChannels.has(channelId)) signalingChannels.set(channelId, new Map());
      signalingChannels.get(channelId).set(userId, ws);
      activeOffers.set(channelId, { broadcasterUserId: userId, sdpOffer });
      console.log(`[signaling] TransmissÃ£o iniciada no canal ${channelId} por ${userId}`);

      const peers = signalingChannels.get(channelId);
      for (const [subId, subWs] of peers) {
        if (subId !== userId && subWs.readyState === 1) {
          subWs.send(JSON.stringify({
            type: 'stream:available',
            channelId,
            broadcasterUserId: userId,
            sdpOffer
          }));
        }
      }
    } else if (type === 'stream:subscribe') {
      registeredChannel = channelId;
      registeredUser = userId;
      if (!signalingChannels.has(channelId)) signalingChannels.set(channelId, new Map());
      signalingChannels.get(channelId).set(userId, ws);
      console.log(`[signaling] Espectador inscrito no canal ${channelId}: ${userId}`);

      const active = activeOffers.get(channelId);
      if (active && active.broadcasterUserId !== userId) {
        ws.send(JSON.stringify({
          type: 'stream:available',
          channelId,
          broadcasterUserId: active.broadcasterUserId,
          sdpOffer: active.sdpOffer
        }));
      }
    } else if (type === 'stream:answer') {
      const peers = signalingChannels.get(channelId);
      if (peers && targetUserId) {
        const targetWs = peers.get(targetUserId);
        if (targetWs && targetWs.readyState === 1) {
          targetWs.send(JSON.stringify({
            type: 'stream:answer',
            channelId,
            subscriberUserId: userId,
            sdpAnswer
          }));
        }
      }
    } else if (type === 'stream:ice-candidate') {
      const peers = signalingChannels.get(channelId);
      if (peers) {
        if (targetUserId) {
          const targetWs = peers.get(targetUserId);
          if (targetWs && targetWs.readyState === 1) {
            targetWs.send(JSON.stringify({
              type: 'stream:ice-candidate',
              channelId,
              fromUserId: userId,
              candidate
            }));
          }
        } else {
          for (const [peerId, peerWs] of peers) {
            if (peerId !== userId && peerWs.readyState === 1) {
              peerWs.send(JSON.stringify({
                type: 'stream:ice-candidate',
                channelId,
                fromUserId: userId,
                candidate
              }));
            }
          }
        }
      }
    } else if (type === 'stream:stop') {
      if (activeOffers.get(channelId)?.broadcasterUserId === userId) {
        activeOffers.delete(channelId);
      }
      const peers = signalingChannels.get(channelId);
      if (peers) {
        for (const [subId, subWs] of peers) {
          if (subId !== userId && subWs.readyState === 1) {
            subWs.send(JSON.stringify({ type: 'stream:stopped', channelId, userId }));
          }
        }
      }
    }
  });

  const cleanup = () => {
    if (registeredChannel && registeredUser) {
      const peers = signalingChannels.get(registeredChannel);
      if (peers) {
        peers.delete(registeredUser);
        if (peers.size === 0) signalingChannels.delete(registeredChannel);
      }
      if (activeOffers.get(registeredChannel)?.broadcasterUserId === registeredUser) {
        activeOffers.delete(registeredChannel);
        const p = signalingChannels.get(registeredChannel);
        if (p) {
          for (const [, pWs] of p) {
            if (pWs.readyState === 1) pWs.send(JSON.stringify({ type: 'stream:stopped', channelId: registeredChannel }));
          }
        }
      }
    }
  };

  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

// Heartbeat ping a cada 30 segundos
setInterval(() => {
  for (const client of wss.clients) {
    if (!client.__alive) {
      client.terminate();
      continue;
    }
    client.__alive = false;
    client.ping();
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`[DiscordMod Signaling] Servidor ativo na porta ${PORT}`);
});
