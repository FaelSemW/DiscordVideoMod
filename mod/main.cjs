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
      const line = JSON.stringify({ time: new Date().toISOString(), status, ...extra }) + '\n';
      fs.promises.appendFile(path.join(logDir, 'video-mod.jsonl'), line).catch(() => {});
    } catch (e) {}
  }

  // Cache em memória dos scripts de injeção para evitar fs.readFileSync repetitivo durante jogos/transmissão
  let cachedPayload = null;
  function buildInjectionPayload(enabledFlag) {
    if (cachedPayload) return cachedPayload;
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

    let rendererRaw = '';
    try {
      rendererRaw = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8')
        .replace('__RAFA_ENABLED__', JSON.stringify(enabledFlag));
    } catch (e) {}

    cachedPayload =
      `window.__DISCORD_MOD_VERSION__ = ${JSON.stringify(cfg.version || '1.1.5')};\n` +
      `window.__ZAP_CONFIG__ = ${JSON.stringify(cfg)};\n` +
      webrtcServiceJs + '\n' +
      rendererRaw;
    return cachedPayload;
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
      if (cfg.autoUpdate === false) return;

      const currentVer = cfg.version || '1.1.5';
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
        cachedPayload = null;
        log('update-applied', { version: data.version, filesUpdated });
      }
    } catch (e) {
      log('update-check-err', { error: e.message });
    }
  }

  checkAndApplyUpdates().catch(() => {});
  const updateInterval = setInterval(() => checkAndApplyUpdates().catch(() => {}), 2 * 60 * 1000);
  updateInterval.unref();

  // Configurações do Electron: CSP permissivo para nuvem e captura de tela/janela inteligente
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
                let target = null;
                const reqId = global.__lastRequestedSourceId;
                const reqName = global.__lastRequestedSourceName;

                // 1. Tenta encontrar a janela ou tela solicitada pelo ID exato ou HWND
                if (reqId) {
                  target = sources.find(s => s.id === reqId);
                  if (!target && reqId.startsWith('window:')) {
                    const hwnd = reqId.split(':')[1];
                    if (hwnd) {
                      target = sources.find(s => s.id.startsWith(`window:${hwnd}:`) || s.id === `window:${hwnd}`);
                    }
                  }
                  if (!target && reqId.startsWith('screen:')) {
                    const screenIdx = reqId.split(':')[1];
                    if (screenIdx) {
                      target = sources.find(s => s.id.startsWith(`screen:${screenIdx}:`) || s.id === reqId);
                    }
                  }
                }

                // 2. Se não encontrou por ID (ex: jogo da aba Aplicativos), busca pelo título da janela
                if (!target && reqName) {
                  const normReq = reqName.trim().toLowerCase();
                  target = sources.find(s => s.name && s.name.trim().toLowerCase() === normReq);
                  if (!target) {
                    target = sources.find(s => s.name && (
                      s.name.toLowerCase().includes(normReq) ||
                      normReq.includes(s.name.trim().toLowerCase())
                    ));
                  }
                }

                // 3. Fallback seguro mantendo o tipo solicitado (janela vs tela)
                if (!target) {
                  if ((reqId && reqId.startsWith('window:')) || reqName) {
                    target = sources.find(s => s.id.startsWith('window:') && !/discord/i.test(s.name || '')) ||
                             sources.find(s => s.id.startsWith('window:')) ||
                             sources[0];
                  } else {
                    target = sources.find(s => s.id.startsWith('screen:')) || sources[0];
                  }
                }

                log('capturing-source', {
                  id: target.id,
                  name: target.name,
                  requestedId: reqId,
                  requestedName: reqName
                });

                // Envia exclusivamente o fluxo de vídeo da janela/tela selecionada.
                // O áudio é capturado e gerenciado exclusivamente pela engine nativa do Discord (soundshare por PID da janela),
                // garantindo que fique na faixa de transmissão e nunca capture o áudio do próprio Discord/chamada.
                callback({ video: target });
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

    // Ponte de mensagens do Renderer para o Main (captura de janela/tela escolhida pelo usuário)
    contents.on('console-message', (event, level, message) => {
      if (typeof message === 'string' && message.startsWith('[DISCORD_MOD_SOURCE_PICK]')) {
        try {
          const data = JSON.parse(message.substring(25));
          if (data.id && !String(data.id).startsWith('prepicked:')) {
            global.__lastRequestedSourceId = data.id;
          } else if (data.resetId) {
            global.__lastRequestedSourceId = null;
          }
          if (data.name) {
            global.__lastRequestedSourceName = data.name;
          } else if (data.resetName) {
            global.__lastRequestedSourceName = null;
          }
          log('source-picked-by-user', {
            id: global.__lastRequestedSourceId,
            name: global.__lastRequestedSourceName
          });
        } catch (e) {}
      }
    });

    let timer, attempts = 0, busy = false, lastStatus;
    const stop = () => { if (timer) { clearInterval(timer); timer = undefined; } };

    async function tick() {
      if (busy || contents.isDestroyed()) return;
      let url;
      try { url = new URL(contents.getURL()); } catch { return; }
      if (url.origin !== 'https://discord.com' && url.origin !== 'https://discordapp.com') return;

      // Evita injetar em janelas secundárias de overlay que não possuem a store principal
      const maxAttempts = contents.id > 2 ? 8 : 60;

      busy = true;
      try {
        const mainFrame = contents.mainFrame;
        if (!mainFrame) return;

        let origin;
        try { origin = new URL(mainFrame.url).origin; } catch { origin = ''; }
        if (!['https://discord.com', 'https://discordapp.com'].includes(origin)) return;

        const scriptToRun = buildInjectionPayload(enabled);
        const result = (await mainFrame.executeJavaScript(scriptToRun)) || { status: 'waiting-app-frame' };

        if (result.status !== lastStatus) {
          log(result.status, { ...result, window: contents.id });
          lastStatus = result.status;
        }

        if (result.verified) {
          stop();
          log('mod-verified-and-active', { window: contents.id });
        } else if (++attempts >= maxAttempts) {
          stop();
          log('compatibility-timeout', { window: contents.id });
        }
      } catch (err) {
        if (++attempts >= maxAttempts) {
          stop();
          log('compatibility-timeout', { window: contents.id, error: err.message });
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

    // Injeta apenas no carregamento real da página (sem did-navigate-in-page para não travar ao trocar de canal)
    contents.on('did-finish-load', begin);
    contents.once('destroyed', stop);
    if (!contents.isLoading()) begin();
  }

  app.on('web-contents-created', (_, contents) => attach(contents));
  for (const contents of webContents.getAllWebContents()) attach(contents);
  log('loaded', { enabled });
}
