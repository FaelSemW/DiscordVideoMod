/**
 * WebRTCService — Serviço de Mídia e Sinalização P2P para Discord Mod
 * Desacoplado dos servidores de mídia oficiais da Discord Inc.
 * Conecta via WebSocket ao backend (Render Cloud 24/7 ou VPS) e negocia WebRTC 1080p60 direto.
 */

export class WebRTCService {
  constructor({
    signalingUrl = (window.__ZAP_CONFIG__?.signalingUrl || (window.__ZAP_CONFIG__?.serverUrl ? window.__ZAP_CONFIG__.serverUrl.replace(/^http/i, 'ws') + '/signaling' : 'wss://discordvideomod.onrender.com/signaling')),
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
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve(true);
    }
    // FIX 1.1.4: se ainda está conectando, espera abrir (antes resolvia na hora e o stream:start se perdia)
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING && this._connectPromise) {
      return this._connectPromise;
    }

    this._connectPromise = new Promise((resolve) => {
      try {
        console.log(`[WebRTCService] Conectando sinalização em ${this.signalingUrl}...`);
        this.ws = new WebSocket(this.signalingUrl);

        this.ws.onopen = () => {
          console.log('[WebRTCService] WebSocket de sinalização conectado com sucesso.');
          this.emit('statusChange', { status: 'connected' });
          this.startHeartbeat();

          if (this.activeChannelId && this.currentUserId) {
            if (this.localStream) {
              // FIX 1.1.4: reenvia a oferta pendente ao reconectar (antes ia sem sdpOffer e ninguém conseguia assistir)
              const pending = this.broadcasterPcs.get('initial');
              this.sendSignal({
                type: 'stream:start',
                channelId: this.activeChannelId,
                userId: this.currentUserId,
                sdpOffer: pending?.localDescription || undefined
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
          resolve(false);
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
    return this._connectPromise;
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

    // Novo stream disponível no canal
    if (type === 'stream:available') {
      console.log(`[WebRTCService] Stream disponível no canal ${channelId} por ${broadcasterUserId}`);
      this.broadcasterUserId = broadcasterUserId;
      this.emit('streamAvailable', { channelId, broadcasterUserId });

      if (!this.localStream && this.activeChannelId === channelId) {
        await this.handleIncomingOffer(sdpOffer, broadcasterUserId);
      }
    }

    // Resposta SDP recebida pelo transmissor
    else if (type === 'stream:answer') {
      console.log(`[WebRTCService] Recebida SDP Answer de ${subscriberUserId}`);
      // FIX 1.1.4: a oferta pendente ('initial') tem prioridade. Depois de usada, ela passa a pertencer
      // a esse espectador e uma oferta nova é anunciada para o próximo (sair/voltar e 2+ espectadores).
      const initial = this.broadcasterPcs.get('initial');
      const pc = (initial && initial.signalingState === 'have-local-offer')
        ? initial
        : this.broadcasterPcs.get(subscriberUserId);
      if (pc && pc.signalingState === 'have-local-offer') {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(sdpAnswer));
          if (pc === initial && subscriberUserId) {
            const old = this.broadcasterPcs.get(subscriberUserId);
            if (old && old !== pc) { try { old.close(); } catch {} }
            this.broadcasterPcs.set(subscriberUserId, pc);
            this.broadcasterPcs.delete('initial');
            this.scheduleOfferRotation(pc);
          }
        } catch (e) {
          console.warn('[WebRTCService] Erro ao aplicar answer:', e);
        }
      }
    }

    // Candidato ICE recebido
    else if (type === 'stream:ice-candidate') {
      const sender = fromUserId;
      if (this.localStream) {
        const pc = this.broadcasterPcs.get(sender) || this.broadcasterPcs.get('initial');
        if (pc && candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.warn('[WebRTCService] ICE add error (broadcaster):', e);
          }
        }
      } else if (this.viewerPc && candidate) {
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

  // --- 1. Captura de Tela Nativa (1080p60 + Áudio) sem erros de restrição ---
  async startScreenCapture() {
    if (this.localStream) {
      return this.localStream;
    }

    console.log('[WebRTCService] Solicitando captura de tela nativa 1080p60...');

    // 1. getDisplayMedia padrão com áudio seguro (evita AbortError: Invalid capture constraints)
    if (navigator.mediaDevices?.getDisplayMedia) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 1920, max: 1920 },
            height: { ideal: 1080, max: 1080 },
            frameRate: { ideal: 60, max: 60 }
          },
          audio: true
        });

        this.localStream = stream;
        this.setupStreamEndedHandler(stream);
        return stream;
      } catch (audioErr) {
        console.warn('[WebRTCService] getDisplayMedia com áudio falhou, tentando fallback somente vídeo:', audioErr);
        try {
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              width: { ideal: 1920, max: 1920 },
              height: { ideal: 1080, max: 1080 },
              frameRate: { ideal: 60, max: 60 }
            },
            audio: false
          });

          this.localStream = stream;
          this.setupStreamEndedHandler(stream);
          return stream;
        } catch (videoErr) {
          console.warn('[WebRTCService] Falha getDisplayMedia, tentando fallback desktopCapture:', videoErr);
        }
      }
    }

    // 2. Fallback: DiscordNative desktopCapture com prioridade para tela inteira (Desktop Duplication)
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

    const pc = await this.createBroadcastOffer(stream);

    this.sendSignal({
      type: 'stream:start',
      channelId: this.activeChannelId,
      userId: this.currentUserId,
      sdpOffer: pc.localDescription
    });

    console.log('[WebRTCService] Transmissão iniciada e anunciada para o canal:', channelId);
    return stream;
  }

  // Cria a conexão/oferta pendente ('initial') — mesmo fluxo da 1.1.0
  async createBroadcastOffer(stream) {
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

    // FIX 1.1.4: libera conexões de espectadores que caíram (antes ficavam abertas para sempre)
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        for (const [key, value] of this.broadcasterPcs) {
          if (value === pc && key !== 'initial') this.broadcasterPcs.delete(key);
        }
      }
    });

    const offer = await pc.createOffer({
      offerToReceiveVideo: false,
      offerToReceiveAudio: false
    });

    const modifiedOffer = new RTCSessionDescription({
      type: offer.type,
      sdp: this.setHighBitrate(offer.sdp)
    });

    await pc.setLocalDescription(modifiedOffer);
    this.broadcasterPcs.set('initial', pc);
    return pc;
  }

  // FIX 1.1.4: quando a oferta é usada, espera o espectador conectar (ou 10s) e anuncia uma nova.
  // Espectadores já conectados ignoram (checagem "Sessão P2P já saudável" da 1.1.0).
  scheduleOfferRotation(usedPc) {
    let done = false;
    const rotate = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      this.rotateOffer();
    };
    const timer = setTimeout(rotate, 10000);
    usedPc.addEventListener('connectionstatechange', () => {
      if (['connected', 'failed', 'closed'].includes(usedPc.connectionState)) rotate();
    });
  }

  async rotateOffer() {
    if (!this.localStream || !this.activeChannelId || !this.currentUserId) return;
    const pending = this.broadcasterPcs.get('initial');
    if (pending && pending.signalingState === 'have-local-offer') return;
    try {
      const pc = await this.createBroadcastOffer(this.localStream);
      if (!this.localStream) { try { pc.close(); } catch {} return; }
      this.sendSignal({
        type: 'stream:start',
        channelId: this.activeChannelId,
        userId: this.currentUserId,
        sdpOffer: pc.localDescription
      });
      console.log('[WebRTCService] Nova oferta anunciada para próximos espectadores.');
    } catch (e) {
      console.warn('[WebRTCService] Falha ao renovar oferta:', e);
    }
  }

  // --- 3. Inscrição e Recepção de Transmissão (Viewer) ---
  async subscribeToStream(channelId, userId) {
    this.activeChannelId = channelId;
    this.currentUserId = userId;
    await this.connectSignaling();

    // Se já estiver conectado ativamente recebendo tracks, não desconecta!
    if (this.viewerPc &&
        (this.viewerPc.connectionState === 'connected' || this.viewerPc.iceConnectionState === 'connected') &&
        this.remoteStream && this.remoteStream.getTracks().some(t => t.readyState === 'live')) {
      console.log(`[WebRTCService] Sessão P2P ativa e saudável no canal ${channelId}.`);
      return;
    }

    console.log(`[WebRTCService] Inscrevendo-se para assistir canal ${channelId}...`);
    this.sendSignal({
      type: 'stream:subscribe',
      channelId: this.activeChannelId,
      userId: this.currentUserId
    });
  }

  async handleIncomingOffer(sdpOffer, broadcasterUserId) {
    if (!sdpOffer) return;

    if (this.viewerPc &&
        this.broadcasterUserId === broadcasterUserId &&
        (this.viewerPc.connectionState === 'connected' || this.viewerPc.iceConnectionState === 'connected') &&
        this.remoteStream && this.remoteStream.getTracks().some(t => t.readyState === 'live')) {
      console.log('[WebRTCService] Sessão P2P já saudável. Mantendo fluxo.');
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
      this.remoteStream.getTracks().forEach(t => {
        if (t.kind === event.track.kind && t.id !== event.track.id) {
          try { this.remoteStream.removeTrack(t); } catch {}
        }
      });
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
