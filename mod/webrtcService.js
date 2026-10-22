/**
 * WebRTCService â€” ServiÃ§o de MÃ­dia e SinalizaÃ§Ã£o P2P para Discord Mod
 * Desacoplado dos servidores de mÃ­dia oficiais da Discord Inc.
 * Conecta via WebSocket ao backend zaprecovery.online e negocia WebRTC 1080p60 direto.
 */

export class WebRTCService {
  constructor({
    signalingUrl = 'wss://zaprecovery.online/signaling',
    iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]
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

  // --- ConexÃ£o de SinalizaÃ§Ã£o (WebSocket) ---
  connectSignaling() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      try {
        console.log(`[WebRTCService] Conectando sinalizaÃ§Ã£o em ${this.signalingUrl}...`);
        this.ws = new WebSocket(this.signalingUrl);

        this.ws.onopen = () => {
          console.log('[WebRTCService] WebSocket de sinalizaÃ§Ã£o conectado com sucesso.');
          this.emit('statusChange', { status: 'connected' });
          this.startHeartbeat();

          // Se jÃ¡ estÃ¡vamos inscritos em um canal, reenvia a inscriÃ§Ã£o
          if (this.activeChannelId && this.currentUserId) {
            if (this.localStream) {
              // Re-anuncia transmissÃ£o
              this.sendSignal({
                type: 'stream:start',
                channelId: this.activeChannelId,
                userId: this.currentUserId
              });
            } else {
              // Re-inscreve como espectador
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
          console.warn('[WebRTCService] Erro no WebSocket de sinalizaÃ§Ã£o:', err);
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

  // --- ManipulaÃ§Ã£o de Mensagens de SinalizaÃ§Ã£o ---
  async handleSignalingMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const { type, channelId, broadcasterUserId, subscriberUserId, sdpOffer, sdpAnswer, candidate, fromUserId } = msg;

    // Novo stream disponÃ­vel no canal
    if (type === 'stream:available') {
      console.log(`[WebRTCService] Stream disponÃ­vel no canal ${channelId} por ${broadcasterUserId}`);
      this.broadcasterUserId = broadcasterUserId;
      this.emit('streamAvailable', { channelId, broadcasterUserId });

      // Se estamos inscritos como espectador e nÃ£o estamos transmitindo, processa a oferta
      if (!this.localStream && this.activeChannelId === channelId) {
        await this.handleIncomingOffer(sdpOffer, broadcasterUserId);
      }
    }

    // Resposta SDP recebida pelo transmissor
    else if (type === 'stream:answer') {
      console.log(`[WebRTCService] Recebida SDP Answer de ${subscriberUserId}`);
      const pc = this.broadcasterPcs.get(subscriberUserId) || this.broadcasterPcs.get('initial');
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(sdpAnswer));
      }
    }

    // Candidato ICE recebido
    else if (type === 'stream:ice-candidate') {
      const sender = fromUserId;
      if (this.localStream) {
        // Transmissor recebendo do espectador
        const pc = this.broadcasterPcs.get(sender) || this.broadcasterPcs.get('initial');
        if (pc && candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.warn('ICE add error:', e));
        }
      } else if (this.viewerPc && candidate) {
        // Espectador recebendo do transmissor
        await this.viewerPc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.warn('ICE add error:', e));
      }
    }

    // Stream encerrado
    else if (type === 'stream:stopped') {
      console.log(`[WebRTCService] Stream encerrado no canal ${channelId}`);
      this.stopViewing();
      this.emit('streamStopped', { channelId });
    }
  }

  // --- Tratamento de SDP: FixaÃ§Ã£o de Bitrate Alto (1080p60 @ 10 Mbps) ---
  setHighBitrate(sdp) {
    if (!sdp) return sdp;
    const lines = sdp.split('\r\n');
    let mVideoIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('m=video')) {
        mVideoIndex = i;
        break;
      }
    }

    if (mVideoIndex !== -1) {
      let insertIndex = mVideoIndex + 1;
      while (insertIndex < lines.length && !lines[insertIndex].startsWith('m=')) {
        if (lines[insertIndex].startsWith('b=')) {
          lines.splice(insertIndex, 1);
        } else {
          insertIndex++;
        }
      }
      // Fixa b=AS:10000 (10000 kbps = 10 Mbps) e b=TIAS:10000000 para 1080p60 ultra limpo
      lines.splice(mVideoIndex + 1, 0, 'b=AS:10000', 'b=TIAS:10000000');
    }

    return lines.join('\r\n');
  }

  // --- 1. Captura de Tela Nativa (1080p60 + Ãudio) ---
  async startScreenCapture() {
    if (this.localStream) {
      return this.localStream;
    }

    console.log('[WebRTCService] Solicitando captura de tela nativa 1080p60...');

    // Tentativa com getDisplayMedia padrÃ£o do Electron/Chromium
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
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sources[0].id,
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

    throw new Error('Nenhum mÃ©todo de captura de tela nativa disponÃ­vel.');
  }

  setupStreamEndedHandler(stream) {
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener('ended', () => {
        console.log('[WebRTCService] UsuÃ¡rio encerrou captura de tela nativa.');
        this.stopBroadcast();
      });
    }
  }

  // --- 2. InÃ­cio de TransmissÃ£o (Broadcaster) ---
  async startBroadcast(channelId, userId) {
    this.activeChannelId = channelId;
    this.currentUserId = userId;
    await this.connectSignaling();

    const stream = await this.startScreenCapture();

    // Cria RTCPeerConnection para gerar a oferta de broadcast
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle'
    });

    // Adiciona tracks de vÃ­deo e Ã¡udio ao peer connection
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    // Coleta ICE candidates locais
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

    // Gera Offer SDP
    const offer = await pc.createOffer({
      offerToReceiveVideo: false,
      offerToReceiveAudio: false
    });

    const modifiedOffer = new RTCSessionDescription({
      type: offer.type,
      sdp: this.setHighBitrate(offer.sdp)
    });

    await pc.setLocalDescription(modifiedOffer);

    // Registra na sinalizaÃ§Ã£o
    this.sendSignal({
      type: 'stream:start',
      channelId: this.activeChannelId,
      userId: this.currentUserId,
      sdpOffer: pc.localDescription
    });

    // MantÃ©m o PC do broadcaster
    this.broadcasterPcs.set('initial', pc);
    console.log('[WebRTCService] TransmissÃ£o iniciada e anunciada para o canal:', channelId);
    return stream;
  }

  // --- 3. InscriÃ§Ã£o e RecepÃ§Ã£o de TransmissÃ£o (Viewer) ---
  async subscribeToStream(channelId, userId) {
    this.activeChannelId = channelId;
    this.currentUserId = userId;
    await this.connectSignaling();

    console.log(`[WebRTCService] Inscrevendo-se para assistir canal ${channelId}...`);
    this.sendSignal({
      type: 'stream:subscribe',
      channelId: this.activeChannelId,
      userId: this.currentUserId
    });
  }

  async handleIncomingOffer(sdpOffer, broadcasterUserId) {
    if (!sdpOffer) return;

    if (this.viewerPc) {
      this.viewerPc.close();
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
        this.remoteStream = event.streams[0] || new MediaStream();
      }
      if (!this.remoteStream.getTracks().some(t => t.id === event.track.id)) {
        this.remoteStream.addTrack(event.track);
      }
      event.track.enabled = true;
      console.log('[WebRTCService] Total tracks no remoteStream:', this.remoteStream.getTracks().length);
      this.emit('remoteStream', this.remoteStream);
    };

    await pc.setRemoteDescription(new RTCSessionDescription(sdpOffer));

    const answer = await pc.createAnswer();
    const modifiedAnswer = new RTCSessionDescription({
      type: answer.type,
      sdp: this.setHighBitrate(answer.sdp)
    });

    await pc.setLocalDescription(modifiedAnswer);

    // Envia Answer para o transmissor
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

    console.log('[WebRTCService] TransmissÃ£o interrompida com sucesso.');
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
