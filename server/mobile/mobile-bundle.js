/**
 * Discord Video Mod Mobile - OTA Bundle v1.1.0-mobile
 * Gerado em: 2026-10-25T02:29:46.342Z
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
  }

  findModules() {
    // 1. Tenta via loaders conhecidos de React Native Mods (Revenge / Bunny / Vendetta)
    const v = this.root.vendetta || this.root.bunny || this.root.enmity;
    if (v?.metro) {
      const dispatcher = v.metro.common?.FluxDispatcher ||
        (v.metro.findByProps && v.metro.findByProps('_interceptors')) ||
        (v.metro.findByProps && v.metro.findByProps('dispatch', 'subscribe'));

      const voiceStore = (v.metro.findByStoreName && v.metro.findByStoreName('SelectedChannelStore')) ||
        (v.metro.findByProps && v.metro.findByProps('getVoiceChannelId', 'getChannelId')) ||
        v.metro.common?.channels;

      const userStore = (v.metro.findByStoreName && v.metro.findByStoreName('UserStore')) ||
        (v.metro.findByProps && v.metro.findByProps('getCurrentUser'));

      const experimentStore = (v.metro.findByStoreName && v.metro.findByStoreName('ApexExperimentStore')) ||
        (v.metro.findByStoreName && v.metro.findByStoreName('ExperimentStore')) ||
        (v.metro.findByProps && v.metro.findByProps('getClientOverrides'));

      return {
        voiceStore,
        userStore,
        dispatcher,
        experimentStore
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

          return { voiceStore, userStore, dispatcher, experimentStore };
        }
      } catch (e) {}
    }

    return {
      voiceStore: null,
      userStore: null,
      dispatcher: null,
      experimentStore: null
    };
  }

  installOverrides(initialModules) {
    const applyAll = () => {
      const modules = this.findModules();
      const userStore = modules.userStore || initialModules?.userStore;
      const experimentStore = modules.experimentStore || initialModules?.experimentStore;
      const dispatcher = modules.dispatcher || initialModules?.dispatcher;

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

      // 2. Hook direto no protótipo de ApexExperimentStore
      if (experimentStore) {
        try {
          const proto = Object.getPrototypeOf(experimentStore) || experimentStore;
          if (proto.getClientOverrides && !proto.__zapPatched) {
            proto.__zapPatched = true;
            const origOverrides = proto.getClientOverrides;
            proto.getClientOverrides = function() {
              const res = origOverrides.call(this) || {};
              res['2026-08-video-guard'] = { variantId: -1 };
              return res;
            };
          }
          if (proto.getExperimentBucket && !proto.__zapBucketPatched) {
            proto.__zapBucketPatched = true;
            const origBucket = proto.getExperimentBucket;
            proto.getExperimentBucket = function(exp) {
              if (exp === '2026-08-video-guard') return -1;
              return origBucket.call(this, exp);
            };
          }
        } catch (e) {}
      }

      // 3. Dispara a ação de override contínua no Dispatcher
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
    const modules = this.findModules();
    const dispatcher = modules.dispatcher || initialModules?.dispatcher;
    if (dispatcher && typeof dispatcher.subscribe === 'function') {
      try { dispatcher.subscribe('CONNECTION_OPEN', applyAll); } catch (e) {}
      try { dispatcher.subscribe('CURRENT_USER_UPDATE', applyAll); } catch (e) {}
      try { dispatcher.subscribe('APEX_EXPERIMENTS_FETCH_SUCCESS', applyAll); } catch (e) {}
      try { dispatcher.subscribe('VOICE_CHANNEL_SELECT', applyAll); } catch (e) {}
      try { dispatcher.subscribe('MEDIA_ENGINE_SET_GO_LIVE', applyAll); } catch (e) {}
      try { dispatcher.subscribe('RTC_CONNECTION_STATE', applyAll); } catch (e) {}
    }

    // Intervalo contínuo de segurança a cada 1.5s
    setInterval(applyAll, 1500);
  }

  getVoiceChannelId() {
    const modules = this.findModules();
    if (modules.voiceStore && typeof modules.voiceStore.getVoiceChannelId === 'function') {
      return modules.voiceStore.getVoiceChannelId();
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
 * Mantém a resiliência e auto-inscrição da 1.1.0 estável.
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
    });

    // 2. Quando chegam candidatos ICE do transmissor
    this.signaling.on('stream:ice-candidate', (data) => {
      if (data.candidate) {
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

    // Sincronização periódica de canal de voz (Base 1.1.0 estável)
    // Garante que o usuário se inscreva imediatamente ao entrar em uma sala de voz
    this.checkInterval = setInterval(() => {
      this.syncVoiceChannel();
    }, 2000);

    return true;
  }

  syncVoiceChannel() {
    const channelId = this.getVoiceChannelIdFn();
    const userId = this.getCurrentUserIdFn();

    if (userId) this.currentUserId = userId;

    if (channelId !== this.currentChannelId) {
      const oldChannel = this.currentChannelId;
      this.currentChannelId = channelId;

      if (channelId && this.currentUserId) {
        // Usuário entrou em um canal de voz
        this.emit('channelJoin', { channelId, userId: this.currentUserId });
        this.signaling.subscribe(channelId, this.currentUserId);
      } else if (!channelId && oldChannel) {
        // Usuário saiu do canal de voz
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

  // --- 5. Initializer ---
  try {
    const hook = new MobileNativeDispatcherHook();
    const modules = hook.findModules();
    hook.installOverrides(modules);

    const manager = new MobileCoreManager({
      config: config || {"name":"discord-video-mod-mobile","version":"1.1.0-mobile","description":"Discord Video Mod para iOS (iPhone) e Android com suporte a Auto-Update OTA e base estável 1.1.0","enabled":true,"serverUrl":"https://discordvideomod.onrender.com","signalingUrl":"wss://discordvideomod.onrender.com/signaling","updateUrl":"https://discordvideomod.onrender.com/api/mod/mobile/update","checkUpdateIntervalMs":300000,"defaultQuality":{"width":1920,"height":1080,"fps":60,"maxBitrate":10000}},
      getVoiceChannelId: () => hook.getVoiceChannelId(),
      getCurrentUserId: () => hook.getCurrentUserId()
    });

    global.__DISCORD_MOBILE_MOD__ = {
      version: config.version || '1.1.0-mobile',
      manager,
      hook,
      active: true
    };

    manager.start().then(() => {
      console.log('[DiscordMod Mobile OTA] Iniciado com sucesso v' + (config.version || '1.1.0-mobile'));
    }).catch(function(e) { console.warn('[DiscordMod Mobile OTA] Erro ao iniciar:', e); });
  } catch (err) {
    console.error('[DiscordMod Mobile OTA] Falha fatal no bootstrap:', err);
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global), typeof window !== 'undefined' ? window : global, {"name":"discord-video-mod-mobile","version":"1.1.0-mobile","description":"Discord Video Mod para iOS (iPhone) e Android com suporte a Auto-Update OTA e base estável 1.1.0","enabled":true,"serverUrl":"https://discordvideomod.onrender.com","signalingUrl":"wss://discordvideomod.onrender.com/signaling","updateUrl":"https://discordvideomod.onrender.com/api/mod/mobile/update","checkUpdateIntervalMs":300000,"defaultQuality":{"width":1920,"height":1080,"fps":60,"maxBitrate":10000}});
