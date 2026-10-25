(() => {
  const enabled = __RAFA_ENABLED__;
  const primaryExperiment = '2026-08-video-guard';
  const cfg = window.__ZAP_CONFIG__ || {};
  const ZAP_SIGNALING = cfg.signalingUrl || (cfg.serverUrl ? cfg.serverUrl.replace(/^http/i, 'ws') + '/signaling' : 'wss://discordvideomod.onrender.com/signaling');

  if (!window.__zapInitializedLog) {
    window.__zapInitializedLog = true;
    console.log(
      '%c[DiscordMod]%c Ativo v' + (window.__DISCORD_MOD_VERSION__ || '1.0.0-stable') + ' (P2P 1080p60 Bypass & Cloud 24/7)',
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

  // Pre-load relevant stores uma única vez
  if (!window.__zapStoresPreloaded) {
    window.__zapStoresPreloaded = true;
    const relevant = factories.filter(([, factory]) =>
      /ApexExperimentStore|_orderedActionHandlers|getClientOverrides|UserStore|isDeveloper|SelectedChannelStore/.test(String(factory))
    );
    for (const [id] of relevant) {
      try { req(id); } catch {}
    }
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

  // 3. Inject CSS to hide Discord Error 2012 / "Transmissão pausada" overlays
  if (typeof document !== 'undefined' && !document.getElementById('zap-native-stream-fix')) {
    const style = document.createElement('style');
    style.id = 'zap-native-stream-fix';
    style.textContent = `
      /* Oculta mensagens oficiais de Erro 2012 e transmissão pausada */
      [class*="videoOverlay_"],
      [class*="streamPaused_"],
      [class*="callAvatarStatus_"],
      [class*="streamNotice_"],
      div[class*="noticeRegionBlocked_"],
      div:has(> [class*="streamPaused_"]) {
        display: none !important;
      }
      /* Assegura que o elemento de vídeo ocupe o layout completo com controles nativos */
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

  // 5. Interceptação da Camada de Estado / Dispatcher
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

      // Guarda a última fonte de captura selecionada (janela de aplicativo ou tela inteira)
      function extractSourceId(ev) {
        if (!ev || typeof ev !== 'object') return null;
        if (typeof ev.sourceId === 'string' && (ev.sourceId.startsWith('window:') || ev.sourceId.startsWith('screen:'))) {
          return ev.sourceId;
        }
        const desc = ev.settings?.desktopDescription || ev.desktopDescription;
        if (typeof desc === 'string' && (desc.startsWith('window:') || desc.startsWith('screen:'))) {
          return desc;
        }
        if (desc && typeof desc.id === 'string' && (desc.id.startsWith('window:') || desc.id.startsWith('screen:'))) {
          return desc.id;
        }
        for (const obj of [ev.settings, ev]) {
          if (!obj || typeof obj !== 'object') continue;
          for (const val of Object.values(obj)) {
            if (typeof val === 'string' && (val.startsWith('window:') || val.startsWith('screen:'))) {
              return val;
            }
            if (val && typeof val === 'object' && typeof val.id === 'string' && (val.id.startsWith('window:') || val.id.startsWith('screen:'))) {
              return val.id;
            }
          }
        }
        return null;
      }

      if (event.type === 'MEDIA_ENGINE_SET_GO_LIVE_SOURCE') {
        const sourceId = extractSourceId(event);
        if (sourceId) {
          window.__zapSelectedSourceId = sourceId;
          console.log('[DiscordMod Dispatcher] Origem selecionada para Go Live:', sourceId);
        }
      }

      // Intercepta ação de iniciar transmissão nativa (Go Live)
      if (
        event.type === 'STREAM_START' ||
        event.type === 'MEDIA_ENGINE_SET_GO_LIVE_SOURCE'
      ) {
        const targetSourceId = extractSourceId(event) || window.__zapSelectedSourceId;
        const hasSource = event.type === 'STREAM_START' || Boolean(targetSourceId || event.desktopDescription);
        const targetChannelId = event.channelId || voiceChannelId;

        console.log('[DiscordMod Dispatcher] Go Live iniciado:', event.type, 'channelId:', targetChannelId, 'sourceId:', targetSourceId);
        if (service && targetChannelId && currentUser) {
          if (hasSource) {
            service.startBroadcast(targetChannelId, currentUser.id, targetSourceId)
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
        if (event.streamKey && currentUser?.id && event.streamKey.endsWith(currentUser.id)) {
          console.log('[DiscordMod Dispatcher] Transmissão local finalizada.');
          if (service) service.stopBroadcast();
          detachStreamFromNativePlayer();
        }
      }

      // Intercepta clique para assistir stream de participante
      if (event.type === 'STREAM_WATCH') {
        console.log('[DiscordMod Dispatcher] Interceptado pedido para assistir stream. Canal:', voiceChannelId);
        if (service && voiceChannelId && currentUser) {
          service.subscribeToStream(voiceChannelId, currentUser.id);
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

      // Suprime o Erro 2012 e estados de desconexão da mídia oficial do Discord
      if (
        (event.type === 'RTC_CONNECTION_STATE' && (event.errorCode === 2012 || event.state === 'RTC_DISCONNECTED')) ||
        (event.type === 'MEDIA_ENGINE_CONNECTION_STATE' && event.errorCode === 2012)
      ) {
        console.warn('[DiscordMod Dispatcher] Suprimido disparo de Erro 2012 oficial:', event.type);
        return;
      }

      return originalDispatch(event);
    };
  }

  // 6. Integração do Player com o Ciclo de Vida do React / DOM
  function isWebMediaOrGif(el) {
    if (!el) return false;
    const src = el.currentSrc || el.src || '';
    if (src.startsWith('http://') || src.startsWith('https://')) return true;
    if (typeof el.querySelector === 'function' && el.querySelector('source[src^="http"]')) return true;
    if (typeof el.closest === 'function') {
      if (el.closest(
        '[class*="chat_"], [class*="messagesWrapper_"], [class*="messageContent_"], ' +
        '[class*="message_"], [class*="slateTextArea_"], [class*="mediaAttachmentsContainer_"], ' +
        '[class*="embedWrapper_"], [class*="embed_"], [class*="reactions_"], [class*="expressionPicker_"], ' +
        '[class*="gifFavoriteButton_"], [class*="avatarDecoration_"], [data-testid="embed-video"]'
      )) {
        return true;
      }
    }
    return false;
  }

  function isCallStreamVideo(el) {
    if (!el || typeof el.closest !== 'function') return false;
    if (isWebMediaOrGif(el)) return false;
    return Boolean(
      el.closest(
        '[class*="videoWrapper_"], [class*="videoContainer_"], [class*="tile_"], ' +
        '[class*="callContainer_"], [class*="streamContainer_"], [class*="videoGrid_"], ' +
        '[class*="stageSection_"]'
      ) || el.id === 'zap-custom-video-player'
    );
  }

  function attachStreamToNativePlayer(stream, isLocal = false) {
    if (!stream || typeof document === 'undefined') return;
    if (!isLocal) {
      window.__activeMediaStream = stream;
    } else {
      window.__localMediaStream = stream;
    }

    // Restaura qualquer GIF ou vídeo do chat que tenha sido tocado anteriormente
    document.querySelectorAll('video').forEach(v => {
      if (isWebMediaOrGif(v) && v.srcObject) {
        v.srcObject = null;
        try { v.load(); v.play().catch(() => {}); } catch {}
      }
    });

    // Oculta avisos visuais no container da chamada sem deletar nós (evita quebrar o React)
    const staleAlerts = document.querySelectorAll('[class*="streamPaused_"], [class*="videoOverlay_"]');
    staleAlerts.forEach(el => {
      if (isCallStreamVideo(el)) {
        el.style.setProperty('display', 'none', 'important');
      }
    });

    // Localiza elementos <video> ativos EXCLUSIVAMENTE na chamada (protegendo 100% os GIFs e vídeos do chat)
    const videoElements = Array.from(document.querySelectorAll('video')).filter(v => {
      const isDummy = v.width === 2 || v.height === 2 || (v.offsetWidth < 50 && v.offsetHeight < 50 && v.offsetWidth > 0);
      if (isDummy) return false;
      return isCallStreamVideo(v);
    });

    let attached = false;
    for (const video of videoElements) {
      if (video) {
        if (video.srcObject !== stream) video.srcObject = stream;
        video.muted = isLocal;
        video.volume = isLocal ? 0 : 1.0;
        video.play().catch(e => console.warn('[DiscordMod] Video.play aviso:', e));
        attached = true;
      }
    }

    // Se o Discord ainda não montou tag <video> na célula da transmissão, injeta nosso player nativo
    if (!attached) {
      const container = document.querySelector('[class*="videoWrapper_"], [class*="videoContainer_"], [class*="tile_"]');
      if (container && isCallStreamVideo(container)) {
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
        player.muted = isLocal;
        player.volume = isLocal ? 0 : 1.0;
        player.play().catch(() => {});
      }
    }
  }

  function detachStreamFromNativePlayer() {
    if (typeof document === 'undefined') return;
    window.__activeMediaStream = null;
    window.__localMediaStream = null;
    const videoElements = Array.from(document.querySelectorAll('video')).filter(v => isCallStreamVideo(v));
    for (const video of videoElements) {
      if (video && video.srcObject) {
        video.srcObject = null;
      }
    }
    const customPlayer = document.getElementById('zap-custom-video-player');
    if (customPlayer) customPlayer.remove();
  }

  // Observador contínuo de montagem de nós <video> no DOM (sempre reinicia para aplicar novos filtros)
  if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
    if (window.__zapVideoObserver) {
      try { window.__zapVideoObserver.disconnect(); } catch {}
      window.__zapVideoObserver = null;
    }
    window.__zapVideoObserver = new MutationObserver(() => {
      const streamToApply = window.__activeMediaStream || window.__localMediaStream;
      const isLocal = !window.__activeMediaStream && Boolean(window.__localMediaStream);

      if (streamToApply) {
        attachStreamToNativePlayer(streamToApply, isLocal);
      }

      // Oculta avisos de Erro 2012 na chamada sem deletar nós do DOM
      const errorBoxes = document.querySelectorAll('div[role="alert"], [class*="streamPaused_"], div[class*="emptyState_"], div[class*="streamNotice_"]');
      errorBoxes.forEach(el => {
        if (isCallStreamVideo(el)) {
          el.style.setProperty('display', 'none', 'important');
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

  // Hook no botão oficial do monitor no painel de voz
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

  // Verificação de sincronização periódica de canal (a cada 2s)
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

  return {
    status: verified ? (enabled ? 'applied' : 'disabled') : 'unverified',
    verified,
    experimentName: primaryExperiment,
    appliedList,
    devUnlocked
  };
})();
