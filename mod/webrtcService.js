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
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      try {
        console.log(`[WebRTCService] Conectando sinalização em ${this.signalingUrl}...`);
        this.ws = new WebSocket(this.signalingUrl);

        this.ws.onopen = () => {
          console.log('[WebRTCService] WebSocket de sinalização conectado com sucesso.');
          this.emit('statusChange', { status: 'connected' });
          this.startHeartbeat();

          if (this.activeChannelId && this.currentUserId) {
            if (this.localStream) {
              this.sendSignal({
                type: 'stream:start',
                channelId: this.activeChannelId,
                userId: this.currentUserId
              });
            } else {
              this.sendSignal({
                type: 'stream:subscribe',
                channelId: this.activeChannelId,
                userId: this.currentUserId
              });
            }
          }
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          this.handleSignalingMessage(event.data);
        };

        this.ws.onclose = () => {
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
          resolve(false);
        };
      } catch (err) {
        console.error('[WebRTCService] Falha ao criar WebSocket:', err);
        resolve(false);
      }
    });
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
        this.broadcasterUserId = broadcasterUserId;
        this.emit('streamAvailable', { channelId, broadcasterUserId });
        await this.handleIncomingOffer(sdpOffer, broadcasterUserId);
      }
    }

    // Resposta SDP recebida pelo transmissor
    else if (type === 'stream:answer') {
      const targetId = subscriberUserId || fromUserId;
      console.log(`[WebRTCService] Recebida SDP Answer de ${targetId}`);
      const pc = this.broadcasterPcs.get(targetId) || this.broadcasterPcs.get('initial');
      if (pc) {
        if (pc.signalingState === 'have-local-offer') {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdpAnswer));
            console.log(`[WebRTCService] Sessão P2P com ${targetId} estabelecida com sucesso!`);
          } catch (e) {
            console.warn('[WebRTCService] Erro ao aplicar remote answer:', e);
          }
        }
      }
    }

    // Candidato ICE recebido
    else if (type === 'stream:ice-candidate') {
      const sender = fromUserId;
      if (this.localStream) {
        // Transmissor recebendo do espectador
        const pc = this.broadcasterPcs.get(sender) || this.broadcasterPcs.get('initial');
        if (pc && candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.warn('[WebRTCService] ICE add error (broadcaster):', e);
          }
        }
      } else if (this.viewerPc && candidate) {
        // Espectador recebendo do transmissor
        try {
          await this.viewerPc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.warn('[WebRTCService] ICE add error (viewer):', e);
        }
      }
    }

    // Stream encerrado
    else if (type === 'stream:stopped') {
      console.log(`[WebRTCService] Stream encerrado no canal ${channelId}`);
      this.stopViewing();
      this.emit('streamStopped', { channelId });
    }
  }

  // --- Tratamento de SDP: Fixação de Bitrate Alto (1080p60 @ 10 Mbps) compatível com RFC 4566 ---
  setHighBitrate(sdp) {
    if (!sdp) return sdp;
    const lines = sdp.split('\r\n');
    let inVideoSection = false;
    let cIndex = -1;
    let mVideoIndex = -1;
    let firstAIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('m=video')) {
        inVideoSection = true;
        mVideoIndex = i;
        continue;
      }
      if (inVideoSection && lines[i].startsWith('m=')) {
        break;
      }
      if (inVideoSection) {
        if (lines[i].startsWith('c=') && cIndex === -1) {
          cIndex = i;
        }
        if (lines[i].startsWith('a=') && firstAIndex === -1) {
          firstAIndex = i;
        }
        if (lines[i].startsWith('b=')) {
          lines.splice(i, 1);
          i--;
        }
      }
    }

    if (mVideoIndex !== -1) {
      // Inserir após c= se existir (RFC 4566), senão antes do primeiro a=, senão logo após m=video
      const insertPos = cIndex !== -1 ? cIndex + 1 : (firstAIndex !== -1 ? firstAIndex : mVideoIndex + 1);
      lines.splice(insertPos, 0, 'b=AS:10000', 'b=TIAS:10000000');
    }

    return lines.join('\r\n');
  }

  // --- 1. Captura de Tela Nativa (1080p60 + Áudio) ---
  async startScreenCapture() {
    if (this.localStream) {
      return this.localStream;
    }

    console.log('[WebRTCService] Solicitando captura de tela nativa 1080p60...');

    // getDisplayMedia padrão do Chromium com Desktop Duplication
    if (navigator.mediaDevices?.getDisplayMedia) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 1920, max: 1920 },
            height: { ideal: 1080, max: 1080 },
            frameRate: { ideal: 60, max: 60 }
          },
          audio: {
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
        console.warn('[WebRTCService] Falha getDisplayMedia, tentando fallback desktopCapture:', err);
      }
    }

    // Fallback: DiscordNative desktopCapture
    if (window.DiscordNative?.desktopCapture?.getSources) {
      const sources = await window.DiscordNative.desktopCapture.getSources({ types: ['screen', 'window'] });
      if (sources && sources.length > 0) {
        const target = sources.find(s => s.id.startsWith('screen:')) || sources[0];
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: target.id,
              minWidth: 1280,
              maxWidth: 1920,
              minHeight: 720,
              maxHeight: 1080,
              minFrameRate: 30,
              maxFrameRate: 60
            }
          }
        });
        this.localStream = stream;
        this.setupStreamEndedHandler(stream);
        return stream;
      }
    }

    throw new Error('Nenhum método de captura de tela nativa disponível.');
  }

  setupStreamEndedHandler(stream) {
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener('ended', () => {
        console.log('[WebRTCService] Usuário encerrou captura de tela nativa.');
        this.stopBroadcast();
      });
    }
  }

  // --- 2. Início de Transmissão (Broadcaster) ---
  async startBroadcast(channelId, userId) {
    this.activeChannelId = channelId;
    this.currentUserId = userId;
    await this.connectSignaling();

    const stream = await this.startScreenCapture();

    // Cria RTCPeerConnection para gerar oferta inicial (compatibilidade retroativa v1.0.3)
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle'
    });

    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: 'stream:ice-candidate',
          channelId: this.activeChannelId,
          userId: this.currentUserId,
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

    // Registra na sinalização
    this.sendSignal({
      type: 'stream:start',
      channelId: this.activeChannelId,
      userId: this.currentUserId,
      sdpOffer: pc.localDescription
    });

    this.broadcasterPcs.set('initial', pc);
    console.log('[WebRTCService] Transmissão iniciada e anunciada para o canal:', channelId);
    return stream;
  }

  async createBroadcasterPeerConnection(subscriberUserId) {
    if (!this.localStream) return;
    console.log(`[WebRTCService] Criando RTCPeerConnection dedicado para espectador: ${subscriberUserId}`);

    const existing = this.broadcasterPcs.get(subscriberUserId);
    if (existing) {
      try { existing.close(); } catch {}
    }

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle'
    });
    this.broadcasterPcs.set(subscriberUserId, pc);

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
    this.activeChannelId = channelId;
    this.currentUserId = userId;
    await this.connectSignaling();

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
    if (!sdpOffer) return;

    // Se já estivermos conectados com tracks ativas desse mesmo broadcaster, mantém sem interrupção
    if (this.viewerPc &&
        this.broadcasterUserId === broadcasterUserId &&
        (this.viewerPc.connectionState === 'connected' || this.viewerPc.iceConnectionState === 'connected') &&
        this.remoteStream && this.remoteStream.getTracks().some(t => t.readyState === 'live')) {
      console.log('[WebRTCService] Sessão P2P já saudável. Mantendo fluxo de vídeo contínuo.');
      return;
    }

    if (this.viewerPc) {
      try { this.viewerPc.close(); } catch {}
      this.viewerPc = null;
    }

    console.log('[WebRTCService] Estabelecendo RTCPeerConnection como espectador...');
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle'
    });
    this.viewerPc = pc;

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

  // --- 4. Encerramento e Limpeza de Recursos ---
  stopBroadcast() {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    for (const [, pc] of this.broadcasterPcs) {
      try { pc.close(); } catch {}
    }
    this.broadcasterPcs.clear();

    if (this.activeChannelId && this.currentUserId) {
      this.sendSignal({
        type: 'stream:stop',
        channelId: this.activeChannelId,
        userId: this.currentUserId
      });
    }

    console.log('[WebRTCService] Transmissão interrompida com sucesso.');
  }

  stopViewing() {
    if (this.viewerPc) {
      try { this.viewerPc.close(); } catch {}
      this.viewerPc = null;
    }
    this.remoteStream = null;
    this.broadcasterUserId = null;
  }

  leaveChannel() {
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
