(() => {
  const enabled = __RAFA_ENABLED__;
  const primaryExperiment = '2026-08-video-guard';
  const cfg = window.__ZAP_CONFIG__ || {};
  const ZAP_SIGNALING = cfg.signalingUrl || (cfg.serverUrl ? cfg.serverUrl.replace(/^http/i, 'ws') + '/signaling' : 'wss://discordvideomod.onrender.com/signaling');

  if (!window.__zapInitializedLog) {
    window.__zapInitializedLog = true;
    console.log(
      '%c[DiscordMod]%c Ativo v' + (window.__DISCORD_MOD_VERSION__ || '1.1.5') + ' (P2P 1080p60 Bypass & Cloud 24/7)',
      'background: #5865F2; color: #ffffff; font-weight: bold; padding: 2px 6px; border-radius: 4px;',
      'color: #57F287; font-weight: bold;'
    );
  }

  // Fast-path: se já está tudo aplicado e validado nesta janela, retorna imediatamente sem escanear módulos Webpack
  if (window.__zapReady && window.__zapStoreRef) {
    try {
      const cur = window.__zapStoreRef.getClientOverrides()?.[primaryExperiment];
      if (enabled ? cur?.variantId === -1 : cur == null) {
        return {
          status: enabled ? 'applied' : 'disabled',
          verified: true,
          experimentName: primaryExperiment,
          appliedList: window.__zapAppliedList || [],
          devUnlocked: true
        };
      }
    } catch {}
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

  // Coleta experimentos de video-guard
  const targetExperiments = new Set([primaryExperiment]);
  for (const [, factory] of factories) {
    const matches = String(factory).match(/202[0-9]-[0-9]{2}-video-guard/g);
    if (matches) {
      for (const m of matches) targetExperiments.add(m);
    }
  }

  // Pré-carrega módulos e stores essenciais
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

  let selectedChannelStore = null;
  try {
    selectedChannelStore = candidates.find(x => {
      try { return x && typeof x.getVoiceChannelId === 'function' && x.getName?.() === 'SelectedChannelStore'; }
      catch { return false; }
    }) || null;
  } catch {}

  let voiceChannelResolver = null;
  if (selectedChannelStore && typeof selectedChannelStore.getVoiceChannelId === 'function') {
    voiceChannelResolver = () => selectedChannelStore.getVoiceChannelId();
  } else {
    for (const c of candidates) {
      try {
        if (c && typeof c.getVoiceChannelId === 'function') {
          voiceChannelResolver = () => c.getVoiceChannelId();
          break;
        }
      } catch {}
    }
  }

  function getActiveVoiceChannelId() {
    if (voiceChannelResolver) {
      try {
        const id = voiceChannelResolver();
        return (typeof id === 'string' && /^\d+$/.test(id)) ? id : null;
      } catch {}
    }
    return null;
  }

  if (!dispatcher || !store) return { status: 'waiting-dispatcher-store' };

  // 1. Desbloqueia experimentos de desenvolvedor (1080p 60fps)
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

  // 2. Override de Video Guard para variante -1 (elimina bloqueio regional)
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

  // Listener persistente de overrides
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

  // 3. Injeta CSS para acelerar o player por hardware (GPU compositor) e ocultar avisos de bloqueio
  if (typeof document !== 'undefined' && !document.getElementById('zap-native-stream-fix')) {
    const style = document.createElement('style');
    style.id = 'zap-native-stream-fix';
    style.textContent = `
      [class*="videoOverlay_"],
      [class*="streamPaused_"],
      [class*="callAvatarStatus_"],
      [class*="streamNotice_"],
      div[class*="emptyState_"],
      div[class*="noticeRegionBlocked_"],
      div:has(> [class*="streamPaused_"]) {
        display: none !important;
      }
      div[class*="videoWrapper_"] video,
      div[class*="videoContainer_"] video,
      div[class*="tile_"] video,
      #zap-custom-video-player {
        object-fit: contain !important;
        width: 100% !important;
        height: 100% !important;
        display: block !important;
        transform: translate3d(0, 0, 0) !important;
        will-change: transform !important;
        backface-visibility: hidden !important;
      }
    `;
    if (document.head) document.head.appendChild(style);
  }

  // 4. Inicializa WebRTCService desacoplado do Discord
  const WebRTCServiceClass = window.WebRTCService;
  if (WebRTCServiceClass && !window.__zapWebRTCInstance) {
    window.__zapWebRTCInstance = new WebRTCServiceClass({
      signalingUrl: ZAP_SIGNALING,
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    });

    const service = window.__zapWebRTCInstance;
    service.connectSignaling();

    service.on('remoteStream', (stream) => {
      console.log('[DiscordMod] Novo stream de vídeo recebido via WebRTCService!', stream);
      attachStreamToNativePlayer(stream, false);
    });

    service.on('streamStopped', () => {
      console.log('[DiscordMod] Transmissão remota encerrada.');
      detachStreamFromNativePlayer();
    });
  }

  function sendSourcePickToMain(id, name, extra = {}) {
    try {
      console.log('[DISCORD_MOD_SOURCE_PICK]' + JSON.stringify({ id: id || null, name: name || null, ...extra }));
    } catch (e) {}
  }

  // 5. Interceptação Cirúrgica da Camada de Estado / Dispatcher
  if (dispatcher && !window.__zapDispatcherIntercepted) {
    window.__zapDispatcherIntercepted = true;
    const originalDispatch = dispatcher.dispatch.bind(dispatcher);

    dispatcher.dispatch = function (event) {
      if (!event || typeof event !== 'object') {
        return originalDispatch(event);
      }

      // A. Suprime todos os gatilhos de Erro 2012, Timeout e Queda do motor de vídeo oficial na ApplicationStreamingStore
      if (event.type === 'STREAM_TIMED_OUT') {
        console.warn('[DiscordMod Dispatcher] Suprimido STREAM_TIMED_OUT para evitar Erro 2012.');
        return;
      }

      if (event.type === 'MEDIA_ENGINE_SET_GO_LIVE_SOURCE' && event.errorCode != null) {
        console.warn('[DiscordMod Dispatcher] Suprimido erro nativo em MEDIA_ENGINE_SET_GO_LIVE_SOURCE:', event.errorCode);
        return;
      }

      if (
        (event.type === 'RTC_CONNECTION_STATE' && (
          event.errorCode != null ||
          (event.streamKey && (event.state === 'DISCONNECTED' || event.state === 'RTC_DISCONNECTED'))
        )) ||
        (event.type === 'MEDIA_ENGINE_CONNECTION_STATE' && event.errorCode != null)
      ) {
        console.warn('[DiscordMod Dispatcher] Suprimido estado de erro/desconexão RTC oficial:', event.type, event.errorCode || event.state);
        return;
      }

      if (
        event.type === 'STREAM_DELETE' &&
        (event.reason === 'unauthorized' || event.reason === 'stream_full' || event.unavailable === true || event.errorCode != null)
      ) {
        console.warn('[DiscordMod Dispatcher] Suprimido STREAM_DELETE por bloqueio:', event.reason);
        return;
      }

      const service = window.__zapWebRTCInstance;
      const needsChannel = event.type === 'STREAM_START' ||
        event.type === 'MEDIA_ENGINE_SET_GO_LIVE_SOURCE' ||
        event.type === 'STREAM_WATCH';
      const voiceChannelId = needsChannel ? (event.channelId ||
        (event.streamKey ? event.streamKey.split(':')[2] : null) ||
        getActiveVoiceChannelId()) : null;
      const currentUser = userStore?.getCurrentUser?.();

      // B. Intercepta início de transmissão (abas Aplicativos, Janelas e Telas)
      if (event.type === 'STREAM_START') {
        const rawSourceId = event.sourceId || event.desktopDescription?.id || null;
        const pickedId = (rawSourceId && !String(rawSourceId).startsWith('prepicked:')) ? rawSourceId : null;
        const pickedName = event.sourceName || event.desktopDescription?.name || null;

        window.__lastPickedSourceId = pickedId;
        window.__lastPickedSourceName = pickedName;
        sendSourcePickToMain(pickedId, pickedName, {
          resetId: !pickedId,
          resetName: !pickedName
        });

        const targetChannelId = event.channelId || voiceChannelId;
        window.__startingStreamBroadcast = true;

        // Executa o dispatch original primeiro para que o ApplicationSwitchingManager resolva o PID do jogo
        // em "window:<hwnd>" e despache MEDIA_ENGINE_SET_GO_LIVE_SOURCE ativando o soundshare nativo por PID!
        let result;
        try {
          result = originalDispatch(event);
        } finally {
          window.__startingStreamBroadcast = false;
        }

        if (targetChannelId && currentUser) {
          const streamType = event.streamType || (event.guildId ? 'guild' : 'call');
          const streamKey = event.guildId
            ? `${streamType}:${event.guildId}:${targetChannelId}:${currentUser.id}`
            : `${streamType}:${targetChannelId}:${currentUser.id}`;

          setTimeout(() => {
            try {
              originalDispatch({
                type: 'RTC_CONNECTION_STATE',
                state: 'RTC_CONNECTED',
                streamKey,
                context: 'stream'
              });
            } catch (e) {}
          }, 50);

          if (service) {
            service.startBroadcast(targetChannelId, currentUser.id, { forceRestart: true })
              .then(stream => {
                console.log('[DiscordMod] Transmissão de vídeo iniciada! Vinculando preview local no player...');
                attachStreamToNativePlayer(stream, true);
              })
              .catch(err => {
                console.error('[DiscordMod] Falha ao iniciar transmissão no WebRTCService:', err);
              });
          }
        }

        return result;
      }

      // C. Intercepta definição/troca de fonte Go Live (resolução de PID -> window:hwnd ou troca de janela)
      if (event.type === 'MEDIA_ENGINE_SET_GO_LIVE_SOURCE') {
        const desktopSettings = event.settings?.desktopSettings;
        if (desktopSettings || event.desktopDescription || event.sourceId) {
          const rawId = desktopSettings?.sourceId ||
            event.desktopDescription?.id ||
            (typeof event.desktopDescription === 'string' ? event.desktopDescription : null) ||
            event.sourceId ||
            null;
          const pickedId = (rawId && !String(rawId).startsWith('prepicked:')) ? rawId : null;
          const pickedName = desktopSettings?.sourceName ||
            event.desktopDescription?.name ||
            event.sourceName ||
            window.__lastPickedSourceName ||
            null;

          if (pickedId || pickedName) {
            const sourceChanged = Boolean(pickedId && pickedId !== window.__lastPickedSourceId);
            if (pickedId) window.__lastPickedSourceId = pickedId;
            if (pickedName) window.__lastPickedSourceName = pickedName;
            sendSourcePickToMain(window.__lastPickedSourceId, window.__lastPickedSourceName);

            // Se o usuário trocou a janela transmitida diretamente sem novo STREAM_START, atualiza a captura
            if (!window.__startingStreamBroadcast && sourceChanged && service && voiceChannelId && currentUser) {
              service.startBroadcast(voiceChannelId, currentUser.id, { forceRestart: true })
                .then(stream => {
                  attachStreamToNativePlayer(stream, true);
                })
                .catch(() => {});
            }
          }
        }
        // NUNCA chama stopBroadcast aqui, pois eventos internos do Discord podem disparar MEDIA_ENGINE_SET_GO_LIVE_SOURCE vazio
        return originalDispatch(event);
      }

      // D. Encerramento explícito de transmissão pelo usuário local
      if (event.type === 'STREAM_STOP') {
        if (!event.streamKey || (currentUser?.id && event.streamKey.endsWith(currentUser.id))) {
          console.log('[DiscordMod Dispatcher] Transmissão local finalizada pelo usuário.');
          if (service) service.stopBroadcast();
          detachStreamFromNativePlayer();
        }
        return originalDispatch(event);
      }

      // E. Intercepta clique para assistir stream de participante
      if (event.type === 'STREAM_WATCH') {
        console.log('[DiscordMod Dispatcher] Assistindo transmissão. Canal:', voiceChannelId, 'StreamKey:', event.streamKey);
        if (event.streamKey) {
          const parts = String(event.streamKey).split(':');
          window.__activeStreamerUserId = parts[parts.length - 1];
        }

        const result = originalDispatch(event);

        // Marca a transmissão como RTC_CONNECTED na ApplicationStreamingStore para abrir o player imediatamente sem Erro 2012
        if (event.streamKey) {
          setTimeout(() => {
            try {
              originalDispatch({
                type: 'RTC_CONNECTION_STATE',
                state: 'RTC_CONNECTED',
                streamKey: event.streamKey,
                context: 'stream'
              });
            } catch (e) {}
          }, 50);
        }

        if (service && voiceChannelId && currentUser) {
          service.subscribeToStream(voiceChannelId, currentUser.id);
        }

        return result;
      }

      // F. Intercepta saída de canal de voz
      if (event.type === 'VOICE_CHANNEL_SELECT' && !event.channelId) {
        console.log('[DiscordMod Dispatcher] Usuário saiu do canal de voz.');
        if (service) {
          service.leaveChannel();
          detachStreamFromNativePlayer();
        }
      }

      return originalDispatch(event);
    };
  }

  // 6. Integração Otimizada do Player com o DOM (Zero Forced Reflow / Zero Travadas)
  let currentActiveVideo = null;

  function attachStreamToNativePlayer(stream, isLocal = false) {
    if (!stream || typeof document === 'undefined') return;
    if (!isLocal) {
      window.__activeMediaStream = stream;
    } else {
      window.__localMediaStream = stream;
    }

    if (currentActiveVideo && currentActiveVideo.isConnected && currentActiveVideo.srcObject === stream) {
      if (currentActiveVideo.paused) currentActiveVideo.play().catch(() => {});
      return;
    }

    const staleAlerts = document.querySelectorAll('[class*="streamPaused_"], [class*="videoOverlay_"]');
    staleAlerts.forEach(el => { if (el.style.display !== 'none') el.style.display = 'none'; });

    const videoElements = document.querySelectorAll('video');
    for (const video of videoElements) {
      if (isWebMediaVideo(video)) continue;
      if (video.width === 2 || video.height === 2) continue;

      if (video.srcObject !== stream) {
        video.srcObject = stream;
      }
      // Garante vídeo 100% mudo no elemento HTML5: o áudio da janela sai exclusivamente na faixa nativa de transmissão do Discord
      video.muted = true;
      video.volume = 0;
      try {
        video.disablePictureInPicture = true;
        video.disableRemotePlayback = true;
      } catch (e) {}
      if (video.paused) video.play().catch(e => console.warn('[DiscordMod] Video.play aviso:', e));
      currentActiveVideo = video;
      return;
    }

    const container = document.querySelector('[class*="videoWrapper_"], [class*="videoContainer_"], [class*="tile_"]');
    if (container) {
      let player = document.getElementById('zap-custom-video-player');
      if (!player) {
        player = document.createElement('video');
        player.id = 'zap-custom-video-player';
        player.autoplay = true;
        player.playsInline = true;
        player.muted = true;
        player.volume = 0;
        try {
          player.disablePictureInPicture = true;
          player.disableRemotePlayback = true;
        } catch (e) {}
        player.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:45;transform:translate3d(0,0,0);will-change:transform;backface-visibility:hidden;';
        container.appendChild(player);
      }
      if (player.srcObject !== stream) {
        player.srcObject = stream;
      }
      player.muted = true;
      player.volume = 0;
      if (player.paused) player.play().catch(() => {});
      currentActiveVideo = player;
    }
  }

  function isWebMediaVideo(v) {
    try {
      const src = v.getAttribute('src') || '';
      if (/^https?:/i.test(src)) return true;
      if (v.querySelector('source[src^="http"]')) return true;
    } catch {}
    return false;
  }

  function detachStreamFromNativePlayer() {
    if (typeof document === 'undefined') return;
    const ours = new Set([window.__activeMediaStream, window.__localMediaStream].filter(Boolean));
    window.__activeMediaStream = null;
    window.__localMediaStream = null;
    currentActiveVideo = null;
    const videoElements = document.querySelectorAll('video');
    for (const video of videoElements) {
      const s = video && video.srcObject;
      if (!s) continue;
      let dead = false;
      try {
        const tracks = s.getTracks ? s.getTracks() : [];
        dead = tracks.length > 0 && tracks.every(t => t.readyState === 'ended');
      } catch {}
      if (ours.has(s) || dead) {
        video.srcObject = null;
        video.muted = true;
        video.volume = 0;
      }
    }
    const customPlayer = document.getElementById('zap-custom-video-player');
    if (customPlayer) customPlayer.remove();
  }

  // Observador inteligente: só atua se houver stream ativo e se elementos de vídeo forem adicionados ao DOM
  if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined' && !window.__zapVideoObserver) {
    let zapObserverScheduled = false;
    window.__zapVideoObserver = new MutationObserver((mutations) => {
      const streamToApply = window.__activeMediaStream || window.__localMediaStream;
      if (!streamToApply) return;

      if (currentActiveVideo && currentActiveVideo.isConnected && currentActiveVideo.srcObject === streamToApply && !currentActiveVideo.paused) {
        return;
      }

      let relevant = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          for (const n of m.addedNodes) {
            if (n.nodeType === 1 && (n.nodeName === 'VIDEO' || n.querySelector?.('video, [class*="video"], [class*="tile"]'))) {
              relevant = true;
              break;
            }
          }
        }
        if (relevant) break;
      }

      if (!relevant || zapObserverScheduled) return;
      zapObserverScheduled = true;

      requestAnimationFrame(() => {
        zapObserverScheduled = false;
        const currentStream = window.__activeMediaStream || window.__localMediaStream;
        if (currentStream) {
          attachStreamToNativePlayer(currentStream, !window.__activeMediaStream && Boolean(window.__localMediaStream));
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

  // Sincronização periódica leve do canal de voz
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
            service.subscribeToStream(currentChannelId, currentUser.id);
          } else {
            service.leaveChannel();
            detachStreamFromNativePlayer();
          }
        }
      }
    }, 10000);
  }

  const current = store.getClientOverrides()?.[primaryExperiment];
  const verified = enabled ? current?.variantId === -1 : current == null;

  if (verified) {
    window.__zapReady = true;
    window.__zapStoreRef = store;
    window.__zapAppliedList = appliedList;
  }

  return {
    status: verified ? (enabled ? 'applied' : 'disabled') : 'unverified',
    verified,
    experimentName: primaryExperiment,
    appliedList,
    devUnlocked
  };
})();
