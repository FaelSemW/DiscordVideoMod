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

  // --- 1. Injeção de Estilos Globais Anti-Erro 2012 e Ajuste do Player ---
  if (typeof document !== 'undefined' && !document.getElementById('zap-native-stream-fix')) {
    const style = document.createElement('style');
    style.id = 'zap-native-stream-fix';
    style.textContent = `
      /* Oculta mensagens oficiais de Erro 2012 e transmissão pausada */
      /* Assegura que o elemento de vídeo customizado ocupe o layout completo */
      #zap-custom-video-player {
        position: absolute !important;
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
        object-fit: contain !important;
        background-color: #000000 !important;
        z-index: 45 !important;
        display: block !important;
        pointer-events: auto !important;
      }
      div[class*="videoWrapper_"] video:not(#zap-custom-video-player),
      div[class*="videoContainer_"] video:not(#zap-custom-video-player),
      div[class*="tile_"] video:not(#zap-custom-video-player) {
        object-fit: contain !important;
        width: 100% !important;
        height: 100% !important;
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  // --- 2. Localização e Injeção no DOM do Discord (Player Nativo) ---
  function findStreamContainer() {
    if (typeof document === 'undefined') return null;

    // 1. Procura por container com badge "AO VIVO" ou "LIVE"
    const liveTile = document.querySelector('[class*="tile_"]:has([class*="live_"], [class*="liveBadge_"], [class*="stream_"])');
    if (liveTile) return liveTile;

    // 2. Video wrapper padrão do Discord
    const videoWrapper = document.querySelector('[class*="videoWrapper_"], [class*="videoContainer_"]');
    if (videoWrapper) return videoWrapper;

    // 3. Procura o maior tile ativo na chamada (largura > 250px e altura > 150px)
    const tiles = Array.from(document.querySelectorAll('[class*="tile_"], [class*="wrapper_"]'))
      .filter(el => el.offsetWidth > 250 && el.offsetHeight > 150);
    if (tiles.length > 0) {
      tiles.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
      return tiles[0];
    }

    // 4. Container geral da chamada
    const callContainer = document.querySelector('[class*="callContainer_"]');
    if (callContainer) return callContainer;

    // 5. Janela separada (Popout)
    const popoutMount = document.querySelector('#app-mount') || document.body;
    return popoutMount;
  }

  function applyStreamToVideo(video, stream, isLocal = false) {
    if (!video || !stream) return;
    if (video.srcObject !== stream) {
      video.srcObject = null;
      video.srcObject = stream;
    }
    if (video.dataset.zapLocal !== String(isLocal)) {
      video.muted = isLocal;
      video.volume = isLocal ? 0 : 1.0;
      video.dataset.zapLocal = String(isLocal);
    }
    video.autoplay = true;
    video.playsInline = true;

    video.style.setProperty('display', 'block', 'important');
    video.style.setProperty('visibility', 'visible', 'important');
    video.style.setProperty('opacity', '1', 'important');
    video.style.setProperty('z-index', '45', 'important');
    video.style.setProperty('position', 'absolute', 'important');
    video.style.setProperty('top', '0', 'important');
    video.style.setProperty('left', '0', 'important');
    video.style.setProperty('width', '100%', 'important');
    video.style.setProperty('height', '100%', 'important');
    video.style.setProperty('object-fit', 'contain', 'important');
    video.style.setProperty('background-color', '#000000', 'important');

    video.play().catch(e => console.warn('[DiscordMod] Video.play aviso:', e));

    // Oculta spinners e overlays que cobrem o vídeo na mesma célula/tile
    const parent = video.parentElement;
    if (parent) {
      const overlays = parent.querySelectorAll(`
        [class*="loading_"],
        [class*="spinner_"],
        [class*="loadingWrapper_"],
        [class*="loadingContainer_"],
        [class*="streamPaused_"],
        [class*="videoOverlay_"],
        [class*="emptyState_"],
        [class*="streamNotice_"],
        div[role="alert"]
      `);
      overlays.forEach(el => {
        if (el !== video && !el.contains(video)) {
          el.style.setProperty('display', 'none', 'important');
          el.style.setProperty('opacity', '0', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
        }
      });
    }
  }

  function attachStreamToNativePlayer(stream, isLocal = false) {
    if (!stream || typeof document === 'undefined') return;
    if (!isLocal) {
      window.__activeMediaStream = stream;
    } else {
      window.__localMediaStream = stream;
    }

    // Localiza ou cria o elemento de vídeo customizado no container da transmissão
    const container = findStreamContainer();
    if (container) {
      if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
      let customPlayer = document.getElementById('zap-custom-video-player');
      if (!customPlayer) {
        customPlayer = document.createElement('video');
        customPlayer.id = 'zap-custom-video-player';
        customPlayer.autoplay = true;
        customPlayer.playsInline = true;
        customPlayer.controls = true;
      }
      if (customPlayer.parentElement !== container) {
        container.appendChild(customPlayer);
      }
      applyStreamToVideo(customPlayer, stream, isLocal);
    }

  }

  function detachStreamFromNativePlayer() {
    if (typeof document === 'undefined') return;
    window.__activeMediaStream = null;
    window.__localMediaStream = null;
    if (window.__zapAudioPlayer) {
      try { window.__zapAudioPlayer.srcObject = null; } catch {}
    }
    const customPlayer = document.getElementById('zap-custom-video-player');
    if (customPlayer) {
      try { customPlayer.srcObject = null; } catch {}
      customPlayer.remove();
    }
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
      attachStreamToNativePlayer(stream, false);
    });

    service.on('streamStopped', () => {
      console.log('[DiscordMod] Transmissão remota encerrada.');
      detachStreamFromNativePlayer();
    });
  }

  // --- 4. Observador contínuo de montagem de nós no DOM ---
  if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined' && !window.__zapVideoObserver) {
    window.__zapVideoObserver = new MutationObserver(() => {
      const activeStream = window.__activeMediaStream;
      const localStream = window.__localMediaStream;
      const streamToApply = activeStream || localStream;
      const isLocal = !activeStream && Boolean(localStream);

      if (streamToApply) {
        attachStreamToNativePlayer(streamToApply, isLocal);

        // Oculta continuamente overlays de carregamento e banners
        const overlays = document.querySelectorAll('[class*="loadingWrapper_"], [class*="spinner_"], [class*="streamPaused_"]');
        overlays.forEach(el => {
          if (!el.querySelector('video') && el.tagName !== 'VIDEO') {
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('opacity', '0', 'important');
          }
        });
      }

      // Limpeza contínua de banners de Erro 2012
      const errorBoxes = document.querySelectorAll('div[role="alert"], [class*="streamPaused_"], div[class*="emptyState_"], div[class*="streamNotice_"]');
      errorBoxes.forEach(el => {
        const text = el.textContent || '';
        if (!el.querySelector('video') && (text.includes('2012') || text.includes('transmissao nao iniciou') || el.className?.includes?.('streamPaused_'))) {
          el.remove();
        }
      });
    });

    if (document.body) {
      window.__zapVideoObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
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

  if (!dispatcher || !store) return { status: 'waiting-dispatcher-store' };

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
    const previous = store.getClientOverrides()?.[experimentName];
    if (enabled) {
      if (previous?.variantId !== -1) {
        dispatcher.dispatch({
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

  // Interceptação do Dispatcher de eventos
  if (dispatcher && !window.__zapDispatcherIntercepted) {
    window.__zapDispatcherIntercepted = true;
    const handleStreamEvent = function (event) {
      if (!window.__zapEnabled) return;
      if (!event || typeof event !== 'object') {
        return;
      }

      const service = window.__zapWebRTCInstance;
      window.__zapLastEvent = { type: event.type, fields: Object.keys(event), at: Date.now() };
      const voiceChannelId = event.channelId ||
        (event.streamKey ? event.streamKey.split(':')[2] : null) ||
        getActiveVoiceChannelId();
      const user = currentUser();

      // Início de transmissão nativa (Go Live)
      if (
        event.type === 'STREAM_START' ||
        event.type === 'MEDIA_ENGINE_SET_GO_LIVE_SOURCE'
      ) {
        const hasSource = event.type === 'STREAM_START' ||
          Boolean(event.desktopDescription?.id || event.sourceId || event.desktopDescription);
        const targetChannelId = event.channelId || voiceChannelId;
        console.log('[DiscordMod Dispatcher] Go Live acionado:', event.type, 'channelId:', targetChannelId);
        if (service && targetChannelId && user) {
          if (hasSource) {
            window.__zapCaptureSourceId = event.desktopDescription?.id || event.sourceId || window.__zapCaptureSourceId || null;
            service.startBroadcast(targetChannelId, user.id)
              .then(stream => {
                console.log('[DiscordMod] Transmissão iniciada! Vinculando preview local no player...');
                attachStreamToNativePlayer(stream, true);
              })
              .catch(err => {
                window.__zapLastError = { stage: 'capture', message: String(err?.message || err), at: Date.now() };
                showStreamError('Não foi possível iniciar a transmissão: ' + String(err?.message || err));
                console.error('[DiscordMod] Falha ao iniciar transmissão no WebRTCService:', err);
              });
          } else {
            service.stopBroadcast();
            detachStreamFromNativePlayer();
          }
        }
      }

      // Encerramento de transmissão do usuário local
      if (event.type === 'STREAM_STOP') {
        if (event.streamKey && user?.id && event.streamKey.endsWith(user.id)) {
          console.log('[DiscordMod Dispatcher] Transmissão local finalizada.');
          if (service) service.stopBroadcast();
          detachStreamFromNativePlayer();
        }
      }

      // Intercepta clique para assistir stream de participante
      if (event.type === 'STREAM_WATCH') {
        console.log('[DiscordMod Dispatcher] Pedido para assistir stream. Canal:', voiceChannelId);
        if (service && voiceChannelId && user) {
          service.subscribeToStream(voiceChannelId, user.id);
        }
      }

      // Saída do canal de voz
      if (event.type === 'VOICE_CHANNEL_SELECT' && !event.channelId) {
        console.log('[DiscordMod Dispatcher] Usuário saiu do canal de voz.');
        if (service) {
          service.leaveChannel();
          service.stopBroadcast();
          detachStreamFromNativePlayer();
        }
      }

      // Suprime Erro 2012 oficial e estados de desconexão bloqueada
      if (
        (event.type === 'RTC_CONNECTION_STATE' && event.errorCode === 2012) ||
        (event.type === 'MEDIA_ENGINE_CONNECTION_STATE' && event.errorCode === 2012)
      ) {
        console.warn('[DiscordMod Dispatcher] Suprimido disparo de Erro 2012 oficial:', event.type);
        return;
      }

    };
    if (typeof dispatcher.subscribe === 'function') {
      for (const type of ['STREAM_START', 'MEDIA_ENGINE_SET_GO_LIVE_SOURCE', 'STREAM_STOP', 'STREAM_WATCH', 'VOICE_CHANNEL_SELECT']) {
        dispatcher.subscribe(type, event => {
          // Flux dispatch must finish before capture or subscription can dispatch again.
          Promise.resolve().then(() => handleStreamEvent({ ...event, type })).catch(error => {
            window.__zapLastError = { stage: 'event', message: String(error.message), at: Date.now() };
          });
        });
      }
    } else {
      window.__zapDispatcherIntercepted = false;
    }
  }

  // Hook no botão de tela no painel de voz
  if (typeof document !== 'undefined' && !window.__zapButtonHookRegistered) {
    window.__zapButtonHookRegistered = true;
    document.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('button[aria-label="Compartilhe sua tela"], button[aria-label="Share Your Screen"], button[aria-label="Compartilhar sua tela"]');
      if (btn) {
        const service = window.__zapWebRTCInstance;
        if (window.__zapEnabled && !service?.localStream && service?.ws?.readyState !== 1) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          showStreamError('Servidor de transmissão desconectado. Aguarde a reconexão e tente novamente.');
          service?.connectSignaling();
          return;
        }
        if (service?.localStream) {
          service.stopBroadcast();
          detachStreamFromNativePlayer();
        }
      }
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
            service.subscribeToStream(currentChannelId, user.id);
          } else {
            console.log('[DiscordMod] Saiu do canal de voz.');
            service.leaveChannel();
            detachStreamFromNativePlayer();
          }
        }
      }
    }, 2000);
  }

  const current = store.getClientOverrides()?.[primaryExperiment];
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
      subscribed: Boolean(window.__zapDispatcherIntercepted),
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
