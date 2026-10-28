/**
 * Discord Video Mod Mobile - OTA Bundle v1.1.0-mobile
 * Gerado em: 2026-10-28T15:12:48.716Z
 */
(function(global, window, config) {
  'use strict';

  // --- 1. Signaling ---
  /**
 * Mobile WebRTC Signaling Client
 * Gerencia a comunicação WebSocket com o servidor de sinalização (Render Cloud)
 * Compatível com iOS (JavaScriptCore/Hermes) e Android (Hermes/V8).
 */

class MobileSignalingClient {
  constructor(options = {}) {
    this.url = options.signalingUrl || 'wss://discordvideomod.onrender.com/signaling';
    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.reconnectInterval = options.reconnectInterval || 3000;
    this.pingTimer = null;
    this.listeners = new Map();
    this.queuedMessages = [];
    this.activeChannelId = null;
    this.currentUserId = null;
    this.WebSocketClass = options.WebSocketClass || (typeof WebSocket !== 'undefined' ? WebSocket : null);
  }

  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(handler);
  }

  emit(event, ...args) {
    const list = this.listeners.get(event);
    if (list) {
      for (const fn of list) {
        try { fn(...args); } catch (e) { console.warn(`[Signaling] Erro no listener ${event}:`, e); }
      }
    }
  }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      try {
        const WS = this.WebSocketClass || globalThis.WebSocket;
        if (!WS) {
          this.emit('error', new Error('Nenhum construtor WebSocket disponível no ambiente mobile.'));
          return resolve(false);
        }

        this.ws = new WS(this.url);

        this.ws.onopen = () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.flushQueue();
          this.emit('open');
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          let data;
          try {
            data = JSON.parse(event.data);
          } catch (e) {
            return;
          }

          if (data.type === 'pong') return;
          this.emit(data.type, data);
          this.emit('message', data);
        };

        this.ws.onclose = () => {
          this.connected = false;
          this.stopHeartbeat();
          this.emit('close');
          this.scheduleReconnect();
        };

        this.ws.onerror = (err) => {
          this.emit('error', err);
        };
      } catch (err) {
        this.emit('error', err);
        resolve(false);
      }
    });
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (this.connected && this.ws?.readyState === 1) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch (e) {}
      }
    }, 25000);
  }

  stopHeartbeat() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('reconnect_failed');
      return;
    }
    this.reconnectAttempts++;
    setTimeout(() => {
      if (!this.connected) {
        this.connect().then(() => {
          if (this.connected && this.activeChannelId && this.currentUserId) {
            this.subscribe(this.activeChannelId, this.currentUserId);
          }
        });
      }
    }, this.reconnectInterval);
  }

  send(msg) {
    const payload = JSON.stringify(msg);
    if (this.connected && this.ws?.readyState === 1) {
      try {
        this.ws.send(payload);
        return true;
      } catch (e) {
        this.queuedMessages.push(msg);
        return false;
      }
    } else {
      this.queuedMessages.push(msg);
      return false;
    }
  }

  flushQueue() {
    while (this.queuedMessages.length > 0 && this.connected) {
      const msg = this.queuedMessages.shift();
      this.send(msg);
    }
  }

  subscribe(channelId, userId) {
    this.activeChannelId = channelId;
    this.currentUserId = userId;
    return this.send({
      type: 'stream:subscribe',
      channelId,
      userId
    });
  }

  sendAnswer(channelId, userId, targetUserId, sdpAnswer) {
    return this.send({
      type: 'stream:answer',
      channelId,
      userId,
      targetUserId,
      sdpAnswer
    });
  }

  sendIceCandidate(channelId, userId, targetUserId, candidate) {
    return this.send({
      type: 'stream:ice-candidate',
      channelId,
      userId,
      targetUserId,
      candidate
    });
  }

  leave() {
    this.activeChannelId = null;
    this.queuedMessages = [];
  }

  disconnect() {
    this.stopHeartbeat();
    this.leave();
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    this.connected = false;
  }
}

  // --- 2. WebRTC ---
  /**
 * Mobile WebRTC Adapter
 * Gerencia sessões WebRTC no ambiente mobile (React Native / iOS / Android)
 * Herda a base de áudio funcional e conexão P2P da versão 1.1.0 estável.
 */

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' }
];

class MobileWebRTCAdapter {
  constructor(options = {}) {
    this.iceServers = options.iceServers || DEFAULT_ICE_SERVERS;
    this.RTCPeerConnectionClass = options.RTCPeerConnection ||
      (typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : globalThis.RTCPeerConnection);
    this.RTCSessionDescriptionClass = options.RTCSessionDescription ||
      (typeof RTCSessionDescription !== 'undefined' ? RTCSessionDescription : globalThis.RTCSessionDescription);
    this.RTCIceCandidateClass = options.RTCIceCandidate ||
      (typeof RTCIceCandidate !== 'undefined' ? RTCIceCandidate : globalThis.RTCIceCandidate);

    this.activePc = null;
    this.remoteStream = null;
    this.pendingCandidates = [];
    this.listeners = new Map();
  }

  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(handler);
  }

  emit(event, ...args) {
    const list = this.listeners.get(event);
    if (list) {
      for (const fn of list) {
        try { fn(...args); } catch (e) { console.warn(`[WebRTC] Erro no listener ${event}:`, e); }
      }
    }
  }

  setHighBitrate(sdp, bitrateKbps = 8000) {
    if (!sdp || typeof sdp !== 'string') return sdp;
    let modified = sdp;
    // Adiciona ou ajusta a linha b=AS:bitrate na seção m=video
    if (/m=video[\s\S]*?c=IN/m.test(modified)) {
      modified = modified.replace(/(m=video[^\r\n]*\r?\n[^\r\n]*c=IN[^\r\n]*)/, `$1\r\nb=AS:${bitrateKbps}`);
    }
    return modified;
  }

  async handleRemoteOffer(sdpOffer, onIceCandidateCallback) {
    if (this.activePc) {
      try { this.activePc.close(); } catch (e) {}
      this.activePc = null;
    }
    this.remoteStream = null;

    if (!this.RTCPeerConnectionClass) {
      throw new Error('RTCPeerConnection não disponível no ambiente.');
    }

    const pc = new this.RTCPeerConnectionClass({
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle'
    });

    this.activePc = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate && onIceCandidateCallback) {
        onIceCandidateCallback(event.candidate.toJSON ? event.candidate.toJSON() : event.candidate);
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams?.[0] || new MediaStream([event.track]);
      this.remoteStream = stream;
      // Garante que os tracks de áudio e vídeo estejam ativos
      event.track.enabled = true;
      this.emit('track', { track: event.track, stream, kind: event.track.kind });
      this.emit('stream', stream);
    };

    pc.onconnectionstatechange = () => {
      this.emit('connectionStateChange', pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.emit('disconnected');
      }
    };

    // 1. Configura oferta remota
    const desc = typeof sdpOffer === 'string'
      ? new this.RTCSessionDescriptionClass({ type: 'offer', sdp: sdpOffer })
      : new this.RTCSessionDescriptionClass(sdpOffer);

    await pc.setRemoteDescription(desc);

    // 2. Processa candidatos ICE enfileirados antes de setRemoteDescription
    while (this.pendingCandidates.length > 0) {
      const cand = this.pendingCandidates.shift();
      try {
        await pc.addIceCandidate(new this.RTCIceCandidateClass(cand));
      } catch (e) {}
    }

    // 3. Cria resposta SDP (Answer)
    const answer = await pc.createAnswer();
    const modifiedAnswer = new this.RTCSessionDescriptionClass({
      type: answer.type,
      sdp: this.setHighBitrate(answer.sdp)
    });

    await pc.setLocalDescription(modifiedAnswer);

    return pc.localDescription;
  }

  async addRemoteCandidate(candidate) {
    if (!candidate) return;
    if (this.activePc && this.activePc.remoteDescription) {
      try {
        await this.activePc.addIceCandidate(new this.RTCIceCandidateClass(candidate));
      } catch (e) {
        console.warn('[WebRTC] Falha ao adicionar candidato ICE:', e);
      }
    } else {
      this.pendingCandidates.push(candidate);
    }
  }

  closeActiveConnection() {
    if (this.activePc) {
      try {
        this.activePc.close();
      } catch (e) {}
      this.activePc = null;
    }
    this.remoteStream = null;
    this.pendingCandidates = [];
    this.emit('streamStopped');
  }
}

  // --- 3. Hook ---
  /**
 * Mobile Native Dispatcher & Store Hook
 * Conecta o mod aos módulos internos do Discord Mobile (React Native Hermes/JSC).
 * Suporta Revenge, Bunny, Vendetta, Enmity ou injeção direta de bundle.
 */

class MobileNativeDispatcherHook {
  constructor() {
    this.root = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global);
    this.dispatcher = null;
    this.stores = {};
    this.isHooked = false;
  }

  findModules() {
    // 1. Tenta via loaders conhecidos de React Native Mods (Revenge / Bunny / Vendetta)
    const v = this.root.vendetta || this.root.bunny || this.root.revenge || this.root.enmity;
    if (v?.metro) {
      const dispatcher = v.metro.common?.FluxDispatcher ||
        (v.metro.findByProps && v.metro.findByProps('_interceptors')) ||
        (v.metro.findByProps && v.metro.findByProps('dispatch', 'subscribe'));

      const voiceStore = (v.metro.findByStoreName && v.metro.findByStoreName('SelectedChannelStore')) ||
        (v.metro.findByProps && v.metro.findByProps('getVoiceChannelId', 'getChannelId')) ||
        v.metro.common?.channels;

      const rtcStore = (v.metro.findByStoreName && v.metro.findByStoreName('RTCConnectionStore')) ||
        (v.metro.findByProps && v.metro.findByProps('getRTCConnection', 'getChannelId'));

      const userStore = (v.metro.findByStoreName && v.metro.findByStoreName('UserStore')) ||
        (v.metro.findByProps && v.metro.findByProps('getCurrentUser'));

      const experimentStore = (v.metro.findByStoreName && v.metro.findByStoreName('ApexExperimentStore')) ||
        (v.metro.findByStoreName && v.metro.findByStoreName('ExperimentStore')) ||
        (v.metro.findByProps && v.metro.findByProps('getClientOverrides'));

      let videoGuardExp = null;
      try {
        if (typeof v.metro.findByFilePath === 'function') {
          videoGuardExp = v.metro.findByFilePath('modules/media_engine/VideoGuardExperiment.tsx');
        }
        if (!videoGuardExp && typeof v.metro.find === 'function') {
          videoGuardExp = v.metro.find(m => {
            if (!m) return false;
            if (m.definition?.id === '2026-08-video-guard') return true;
            if (m.VideoGuardExperiment?.definition?.id === '2026-08-video-guard') return true;
            return Object.values(m).some(val => val?.id === '2026-08-video-guard' || val?.definition?.id === '2026-08-video-guard');
          });
        }
      } catch (e) {}

      return {
        voiceStore,
        rtcStore,
        userStore,
        dispatcher,
        experimentStore,
        videoGuardExp
      };
    }

    // 2. Tenta via webpackChunk / metro require nativo
    const chunks = this.root.webpackChunkdiscord_app;
    if (chunks && typeof chunks.push === 'function') {
      try {
        let req;
        const runtimes = [];
        chunks.push([[Symbol('mobile-hook')], {}, r => { runtimes.push(r); }]);
        chunks.pop();
        req = runtimes.sort((a,b) => Object.keys(b?.c || {}).length - Object.keys(a?.c || {}).length)[0];
        if (req?.c) {
          const modules = Object.values(req.c).map(m => m?.exports).filter(Boolean);
          const voiceStore = modules.find(m => typeof m?.getVoiceChannelId === 'function');
          const userStore = modules.find(m => typeof m?.getCurrentUser === 'function');
          const dispatcher = modules.find(m => typeof m?.dispatch === 'function' && typeof m?.subscribe === 'function');
          const experimentStore = modules.find(m => typeof m?.getClientOverrides === 'function');
          const videoGuardExp = modules.find(m => m?.definition?.id === '2026-08-video-guard');

          return { voiceStore, userStore, dispatcher, experimentStore, videoGuardExp };
        }
      } catch (e) {}
    }

    return {
      voiceStore: null,
      userStore: null,
      dispatcher: null,
      experimentStore: null,
      videoGuardExp: null
    };
  }

  installOverrides(initialModules, callbacks = {}) {
    if (callbacks.onWatchStream) this.onWatchStream = callbacks.onWatchStream;
    if (callbacks.onTick) this.onTick = callbacks.onTick;

    const applyAll = () => {
      if (typeof this.onTick === 'function') {
        try { this.onTick(); } catch (e) {}
      }
      const modules = this.findModules();
      const userStore = modules.userStore || initialModules?.userStore;
      const experimentStore = modules.experimentStore || initialModules?.experimentStore;
      const dispatcher = modules.dispatcher || initialModules?.dispatcher;
      const videoGuardExp = modules.videoGuardExp || initialModules?.videoGuardExp;

      // 1. Desbloqueia developer flags no usuário atual
      try {
        const user = userStore?.getCurrentUser?.();
        if (user) {
          Object.defineProperty(user, 'isDeveloper', { get: () => true, configurable: true });
          Object.defineProperty(user, 'isStaff', { get: () => true, configurable: true });
          if (user.constructor?.prototype) {
            Object.defineProperty(user.constructor.prototype, 'isDeveloper', { get: () => true, configurable: true });
            Object.defineProperty(user.constructor.prototype, 'isStaff', { get: () => true, configurable: true });
          }
        }
      } catch (e) {}

      // 2. Hook direto no protótipo de ApexExperimentStore e ExperimentStore
      if (experimentStore) {
        try {
          const proto = Object.getPrototypeOf(experimentStore) || experimentStore;
          if (proto.getClientOverrides && !proto.__zapPatched) {
            proto.__zapPatched = true;
            const origOverrides = proto.getClientOverrides;
            proto.getClientOverrides = function() {
              const res = origOverrides.call(this) || {};
              res['2026-08-video-guard'] = { type: 'user', variantId: -1 };
              res['video-guard'] = { type: 'user', variantId: -1 };
              return res;
            };
            console.log('[DiscordVideoMod] ApexExperimentStore.getClientOverrides patched!');
          }
          if (proto.getExperimentBucket && !proto.__zapBucketPatched) {
            proto.__zapBucketPatched = true;
            const origBucket = proto.getExperimentBucket;
            proto.getExperimentBucket = function(exp) {
              if (exp === '2026-08-video-guard' || exp === 'video-guard') return -1;
              return origBucket.call(this, exp);
            };
            console.log('[DiscordVideoMod] ApexExperimentStore.getExperimentBucket patched!');
          }
          if (proto.getUserExperimentBucket && !proto.__zapUserBucketPatched) {
            proto.__zapUserBucketPatched = true;
            const origUserBucket = proto.getUserExperimentBucket;
            proto.getUserExperimentBucket = function(exp) {
              if (exp === '2026-08-video-guard' || exp === 'video-guard') return -1;
              return origUserBucket.call(this, exp);
            };
          }
          if (proto.getGuildExperimentBucket && !proto.__zapGuildBucketPatched) {
            proto.__zapGuildBucketPatched = true;
            const origGuildBucket = proto.getGuildExperimentBucket;
            proto.getGuildExperimentBucket = function(exp) {
              if (exp === '2026-08-video-guard' || exp === 'video-guard') return -1;
              return origGuildBucket.call(this, exp);
            };
          }
        } catch (e) {
          console.error('[DiscordVideoMod] Erro ao aplicar hook em experimentStore:', e);
        }
      }

      // 3. Patch direto no módulo VideoGuardExperiment
      if (videoGuardExp && !videoGuardExp.__zapExpPatched) {
        try {
          videoGuardExp.__zapExpPatched = true;
          const safeConfig = { enabled: false, isBlocked: false, videoDisabled: false };
          const targets = [videoGuardExp, videoGuardExp.VideoGuardExperiment, videoGuardExp.default].filter(Boolean);

          for (const target of targets) {
            if (typeof target.useExperiment === 'function') {
              target.useExperiment = () => safeConfig;
            }
            if (typeof target.getCurrentConfig === 'function') {
              target.getCurrentConfig = () => safeConfig;
            }
            if (target.definition) {
              target.definition.defaultConfig = safeConfig;
            }
          }
          console.log('[DiscordVideoMod] VideoGuardExperiment module patched to enabled: false!');
        } catch (e) {
          console.error('[DiscordVideoMod] Erro ao aplicar hook em videoGuardExp:', e);
        }
      }

      // 4. Dispara a ação de override contínua no Dispatcher
      if (dispatcher && typeof dispatcher.dispatch === 'function') {
        try {
          dispatcher.dispatch({
            type: 'APEX_EXPERIMENT_OVERRIDE_CREATE',
            experimentName: '2026-08-video-guard',
            variantId: -1
          });
        } catch (e) {}
      }
    };

    // Aplica imediatamente
    applyAll();

    // Se inscreve nos eventos do ciclo de vida do Discord
    const registerDispatcherEvents = () => {
      const modules = this.findModules();
      const dispatcher = modules.dispatcher || initialModules?.dispatcher;
      if (dispatcher && typeof dispatcher.subscribe === 'function' && !this.subscribed) {
        this.subscribed = true;
        try { dispatcher.subscribe('CONNECTION_OPEN', applyAll); } catch (e) {}
        try { dispatcher.subscribe('CURRENT_USER_UPDATE', applyAll); } catch (e) {}
        try { dispatcher.subscribe('APEX_EXPERIMENTS_FETCH_SUCCESS', applyAll); } catch (e) {}
        try { dispatcher.subscribe('VOICE_CHANNEL_SELECT', applyAll); } catch (e) {}
        try { dispatcher.subscribe('MEDIA_ENGINE_SET_GO_LIVE', applyAll); } catch (e) {}
        try { dispatcher.subscribe('RTC_CONNECTION_STATE', applyAll); } catch (e) {}
        try {
          dispatcher.subscribe('STREAM_WATCH', (action) => {
            if (typeof this.onWatchStream === 'function') {
              try { this.onWatchStream(action); } catch (e) {}
            }
          });
        } catch (e) {}
        console.log('[DiscordVideoMod] Dispatcher lifecycle listeners registrados!');
      }
    };

    registerDispatcherEvents();

    // Polling inicial para garantir inicialização caso stores carreguem assincronamente
    let pollCount = 0;
    const pollInterval = setInterval(() => {
      pollCount++;
      applyAll();
      registerDispatcherEvents();
      if (pollCount > 30) {
        clearInterval(pollInterval);
        // Intervalo de segurança permanente a cada 3s
        setInterval(applyAll, 3000);
      }
    }, 500);
  }

  getVoiceChannelId() {
    const modules = this.findModules();
    if (modules.voiceStore && typeof modules.voiceStore.getVoiceChannelId === 'function') {
      const cid = modules.voiceStore.getVoiceChannelId();
      if (cid) return cid;
    }
    if (modules.rtcStore && typeof modules.rtcStore.getChannelId === 'function') {
      const cid = modules.rtcStore.getChannelId();
      if (cid) return cid;
    }
    return this.root.__DISCORD_ACTIVE_VOICE_CHANNEL_ID__ || null;
  }

  getCurrentUserId() {
    const modules = this.findModules();
    if (modules.userStore && typeof modules.userStore.getCurrentUser === 'function') {
      const u = modules.userStore.getCurrentUser();
      return u?.id || null;
    }
    return this.root.__DISCORD_CURRENT_USER_ID__ || null;
  }
}

  // --- 4. Core ---
  /**
 * Mobile Core Manager
 * Orquestrador central do Discord Video Mod Mobile (iOS/Android)
 * Detecta canais de voz e transmissões ativas no Render Cloud para acionar o Player WebRTC.
 */


class MobileCoreManager {
  constructor(options = {}) {
    this.config = options.config || {};
    this.signaling = new MobileSignalingClient({
      signalingUrl: this.config.signalingUrl,
      WebSocketClass: options.WebSocketClass
    });
    this.webrtc = new MobileWebRTCAdapter({
      RTCPeerConnection: options.RTCPeerConnection,
      RTCSessionDescription: options.RTCSessionDescription,
      RTCIceCandidate: options.RTCIceCandidate
    });

    this.currentChannelId = null;
    this.currentUserId = null;
    this.activeBroadcasterId = null;
    this.checkInterval = null;
    this.getVoiceChannelIdFn = options.getVoiceChannelId || (() => null);
    this.getCurrentUserIdFn = options.getCurrentUserId || (() => null);
    this.enableDirectWebRTC = Boolean(options.enableDirectWebRTC);
    this.listeners = new Map();
    this.isInitialized = false;

    this.setupEvents();
  }

  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(handler);
  }

  emit(event, ...args) {
    const list = this.listeners.get(event);
    if (list) {
      for (const fn of list) {
        try { fn(...args); } catch (e) { console.warn(`[MobileCore] Erro no listener ${event}:`, e); }
      }
    }
  }

  setupEvents() {
    // 1. Quando uma transmissão estiver disponível no canal
    this.signaling.on('stream:available', async (data) => {
      if (data.channelId === this.currentChannelId && data.sdpOffer) {
        this.activeBroadcasterId = data.broadcasterUserId;
        this.emit('streamAvailable', {
          channelId: data.channelId,
          broadcasterUserId: data.broadcasterUserId
        });

        // No app mobile real, o WebView Chromium negocia a oferta diretamente para não consumir a oferta no Hermes.
        // Nos testes unitários (enableDirectWebRTC), usa o adaptador direto.
        if (this.enableDirectWebRTC) {
          try {
            const sdpAnswer = await this.webrtc.handleRemoteOffer(data.sdpOffer, (candidate) => {
              this.signaling.sendIceCandidate(
                this.currentChannelId,
                this.currentUserId,
                this.activeBroadcasterId,
                candidate
              );
            });

            this.signaling.sendAnswer(
              this.currentChannelId,
              this.currentUserId,
              this.activeBroadcasterId,
              sdpAnswer
            );
          } catch (err) {
            console.error('[MobileCore] Falha ao responder oferta WebRTC:', err);
            this.emit('error', err);
          }
        }
      }
    });

    // 2. Quando chegam candidatos ICE do transmissor
    this.signaling.on('stream:ice-candidate', (data) => {
      if (this.enableDirectWebRTC && data.candidate) {
        this.webrtc.addRemoteCandidate(data.candidate);
      }
    });

    // 3. Quando a transmissão for encerrada
    this.signaling.on('stream:stopped', (data) => {
      if (!data.channelId || data.channelId === this.currentChannelId) {
        this.activeBroadcasterId = null;
        this.webrtc.closeActiveConnection();
        this.emit('streamStopped', data);
      }
    });

    // 4. Recebimento de stream com áudio e vídeo
    this.webrtc.on('stream', (stream) => {
      this.emit('streamReady', {
        stream,
        channelId: this.currentChannelId,
        broadcasterUserId: this.activeBroadcasterId
      });
    });
  }

  async start() {
    if (this.isInitialized) return true;
    this.isInitialized = true;

    await this.signaling.connect();
    this.syncVoiceChannel();

    // Sincronização periódica de canal de voz (a cada 1.5s)
    this.checkInterval = setInterval(() => {
      this.syncVoiceChannel();
    }, 1500);

    return true;
  }

  syncVoiceChannel() {
    const channelId = this.getVoiceChannelIdFn();
    const userId = this.getCurrentUserIdFn();

    if (userId) {
      this.currentUserId = userId;
    } else if (!this.currentUserId) {
      this.currentUserId = 'mobile_' + Math.floor(100000 + Math.random() * 900000);
    }

    if (channelId !== this.currentChannelId) {
      const oldChannel = this.currentChannelId;
      this.currentChannelId = channelId;

      if (channelId && this.currentUserId) {
        // Usa sufixo _probe no Hermes quando o player WebView está ativo, para não colidir no mapa de sockets do servidor
        const subUserId = this.enableDirectWebRTC ? this.currentUserId : `${this.currentUserId}_probe`;
        this.emit('channelJoin', { channelId, userId: this.currentUserId });
        this.signaling.subscribe(channelId, subUserId);
      } else if (!channelId && oldChannel) {
        this.emit('channelLeave', { channelId: oldChannel });
        this.activeBroadcasterId = null;
        this.signaling.leave();
        this.webrtc.closeActiveConnection();
      }
    }
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.webrtc.closeActiveConnection();
    this.signaling.disconnect();
    this.isInitialized = false;
  }
}

  // --- 5. Player UI (React Native + WebView WebRTC 1080p60) ---
  /**
 * Mobile WebRTC Live Stream Player UI (React Native + Embedded Chromium/WKWebView)
 * Conecta ao mesmo Render Cloud (wss://discordvideomod.onrender.com/signaling)
 * e reproduz a transmissão P2P do PC em 1080p/1440p 60FPS com áudio.
 */

function buildWebRTCPlayerHtml(channelId, userId, signalingUrl) {
  const safeChannelId = String(channelId || '').replace(/[^0-9a-zA-Z_-]/g, '');
  const safeUserId = String(userId || 'mobile_' + Math.floor(Math.random() * 999999)).replace(/[^0-9a-zA-Z_-]/g, '') + '_mob';
  const safeWsUrl = String(signalingUrl || 'wss://discordvideomod.onrender.com/signaling');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=4,user-scalable=yes">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  html, body { width: 100%; height: 100%; background: #000; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #fff; user-select: none; }
  #stage { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #000; overflow: hidden; }
  video { width: 100%; height: 100%; object-fit: contain; background: #000; transition: transform 0.15s ease; transform-origin: center center; }
  #overlay-status {
    position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: rgba(10, 11, 14, 0.86); z-index: 10; text-align: center; padding: 16px; transition: opacity 0.25s;
  }
  #overlay-status.hidden { opacity: 0; pointer-events: none; }
  .spinner {
    width: 38px; height: 38px; border: 3.5px solid rgba(88, 101, 242, 0.25);
    border-top-color: #5865F2; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 12px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  #status-title { font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 4px; }
  #status-sub { font-size: 12px; color: #b5bac1; }
  #controls-bar {
    position: absolute; bottom: 10px; left: 10px; right: 10px; display: flex; align-items: center;
    justify-content: space-between; z-index: 20; pointer-events: none;
  }
  .pill {
    pointer-events: auto; background: rgba(17, 18, 20, 0.82); border: 1px solid rgba(255,255,255,0.14);
    color: #fff; font-size: 11px; font-weight: 600; padding: 6px 10px; border-radius: 16px;
    display: inline-flex; align-items: center; gap: 6px; backdrop-filter: blur(6px);
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #23a55a; }
  .btn-group { display: flex; gap: 6px; pointer-events: auto; }
  button.ctrl-btn {
    background: rgba(17, 18, 20, 0.85); border: 1px solid rgba(255,255,255,0.18); color: #fff;
    font-size: 11px; font-weight: 600; padding: 6px 10px; border-radius: 14px; cursor: pointer;
  }
  button.ctrl-btn:active { background: #5865F2; }
  #unmute-banner {
    position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
    background: #5865F2; color: #fff; font-size: 12px; font-weight: 700;
    padding: 8px 14px; border-radius: 20px; z-index: 30; display: none; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  }
</style>
</head>
<body>
<div id="stage">
  <video id="live-video" autoplay playsinline></video>
  <button id="unmute-banner" onclick="forceUnmute()">🔊 Toque para ativar o som</button>
  <div id="overlay-status">
    <div class="spinner" id="status-spinner"></div>
    <div id="status-title">Conectando à transmissão...</div>
    <div id="status-sub">Canal ${safeChannelId} • Render P2P</div>
  </div>
  <div id="controls-bar">
    <div class="pill"><span class="dot" id="live-dot"></span><span id="res-label">Aguardando vídeo...</span></div>
    <div class="btn-group">
      <button class="ctrl-btn" id="btn-mute" onclick="toggleMute()">🔊 Som</button>
      <button class="ctrl-btn" id="btn-zoom" onclick="cycleZoom()">🔍 1x</button>
      <button class="ctrl-btn" id="btn-fit" onclick="toggleFit()">⤢ Ajustar</button>
    </div>
  </div>
</div>
<script>
(function() {
  const CHANNEL_ID = ${JSON.stringify(safeChannelId)};
  const USER_ID = ${JSON.stringify(safeUserId)};
  const WS_URL = ${JSON.stringify(safeWsUrl)};
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ];

  const video = document.getElementById('live-video');
  const overlay = document.getElementById('overlay-status');
  const statusTitle = document.getElementById('status-title');
  const statusSub = document.getElementById('status-sub');
  const resLabel = document.getElementById('res-label');
  const unmuteBanner = document.getElementById('unmute-banner');
  const btnMute = document.getElementById('btn-mute');
  const btnZoom = document.getElementById('btn-zoom');

  let ws = null;
  let pc = null;
  let remoteStream = null;
  let broadcasterUserId = null;
  let pendingCandidates = [];
  let isPlaying = false;
  let zoomIdx = 0;
  const zooms = [1, 1.35, 1.8, 2.4];
  let fitCover = false;

  function postRN(data) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(data));
      }
    } catch (e) {}
  }

  function setStatus(title, sub, hideOverlay) {
    if (title) statusTitle.textContent = title;
    if (sub) statusSub.textContent = sub;
    if (hideOverlay) overlay.classList.add('hidden');
    else overlay.classList.remove('hidden');
  }

  window.forceUnmute = function() {
    video.muted = false;
    video.volume = 1.0;
    unmuteBanner.style.display = 'none';
    btnMute.textContent = '🔊 Som';
    video.play().catch(function(){});
  };

  window.toggleMute = function() {
    video.muted = !video.muted;
    btnMute.textContent = video.muted ? '🔇 Mudo' : '🔊 Som';
    if (!video.muted) unmuteBanner.style.display = 'none';
  };

  window.cycleZoom = function() {
    zoomIdx = (zoomIdx + 1) % zooms.length;
    const z = zooms[zoomIdx];
    video.style.transform = 'scale(' + z + ')';
    btnZoom.textContent = '🔍 ' + z + 'x';
  };

  window.toggleFit = function() {
    fitCover = !fitCover;
    video.style.objectFit = fitCover ? 'cover' : 'contain';
  };

  function setHighBitrate(sdp) {
    if (!sdp) return sdp;
    const lines = sdp.split('\\r\\n');
    let inVideo = false, cIdx = -1, mIdx = -1, aIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('m=video')) { inVideo = true; mIdx = i; continue; }
      if (inVideo && lines[i].startsWith('m=')) break;
      if (inVideo) {
        if (lines[i].startsWith('c=') && cIdx === -1) cIdx = i;
        if (lines[i].startsWith('a=') && aIdx === -1) aIdx = i;
        if (lines[i].startsWith('b=')) { lines.splice(i, 1); i--; }
      }
    }
    if (mIdx !== -1) {
      const pos = cIdx !== -1 ? cIdx + 1 : (aIdx !== -1 ? aIdx : mIdx + 1);
      lines.splice(pos, 0, 'b=AS:10000', 'b=TIAS:10000000');
    }
    return lines.join('\\r\\n');
  }

  async function handleOffer(sdpOffer, bUserId) {
    if (!sdpOffer) return;
    if (pc && broadcasterUserId === bUserId &&
        (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected') &&
        remoteStream && remoteStream.getTracks().some(function(t){ return t.readyState === 'live'; })) {
      return;
    }

    broadcasterUserId = bUserId;
    pendingCandidates = [];
    if (pc) {
      try { pc.close(); } catch (e) {}
      pc = null;
    }

    setStatus('Recebendo vídeo P2P...', 'Negociando WebRTC 1080p60', false);
    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' });

    pc.onicecandidate = function(ev) {
      if (ev.candidate && ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'stream:ice-candidate',
          channelId: CHANNEL_ID,
          userId: USER_ID,
          targetUserId: broadcasterUserId,
          candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate
        }));
      }
    };

    pc.ontrack = function(ev) {
      if (!remoteStream) remoteStream = new MediaStream();
      remoteStream.getTracks().forEach(function(t) {
        if (t.kind === ev.track.kind && t.id !== ev.track.id) {
          try { remoteStream.removeTrack(t); } catch (e) {}
        }
      });
      if (!remoteStream.getTracks().some(function(t) { return t.id === ev.track.id; })) {
        remoteStream.addTrack(ev.track);
      }
      ev.track.enabled = true;
      if (video.srcObject !== remoteStream) {
        video.srcObject = remoteStream;
      }
      video.muted = false;
      video.volume = 1.0;
      const playPromise = video.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise.then(function() {
          isPlaying = true;
          setStatus('', '', true);
          postRN({ type: 'playing' });
        }).catch(function() {
          video.muted = true;
          btnMute.textContent = '🔇 Mudo';
          unmuteBanner.style.display = 'block';
          video.play().then(function() {
            isPlaying = true;
            setStatus('', '', true);
            postRN({ type: 'playing' });
          }).catch(function(){});
        });
      }
    };

    pc.onconnectionstatechange = function() {
      if (!pc) return;
      if (pc.connectionState === 'connected') {
        isPlaying = true;
        setStatus('', '', true);
        postRN({ type: 'connected' });
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        isPlaying = false;
        setStatus('Reconectando à live...', 'Aguardando pacote de vídeo', false);
        subscribeNow();
      }
    };

    try {
      const desc = typeof sdpOffer === 'string' ? { type: 'offer', sdp: sdpOffer } : sdpOffer;
      await pc.setRemoteDescription(new RTCSessionDescription(desc));

      while (pendingCandidates.length > 0) {
        const c = pendingCandidates.shift();
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {}
      }

      const answer = await pc.createAnswer();
      const modAnswer = new RTCSessionDescription({
        type: answer.type,
        sdp: setHighBitrate(answer.sdp)
      });
      await pc.setLocalDescription(modAnswer);

      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'stream:answer',
          channelId: CHANNEL_ID,
          userId: USER_ID,
          targetUserId: broadcasterUserId,
          sdpAnswer: pc.localDescription
        }));
      }
    } catch (err) {
      setStatus('Erro ao abrir stream', String(err && err.message || err), false);
    }
  }

  function subscribeNow() {
    if (ws && ws.readyState === 1 && CHANNEL_ID) {
      ws.send(JSON.stringify({
        type: 'stream:subscribe',
        channelId: CHANNEL_ID,
        userId: USER_ID
      }));
    }
  }

  function connectWs() {
    try {
      ws = new WebSocket(WS_URL);
      ws.onopen = function() {
        setStatus('Aguardando transmissão no canal...', 'Conectado ao servidor Render', false);
        subscribeNow();
      };
      ws.onmessage = function(ev) {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.type === 'stream:available' && msg.sdpOffer) {
          handleOffer(msg.sdpOffer, msg.broadcasterUserId);
        } else if (msg.type === 'stream:ice-candidate' && msg.candidate) {
          if (pc && pc.remoteDescription) {
            pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(function(){});
          } else {
            pendingCandidates.push(msg.candidate);
          }
        } else if (msg.type === 'stream:stopped') {
          isPlaying = false;
          if (pc) { try { pc.close(); } catch (e) {} pc = null; }
          remoteStream = null;
          video.srcObject = null;
          setStatus('Transmissão encerrada', 'Quem estava transmitindo fechou a live.', false);
          postRN({ type: 'stopped' });
        }
      };
      ws.onclose = function() {
        setTimeout(connectWs, 2500);
      };
    } catch (e) {
      setTimeout(connectWs, 3000);
    }
  }

  video.addEventListener('loadedmetadata', function() {
    if (video.videoWidth && video.videoHeight) {
      resLabel.textContent = 'AO VIVO • ' + video.videoWidth + 'x' + video.videoHeight;
      setStatus('', '', true);
    }
  });

  setInterval(function() {
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify({ type: 'ping' })); } catch (e) {}
      if (!isPlaying && (!pc || (pc.connectionState !== 'connected' && pc.connectionState !== 'connecting'))) {
        subscribeNow();
      }
    }
    if (video.videoWidth && video.videoHeight) {
      resLabel.textContent = 'AO VIVO • ' + video.videoWidth + 'x' + video.videoHeight;
    }
  }, 3500);

  connectWs();
})();
</script>
</body>
</html>`;
}

class MobilePlayerController {
  constructor(options = {}) {
    this.root = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global);
    this.signalingUrl = options.signalingUrl || 'wss://discordvideomod.onrender.com/signaling';
    this.state = {
      channelId: null,
      userId: null,
      streamAvailable: false,
      broadcasterUserId: null,
      playerOpen: false,
      minimized: false,
      reloadKey: 1
    };
    this.subscribers = new Set();
    this.wrapperInstalled = false;
    this.wrapperRendered = false;
    this.ebPatched = false;
    this.autoOpenedForBroadcaster = null;
  }

  setState(patch) {
    Object.assign(this.state, patch);
    for (const fn of this.subscribers) {
      try { fn({ ...this.state }); } catch (e) {}
    }
  }

  onChannelChange(channelId, userId) {
    if (!channelId) {
      this.autoOpenedForBroadcaster = null;
      this.setState({
        channelId: null,
        streamAvailable: false,
        broadcasterUserId: null,
        playerOpen: false,
        minimized: false
      });
    } else {
      this.setState({
        channelId,
        userId: userId || this.state.userId
      });
    }
  }

  onStreamAvailable(channelId, broadcasterUserId) {
    const shouldAutoOpen = this.autoOpenedForBroadcaster !== broadcasterUserId;
    this.autoOpenedForBroadcaster = broadcasterUserId;
    this.setState({
      channelId: channelId || this.state.channelId,
      streamAvailable: true,
      broadcasterUserId,
      playerOpen: shouldAutoOpen ? true : this.state.playerOpen
    });
  }

  onStreamStopped() {
    this.autoOpenedForBroadcaster = null;
    this.setState({
      streamAvailable: false,
      broadcasterUserId: null,
      playerOpen: false,
      minimized: false
    });
  }

  openPlayer(channelId, userId) {
    this.setState({
      channelId: channelId || this.state.channelId,
      userId: userId || this.state.userId,
      playerOpen: true,
      minimized: false,
      reloadKey: this.state.reloadKey + 1
    });
  }

  closePlayer() {
    this.setState({ playerOpen: false, minimized: false });
  }

  toggleMinimize() {
    this.setState({ minimized: !this.state.minimized });
  }

  reloadPlayer() {
    this.setState({ reloadKey: this.state.reloadKey + 1 });
  }

  getWebViewComponent() {
    try {
      const v = this.root.vendetta || this.root.bunny || this.root.revenge || this.root.enmity;
      if (v?.metro?.findByProps) {
        const mod = v.metro.findByProps('WebView');
        if (mod?.WebView) return mod.WebView;
        if (typeof mod === 'function') return mod;
      }
      if (v?.metro?.findByDisplayName) {
        const comp = v.metro.findByDisplayName('RNCWebView') || v.metro.findByDisplayName('WebView');
        if (comp) return comp;
      }
    } catch (e) {}
    return null;
  }

  installRootOverlay() {
    if (this.wrapperInstalled && this.ebPatched) return true;
    const React = this.root.React;
    const RN = this.root.ReactNative;
    if (!React || !RN) {
      return false;
    }

    const controller = this;

    if (!this.OverlayComp) {
      this.OverlayComp = function DiscordModLiveOverlay() {
        const [st, setSt] = React.useState(() => ({ ...controller.state }));

        React.useEffect(() => {
          const listener = (next) => setSt(next);
          controller.subscribers.add(listener);
          return () => controller.subscribers.delete(listener);
        }, []);

        if (!st.channelId) return null;

        const View = RN.View;
        const Text = RN.Text;
        const TouchableOpacity = RN.TouchableOpacity || RN.Pressable;
        const WebViewComp = controller.getWebViewComponent();

        // 1. Se o player estiver fechado, mostra o botão flutuante no topo direito da chamada
        if (!st.playerOpen) {
          return React.createElement(
            View,
            {
              pointerEvents: 'box-none',
              style: {
                position: 'absolute',
                top: 48,
                right: 12,
                zIndex: 999999,
                elevation: 999
              }
            },
            React.createElement(
              TouchableOpacity,
              {
                activeOpacity: 0.85,
                onPress: () => controller.openPlayer(st.channelId, st.userId),
                style: {
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: st.streamAvailable ? '#23a55a' : '#5865F2',
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                  borderRadius: 22,
                  borderWidth: 1.5,
                  borderColor: 'rgba(255,255,255,0.35)',
                  elevation: 10
                }
              },
              React.createElement(View, {
                style: {
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: '#ffffff',
                  marginRight: 7
                }
              }),
              React.createElement(
                Text,
                {
                  style: {
                    color: '#ffffff',
                    fontWeight: 'bold',
                    fontSize: 12
                  }
                },
                st.streamAvailable ? '📺 ASSISTIR LIVE AO VIVO' : '📺 Abrir Player Live'
              )
            )
          );
        }

        // 2. Player Aberto (Modo Tela Cheia ou Modo Mini-Player PiP)
        const isMini = Boolean(st.minimized);
        const containerStyle = isMini
          ? {
              position: 'absolute',
              top: 52,
              right: 10,
              width: 265,
              height: 180,
              borderRadius: 12,
              overflow: 'hidden',
              backgroundColor: '#000000',
              borderWidth: 1.5,
              borderColor: '#5865F2',
              zIndex: 999999,
              elevation: 999
            }
          : {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: '#000000',
              zIndex: 999999,
              elevation: 999,
              flexDirection: 'column'
            };

        const htmlContent = buildWebRTCPlayerHtml(st.channelId, st.userId, controller.signalingUrl);

        return React.createElement(
          View,
          { style: containerStyle },
          // Barra de topo com controles nativos
          React.createElement(
            View,
            {
              style: {
                height: isMini ? 32 : 52,
                paddingTop: isMini ? 0 : 10,
                paddingHorizontal: 10,
                backgroundColor: '#111214',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottomWidth: 1,
                borderBottomColor: 'rgba(255,255,255,0.1)'
              }
            },
            React.createElement(
              View,
              { style: { flexDirection: 'row', alignItems: 'center' } },
              React.createElement(View, {
                style: {
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: '#f23f43',
                  marginRight: 6
                }
              }),
              React.createElement(
                Text,
                {
                  style: {
                    color: '#ffffff',
                    fontWeight: 'bold',
                    fontSize: isMini ? 11 : 13
                  }
                },
                isMini ? 'LIVE P2P' : 'TRANSMISSÃO AO VIVO (P2P)'
              )
            ),
            React.createElement(
              View,
              { style: { flexDirection: 'row', alignItems: 'center' } },
              React.createElement(
                TouchableOpacity,
                {
                  onPress: () => controller.reloadPlayer(),
                  style: {
                    backgroundColor: '#2b2d31',
                    paddingVertical: isMini ? 3 : 6,
                    paddingHorizontal: isMini ? 7 : 10,
                    borderRadius: 8,
                    marginRight: 6
                  }
                },
                React.createElement(
                  Text,
                  { style: { color: '#ffffff', fontSize: isMini ? 10 : 12, fontWeight: '600' } },
                  '🔄'
                )
              ),
              React.createElement(
                TouchableOpacity,
                {
                  onPress: () => controller.toggleMinimize(),
                  style: {
                    backgroundColor: '#5865F2',
                    paddingVertical: isMini ? 3 : 6,
                    paddingHorizontal: isMini ? 7 : 10,
                    borderRadius: 8,
                    marginRight: 6
                  }
                },
                React.createElement(
                  Text,
                  { style: { color: '#ffffff', fontSize: isMini ? 10 : 12, fontWeight: '600' } },
                  isMini ? '⤢ Expandir' : '🗕 Mini PiP'
                )
              ),
              React.createElement(
                TouchableOpacity,
                {
                  onPress: () => controller.closePlayer(),
                  style: {
                    backgroundColor: '#da373c',
                    paddingVertical: isMini ? 3 : 6,
                    paddingHorizontal: isMini ? 7 : 10,
                    borderRadius: 8
                  }
                },
                React.createElement(
                  Text,
                  { style: { color: '#ffffff', fontSize: isMini ? 10 : 12, fontWeight: 'bold' } },
                  '✕'
                )
              )
            )
          ),
          // Corpo do Player (WebView Chromium com WebRTC 1080p60)
          React.createElement(
            View,
            { style: { flex: 1, backgroundColor: '#000000' } },
            WebViewComp
              ? React.createElement(WebViewComp, {
                  key: 'wv-' + st.channelId + '-' + st.reloadKey,
                  source: {
                    html: htmlContent,
                    baseUrl: 'https://discordvideomod.onrender.com'
                  },
                  originWhitelist: ['*'],
                  javaScriptEnabled: true,
                  domStorageEnabled: true,
                  allowsInlineMediaPlayback: true,
                  mediaPlaybackRequiresUserAction: false,
                  allowsFullscreenVideo: true,
                  mixedContentMode: 'always',
                  scrollEnabled: false,
                  bounces: false,
                  overScrollMode: 'never',
                  style: { flex: 1, backgroundColor: '#000000' }
                })
              : React.createElement(
                  View,
                  { style: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 } },
                  React.createElement(
                    Text,
                    { style: { color: '#ffffff', fontSize: 14, textAlign: 'center' } },
                    'Carregando componente WebView do Discord...'
                  )
                )
          )
        );
      };
    }

    const DiscordModLiveOverlay = this.OverlayComp;

    if (!this.wrapperInstalled && RN.AppRegistry && typeof RN.AppRegistry.setWrapperComponentProvider === 'function') {
      try {
        RN.AppRegistry.setWrapperComponentProvider(() => function DiscordModRootWrapper(props) {
          controller.wrapperRendered = true;
          return React.createElement(
            RN.View,
            { style: { flex: 1 } },
            props.children,
            React.createElement(DiscordModLiveOverlay, null)
          );
        });
        this.wrapperInstalled = true;
        console.log('[DiscordVideoMod] Root Overlay Wrapper instalado no AppRegistry!');
      } catch (e) {
        console.warn('[DiscordVideoMod] Erro ao instalar wrapper no AppRegistry:', e);
      }
    }

    // Fallback redundante via ErrorBoundary caso AppRegistry.runApplication já tenha ocorrido antes do wrapper
    if (!this.ebPatched) {
      try {
        const v = this.root.vendetta || this.root.bunny || this.root.revenge || this.root.enmity;
        const EB = v?.metro?.findByName?.('ErrorBoundary');
        if (EB?.prototype?.render && v?.patcher?.after) {
          this.ebPatched = true;
          v.patcher.after('render', EB.prototype, function(args, ret) {
            if (controller.wrapperRendered) return ret;
            return React.createElement(
              RN.View,
              { style: { flex: 1 } },
              ret,
              React.createElement(DiscordModLiveOverlay, null)
            );
          });
          console.log('[DiscordVideoMod] ErrorBoundary fallback overlay registrado!');
        }
      } catch (e) {}
    }

    return this.wrapperInstalled || this.ebPatched;
  }
}

  // --- 6. Initializer ---
  function initDiscordVideoMod() {
    try {
      if (global.__DISCORD_MOBILE_MOD__) {
        global.__DISCORD_MOBILE_MOD__.playerController?.installRootOverlay();
        return global.__DISCORD_MOBILE_MOD__;
      }

      const hook = new MobileNativeDispatcherHook();
      const playerController = new MobilePlayerController({
        signalingUrl: (config && config.signalingUrl) || 'wss://discordvideomod.onrender.com/signaling'
      });

      playerController.installRootOverlay();

      const modules = hook.findModules();
      hook.installOverrides(modules, {
        onTick: () => {
          playerController.installRootOverlay();
        },
        onWatchStream: () => {
          const cid = hook.getVoiceChannelId();
          const uid = hook.getCurrentUserId();
          if (cid) {
            playerController.openPlayer(cid, uid);
          }
        }
      });

      const manager = new MobileCoreManager({
        config: config || {"name":"discord-video-mod-mobile","version":"1.1.0-mobile","description":"Discord Video Mod para iOS (iPhone) e Android com suporte a Auto-Update OTA e base estável 1.1.0","enabled":true,"serverUrl":"https://discordvideomod.onrender.com","signalingUrl":"wss://discordvideomod.onrender.com/signaling","updateUrl":"https://discordvideomod.onrender.com/api/mod/mobile/update","checkUpdateIntervalMs":300000,"defaultQuality":{"width":1920,"height":1080,"fps":60,"maxBitrate":10000}},
        getVoiceChannelId: () => hook.getVoiceChannelId(),
        getCurrentUserId: () => hook.getCurrentUserId(),
        enableDirectWebRTC: false
      });

      manager.on('channelJoin', ({ channelId, userId }) => {
        playerController.onChannelChange(channelId, userId);
      });

      manager.on('channelLeave', () => {
        playerController.onChannelChange(null, null);
      });

      manager.on('streamAvailable', ({ channelId, broadcasterUserId }) => {
        playerController.onStreamAvailable(channelId, broadcasterUserId);
      });

      manager.on('streamStopped', () => {
        playerController.onStreamStopped();
      });

      global.__DISCORD_MOBILE_MOD__ = {
        version: (config && config.version) || '1.1.0-mobile',
        manager,
        hook,
        playerController,
        active: true
      };

      manager.start().then(() => {
        console.log('[DiscordMod Mobile OTA] Iniciado com sucesso v' + ((config && config.version) || '1.1.0-mobile'));
      }).catch(function(e) { console.warn('[DiscordMod Mobile OTA] Erro ao iniciar:', e); });

      return global.__DISCORD_MOBILE_MOD__;
    } catch (err) {
      console.error('[DiscordMod Mobile OTA] Falha fatal no bootstrap:', err);
      return null;
    }
  }

  global.__INIT_DISCORD_VIDEO_MOD__ = initDiscordVideoMod;
  initDiscordVideoMod();
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global), typeof window !== 'undefined' ? window : global, {"name":"discord-video-mod-mobile","version":"1.1.0-mobile","description":"Discord Video Mod para iOS (iPhone) e Android com suporte a Auto-Update OTA e base estável 1.1.0","enabled":true,"serverUrl":"https://discordvideomod.onrender.com","signalingUrl":"wss://discordvideomod.onrender.com/signaling","updateUrl":"https://discordvideomod.onrender.com/api/mod/mobile/update","checkUpdateIntervalMs":300000,"defaultQuality":{"width":1920,"height":1080,"fps":60,"maxBitrate":10000}});
