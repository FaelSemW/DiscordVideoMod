(() => {
  const enabled = __RAFA_ENABLED__;
  window.__zapEnabled = enabled;
  if (!enabled) window.__zapWebRTCInstance?.destroy();
  const primaryExperiment = '2026-08-video-guard';
  const ZAP_SIGNALING = 'wss://zaprecovery.online/signaling';

  function showStreamError(message) {
    window.__zapLastError = { stage: 'connection', message, at: Date.now() };
    if (typeof document === 'undefined') return;
    let notice = document.getElementById('zap-stream-error');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'zap-stream-error';
      notice.setAttribute('role', 'status');
      notice.style.cssText = 'position:fixed;bottom:90px;left:24px;z-index:2147483647;background:#412329;color:white;padding:14px;border-radius:8px;max-width:380px';
      notice.addEventListener('click', () => notice.remove());
      document.body?.appendChild(notice);
    }
    notice.textContent = message + ' (clique para fechar)';
  }

  if (!window.__zapInitializedLog) {
    window.__zapInitializedLog = true;
    console.log(
      '%c[DiscordMod]%c Ativo v' + (window.__DISCORD_MOD_VERSION__ || '1.0.4') + ' (P2P 1080p60 Bypass & Auto-Update)',
      'background: #5865F2; color: #ffffff; font-weight: bold; padding: 2px 6px; border-radius: 4px;',
      'color: #57F287; font-weight: bold;'
    );
  }

  // A dedicated surface survives Discord tile remounts and never hides native errors.
  function mediaPanel() {
    let panel = document.getElementById('zap-media-panel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'zap-media-panel';
      panel.style.cssText = 'position:fixed;right:20px;bottom:90px;width:min(720px,80vw);background:#151515;padding:12px;border-radius:10px;z-index:10000;color:white';
      const title = document.createElement('div');
      title.textContent = 'Transmissão do mod';
      panel.appendChild(title);
      const video = document.createElement('video');
      video.id = 'zap-custom-video-player';
      video.autoplay = true; video.playsInline = true; video.controls = true;
      video.style.cssText = 'width:100%;max-height:65vh;object-fit:contain;background:black';
      panel.appendChild(video);
      const status = document.createElement('div'); status.id = 'zap-playback-status';
      panel.appendChild(status);
      const stop = document.createElement('button'); stop.textContent = 'Fechar / parar transmissão';
      stop.onclick = () => {
        const service = window.__zapWebRTCInstance;
        if (service?.localStream) service.stopBroadcast();
        else { service?.stopViewing(); window.__zapViewingPaused = true; }
        detachStreamFromNativePlayer();
      };
      panel.appendChild(stop);
      document.body.appendChild(panel);
    }
    return panel;
  }

  function attachStreamToNativePlayer(stream, isLocal = false) {
    if (!stream || typeof document === 'undefined') return;
    if (isLocal) { window.__localMediaStream = stream; window.__activeMediaStream = null; }
    else { window.__activeMediaStream = stream; window.__zapViewingPaused = false; }
    mediaPanel();
    const video = document.getElementById('zap-custom-video-player');
    if (video.srcObject === stream) return;
    video.srcObject = stream;
    video.muted = isLocal;
    const status = document.getElementById('zap-playback-status');
    status.textContent = 'Aguardando o primeiro quadro de vídeo…';
    video.onloadeddata = () => { status.textContent = 'Vídeo recebido'; };
    video.onwaiting = () => { status.textContent = 'Aguardando dados de vídeo…'; };
    video.onerror = () => { status.textContent = 'Falha na reprodução. Feche e conecte novamente.'; };
    video.play().catch(async () => {
      // Autoplay with sound may be blocked: keep video visible and expose audio control.
      video.muted = true;
      try { await video.play(); status.textContent = 'Vídeo sem som. Ative o áudio nos controles do vídeo.'; }
      catch { status.textContent = 'Clique em reproduzir nos controles do vídeo.'; }
    });
  }

  function detachStreamFromNativePlayer() {
    window.__activeMediaStream = null; window.__localMediaStream = null;
    if (typeof document === 'undefined') return;
    const player = document.getElementById('zap-custom-video-player');
    if (player) player.srcObject = null;
    document.getElementById('zap-media-panel')?.remove();
  }

  // --- 3. Inicializa WebRTCService desacoplado ---
  const WebRTCServiceClass = window.WebRTCService;
  if (enabled && WebRTCServiceClass && !window.__zapWebRTCInstance) {
    window.__zapWebRTCInstance = new WebRTCServiceClass({
      signalingUrl: ZAP_SIGNALING,
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    });

    const service = window.__zapWebRTCInstance;
    service.on('statusChange', data => {
      if (data.status === 'error' || data.status === 'warning') showStreamError(data.message || 'Falha na conexão de transmissão.');
    });
    service.connectSignaling();

    service.on('remoteStream', (stream) => {
      console.log('[DiscordMod] Novo stream remoto recebido via WebRTCService! Renderizando...');
      if (!window.__zapViewingPaused) attachStreamToNativePlayer(stream, false);
    });

    service.on('streamStopped', () => {
      console.log('[DiscordMod] Transmissão remota encerrada.');
      detachStreamFromNativePlayer();
    });
  }

  // --- 5. Interceptação do Webpack / Apex Experiments / Dispatcher ---
  const chunks = window.webpackChunkdiscord_app;
  if (!chunks || typeof chunks.push !== 'function') {
    // Se estivermos em uma janela popout ou sem webpack principal, ainda garantimos a renderização
    const customPlayer = typeof document === 'undefined' ? null : document.getElementById('zap-custom-video-player');
    const activeStream = window.__activeMediaStream;
    return {
      status: 'waiting-webpack',
      verified: false,
      hasPlayer: Boolean(customPlayer),
      hasStream: Boolean(activeStream)
    };
  }

  let req;
  const runtimes = [];
  chunks.push([[Symbol('screen-unlock-hook')], {}, r => { runtimes.push(r); }]);
  chunks.pop();
  req = runtimes.sort((a,b) => Object.keys(b?.c || {}).length - Object.keys(a?.c || {}).length)[0];
  if (!req?.c) return { status: 'waiting-cache' };

  const factories = Object.entries(req.m || {});

  // Coleta experimentos video-guard
  const targetExperiments = new Set([primaryExperiment]);
  for (const [, factory] of factories) {
    const matches = String(factory).match(/202[0-9]-[0-9]{2}-video-guard/g);
    if (matches) {
      for (const m of matches) targetExperiments.add(m);
    }
  }

  const relevant = factories.filter(([, factory]) =>
    /ApexExperimentStore|_orderedActionHandlers|getClientOverrides|UserStore|isDeveloper|SelectedChannelStore|getVoiceChannelId/.test(String(factory))
  );
  for (const [id] of relevant) {
    try { req(id); } catch {}
  }

  const candidates = [];
  for (const module of Object.values(req.c)) {
    const exports = module?.exports;
    if (!exports || !['object', 'function'].includes(typeof exports)) continue;
    candidates.push(exports);
    for (const key of Object.keys(exports)) {
      try {
        if (exports[key] && ['object', 'function'].includes(typeof exports[key])) {
          candidates.push(exports[key]);
        }
      } catch {}
    }
  }

  const store = candidates.find(x => {
    try { return x && typeof x.getClientOverrides === 'function' && x.getName?.() === 'ApexExperimentStore'; }
    catch { return false; }
  });

  const dispatcher = store?._dispatcher || candidates.find(x =>
    x && typeof x.dispatch === 'function' && (x._actionHandlers || typeof x.subscribe === 'function')
  );

  const userStore = candidates.find(x => {
    try { return x && typeof x.getCurrentUser === 'function' && (x.getName?.() === 'UserStore' || typeof x.getUser === 'function'); }
    catch { return false; }
  });

  window.__zapStores = { userStore, candidates };
  const currentUser = () => window.__zapStores?.userStore?.getCurrentUser?.();

  function getActiveVoiceChannelId() {
    for (const c of window.__zapStores?.candidates || []) {
      try {
        if (c && typeof c.getVoiceChannelId === 'function') {
          const id = c.getVoiceChannelId();
          if (typeof id === 'string' && /^\d+$/.test(id)) return id;
        }
      } catch {}
    }
    return null;
  }



  // Desbloqueia experimentos de desenvolvedor (1080p60 nativo)
  let devUnlocked = false;
  try {
    const user = currentUser();
    if (user) {
      Object.defineProperty(user, 'isDeveloper', { get: () => true, configurable: true });
      Object.defineProperty(user, 'isStaff', { get: () => true, configurable: true });
      devUnlocked = true;
    }
    if (user?.constructor?.prototype) {
      Object.defineProperty(user.constructor.prototype, 'isDeveloper', { get: () => true, configurable: true });
      Object.defineProperty(user.constructor.prototype, 'isStaff', { get: () => true, configurable: true });
      devUnlocked = true;
    }
  } catch (err) {
    console.warn('[ZapStream] Dev unlock error:', err);
  }

  // Override Video Guard experiment to variant -1
  const appliedList = [];
  for (const experimentName of targetExperiments) {
    const previous = store?.getClientOverrides?.()?.[experimentName];
    if (enabled) {
      if (previous?.variantId !== -1) {
        dispatcher?.dispatch({
          type: 'APEX_EXPERIMENT_OVERRIDE_CREATE',
          experimentName,
          variantId: -1
        });
      }
      appliedList.push(experimentName);
    } else {
      if (previous != null) {
        dispatcher.dispatch({
          type: 'APEX_EXPERIMENT_OVERRIDE_DELETE',
          experimentName
        });
      }
    }
  }

  if (dispatcher && !window.__zapOverridesSubscribed) {
    window.__zapOverridesSubscribed = true;
    const reapply = () => {
      try {
        for (const exp of targetExperiments) {
          if (window.__zapEnabled) {
            dispatcher.dispatch({
              type: 'APEX_EXPERIMENT_OVERRIDE_CREATE',
              experimentName: exp,
              variantId: -1
            });
          }
        }
        const u = currentUser();
        if (u) {
          Object.defineProperty(u, 'isDeveloper', { get: () => true, configurable: true });
          Object.defineProperty(u, 'isStaff', { get: () => true, configurable: true });
        }
      } catch (e) {}
    };
    try { dispatcher.subscribe('CONNECTION_OPEN', reapply); } catch {}
    try { dispatcher.subscribe('CURRENT_USER_UPDATE', reapply); } catch {}
    try { dispatcher.subscribe('APEX_EXPERIMENTS_FETCH_SUCCESS', reapply); } catch {}
  }

  async function openCapturePicker() {
    if (!window.__zapEnabled) return;
    if (document.getElementById('zap-capture-picker')) return;
    const service = window.__zapWebRTCInstance;
    if (service?.localStream || service?.startPromise) {
      service.stopBroadcast(); detachStreamFromNativePlayer(); return;
    }
    if (!service || service.ws?.readyState !== 1) {
      showStreamError('Servidor de transmissão desconectado. Aguarde a reconexão e tente novamente.');
      service?.connectSignaling(); return;
    }
    const channelId = getActiveVoiceChannelId(), user = currentUser();
    if (!channelId || !user) { showStreamError('Entre em um canal de voz antes de transmitir.'); return; }
    const desktop = window.DiscordNative?.desktopCapture;
    const getSources = desktop?.getDesktopCaptureSources || desktop?.getSources;
    if (!getSources) { showStreamError('Lista de telas indisponível. Reinicie o Discord atualizado.'); return; }
    const dialog = document.createElement('section'); dialog.id = 'zap-capture-picker';
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-label', 'Escolher tela para transmitir');
    dialog.style.cssText = 'position:fixed;inset:15% 20%;overflow:auto;background:#232428;color:white;padding:24px;border:2px solid #5865f2;border-radius:12px;z-index:2147483646';
    const heading = document.createElement('h2'); heading.textContent = 'Escolha a tela ou janela'; dialog.appendChild(heading);
    const close = document.createElement('button'); close.textContent = 'Cancelar'; close.onclick = () => dialog.remove(); dialog.appendChild(close);
    document.body.appendChild(dialog);
    try {
      const sources = await getSources.call(desktop, { types: ['screen', 'window'] });
      if (!dialog.isConnected) return;
      if (!sources?.length) throw Error('Nenhuma tela ou janela disponível.');
      const quality = document.createElement('select'); quality.setAttribute('aria-label', 'Qualidade');
      for (const value of ['1920x1080', '1280x720', '2560x1440']) {
        const option = document.createElement('option'); option.value = value; option.textContent = value; quality.appendChild(option);
      }
      dialog.appendChild(quality);
      const fps = document.createElement('select'); fps.setAttribute('aria-label', 'Quadros por segundo');
      for (const value of ['60', '30']) { const option = document.createElement('option'); option.value = value; option.textContent = value + ' FPS'; fps.appendChild(option); }
      dialog.appendChild(fps);
      if (!sources.some(source => /^(screen|window):/.test(source.id))) throw Error('Nenhuma fonte compatível encontrada.');
      for (const source of sources) {
        if (!/^(screen|window):/.test(source.id)) continue;
        const button = document.createElement('button'); button.textContent = source.name || source.id;
        button.style.cssText = 'display:block;width:100%;padding:14px;margin-top:8px';
        button.onclick = async () => {
          if (getActiveVoiceChannelId() !== channelId) { dialog.remove(); showStreamError('O canal mudou. Escolha a tela novamente.'); return; }
          window.__zapCaptureSourceId = source.id;
          const [width,height] = quality.value.split('x').map(Number);
          window.__zapCaptureOptions = { width, height, frameRate: Number(fps.value) };
          dialog.remove();
          try { attachStreamToNativePlayer(await service.startBroadcast(channelId, user.id), true); }
          catch (error) { showStreamError('Não foi possível iniciar: ' + error.message); }
        };
        dialog.appendChild(button);
      }
    } catch (error) { dialog.remove(); showStreamError(error.message); }
  }

  // The mod's button never invokes Discord Go Live. Native events do not start capture.
  window.__zapOpenCapturePicker = openCapturePicker;
  if (typeof document !== 'undefined' && !document.getElementById('zap-share-button')) {
    const button = document.createElement('button'); button.id = 'zap-share-button';
    button.textContent = 'Transmitir / parar pelo site';
    button.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:10001;padding:12px;background:#5865f2;color:white;border:0;border-radius:8px';
    button.onclick = () => window.__zapOpenCapturePicker().catch(error => showStreamError(error.message));
    document.body?.appendChild(button);
  }
  if (typeof document !== 'undefined' && !document.getElementById('zap-watch-button')) {
    const button = document.createElement('button'); button.id = 'zap-watch-button'; button.textContent = 'Assistir pelo site';
    button.style.cssText = 'position:fixed;right:20px;bottom:64px;z-index:10001;padding:10px;background:#303238;color:white;border:0;border-radius:8px';
    button.onclick = async () => {
      if (!window.__zapEnabled) return;
      const channel = getActiveVoiceChannelId(), user = currentUser(), service = window.__zapWebRTCInstance;
      if (!channel || !user) { showStreamError('Entre no mesmo canal de voz de quem transmite.'); return; }
      if (service?.localStream) { showStreamError('Pare sua transmissão antes de assistir outra.'); return; }
      service?.stopViewing(); detachStreamFromNativePlayer(); window.__zapViewingPaused = false;
      try { await service?.subscribeToStream(channel,user.id); }
      catch (error) { showStreamError(error.message); }
    };
    document.body?.appendChild(button);
  }
  if (typeof document !== 'undefined' && !window.__zapButtonHookRegistered) {
    window.__zapButtonHookRegistered = true;
    document.addEventListener('click', event => {
      if (!window.__zapEnabled) return;
      const button = event.target?.closest?.('button[aria-label="Compartilhe sua tela"], button[aria-label="Share Your Screen"], button[aria-label="Compartilhar sua tela"], [role="button"][aria-label="Compartilhe sua tela"], [role="button"][aria-label="Share Your Screen"]');
      if (!button) return;
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      window.__zapOpenCapturePicker().catch(error => showStreamError(error.message));
    }, true);
  }
  // Verificação de sincronização periódica de canal (a cada 2s)
  if (typeof setInterval !== 'undefined' && !window.__zapChannelSyncInterval) {
    let lastVoiceChannelId = null;
    window.__zapChannelSyncInterval = setInterval(() => {
      if (!window.__zapEnabled) return;
      const currentChannelId = getActiveVoiceChannelId();
      const user = currentUser();
      const service = window.__zapWebRTCInstance;

      if (currentChannelId !== lastVoiceChannelId) {
        lastVoiceChannelId = currentChannelId;
        if (service) {
          if (currentChannelId && user) {
            console.log('[DiscordMod] Canal de voz ativo sincronizado:', currentChannelId);
            window.__zapViewingPaused = false;
            service.subscribeToStream(currentChannelId, user.id).catch(error => showStreamError(error.message));
          } else {
            console.log('[DiscordMod] Saiu do canal de voz.');
            service.leaveChannel();
            detachStreamFromNativePlayer();
          }
        }
      }
      if (service?.localStream && !window.__localMediaStream) attachStreamToNativePlayer(service.localStream, true);
      if ((window.__activeMediaStream || window.__localMediaStream) && typeof document !== 'undefined' && !document.getElementById('zap-custom-video-player')) {
        attachStreamToNativePlayer(window.__activeMediaStream || window.__localMediaStream, !window.__activeMediaStream);
      }
    }, 2000);
  }

  const current = store?.getClientOverrides?.()?.[primaryExperiment];
  const verified = enabled ? current?.variantId === -1 : current == null;

  const player = typeof document === 'undefined' ? null : document.getElementById('zap-custom-video-player');
  const activeStream = window.__activeMediaStream;
  const localStream = window.__localMediaStream;

  return {
    status: verified ? (enabled ? 'applied' : 'disabled') : 'unverified',
    verified,
    experimentName: primaryExperiment,
    appliedList,
    devUnlocked,
    integration: {
      version: window.__DISCORD_MOD_VERSION__,
      hasUser: Boolean(currentUser()),
      hasVoiceChannel: Boolean(getActiveVoiceChannelId()),
      independentCapture: true,
      signalingState: window.__zapWebRTCInstance?.ws?.readyState,
      capturing: Boolean(window.__zapWebRTCInstance?.localStream),
      receiving: Boolean(window.__zapWebRTCInstance?.remoteStream),
      peerState: window.__zapWebRTCInstance?.viewerPc?.connectionState,
      lastEvent: window.__zapLastEvent,
      lastError: window.__zapLastError
    },
    videoInfo: {
      count: typeof document === 'undefined' ? 0 : document.querySelectorAll('video').length,
      hasCustomPlayer: Boolean(player),
      customPlayerWidth: player?.videoWidth,
      customPlayerHeight: player?.videoHeight,
      customPlayerPaused: player?.paused,
      activeStreamTracks: activeStream?.getTracks?.().map(t => `${t.kind}:${t.readyState}:${t.muted}:${t.enabled}`),
      localStreamTracks: localStream?.getTracks?.().map(t => `${t.kind}:${t.readyState}:${t.muted}:${t.enabled}`)
    }
  };
})();
