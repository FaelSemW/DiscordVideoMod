(() => {
  const enabled = __RAFA_ENABLED__;
  const primaryExperiment = '2026-08-video-guard';
  const cfg = window.__ZAP_CONFIG__ || {};
  const ZAP_SIGNALING = cfg.signalingUrl || (cfg.serverUrl ? cfg.serverUrl.replace(/^http/i, 'ws') + '/signaling' : 'wss://discordvideomod.onrender.com/signaling');

  if (!window.__zapInitializedLog) {
    window.__zapInitializedLog = true;
    console.log(
      '%c[DiscordMod]%c Ativo v' + (window.__DISCORD_MOD_VERSION__ || '1.1.2') + ' (P2P 1080p60 Bypass & Zero-2012 Engine)',
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
  req = runtimes.sort((a, b) => Object.keys(b?.c || {}).length - Object.keys(a?.c || {}).length)[0];
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

  // Pre-load relevant stores including VideoStreamStore, AVErrorStore, UserStore, SelectedChannelStore
  const relevant = factories.filter(([, factory]) =>
    /ApexExperimentStore|_orderedActionHandlers|getClientOverrides|UserStore|getCurrentUser|isDeveloper|SelectedChannelStore|getVoiceChannelId|VideoStreamStore|getTimedoutVideos|AVErrorStore|getActiveErrorsOfType|ApplicationStreamingStore|2026-08-video-guard/.test(String(factory))
  );
  for (const [id] of relevant) {
    try { req(id); } catch {}
  }

  const candidates = [];
  for (const module of Object.values(req.c)) {
    const exports = module?.exports;
    if (!exports || !['object', 'function'].includes(typeof exports)) continue;
    candidates.push(exports);
    for (const key of Object.getOwnPropertyNames(exports)) {
      if (key === 'prototype' || key === 'length' || key === 'name') continue;
      try {
        const val = exports[key];
        if (val && ['object', 'function'].includes(typeof val)) {
          candidates.push(val);
        }
      } catch {}
    }
  }

  const store = candidates.find(x => {
    try { return x && typeof x.getClientOverrides === 'function' && (x.getName?.() === 'ApexExperimentStore' || x.constructor?.displayName === 'ApexExperimentStore'); }
    catch { return false; }
  }) || candidates.find(x => {
    try { return x && typeof x.getClientOverrides === 'function'; }
    catch { return false; }
  });

  const dispatcher = store?._dispatcher || candidates.find(x =>
    x && typeof x.dispatch === 'function' && (x._actionHandlers || typeof x.subscribe === 'function')
  );

  const userStore = candidates.find(x => {
    try { return x && typeof x.getCurrentUser === 'function' && typeof x.getUsers === 'function'; }
    catch { return false; }
  });

  const authStore = candidates.find(x => {
    try { return x && typeof x.getId === 'function' && typeof x.getSessionId === 'function'; }
    catch { return false; }
  });

  const voiceStore = candidates.find(x => {
    try { return x && typeof x.getVoiceChannelId === 'function' && typeof x.getChannelId === 'function'; }
    catch { return false; }
  });

  const videoStreamStore = candidates.find(x => {
    try { return x && typeof x.getTimedoutVideos === 'function'; }
    catch { return false; }
  });

  const avErrorStore = candidates.find(x => {
    try { return x && typeof x.getActiveErrorsOfType === 'function'; }
    catch { return false; }
  });

  const appStreamingStore = candidates.find(x => {
    try { return x && typeof x.getAllActiveStreams === 'function' && typeof x.getActiveStreamForStreamKey === 'function'; }
    catch { return false; }
  });

  // Patch direto no objeto de experimento 2026-08-video-guard (variations 1 e 2 -> videoEnabled: true)
  for (const c of candidates) {
    try {
      if (c && (c.name === primaryExperiment || c.id === primaryExperiment || c.definition?.name === primaryExperiment || c.definition?.id === primaryExperiment)) {
        if (c.variations) {
          for (const k of Object.keys(c.variations)) {
            if (c.variations[k] && typeof c.variations[k] === 'object') {
              c.variations[k].videoEnabled = true;
              c.variations[k].enabled = false;
            }
          }
        }
        if (typeof c.getConfig === 'function' && !c.__zapConfigPatched) {
          c.__zapConfigPatched = true;
          const origGetConfig = c.getConfig.bind(c);
          c.getConfig = function (...args) {
            const res = origGetConfig(...args) || {};
            return { ...res, videoEnabled: true, enabled: false };
          };
        }
        if (typeof c.useConfig === 'function' && !c.__zapUseConfigPatched) {
          c.__zapUseConfigPatched = true;
          const origUseConfig = c.useConfig.bind(c);
          c.useConfig = function (...args) {
            const res = origUseConfig(...args) || {};
            return { ...res, videoEnabled: true, enabled: false };
          };
        }
      }
    } catch {}
  }

  // Patch direto no VideoStreamStore e AVErrorStore para neutralizar Erro 2012 / 2011 / 2014 / 2015 na origem
  if (videoStreamStore) {
    try {
      const proto = Object.getPrototypeOf(videoStreamStore) || videoStreamStore;
      if (!proto.__zapTimedoutPatched) {
        proto.__zapTimedoutPatched = true;
        proto.getTimedoutVideos = () => ({});
        proto.getTimedoutVideo = () => null;
      }
    } catch {}
  }

  if (avErrorStore) {
    try {
      const proto = Object.getPrototypeOf(avErrorStore) || avErrorStore;
      if (!proto.__zapAvErrorPatched) {
        proto.__zapAvErrorPatched = true;
        proto.getActiveErrorsOfType = () => [];
        proto.hasActiveErrorOfType = () => false;
        proto.getActiveErrors = () => new Map();
      }
    } catch {}
  }

  // Atualiza referências dinâmicas em window.__zapLive para nunca usar closures obsoletas
  window.__zapLive = {
    dispatcher,
    store,
    userStore,
    authStore,
    voiceStore,
    videoStreamStore,
    avErrorStore,
    appStreamingStore,
    getActiveVoiceChannelId() {
      try {
        const vs = this.voiceStore || voiceStore;
        if (vs && typeof vs.getVoiceChannelId === 'function') {
          const id = vs.getVoiceChannelId();
          if (typeof id === 'string' && /^\d+$/.test(id)) return id;
        }
        for (const c of candidates) {
          if (c && typeof c.getVoiceChannelId === 'function') {
            const id = c.getVoiceChannelId();
            if (typeof id === 'string' && /^\d+$/.test(id)) return id;
          }
        }
      } catch {}
      return null;
    },
    getCurrentUser() {
      try {
        return (this.userStore || userStore)?.getCurrentUser?.() || null;
      } catch {
        return null;
      }
    },
    getCurrentUserId() {
      try {
        const u = this.getCurrentUser();
        if (u?.id) return u.id;
        const id = (this.authStore || authStore)?.getId?.();
        if (typeof id === 'string' && /^\d+$/.test(id)) return id;
      } catch {}
      return null;
    }
  };

  if (!dispatcher || !store) return { status: 'waiting-dispatcher-store' };

  // 1. Unlock Developer & 1080p60 Settings (sem tocar em user.isStaff que é método não-configurável)
  let devUnlocked = false;
  try {
    const user = window.__zapLive.getCurrentUser();
    if (user) {
      try {
        Object.defineProperty(user, 'isDeveloper', { get: () => true, configurable: true });
      } catch {}
      try {
        user.premiumType = 2;
      } catch {}
      devUnlocked = true;
    }
    for (const c of candidates) {
      try {
        if (c && ('isDeveloper' in c) && typeof c.getName === 'function' && c.getName().includes('Developer')) {
          Object.defineProperty(c, 'isDeveloper', { get: () => true, configurable: true });
          devUnlocked = true;
        }
      } catch {}
    }
  } catch (err) {
    console.warn('[ZapStream] Dev unlock error:', err);
  }

  // 2. Override Video Guard experiment to variant -1 (bypasses region restriction)
  try {
    const proto = Object.getPrototypeOf(store) || store;
    if (proto.getClientOverrides && !proto.__zapOverridePatched) {
      proto.__zapOverridePatched = true;
      const origGetOverrides = proto.getClientOverrides;
      proto.getClientOverrides = function () {
        const res = origGetOverrides.call(this) || {};
        if (enabled) {
          res[primaryExperiment] = { type: 'user', variantId: -1 };
        }
        return res;
      };
    }
  } catch {}

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
        const u = window.__zapLive?.getCurrentUser();
        if (u) {
          try { Object.defineProperty(u, 'isDeveloper', { get: () => true, configurable: true }); } catch {}
          try { u.premiumType = 2; } catch {}
        }
      } catch (e) {}
    };
    try { dispatcher.subscribe('CONNECTION_OPEN', reapply); } catch {}
    try { dispatcher.subscribe('CURRENT_USER_UPDATE', reapply); } catch {}
    try { dispatcher.subscribe('APEX_EXPERIMENTS_FETCH_SUCCESS', reapply); } catch {}
  }

  // 3. Inject CSS to hide Discord Error 2012 / "Transmissão pausada" overlays cleanly (sem quebrar o React DOM)
  if (typeof document !== 'undefined' && !document.getElementById('zap-native-stream-fix')) {
    const style = document.createElement('style');
    style.id = 'zap-native-stream-fix';
    style.textContent = `
      /* Oculta mensagens oficiais de Erro 2012 e transmissão pausada */
      [class*="videoOverlay_"],
      [class*="streamPaused_"],
      [class*="streamNotice_"],
      [class*="streamError_"],
      [class*="streamUnavailable_"],
      div[class*="noticeRegionBlocked_"],
      div[class*="errorNotice_"] {
        display: none !important;
        pointer-events: none !important;
        opacity: 0 !important;
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

  // 4. Inicializa WebRTCService desacoplado do Discord (suporta hot-reload se a classe foi atualizada)
  const WebRTCServiceClass = window.WebRTCService;
  if (WebRTCServiceClass && (!window.__zapWebRTCInstance || !window.__zapWebRTCInstance.createOfferForViewer)) {
    if (window.__zapWebRTCInstance && typeof window.__zapWebRTCInstance.destroy === 'function') {
      try { window.__zapWebRTCInstance.destroy(); } catch {}
    }
    window.__zapWebRTCInstance = new WebRTCServiceClass({
      signalingUrl: ZAP_SIGNALING,
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' }
      ]
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

  // Helper para forçar estado ACTIVE da stream no Flux do Discord (cancela o timer de 5s do STREAM_TIMED_OUT)
  function markStreamActiveInDiscord(originalDispatch, streamKey, currentUserId) {
    if (!streamKey || typeof originalDispatch !== 'function') return;
    const activate = () => {
      try {
        originalDispatch({
          type: 'STREAM_CREATE',
          streamKey,
          region: 'us-east',
          viewerIds: currentUserId ? [currentUserId] : [],
          paused: false
        });
        originalDispatch({
          type: 'RTC_CONNECTION_STATE',
          streamKey,
          state: 'RTC_CONNECTED'
        });
        const parts = streamKey.split(':');
        const ownerId = parts[parts.length - 1];
        if (ownerId) {
          originalDispatch({
            type: 'CLEAR_VIDEO_STREAM_READY_TIMEOUT',
            mediaContext: 'stream',
            userId: ownerId
          });
        }
      } catch {}
    };
    setTimeout(activate, 30);
    setTimeout(activate, 350);
    setTimeout(activate, 1200);
  }

  // 5. Interceptação da Camada de Estado / Dispatcher
  if (dispatcher && !window.__zapDispatcherInterceptedV2) {
    window.__zapDispatcherInterceptedV2 = true;
    const rawDispatch = dispatcher.__zapOriginalDispatch || dispatcher.dispatch.bind(dispatcher);
    dispatcher.__zapOriginalDispatch = rawDispatch;

    dispatcher.dispatch = function (event) {
      if (!event || typeof event !== 'object') {
        return rawDispatch(event);
      }

      const live = window.__zapLive;
      const service = window.__zapWebRTCInstance;
      const voiceChannelId = event.channelId ||
        (event.streamKey ? event.streamKey.split(':')[2] : null) ||
        live?.getActiveVoiceChannelId?.();
      const currentUserId = live?.getCurrentUserId?.();

      // Bloqueia na origem todos os eventos que disparam o Erro 2012 / 2011 / 2014 / 2015 e derrubam o player
      if (
        event.type === 'STREAM_TIMED_OUT' ||
        event.type === 'VIDEO_STREAM_READY_TIMEOUT'
      ) {
        console.log('[DiscordMod Dispatcher] Bloqueado evento de timeout de stream (Anti-2012):', event.type, event.streamKey);
        if (event.streamKey) {
          markStreamActiveInDiscord(rawDispatch, event.streamKey, currentUserId);
        }
        return;
      }

      if (event.type === 'ACTIVE_AV_ERRORS_CHANGED' && event.activeErrors instanceof Map) {
        for (const [k, errObj] of event.activeErrors.entries()) {
          const errType = String(errObj?.type || k || '');
          if (
            errType.includes('timeout') ||
            errType.includes('stream') ||
            errObj?.errorCode === 2012 ||
            errObj?.errorCode === 2011 ||
            errObj?.errorCode === 2014 ||
            errObj?.errorCode === 2015
          ) {
            event.activeErrors.delete(k);
          }
        }
      }

      if (event.type === 'STREAM_UPDATE' && event.paused === true) {
        event.paused = false;
      }

      if (event.type === 'STREAM_DELETE') {
        const hasActiveP2P = Boolean(window.__activeMediaStream || window.__localMediaStream || service?.remoteStream || service?.localStream);
        if (hasActiveP2P && (event.unavailable || event.reason === 'unauthorized' || event.reason === 'stream_failed' || event.reason === 'stream_full')) {
          console.log('[DiscordMod Dispatcher] Suprimido STREAM_DELETE de erro enquanto P2P está ativo:', event.reason);
          if (event.streamKey) {
            markStreamActiveInDiscord(rawDispatch, event.streamKey, currentUserId);
          }
          return;
        }
      }

      if (event.type === 'RTC_CONNECTION_STATE' && event.streamKey && event.state !== 'RTC_CONNECTED') {
        const hasActiveP2P = Boolean(window.__activeMediaStream || window.__localMediaStream || service?.remoteStream || service?.localStream);
        if (hasActiveP2P || event.errorCode === 2012 || event.state === 'DISCONNECTED' || event.state === 'RTC_DISCONNECTED') {
          event.state = 'RTC_CONNECTED';
          delete event.errorCode;
        }
      }

      if (event.type === 'MEDIA_ENGINE_CONNECTION_STATE' && event.errorCode === 2012) {
        return;
      }

      // Intercepta ação de iniciar transmissão nativa (Go Live)
      if (
        event.type === 'STREAM_START' ||
        event.type === 'MEDIA_ENGINE_SET_GO_LIVE_SOURCE'
      ) {
        if (event.errorCode != null) {
          delete event.errorCode;
          delete event.endReason;
        }
        const hasSource = event.type === 'STREAM_START' ||
          Boolean(event.desktopDescription?.id || event.sourceId || event.desktopDescription || event.settings?.desktopSettings);
        const targetChannelId = event.channelId || voiceChannelId;
        console.log('[DiscordMod Dispatcher] Go Live iniciado:', event.type, 'channelId:', targetChannelId);
        if (service && targetChannelId && currentUserId) {
          if (hasSource) {
            service.startBroadcast(targetChannelId, currentUserId)
              .then(stream => {
                console.log('[DiscordMod] Transmissão iniciada! Vinculando preview local no player...');
                attachStreamToNativePlayer(stream, true);
              })
              .catch(err => {
                console.error('[DiscordMod] Falha ao iniciar transmissão no WebRTCService:', err);
              });
          } else if (event.type === 'MEDIA_ENGINE_SET_GO_LIVE_SOURCE' && event.settings === null) {
            service.stopBroadcast();
            detachStreamFromNativePlayer();
          }
        }
      }

      // Encerramento de transmissão do usuário local
      if (event.type === 'STREAM_STOP') {
        if (!event.streamKey || (currentUserId && event.streamKey.endsWith(currentUserId))) {
          console.log('[DiscordMod Dispatcher] Transmissão local finalizada.');
          if (service) service.stopBroadcast();
          detachStreamFromNativePlayer();
        }
      }

      // Intercepta clique para assistir stream de participante
      if (event.type === 'STREAM_WATCH') {
        console.log('[DiscordMod Dispatcher] Interceptado pedido para assistir stream. Canal:', voiceChannelId);
        if (event.streamKey) {
          markStreamActiveInDiscord(rawDispatch, event.streamKey, currentUserId);
        }
        if (service && voiceChannelId && currentUserId) {
          if (service.remoteStream && service.remoteStream.getTracks().some(t => t.readyState === 'live')) {
            setTimeout(() => attachStreamToNativePlayer(service.remoteStream, false), 50);
          }
          service.subscribeToStream(voiceChannelId, currentUserId);
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

      return rawDispatch(event);
    };
  }

  // 6. Integração do Player com o Ciclo de Vida do React / DOM (sem remover nós do React)
  function hideErrorOverlays() {
    if (typeof document === 'undefined') return;
    const staleAlerts = document.querySelectorAll(
      '[class*="streamPaused_"], [class*="videoOverlay_"], [class*="streamError_"], [class*="streamUnavailable_"], [class*="streamNotice_"]'
    );
    staleAlerts.forEach(el => {
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
    });
  }

  function attachStreamToNativePlayer(stream, isLocal = false) {
    if (!stream || typeof document === 'undefined') return;
    if (!isLocal) {
      window.__activeMediaStream = stream;
    } else {
      window.__localMediaStream = stream;
    }

    hideErrorOverlays();

    // Localiza elementos <video> ativos (ignorando tags dummy de 2x2 do Discord)
    const videoElements = Array.from(document.querySelectorAll('video')).filter(v => {
      if (v.id === 'zap-custom-video-player') return false;
      const isDummy = v.width === 2 || v.height === 2 || (v.offsetWidth < 50 && v.offsetHeight < 50 && v.offsetWidth > 0);
      return !isDummy;
    });

    let attached = false;
    for (const video of videoElements) {
      if (video) {
        if (video.srcObject !== stream) {
          video.srcObject = stream;
        }
        video.muted = isLocal;
        video.volume = isLocal ? 0 : 1.0;
        if (video.paused) {
          video.play().catch(() => {});
        }
        attached = true;
      }
    }

    // Se o Discord já montou sua própria tag <video>, remove nosso player customizado para evitar duplicidade
    if (attached) {
      const customPlayer = document.getElementById('zap-custom-video-player');
      if (customPlayer && customPlayer.parentNode) {
        customPlayer.srcObject = null;
        customPlayer.remove();
      }
      return;
    }

    // Se o Discord ainda não montou tag <video> na célula da transmissão, injeta nosso player nativo em um wrapper isolado
    const container = document.querySelector(
      '[class*="videoWrapper_"], [class*="videoContainer_"], [class*="streamPreviewWrapper_"], [class*="tile_"] [class*="background_"]'
    ) || document.querySelector('[class*="tile_"]');

    if (container) {
      let player = document.getElementById('zap-custom-video-player');
      if (!player) {
        player = document.createElement('video');
        player.id = 'zap-custom-video-player';
        player.autoplay = true;
        player.playsInline = true;
        player.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:10;pointer-events:none;';
        container.appendChild(player);
      } else if (player.parentElement !== container) {
        container.appendChild(player);
      }
      if (player.srcObject !== stream) {
        player.srcObject = stream;
      }
      player.muted = isLocal;
      player.volume = isLocal ? 0 : 1.0;
      if (player.paused) {
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

  // Observador contínuo de montagem de nós <video> no DOM (Resiliência a re-render do React)
  if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined' && !window.__zapVideoObserverV2) {
    if (window.__zapVideoObserver) {
      try { window.__zapVideoObserver.disconnect(); } catch {}
    }
    window.__zapVideoObserverV2 = new MutationObserver(() => {
      const streamToApply = window.__activeMediaStream || window.__localMediaStream;
      const isLocal = !window.__activeMediaStream && Boolean(window.__localMediaStream);

      if (streamToApply) {
        attachStreamToNativePlayer(streamToApply, isLocal);
      }

      // Oculta banners de Erro 2012 gerados dinamicamente (usando CSS display:none para não quebrar o React)
      const errorBoxes = document.querySelectorAll('div[role="alert"], [class*="streamPaused_"], div[class*="emptyState_"], div[class*="streamNotice_"]');
      errorBoxes.forEach(el => {
        const text = el.textContent || '';
        if (text.includes('2012') || text.includes('transmissão não iniciou') || el.className?.includes?.('streamPaused_')) {
          el.style.setProperty('display', 'none', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
        }
      });
    });

    if (document.body) {
      window.__zapVideoObserverV2.observe(document.body, {
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

  // Verificação de sincronização periódica de canal (a cada 2s) usando referências vivas (__zapLive)
  if (typeof setInterval !== 'undefined' && !window.__zapChannelSyncIntervalV2) {
    if (window.__zapChannelSyncInterval) {
      clearInterval(window.__zapChannelSyncInterval);
    }
    let lastVoiceChannelId = null;
    window.__zapChannelSyncIntervalV2 = setInterval(() => {
      const live = window.__zapLive;
      const currentChannelId = live?.getActiveVoiceChannelId?.();
      const currentUserId = live?.getCurrentUserId?.();
      const service = window.__zapWebRTCInstance;

      // Mantém stream sempre anexada se houver vídeo ativo
      const streamToApply = window.__activeMediaStream || window.__localMediaStream;
      if (streamToApply) {
        attachStreamToNativePlayer(streamToApply, !window.__activeMediaStream && Boolean(window.__localMediaStream));
      }

      if (currentChannelId !== lastVoiceChannelId) {
        if (!currentChannelId) {
          lastVoiceChannelId = null;
          if (service) {
            console.log('[DiscordMod] Saiu do canal de voz.');
            service.leaveChannel();
            detachStreamFromNativePlayer();
          }
        } else if (currentUserId && service) {
          lastVoiceChannelId = currentChannelId;
          console.log('[DiscordMod] Canal de voz ativo:', currentChannelId, 'userId:', currentUserId);
          service.subscribeToStream(currentChannelId, currentUserId);
        }
      }
    }, 1500);
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
