(() => {
  const enabled = __RAFA_ENABLED__;
  const primaryExperiment = '2026-08-video-guard';
  const ZAP_SIGNALING = 'wss://zaprecovery.online/signaling';

  if (!window.__zapInitializedLog) {
    window.__zapInitializedLog = true;
    console.log(
      '%c[DiscordMod]%c Ativo v' + (window.__DISCORD_MOD_VERSION__ || '1.0.0') + ' (P2P 1080p60 Bypass & Auto-Update)',
      'background: #5865F2; color: #ffffff; font-weight: bold; padding: 2px 6px; border-radius: 4px;',
      'color: #57F287; font-weight: bold;'
    );
  }

  const chunks = window.webpackChunkdiscord_app;
  if (!chunks || typeof chunks.push !== 'function') return { status: 'waiting-webpack' };

  let req;
  const runtimes = [];
  chunks.push([[Symbol('screen-unlock-hook')], {}, r => { runtimes.push(r); }]);
  chunks.pop();
  req = runtimes.sort((a,b) => Object.keys(b?.c || {}).length - Object.keys(a?.c || {}).length)[0];
  if (!req?.c) return { status: 'waiting-cache' };

  const factories = Object.entries(req.m || {});

  // Collect video-guard experiments
  const targetExperiments = new Set([primaryExperiment]);
  for (const [, factory] of factories) {
    const matches = String(factory).match(/202[0-9]-[0-9]{2}-video-guard/g);
    if (matches) {
      for (const m of matches) targetExperiments.add(m);
    }
  }

  // Pre-load relevant stores
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
    try { return x && typeof x.getCurrentUser === 'function' && x.getName?.() === 'UserStore'; }
    catch { return false; }
  });

  function getActiveVoiceChannelId() {
    for (const c of candidates) {
      try {
        if (c && typeof c.getVoiceChannelId === 'function') {
          const id = c.getVoiceChannelId();
          if (typeof id === 'string' && /^\d+$/.test(id)) return id;
        }
      } catch {}
    }
    return null;
  }

  const selectedChannelStore = candidates.find(x => {
    try {
      return x && typeof x.getVoiceChannelId === 'function' &&
        (x.getName?.() === 'SelectedChannelStore' || typeof x.getChannelId === 'function');
    } catch { return false; }
  });

  if (!dispatcher || !store) return { status: 'waiting-dispatcher-store' };

  // 1. Unlock Developer Experiments (1080p 60fps & unrestrict settings)
  let devUnlocked = false;
  try {
    const user = userStore?.getCurrentUser?.();
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

  // 2. Override Video Guard experiment to variant -1 (bypasses region restriction)
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

  // Persistent listener for overrides
  if (dispatcher && !window.__zapOverridesSubscribed) {
    window.__zapOverridesSubscribed = true;
    const reapply = () => {
      try {
        for (const exp of targetExperiments) {
          if (enabled) {
            dispatcher.dispatch({
              type: 'APEX_EXPERIMENT_OVERRIDE_CREATE',
              experimentName: exp,
              variantId: -1
            });
          }
        }
        const u = userStore?.getCurrentUser?.();
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

  // 3. Inject CSS to hide Discord Error 2012 / "TransmissÃ£o pausada" overlays
  if (typeof document !== 'undefined' && !document.getElementById('zap-native-stream-fix')) {
    const style = document.createElement('style');
    style.id = 'zap-native-stream-fix';
    style.textContent = `
      /* Oculta mensagens oficiais de Erro 2012 e transmissÃ£o pausada */
      [class*="videoOverlay_"],
      [class*="streamPaused_"],
      [class*="callAvatarStatus_"],
      [class*="streamNotice_"],
      div[class*="noticeRegionBlocked_"],
      div:has(> [class*="streamPaused_"]) {
        display: none !important;
      }
      /* Assegura que o elemento de vÃ­deo ocupe o layout completo com controles nativos */
      div[class*="videoWrapper_"] video,
      div[class*="videoContainer_"] video,
      div[class*="tile_"] video {
        object-fit: contain !important;
        width: 100% !important;
        height: 100% !important;
        display: block !important;
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  // 4. Inicializa WebRTCService desacoplado do Discord
  const WebRTCServiceClass = window.WebRTCService;
  if (WebRTCServiceClass && !window.__zapWebRTCInstance) {
    window.__zapWebRTCInstance = new WebRTCServiceClass({
      signalingUrl: ZAP_SIGNALING,
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    const service = window.__zapWebRTCInstance;

    // Conecta imediatamente com a sinalizaÃ§Ã£o do backend
    service.connectSignaling();

    // Listener de recepÃ§Ã£o de stream remoto (Espectador)
    service.on('remoteStream', (stream) => {
      console.log('[DiscordMod] Novo stream remoto recebido via WebRTCService!', stream);
      attachStreamToNativePlayer(stream);
    });

    service.on('streamStopped', () => {
      console.log('[DiscordMod] TransmissÃ£o remota encerrada.');
      detachStreamFromNativePlayer();
    });
  }

  // 5. InterceptaÃ§Ã£o da Camada de Estado / Dispatcher
  if (dispatcher && !window.__zapDispatcherIntercepted) {
    window.__zapDispatcherIntercepted = true;
    const originalDispatch = dispatcher.dispatch.bind(dispatcher);

    dispatcher.dispatch = function (event) {
      if (!event || typeof event !== 'object') {
        return originalDispatch(event);
      }

      const service = window.__zapWebRTCInstance;
      const voiceChannelId = event.channelId ||
        (event.streamKey ? event.streamKey.split(':')[2] : null) ||
        getActiveVoiceChannelId();
      const currentUser = userStore?.getCurrentUser?.();

      // Intercepta aÃ§Ã£o de iniciar transmissÃ£o nativa (Go Live)
      if (
        event.type === 'STREAM_START' ||
        event.type === 'MEDIA_ENGINE_SET_GO_LIVE_SOURCE'
      ) {
        const hasSource = event.type === 'STREAM_START' ||
          Boolean(event.desktopDescription?.id || event.sourceId || event.desktopDescription);
        const targetChannelId = event.channelId || voiceChannelId;
        console.log('[DiscordMod Dispatcher] Go Live iniciado:', event.type, 'channelId:', targetChannelId);
        if (service && targetChannelId && currentUser) {
          if (hasSource) {
            service.startBroadcast(targetChannelId, currentUser.id)
              .catch(err => {
                console.error('[DiscordMod] Falha ao iniciar transmissÃ£o no WebRTCService:', err);
              });
          } else {
            service.stopBroadcast();
          }
        }
      }

      // Encerramento de transmissÃ£o do usuÃ¡rio local
      if (event.type === 'STREAM_STOP') {
        if (event.streamKey && currentUser?.id && event.streamKey.endsWith(currentUser.id)) {
          console.log('[DiscordMod Dispatcher] TransmissÃ£o local finalizada.');
          if (service) service.stopBroadcast();
        }
      }

      // Intercepta clique para assistir stream de participante
      if (event.type === 'STREAM_WATCH') {
        console.log('[DiscordMod Dispatcher] Interceptado pedido para assistir stream. Canal:', voiceChannelId);
        if (service && voiceChannelId && currentUser) {
          service.subscribeToStream(voiceChannelId, currentUser.id);
        }
      }

      // Intercepta saÃ­da de canal de voz
      if (event.type === 'VOICE_CHANNEL_SELECT' && !event.channelId) {
        console.log('[DiscordMod Dispatcher] UsuÃ¡rio saiu do canal de voz.');
        if (service) {
          service.leaveChannel();
          service.stopBroadcast();
          detachStreamFromNativePlayer();
        }
      }

      // Suprime o Erro 2012 e estados de desconexÃ£o da mÃ­dia oficial do Discord
      if (
        (event.type === 'RTC_CONNECTION_STATE' && (event.errorCode === 2012 || event.state === 'RTC_DISCONNECTED')) ||
        (event.type === 'MEDIA_ENGINE_CONNECTION_STATE' && event.errorCode === 2012)
      ) {
        console.warn('[DiscordMod Dispatcher] Suprimido disparo de Erro 2012 oficial:', event.type);
        // Impede o Discord de propagar o erro para a UI
        return;
      }

      return originalDispatch(event);
    };
  }

  // 6. IntegraÃ§Ã£o do Player com o Ciclo de Vida do React / DOM
  function applyStreamToVideo(video, stream, isLocal = false) {
    if (!video || !stream) return;
    if (video.srcObject !== stream) {
      video.srcObject = null;
      video.srcObject = stream;
    }
    video.muted = isLocal;
    video.volume = isLocal ? 0 : 1.0;
    video.autoplay = true;
    video.playsInline = true;

    // Garante que o elemento de video fique visivel acima de qualquer backdrop do Discord
    video.style.setProperty('display', 'block', 'important');
    video.style.setProperty('visibility', 'visible', 'important');
    video.style.setProperty('opacity', '1', 'important');
    video.style.setProperty('z-index', '25', 'important');
    video.style.setProperty('position', 'absolute', 'important');
    video.style.setProperty('top', '0', 'important');
    video.style.setProperty('left', '0', 'important');
    video.style.setProperty('width', '100%', 'important');
    video.style.setProperty('height', '100%', 'important');
    video.style.setProperty('object-fit', 'contain', 'important');
    video.style.setProperty('background-color', '#000000', 'important');

    video.play().catch(e => console.warn('[DiscordMod] Video.play aviso:', e));

    // Oculta spinners e overlays que cobrem o video na mesma celula/tile
    const parentTile = video.closest('[class*="wrapper_"], [class*="tile_"], [class*="videoWrapper_"]') || video.parentElement;
    if (parentTile) {
      const overlays = parentTile.querySelectorAll(`
        [class*="loading_"],
        [class*="spinner_"],
        [class*="loadingWrapper_"],
        [class*="loadingContainer_"],
        [class*="streamPaused_"],
        [class*="videoOverlay_"],
        [class*="emptyState_"],
        [class*="streamNotice_"],
        [class*="overlay_"],
        [class*="backdrop_"],
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

    // Dispara estados internos para tirar o React do modo conectando
    if (dispatcher && typeof dispatcher.dispatch === 'function') {
      try {
        dispatcher.dispatch({ type: 'RTC_CONNECTION_STATE', state: 'RTC_CONNECTED' });
        const bId = isLocal ? userStore?.getCurrentUser?.()?.id : window.__zapWebRTCInstance?.broadcasterUserId;
        if (bId) {
          dispatcher.dispatch({ type: 'MEDIA_ENGINE_VIDEO_STATE_CHANGED', userId: bId, videoState: 1 });
        }
      } catch (e) {}
    }

    // Localiza e vincula em todos os elementos <video> ativos
    const videoElements = document.querySelectorAll('video');
    let attached = false;
    for (const video of videoElements) {
      applyStreamToVideo(video, stream, isLocal);
      attached = true;
    }

    // Fallback: se o Discord nao gerou uma tag <video> na tile da transmissao, cria uma dinamicamente
    if (!attached || videoElements.length === 0) {
      const streamTile = document.querySelector('[class*="tile_"]:has([class*="live_"]), [class*="tile_"]:has([class*="stream_"]), [class*="videoWrapper_"], [class*="callContainer_"] [class*="wrapper_"]');
      if (streamTile) {
        let player = streamTile.querySelector('#zap-custom-video-player');
        if (!player) {
          player = document.createElement('video');
          player.id = 'zap-custom-video-player';
          player.autoplay = true;
          player.playsInline = true;
          streamTile.appendChild(player);
        }
        applyStreamToVideo(player, stream, isLocal);
      }
    }
  }

  function detachStreamFromNativePlayer() {
    if (typeof document === 'undefined') return;
    window.__activeMediaStream = null;
    window.__localMediaStream = null;
    const videoElements = document.querySelectorAll('video');
    for (const video of videoElements) {
      if (video && video.srcObject) {
        video.srcObject = null;
      }
    }
    const customPlayer = document.getElementById('zap-custom-video-player');
    if (customPlayer) customPlayer.remove();
  }

  // Observador continuo de montagem de nos <video> no DOM (Resiliencia a re-render do React)
  if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined' && !window.__zapVideoObserver) {
    window.__zapVideoObserver = new MutationObserver(() => {
      const activeStream = window.__activeMediaStream;
      const localStream = window.__localMediaStream;
      const streamToApply = activeStream || localStream;
      const isLocal = !activeStream && Boolean(localStream);

      if (streamToApply) {
        const videoElements = document.querySelectorAll('video');
        for (const video of videoElements) {
          applyStreamToVideo(video, streamToApply, isLocal);
        }

        // Limpeza continua de overlays de carregamento
        const overlays = document.querySelectorAll('[class*="loadingWrapper_"], [class*="spinner_"], [class*="streamPaused_"]');
        overlays.forEach(el => {
          if (!el.querySelector('video') && el.tagName !== 'VIDEO') {
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('opacity', '0', 'important');
          }
        });
      }

      // Limpeza continua de banners de Erro 2012 gerados dinamicamente
      const errorBoxes = document.querySelectorAll('div[role="alert"], [class*="streamPaused_"], div[class*="emptyState_"], div[class*="streamNotice_"]');
      errorBoxes.forEach(el => {
        const text = el.textContent || '';
        if (text.includes('2012') || text.includes('transmissao nao iniciou') || el.className?.includes?.('streamPaused_')) {
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

  // Hook no botÃ£o oficial do monitor no painel de voz
  if (typeof document !== 'undefined' && !window.__zapButtonHookRegistered) {
    window.__zapButtonHookRegistered = true;
    document.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('button[aria-label="Compartilhe sua tela"], button[aria-label="Share Your Screen"], button[aria-label="Compartilhar sua tela"]');
      if (btn) {
        const service = window.__zapWebRTCInstance;
        if (service?.localStream) {
          service.stopBroadcast();
        }
      }
    }, true);
  }

  // VerificaÃ§Ã£o de sincronizaÃ§Ã£o periÃ³dica de canal (a cada 2s)
  if (typeof setInterval !== 'undefined' && !window.__zapChannelSyncInterval) {
    let lastVoiceChannelId = null;
    window.__zapChannelSyncInterval = setInterval(() => {
      const currentChannelId = getActiveVoiceChannelId();
      const currentUser = userStore?.getCurrentUser?.();
      const service = window.__zapWebRTCInstance;

      if (currentChannelId !== lastVoiceChannelId) {
        lastVoiceChannelId = currentChannelId;
        if (service) {
          if (currentChannelId && currentUser) {
            console.log('[DiscordMod] Canal de voz ativo:', currentChannelId);
            service.subscribeToStream(currentChannelId, currentUser.id);
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

  const v = document.querySelector('video');
  const activeStream = window.__activeMediaStream;
  const localStream = window.__localMediaStream;

  return {
    status: verified ? (enabled ? 'applied' : 'disabled') : 'unverified',
    verified,
    experimentName: primaryExperiment,
    appliedList,
    devUnlocked,
    videoInfo: {
      count: document.querySelectorAll('video').length,
      videoWidth: v?.videoWidth,
      videoHeight: v?.videoHeight,
      paused: v?.paused,
      muted: v?.muted,
      activeStreamTracks: activeStream?.getTracks?.().map(t => `${t.kind}:${t.readyState}:${t.muted}:${t.enabled}`),
      localStreamTracks: localStream?.getTracks?.().map(t => `${t.kind}:${t.readyState}:${t.muted}:${t.enabled}`)
    }
  };
})()
