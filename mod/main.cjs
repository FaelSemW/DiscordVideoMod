'use strict';
const { app, webContents, session, desktopCapturer } = require('electron');

if (app && app.commandLine) {
  try {
    app.commandLine.appendSwitch('force-fieldtrials', 'WebRTC-IPv6/Disabled/');
    app.commandLine.appendSwitch('disable-ipv6');
    app.commandLine.appendSwitch('dns-result-order', 'ipv4first');
  } catch (e) {}
}

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const root = process.env.RAFA_DISCORD_MOD_ROOT || path.join(__dirname, '..');

if (!global.__rafaVideoTestLoaded) {
  global.__rafaVideoTestLoaded = true;
  const logDir = path.join(root, 'runtime');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch (e) {}

  function log(status, extra = {}) {
    try {
      fs.appendFileSync(
        path.join(logDir, 'video-mod.jsonl'),
        JSON.stringify({ time: new Date().toISOString(), status, ...extra }) + '\n'
      );
    } catch (e) {}
  }

  // --- Auto-Updater Client Logic ---
  function fetchUpdatePayload(targetUrl, timeoutMs = 5000) {
    return new Promise((resolve) => {
      try {
        const u = new URL(targetUrl);
        const client = u.protocol === 'https:' ? https : http;
        const req = client.get(u, { timeout: timeoutMs }, (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            return resolve(null);
          }
          let buffer = '';
          res.setEncoding('utf8');
          res.on('data', chunk => { buffer += chunk; });
          res.on('end', () => {
            try {
              resolve(JSON.parse(buffer));
            } catch {
              resolve(null);
            }
          });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => {
          req.destroy();
          resolve(null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function isNewerVersion(remote, local) {
    if (!remote) return false;
    if (!local) return true;
    if (remote === local) return false;
    const r = String(remote).trim().split('.').map(n => parseInt(n, 10) || 0);
    const l = String(local).trim().split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(r.length, l.length); i++) {
      const rv = r[i] || 0;
      const lv = l[i] || 0;
      if (rv > lv) return true;
      if (rv < lv) return false;
    }
    return false;
  }

  async function checkAndApplyUpdates() {
    try {
      const configPath = path.join(__dirname, 'config.json');
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
      const currentVer = cfg.version || '1.0.0';
      const updateUrl = cfg.updateUrl || (cfg.serverUrl ? cfg.serverUrl + '/api/mod/update' : 'https://discordvideomod.onrender.com/api/mod/update');

      const data = await fetchUpdatePayload(updateUrl, 5000);
      if (!data || !data.version || !data.files) return;

      if (isNewerVersion(data.version, currentVer)) {
        log('update-found', { from: currentVer, to: data.version });
        let filesUpdated = 0;
        for (const [name, content] of Object.entries(data.files)) {
          if (!['renderer.js', 'webrtcService.js', 'main.cjs'].includes(name)) continue;
          if (typeof content !== 'string' || content.length < 50) continue;
          try {
            const dest = path.join(__dirname, name);
            const tmp = dest + '.upd.tmp';
            fs.writeFileSync(tmp, content, 'utf8');
            fs.renameSync(tmp, dest);
            filesUpdated++;
          } catch (e) {
            log('update-file-err', { file: name, error: e.message });
          }
        }
        cfg.version = data.version;
        cfg.lastUpdated = new Date().toISOString();
        try { fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8'); } catch {}
        log('update-applied', { version: data.version, filesUpdated });
      }
    } catch (e) {
      log('update-check-err', { error: e.message });
    }
  }

  // Verificação de atualizações no início e a cada 2 minutos
  checkAndApplyUpdates().catch(() => {});
  const updateInterval = setInterval(() => checkAndApplyUpdates().catch(() => {}), 2 * 60 * 1000);
  updateInterval.unref();

  // Configurações do Electron: CSP permissivo para nuvem e captura de tela robusta
  if (app && typeof app.whenReady === 'function') {
    app.whenReady().then(() => {
      try {
        const ses = session?.defaultSession;
        if (ses && ses.webRequest) {
          ses.webRequest.onHeadersReceived((details, callback) => {
            const responseHeaders = details.responseHeaders || {};
            for (const header of Object.keys(responseHeaders)) {
              if (header.toLowerCase() === 'content-security-policy') {
                responseHeaders[header] = responseHeaders[header].map(rule =>
                  rule.replace(/connect-src\s+/gi, 'connect-src * ')
                );
              }
            }
            callback({ responseHeaders });
          });
        }

        if (ses && typeof ses.setDisplayMediaRequestHandler === 'function') {
          ses.setDisplayMediaRequestHandler((request, callback) => {
            desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
              if (sources && sources.length > 0) {
                const target = sources.find(s => s.id.startsWith('screen:')) || sources[0];
                log('capturing-source', { id: target.id, name: target.name });
                callback({ video: target, audio: 'loopback' });
              } else {
                callback({});
              }
            }).catch(() => callback({}));
          });
        }
      } catch (e) {
        log('display-media-handler-err', { error: e.message });
      }
    });
  }

  let enabled = true;
  try {
    enabled = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')).enabled !== false;
  } catch {
    enabled = true;
  }

  function attach(contents) {
    if (contents.__rafaVideoTestAttached) return;
    contents.__rafaVideoTestAttached = true;

    // DevTools shortcut (Ctrl+Shift+I)
    contents.on('before-input-event', (event, input) => {
      if (input.control && input.shift && input.key.toLowerCase() === 'i') {
        contents.toggleDevTools();
      }
    });

    let timer, attempts = 0, busy = false, lastStatus;
    const stop = () => { clearInterval(timer); timer = undefined; };

    async function tick() {
      if (busy || contents.isDestroyed()) return;
      let url;
      try { url = new URL(contents.getURL()); } catch { return; }
      if (url.origin !== 'https://discord.com' && url.origin !== 'https://discordapp.com') return;

      busy = true;
      try {
        const frames = contents.mainFrame.framesInSubtree;
        let result = { status: 'waiting-app-frame' };
        for (const frame of frames) {
          let origin;
          try { origin = new URL(frame.url).origin; } catch { continue; }
          if (!['https://discord.com', 'https://discordapp.com'].includes(origin)) continue;

          let webrtcServiceJs = '';
          try {
            const raw = fs.readFileSync(path.join(__dirname, 'webrtcService.js'), 'utf8');
            webrtcServiceJs = 'if (!window.WebRTCService) {\n' +
              raw.replace('export class WebRTCService', 'window.WebRTCService = class WebRTCService') +
              '\n}\n';
          } catch (e) {}

          let cfg = {};
          try {
            cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
          } catch {}

          const candidate = await frame.executeJavaScript(
            `window.__DISCORD_MOD_VERSION__ = ${JSON.stringify(cfg.version || '1.0.0-stable')};\n` +
            `window.__ZAP_CONFIG__ = ${JSON.stringify(cfg)};\n` +
            webrtcServiceJs + '\n' +
            fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8')
              .replace('__RAFA_ENABLED__', JSON.stringify(enabled))
          );
          if (candidate) result = candidate;
          if (candidate?.verified) break;
        }

        result.frames = frames.length;
        if (result.status !== lastStatus || attempts % 10 === 0) {
          log(result.status, { ...result, window: contents.id });
          lastStatus = result.status;
        }

        if (result.verified && attempts < 90) {
          stop();
          timer = setInterval(tick, 4000);
          timer.unref();
        } else if (++attempts >= 90) {
          stop();
          log('compatibility-timeout', { window: contents.id });
        }
      } catch (err) {
        log('injection-error', { window: contents.id, error: err.message });
        if (++attempts >= 90) {
          stop();
          log('compatibility-timeout', { window: contents.id });
        }
      } finally {
        busy = false;
      }
    }

    function begin() {
      stop();
      attempts = 0;
      lastStatus = undefined;
      timer = setInterval(tick, 1000);
      timer.unref();
      tick();
    }

    contents.on('did-finish-load', begin);
    contents.on('did-navigate-in-page', begin);
    contents.once('destroyed', stop);
    if (!contents.isLoading()) begin();
  }

  app.on('web-contents-created', (_, contents) => attach(contents));
  for (const contents of webContents.getAllWebContents()) attach(contents);
  log('loaded', { enabled });
}
