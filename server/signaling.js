'use strict';

/**
 * Servidor de Sinalização WebRTC para o Discord Mod
 * Permite que usuários transmitam e assistam telas em 1080p60
 * de forma 100% desacoplada dos gateways de mídia da Discord Inc.
 * Compatível com Render Cloud (24/7 gratuito), VPS ou execução local.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

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
      let version = '1.0.0-stable';
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

  if (req.url && req.url.startsWith('/api/mod/mobile/release/bundle-ota/revenge.min.js')) {
    try {
      const candidates = [
        path.join(__dirname, 'mobile', 'revenge.min.js'),
        path.join(__dirname, '..', '..', 'mobile', 'android', 'tools', 'custom-revenge.min.js'),
        'D:\\discord\\mobile\\android\\tools\\custom-revenge.min.js'
      ];
      const filePath = candidates.find(f => fs.existsSync(f));
      if (filePath) {
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*'
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Mobile revenge bundle not found');
        return;
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  if (req.url && req.url.startsWith('/api/mod/mobile/update')) {
    try {
      const candidates = [
        path.join(__dirname, 'mobile', 'mobile-bundle.js'),
        path.join(__dirname, '..', '..', 'mobile', 'dist', 'mobile-bundle.js'),
        'D:\\discord\\mobile\\dist\\mobile-bundle.js',
        path.join(__dirname, '..', 'mobile', 'dist', 'mobile-bundle.js')
      ];
      const bundlePath = candidates.find(f => fs.existsSync(f));
      let code = '';
      if (bundlePath) {
        code = fs.readFileSync(bundlePath, 'utf8');
      }

      let version = '1.1.0-mobile';
      const configCandidates = [
        path.join(__dirname, 'mobile', 'config.json'),
        path.join(__dirname, '..', '..', 'mobile', 'config.json'),
        'D:\\discord\\mobile\\config.json',
        path.join(__dirname, '..', 'mobile', 'config.json')
      ];
      const configPath = configCandidates.find(f => fs.existsSync(f));
      if (configPath) {
        try {
          const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          if (cfg.version) version = cfg.version;
        } catch {}
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        version,
        updatedAt: new Date().toISOString(),
        code
      }));
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  if (req.url && req.url.startsWith('/plugin')) {
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      let filename = 'manifest.json';
      if (parsedUrl.pathname.endsWith('index.js')) filename = 'index.js';
      else if (parsedUrl.pathname.endsWith('manifest.json')) filename = 'manifest.json';

      const candidates = [
        path.join(__dirname, 'plugin', filename),
        path.join(__dirname, '..', '..', 'mobile', 'plugin', filename),
        path.join('D:\\discord\\mobile\\plugin', filename)
      ];
      const filePath = candidates.find(f => fs.existsSync(f));
      if (filePath) {
        const contentType = filename.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'application/json; charset=utf-8';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*'
        });
        res.end(fs.readFileSync(filePath));
        return;
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Plugin file not found');
        return;
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  if (req.url && (req.url === '/download/apk' || req.url === '/api/apk')) {
    try {
      const candidates = [
        path.join(__dirname, 'dist', 'revenge-manager-1.3.2.apk'),
        'D:\\discord\\mobile\\dist\\revenge-manager-1.3.2.apk'
      ];
      const apkPath = candidates.find(f => fs.existsSync(f));
      if (apkPath) {
        res.writeHead(200, {
          'Content-Type': 'application/vnd.android.package-archive',
          'Content-Disposition': 'attachment; filename="revenge-manager-1.3.2.apk"'
        });
        fs.createReadStream(apkPath).pipe(res);
        return;
      }
    } catch (e) {}
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Discord Mod Signaling Server - Online no Render Cloud 24/7');
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
      console.log(`[signaling] Transmissão iniciada no canal ${channelId} por ${userId}`);

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
        const peers = signalingChannels.get(channelId);
        const broadcasterWs = peers?.get(active.broadcasterUserId);
        if (broadcasterWs && broadcasterWs.readyState === 1) {
          broadcasterWs.send(JSON.stringify({
            type: 'stream:viewer-request',
            channelId,
            subscriberUserId: userId
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'stream:available',
            channelId,
            broadcasterUserId: active.broadcasterUserId,
            sdpOffer: active.sdpOffer
          }));
        }
      }
    } else if (type === 'stream:offer') {
      const peers = signalingChannels.get(channelId);
      if (peers && targetUserId) {
        const targetWs = peers.get(targetUserId);
        if (targetWs && targetWs.readyState === 1) {
          targetWs.send(JSON.stringify({
            type: 'stream:available',
            channelId,
            broadcasterUserId: userId,
            sdpOffer
          }));
        }
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

// Auto Keep-Alive para Render Cloud (mantém o plano gratuito ativo 24/7)
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_EXTERNAL_URL) {
  console.log(`[Render Keep-Alive] Monitoramento ativo para ${RENDER_EXTERNAL_URL} a cada 10 min.`);
  setInterval(() => {
    try {
      const client = RENDER_EXTERNAL_URL.startsWith('https') ? require('https') : require('http');
      client.get(`${RENDER_EXTERNAL_URL}/health`, (res) => {
        console.log(`[Render Keep-Alive] Ping executado: status ${res.statusCode}`);
      }).on('error', () => {});
    } catch {}
  }, 10 * 60 * 1000);
}

server.listen(PORT, () => {
  console.log(`[DiscordMod Signaling] Servidor ativo na porta ${PORT}`);
});
