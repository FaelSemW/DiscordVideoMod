(() => {
  const enabled = __RAFA_ENABLED__;
  const primaryExperiment = '2026-08-video-guard';
  const cfg = window.__ZAP_CONFIG__ || {};
  const ZAP_SIGNALING = cfg.signalingUrl || (cfg.serverUrl ? cfg.serverUrl.replace(/^http/i, 'ws') + '/signaling' : 'wss://discordvideomod.onrender.com/signaling');

  if (!window.__zapInitializedLog) {
    window.__zapInitializedLog = true;
    console.log(
      '%c[DiscordMod]%c Ativo v' + (window.__DISCORD_MOD_VERSION__ || '1.1.1') + ' (P2P 1080p60 + Suporte a Janelas e Popout)',
      'background: #5865F2; color: #ffffff; font-weight: bold; padding: 2px 6px; border-radius: 4px;',
      'color: #57F287; font-weight: bold;'
    );
  }

  // --- 1. Estilos Globais: Remove aviso de Erro 2012 e ajusta o layout do player ---
  if (typeof document !== 'undefined' && !document.getElementById('zap-native-stream-fix')) {
    const style = document.createElement('style');
    style.id = 'zap-native-stream-fix';
    style.textContent = `
      [class*="videoOverlay_"],
      [class*="streamPaused_"],
      [class*="callAvatarStatus_"],
      [class*="streamNotice_"],
      div[class*="noticeRegionBlocked_"],
      div:has(> [class*="streamPaused_"]) {
        display: none !important;
      }
      div[class*="videoWrapper_"] video,
      div[class*="videoContainer_"] video,
      div[class*="tile_"] video,
      div[class*="popout_"] video,
      video {
        object-fit: contain !important;
        width: 100% !important;
        height: 100% !important;
        display: block !important;
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  // --- 2. Integração do Player de Vídeo no DOM ---
  function attachStreamToNativePlayer(stream, isLocal = false) {
    if (!stream || typeof document === 'undefined') return;
    if (!isLocal) {
      window.__activeMediaStream = stream;
    } else {
      window.__localMediaStream = stream;
    }

    const staleAlerts = document.querySelectorAll('[class*="streamPaused_"], [class*="videoOverlay_"]');
    staleAlerts.forEach(el => el.remove());

    const videoElements = Array.from(document.querySelectorAll('video')).filter(v => {
      const isDummy = v.width === 2 || v.height === 2 || (v.offsetWidth < 50 && v.offsetHeight < 50 && v.offsetWidth > 0);
      return !isDummy;
    });

    let attached = false;
    for (const video of videoElements) {
      if (video) {
        if (video.srcObject !== stream) video.srcObject = stream;
        // Áudio da tela/jogo é transmitido nativamente pelo canal de voz oficial do Discord
        // Mantemos o elemento HTML5 sempre mudo para evitar áudio duplicado e eco
        video.muted = true;
        video.volume = 0;
        video.play().catch(e => console.warn('[DiscordMod] Video.play aviso:', e));
        attached = true;
      }
    }

    if (!attached) {
      const container = document.querySelector('[class*="videoWrapper_"], [class*="videoContainer_"], [class*="tile_"], [class*="popout_"]');
      if (container) {
        let player = document.getElementById('zap-custom-video-player');
        if (!player) {
          player = document.createElement('video');
          player.id = 'zap-custom-video-player';
          player.autoplay = true;
          player.playsInline = true;
          player.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:45;';
          container.appendChild(player);
        }
        player.srcObject = stream;
        player.muted = true;
        player.volume = 0;
        player.play().catch(() => {});
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

  // Observador contínuo de montagem de nós <video> no DOM
  if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined' && !window.__zapVideoObserver) {
    window.__zapVideoObserver = new MutationObserver(() => {
      const streamToApply = window.__activeMediaStream || window.__localMediaStream;
      const isLocal = !window.__activeMediaStream && Boolean(window.__localMediaStream);

      if (streamToApply) {
        attachStreamToNativePlayer(streamToApply, isLocal);
      }

      const errorBoxes = document.querySelectorAll('div[role="alert"], [class*="streamPaused_"], div[class*="emptyState_"], div[class*="streamNotice_"]');
      errorBoxes.forEach(el => {
        const text = el.textContent || '';
        if (text.includes('2012') || text.includes('transmissão não iniciou') || el.className?.includes?.('streamPaused_')) {
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

  // --- 3. Suporte a Janela Separada (Popout) ---
  const isPopout = Boolean(
    window.__DISCORD_IS_POPOUT__ ||
    (typeof window !== 'undefined' && window.location?.pathname?.includes('/popout')) ||
    (typeof window !== 'undefined' && window.opener)
  );

  if (isPopout) {
    let stream = window.__activeMediaStream || window.__localMediaStream;
    if (!stream && window.opener) {
      try {
        stream = window.opener.__activeMediaStream || window.opener.__localMediaStream;
        if (stream) {
          window.__activeMediaStream = stream;
        }
      } catch (e) {}
    }

    if (stream) {
      attachStreamToNativePlayer(stream, false);
    }

    return {
      status: 'popout-ready',
      verified: true,
      isPopout: true,
      hasStream: Boolean(stream)
    };
  }

  // --- 4. Janela Principal: Desbloqueio de Experimentos e WebRTC ---
  const chunks = window.webpackChunkdiscord_app;
  if (!chunks || typeof chunks.push !== 'function') return { status: 'waiting-webpack' };

  let req;
  const runtimes = [];
  chunks.push([[Symbol('screen-unlock-hook')], {}, r => { runtimes.push(r); }]);
  chunks.pop();
  req = runtimes.sort((a,b) => Object.keys(b?.c || {}).length - Object.keys(a?.c || {}).length)[0];
  if (!req?.c) return { status: 'waiting-cache' };

  const factories = Object.entries(req.m || {});

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

  if (!dispatcher || !store) return { status: 'waiting-dispatcher-store' };

  // Desbloqueio das configurações 1080p 60fps
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

  // Inicializa WebRTCService desacoplado
  const WebRTCServiceClass = window.WebRTCService;
  if (WebRTCServiceClass && !window.__zapWebRTCInstance) {
    window.__zapWebRTCInstance = new WebRTCServiceClass({
      signalingUrl: ZAP_SIGNALING,
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }]
    });

    const service = window.__zapWebRTCInstance;
    service.connectSignaling();

    service.on('remoteStream', (stream) => {
      console.log('[DiscordMod] Novo stream remoto recebido via WebRTCService!', stream);
      attachStreamToNativePlayer(stream, false);
    });

    service.on('streamStopped', () => {
      console.log('[DiscordMod] Transmissão remota encerrada.');
      detachStreamFromNativePlayer();
    });
  }

  // Interceptação do Dispatcher
  if (dispatcher && !window.__zapDispatcherIntercepted) {
    window.__zapDispatcherIntercepted = true;
    const originalDispatch = dispatcher.dispatch.bind(dispatcher);

    dispatcher.dispatch = function (event) {
      if (!event || typeof event !== 'object') {
        return originalDispatch(event);
      }

      const service = window.__zapWebRTCInstance;
      const voiceChannelId = event.channelId ||
        (event.streamKey ? event.streamKey.split(':')[1] : null) ||
        getActiveVoiceChannelId();
      const currentUser = userStore?.getCurrentUser?.();

      // Intercepta ação de iniciar transmissão nativa (Go Live de tela OU janela de jogo)
      if (
        event.type === 'STREAM_START' ||
        event.type === 'MEDIA_ENGINE_SET_GO_LIVE_SOURCE'
      ) {
        // Suporta tanto tela inteira quanto janelas de jogos específicos (Roblox, etc.)
        const selectedSourceId = event.settings?.desktopSettings?.sourceId ||
          event.desktopDescription?.id ||
          event.sourceId;

        if (selectedSourceId) {
          window.__DISCORD_SELECTED_SOURCE_ID__ = selectedSourceId;
        }

        const hasSource = event.type === 'STREAM_START' ||
          Boolean(
            selectedSourceId ||
            event.settings?.desktopSettings ||
            event.desktopDescription ||
            (event.settings && Object.keys(event.settings).length > 0)
          );

        const targetChannelId = event.channelId || voiceChannelId;
        console.log('[DiscordMod Dispatcher] Go Live:', event.type, 'hasSource:', hasSource, 'sourceId:', selectedSourceId);

        if (service && targetChannelId && currentUser) {
          if (hasSource) {
            service.startBroadcast(targetChannelId, currentUser.id)
              .then(stream => {
                console.log('[DiscordMod] Transmissão iniciada! Vinculando preview local no player...');
                attachStreamToNativePlayer(stream, true);
              })
              .catch(err => {
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
        window.__DISCORD_SELECTED_SOURCE_ID__ = null;
        if (event.streamKey && currentUser?.id && event.streamKey.endsWith(currentUser.id)) {
          console.log('[DiscordMod Dispatcher] Transmissão local finalizada.');
          if (service) service.stopBroadcast();
          detachStreamFromNativePlayer();
        }
      }

      // Intercepta clique para assistir stream de participante
      if (event.type === 'STREAM_WATCH') {
        const streamChannelId = (event.streamKey ? event.streamKey.split(':')[1] : null) || voiceChannelId;
        console.log('[DiscordMod Dispatcher] Assistir transmissão no canal:', streamChannelId);
        if (service && streamChannelId && currentUser) {
          service.subscribeToStream(streamChannelId, currentUser.id);
        }
      }

      // Intercepta saída de canal de voz
      if (event.type === 'VOICE_CHANNEL_SELECT' && !event.channelId) {
        console.log('[DiscordMod Dispatcher] Usuário saiu do canal de voz.');
        if (service) {
          service.leaveChannel();
          service.stopBroadcast();
          detachStreamFromNativePlayer();
        }
      }

      // Suprime o Erro 2012 e desconexões da mídia oficial do Discord
      if (
        (event.type === 'RTC_CONNECTION_STATE' && (event.errorCode === 2012 || event.state === 'RTC_DISCONNECTED')) ||
        (event.type === 'MEDIA_ENGINE_CONNECTION_STATE' && event.errorCode === 2012)
      ) {
        console.warn('[DiscordMod Dispatcher] Suprimido Erro 2012 oficial:', event.type);
        return;
      }

      return originalDispatch(event);
    };
  }

  // Hook no botão oficial do monitor
  if (typeof document !== 'undefined' && !window.__zapButtonHookRegistered) {
    window.__zapButtonHookRegistered = true;
    document.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('button[aria-label="Compartilhe sua tela"], button[aria-label="Share Your Screen"], button[aria-label="Compartilhar sua tela"]');
      if (btn) {
        const service = window.__zapWebRTCInstance;
        if (service?.localStream) {
          service.stopBroadcast();
          detachStreamFromNativePlayer();
        }
      }
    }, true);
  }

  // Sincronização periódica de canal de voz (somente detecta saída do canal de voz)
  if (typeof setInterval !== 'undefined' && !window.__zapChannelSyncInterval) {
    let lastVoiceChannelId = null;
    window.__zapChannelSyncInterval = setInterval(() => {
      const currentChannelId = getActiveVoiceChannelId();
      const service = window.__zapWebRTCInstance;

      if (currentChannelId !== lastVoiceChannelId) {
        lastVoiceChannelId = currentChannelId;
        if (service && !currentChannelId) {
          console.log('[DiscordMod] Saiu do canal de voz.');
          service.leaveChannel();
          detachStreamFromNativePlayer();
        }
      }
    }, 2000);
  }

  const current = store.getClientOverrides()?.[primaryExperiment];
  const verified = enabled ? current?.variantId === -1 : current == null;

  return {
    status: verified ? (enabled ? 'applied' : 'disabled') : 'unverified',
    verified,
    experimentName: primaryExperiment,
    appliedList,
    devUnlocked,
    channelId: getActiveVoiceChannelId(),
    userId: userStore?.getCurrentUser?.()?.id,
    selectedSourceId: window.__DISCORD_SELECTED_SOURCE_ID__ || null
  };
})();