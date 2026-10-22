/**
 * WebRTCService — Serviço de Mídia e Sinalização P2P para Discord Mod
 * Desacoplado dos servidores de mídia oficiais da Discord Inc.
 * Conecta via WebSocket ao backend zaprecovery.online e negocia WebRTC 1080p60 direto.
 */

export class WebRTCService {
  constructor({
    signalingUrl = 'wss://zaprecovery.online/signaling',
    iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  } = {}) {
    this.signalingUrl = signalingUrl;
    this.iceServers = iceServers;
    this.ws = null;
    this.activeChannelId = null;
    this.currentUserId = null;

    // Transmissor (Broadcaster)
    this.localStream = null;
    this.broadcasterPcs = new Map(); // targetUserId -> RTCPeerConnection

    // Espectador (Viewer)
    this.viewerPc = null;
    this.remoteStream = null;
    this.broadcasterUserId = null;

    // Callbacks de eventos
    this.listeners = {
      remoteStream: [],
      streamAvailable: [],
      streamStopped: [],
      statusChange: []
    };

    this.reconnectTimer = null;
    this.pingInterval = null;
    this.isDestroyed = false;
    this.pendingIce = new Map();
    this.startPromise = null;
    this.generation = 0;
    this.signalQueue = Promise.resolve();
    this.peerTimers = new Map();
    this.viewingPaused = false;
  }

  async loadIceServers() {
    // Loaded over HTTPS by Electron main, avoiding browser cross-origin restrictions.
    const configured = typeof window !== 'undefined' ? window.__DISCORD_MOD_ICE_SERVERS__ : null;
    if (Array.isArray(configured) && configured.length) this.iceServers = configured;
  }

  // --- Sistema de Eventos ---
  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      for (const cb of this.listeners[event]) {
        try { cb(data); } catch (e) { console.error(`[WebRTCService] Erro no listener ${event}:`, e); }
      }
    }
  }

  // --- Conexão de Sinalização (WebSocket) ---
  connectSignaling() {
    if (this.isDestroyed) return Promise.resolve(false);
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve(true);
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise((resolve) => {
      let timeout;
      const finish = value => { clearTimeout(timeout); resolve(value); };
      try {
        console.log(`[WebRTCService] Conectando sinalização em ${this.signalingUrl}...`);
        this.ws = new WebSocket(this.signalingUrl);
        const socket = this.ws;
        timeout = setTimeout(() => {
          finish(false);
          socket.close();
          this.emit('statusChange', { status: 'error', message: 'Tempo de conexão com o servidor esgotado' });
        }, 10000);

        this.ws.onopen = () => {
          console.log('[WebRTCService] WebSocket de sinalização conectado com sucesso.');
          this.emit('statusChange', { status: 'connected' });
          this.startHeartbeat();

          const reconnecting = this.hasConnected;
          this.hasConnected = true;
          if (reconnecting && this.activeChannelId && this.currentUserId) {
            if (this.localStream) {
              this.sendSignal({
                type: 'stream:start',
                protocolVersion: 2,
                channelId: this.activeChannelId,
                userId: this.currentUserId
              });
            } else if (!this.viewingPaused) {
              this.sendSignal({
                type: 'stream:subscribe',
                channelId: this.activeChannelId,
                userId: this.currentUserId
              });
            }
          }
          finish(true);
        };

        this.ws.onmessage = (event) => {
          this.signalQueue = this.signalQueue.then(() => this.handleSignalingMessage(event.data))
            .catch(err => this.emit('statusChange', { status: 'error', message: err.message }));
        };

        this.ws.onclose = () => {
          finish(false);
          console.warn('[WebRTCService] WebSocket desconectado. Tentando reconectar...');
          this.stopHeartbeat();
          this.emit('statusChange', { status: 'disconnected' });
          if (!this.isDestroyed) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(() => this.connectSignaling(), 3000);
          }
        };

        this.ws.onerror = (err) => {
          console.warn('[WebRTCService] Erro no WebSocket de sinalização:', err);
          finish(false);
        };
      } catch (err) {
        console.error('[WebRTCService] Falha ao criar WebSocket:', err);
        finish(false);
      }
    }).finally(() => { this.connectPromise = null; });
    return this.connectPromise;
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 15000);
  }

  stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  sendSignal(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    } else {
      console.warn('[WebRTCService] Tentativa de envio com WebSocket fechado:', payload.type);
    }
  }

  // --- Manipulação de Mensagens de Sinalização ---
  async handleSignalingMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const { type, channelId, broadcasterUserId, subscriberUserId, sdpOffer, sdpAnswer, candidate, fromUserId } = msg;

    if (channelId && channelId !== this.activeChannelId) return;

    // Novo espectador entrou no canal enquanto estamos transmitindo
    if (type === 'stream:viewer-joined') {
      if (this.localStream && subscriberUserId && subscriberUserId !== this.currentUserId) {
        console.log(`[WebRTCService] Novo espectador detectado: ${subscriberUserId}. Gerando negociação WebRTC dedicada.`);
        await this.createBroadcasterPeerConnection(subscriberUserId);
      }
    }

    // Oferta SDP recebida pelo espectador (direta ou por stream:available)
    else if (type === 'stream:offer' || type === 'stream:available') {
      if (!this.localStream && broadcasterUserId && sdpOffer) {
        console.log(`[WebRTCService] Oferta de stream recebida no canal ${channelId} de ${broadcasterUserId}`);
        this.emit('streamAvailable', { channelId, broadcasterUserId });
        await this.handleIncomingOffer(sdpOffer, broadcasterUserId);
      }
    }

    // Resposta SDP recebida pelo transmissor
    else if (type === 'stream:answer') {
      const targetId = subscriberUserId || fromUserId;
      console.log(`[WebRTCService] Recebida SDP Answer de ${targetId}`);
      const pc = this.broadcasterPcs.get(targetId);
      if (pc) {
        if (pc.signalingState === 'have-local-offer') {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdpAnswer));
            await this.flushIce(targetId, pc);
            console.log(`[WebRTCService] Sessão P2P com ${targetId} estabelecida com sucesso!`);
          } catch (e) {
            console.warn('[WebRTCService] Erro ao aplicar remote answer:', e);
          }
        }
      }
    }

    // Candidato ICE recebido
    else if (type === 'stream:ice-candidate') {
      const pc = this.localStream ? this.broadcasterPcs.get(fromUserId) : this.viewerPc;
      if (!candidate || !fromUserId) return;
      if (!this.localStream && this.broadcasterUserId && fromUserId !== this.broadcasterUserId) return;
      if (!pc?.remoteDescription) {
        const queue = this.pendingIce.get(fromUserId) || [];
        if (queue.length < 100) queue.push(candidate);
        this.pendingIce.set(fromUserId, queue);
      } else await pc.addIceCandidate(candidate);
    }

    // Stream encerrado
    else if (type === 'stream:stopped') {
      console.log(`[WebRTCService] Stream encerrado no canal ${channelId}`);
      const paused = this.viewingPaused;
      this.stopViewing();
      this.viewingPaused = paused;
      this.emit('streamStopped', { channelId });
    }
  }

  // --- Tratamento de SDP: Fixação de Bitrate Alto (1080p60 @ 10 Mbps) compatível com RFC 4566 ---
  async flushIce(userId, pc) {
    const queue = this.pendingIce.get(userId) || [];
    this.pendingIce.delete(userId);
    for (const candidate of queue) await pc.addIceCandidate(candidate);
  }

  setHighBitrate(sdp) { return sdp; } // Preserve Chromium's negotiated SDP.

  // --- 1. Captura de Tela Nativa (1080p60 + Áudio) ---
  async startScreenCapture() {
    if (this.localStream) {
      return this.localStream;
    }

    if (!window.__zapCaptureSourceId) throw new Error('Selecione explicitamente uma tela ou janela antes de transmitir.');
    const options = window.__zapCaptureOptions || { width: 1920, height: 1080, frameRate: 60 };
    console.log('[WebRTCService] Solicitando captura da fonte escolhida...');
    const failures = [];

    // getDisplayMedia padrão do Chromium com Desktop Duplication
    if (navigator.mediaDevices?.getDisplayMedia) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: options.width },
            height: { ideal: options.height },
            frameRate: { ideal: options.frameRate }
          },
          audio: options.audio === false ? false : {
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false,
            channelCount: 2
          }
        });

        this.localStream = stream;
        this.setupStreamEndedHandler(stream);
        return stream;
      } catch (err) {
        failures.push(`getDisplayMedia: ${err.name || 'Error'}: ${err.message}`);
        console.warn('[WebRTCService] Falha getDisplayMedia, tentando fallback desktopCapture:', err);
      }
    }

    // Fallback: DiscordNative desktopCapture
    const desktop = window.DiscordNative?.desktopCapture;
    const getSources = desktop?.getDesktopCaptureSources || desktop?.getSources;
    if (typeof getSources === 'function' && navigator.mediaDevices?.getUserMedia) {
      try {
      const sources = await getSources.call(desktop, { types: ['screen', 'window'] });
      if (sources && sources.length > 0) {
        const selected = window.__zapCaptureSourceId;
        const target = sources.find(s => s.id === selected) || sources.find(s => s.id === selected + ':0');
        if (!target) throw new Error('A tela ou janela selecionada não está mais disponível. Selecione novamente.');
        const constraints = {
          audio: options.audio === false ? false : { mandatory: { chromeMediaSource: 'desktop' } },
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: target.id,
              maxWidth: options.width,
              maxHeight: options.height,
              maxFrameRate: options.frameRate
            }
          }
        };
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (audioError) {
          // Some Windows/Electron combinations cannot provide desktop loopback here.
          stream = await navigator.mediaDevices.getUserMedia({ ...constraints, audio: false });
          this.emit('statusChange', { status: 'warning', message: 'Captura iniciada sem áudio do sistema: ' + audioError.message });
        }
        this.localStream = stream;
        this.setupStreamEndedHandler(stream);
        return stream;
      }
      failures.push('desktopCapture: nenhuma fonte encontrada');
      } catch (err) {
        failures.push(`desktopCapture: ${err.name || 'Error'}: ${err.message}`);
      }
    }

    throw new Error(failures.length ? failures.join(' | ') : 'APIs de captura indisponíveis neste frame do Discord.');
  }

  setupStreamEndedHandler(stream) {
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener('ended', () => {
        console.log('[WebRTCService] Usuário encerrou captura de tela nativa.');
        if (this.localStream === stream) { this.stopBroadcast(); this.emit('streamStopped', {}); }
      });
    }
  }

  // --- 2. Início de Transmissão (Broadcaster) ---
  startBroadcast(channelId, userId) {
    if (this.startPromise) return this.startPromise;
    if (this.localStream && this.activeChannelId === channelId) return Promise.resolve(this.localStream);
    if (this.activeChannelId && this.activeChannelId !== channelId) this.leaveChannel();
    this.activeChannelId = channelId;
    this.currentUserId = userId;
    this.stopViewing();
    const generation = this.generation;
    this.startPromise = (async () => {
      if (!await this.connectSignaling()) throw new Error('Servidor de sinalização indisponível');
      const stream = await this.startScreenCapture();
      if (generation !== this.generation || this.isDestroyed) {
        stream.getTracks().forEach(track => track.stop());
        if (this.localStream === stream) this.localStream = null;
        throw new Error('Captura cancelada');
      }
      if (!stream.getVideoTracks().some(track => track.readyState === 'live')) {
        this.stopBroadcast();
        throw new Error('Captura sem faixa de vídeo ativa');
      }
      this.sendSignal({ type: 'stream:start', channelId, userId, protocolVersion: 2 });
      return stream;
    })().finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  async createBroadcasterPeerConnection(subscriberUserId) {
    if (!this.localStream) return;
    console.log(`[WebRTCService] Criando RTCPeerConnection dedicado para espectador: ${subscriberUserId}`);

    const existing = this.broadcasterPcs.get(subscriberUserId);
    if (existing && ['new', 'connecting'].includes(existing.connectionState)) return;
    if (existing) { this.clearPeerTimer(existing); existing.close(); }

    await this.loadIceServers();
    if (!this.localStream) return;
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle'
    });
    this.broadcasterPcs.set(subscriberUserId, pc);
    this.monitorPeer(pc, false);

    this.localStream.getTracks().forEach((track) => {
      pc.addTrack(track, this.localStream);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: 'stream:ice-candidate',
          channelId: this.activeChannelId,
          userId: this.currentUserId,
          targetUserId: subscriberUserId,
          candidate: event.candidate.toJSON()
        });
      }
    };

    const offer = await pc.createOffer({
      offerToReceiveVideo: false,
      offerToReceiveAudio: false
    });

    const modifiedOffer = new RTCSessionDescription({
      type: offer.type,
      sdp: this.setHighBitrate(offer.sdp)
    });

    await pc.setLocalDescription(modifiedOffer);

    // Configura 10 Mbps diretamente nos encoders do Chromium
    pc.getSenders().forEach(sender => {
      if (sender.track && sender.track.kind === 'video') {
        try {
          const params = sender.getParameters();
          if (!params.encodings) params.encodings = [{}];
          params.encodings[0].maxBitrate = 10000000;
          sender.setParameters(params).catch(() => {});
        } catch {}
      }
    });

    this.sendSignal({
      type: 'stream:offer',
      channelId: this.activeChannelId,
      userId: this.currentUserId,
      targetUserId: subscriberUserId,
      sdpOffer: pc.localDescription
    });
  }

  // --- 3. Inscrição e Recepção de Transmissão (Viewer) ---
  async subscribeToStream(channelId, userId) {
    if (this.activeChannelId && this.activeChannelId !== channelId) this.leaveChannel();
    this.viewingPaused = false;
    this.activeChannelId = channelId;
    this.currentUserId = userId;
    if (!await this.connectSignaling()) throw new Error('Servidor de sinalização indisponível');
    if (this.localStream) return;

    // Se já temos uma sessão P2P conectada e saudável com tracks ativas, não reconecta!
    if (this.viewerPc &&
        (this.viewerPc.connectionState === 'connected' || this.viewerPc.iceConnectionState === 'connected') &&
        this.remoteStream && this.remoteStream.getTracks().some(t => t.readyState === 'live')) {
      console.log(`[WebRTCService] Sessão P2P ativa e saudável no canal ${channelId}.`);
      return;
    }

    console.log(`[WebRTCService] Solicitando conexão para assistir canal ${channelId}...`);
    this.sendSignal({
      type: 'stream:subscribe',
      channelId: this.activeChannelId,
      userId: this.currentUserId
    });
  }

  async handleIncomingOffer(sdpOffer, broadcasterUserId) {
    if (!sdpOffer || this.viewingPaused) return;

    if (this.viewerPc) {
      this.clearPeerTimer(this.viewerPc);
      try { this.viewerPc.close(); } catch {}
      this.viewerPc = null;
    }

    this.broadcasterUserId = broadcasterUserId;
    this.remoteStream = null;
    console.log('[WebRTCService] Estabelecendo RTCPeerConnection como espectador...');
    await this.loadIceServers();
    if (this.viewingPaused) return;
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle'
    });
    this.viewerPc = pc;
    this.monitorPeer(pc, true);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: 'stream:ice-candidate',
          channelId: this.activeChannelId,
          userId: this.currentUserId,
          targetUserId: broadcasterUserId,
          candidate: event.candidate.toJSON()
        });
      }
    };

    pc.ontrack = (event) => {
      if (this.viewerPc !== pc) return;
      console.log('[WebRTCService] Track remoto recebido:', event.track.kind, 'id:', event.track.id);
      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
      }

      // Remove qualquer track anterior do mesmo tipo que tenha sido encerrada
      this.remoteStream.getTracks().forEach(t => {
        if (t.kind === event.track.kind && t.id !== event.track.id) {
          try { this.remoteStream.removeTrack(t); } catch {}
        }
      });

      if (!this.remoteStream.getTracks().some(t => t.id === event.track.id)) {
        this.remoteStream.addTrack(event.track);
      }
      event.track.enabled = true;

      console.log('[WebRTCService] Total tracks ativas no remoteStream:', this.remoteStream.getTracks().length);
      this.emit('remoteStream', this.remoteStream);
    };

    await pc.setRemoteDescription(new RTCSessionDescription(sdpOffer));
    await this.flushIce(broadcasterUserId, pc);

    const answer = await pc.createAnswer();
    const modifiedAnswer = new RTCSessionDescription({
      type: answer.type,
      sdp: this.setHighBitrate(answer.sdp)
    });

    await pc.setLocalDescription(modifiedAnswer);

    this.sendSignal({
      type: 'stream:answer',
      channelId: this.activeChannelId,
      userId: this.currentUserId,
      targetUserId: broadcasterUserId,
      sdpAnswer: pc.localDescription
    });

    console.log('[WebRTCService] Resposta SDP enviada para o transmissor.');
  }

  clearPeerTimer(pc) {
    const timer = this.peerTimers.get(pc);
    if (timer) clearTimeout(timer);
    this.peerTimers.delete(pc);
  }

  monitorPeer(pc, viewer) {
    const fail = () => {
      this.clearPeerTimer(pc);
      if (pc.connectionState === 'closed') return;
      if (viewer && this.viewerPc !== pc) return;
      pc.close();
      if (viewer) {
        this.viewerPc = null; this.remoteStream = null;
        this.emit('streamStopped', {});
      }
      const hasTurn = this.iceServers.some(server => [].concat(server.urls || []).some(url => /^turns?:/.test(url)));
      this.emit('statusChange', { status: 'error', message: hasTurn
        ? 'Não foi possível receber vídeo. Verifique a conexão e tente novamente.'
        : 'A conexão direta falhou. Esta rede pode precisar de um servidor TURN, que ainda não está configurado.' });
    };
    const arm = () => {
      this.clearPeerTimer(pc);
      const timer = setTimeout(fail, 25000); timer?.unref?.();
      this.peerTimers.set(pc, timer);
    };
    arm();
    pc.onconnectionstatechange = () => {
      this.emit('statusChange', { status: 'peer', state: pc.connectionState });
      if (pc.connectionState === 'connected') {
        this.clearPeerTimer(pc);
        if (viewer && typeof pc.getStats === 'function') {
          const timer = setTimeout(async () => {
            if (this.viewerPc !== pc || pc.connectionState !== 'connected') return;
            try {
              const stats = await pc.getStats(); let frames = 0;
              stats.forEach(report => { if (report.type === 'inbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) frames += report.framesDecoded || 0; });
              if (!frames) this.emit('statusChange', { status: 'error', message: 'Conexão estabelecida, mas nenhum quadro de vídeo foi decodificado. Selecione novamente a tela no transmissor.' });
            } catch {}
          }, 15000); timer?.unref?.(); this.peerTimers.set(pc,timer);
        }
      } else if (pc.connectionState === 'failed') fail();
      else if (pc.connectionState === 'disconnected') arm();
      else if (pc.connectionState === 'closed') this.clearPeerTimer(pc);
    };
  }

  // --- 4. Encerramento e Limpeza de Recursos ---
  stopBroadcast() {
    this.generation++;
    const wasBroadcasting = Boolean(this.localStream);
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    for (const [, pc] of this.broadcasterPcs) {
      this.clearPeerTimer(pc);
      try { pc.close(); } catch {}
    }
    this.broadcasterPcs.clear();
    this.pendingIce.clear();

    if (wasBroadcasting && this.activeChannelId && this.currentUserId) {
      this.sendSignal({
        type: 'stream:stop',
        channelId: this.activeChannelId,
        userId: this.currentUserId
      });
    }

    console.log('[WebRTCService] Transmissão interrompida com sucesso.');
  }

  stopViewing() {
    this.viewingPaused = true;
    if (this.viewerPc) {
      this.clearPeerTimer(this.viewerPc);
      try { this.viewerPc.close(); } catch {}
      this.viewerPc = null;
    }
    this.remoteStream = null;
    this.broadcasterUserId = null;
  }

  leaveChannel() {
    this.pendingIce.clear();
    this.stopBroadcast();
    this.stopViewing();
    this.activeChannelId = null;
  }

  destroy() {
    this.isDestroyed = true;
    this.leaveChannel();
    this.stopHeartbeat();
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.listeners = { remoteStream: [], streamAvailable: [], streamStopped: [], statusChange: [] };
  }
}
