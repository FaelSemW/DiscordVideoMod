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
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ]
  } = {}) {
    this.signalingUrl = signalingUrl;
    this.iceServers = iceServers;
    this.ws = null;
    this.connectPromise = null;
    this.pendingSignals = [];
    this.activeChannelId = null;
    this.currentUserId = null;

    // Transmissor (Broadcaster)
    this.localStream = null;
    this.broadcasterPcs = new Map(); // targetUserId -> RTCPeerConnection
    this.pendingBroadcasterCandidates = new Map(); // targetUserId -> RTCIceCandidateInit[]

    // Espectador (Viewer)
    this.viewerPc = null;
    this.remoteStream = null;
    this.broadcasterUserId = null;
    this.pendingViewerCandidates = [];
    this.viewerWatchdogTimer = null;

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
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING && this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise((resolve) => {
      try {
        console.log(`[WebRTCService] Conectando sinalização em ${this.signalingUrl}...`);
        const ws = new WebSocket(this.signalingUrl);
        this.ws = ws;

        ws.onopen = () => {
          console.log('[WebRTCService] WebSocket de sinalização conectado com sucesso.');
          this.connectPromise = null;
          this.emit('statusChange', { status: 'connected' });
          this.startHeartbeat();

          // Esvazia fila de mensagens pendentes
          while (this.pendingSignals.length > 0 && ws.readyState === WebSocket.OPEN) {
            const msg = this.pendingSignals.shift();
            try { ws.send(JSON.stringify(msg)); } catch {}
          }

          if (this.activeChannelId && this.currentUserId) {
            if (this.localStream) {
              this.createAndSendInitialOffer().catch(() => {});
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

        ws.onmessage = (event) => {
          this.handleSignalingMessage(event.data);
        };

        ws.onclose = () => {
          console.warn('[WebRTCService] WebSocket desconectado. Tentando reconectar...');
          this.connectPromise = null;
          this.stopHeartbeat();
          this.emit('statusChange', { status: 'disconnected' });
          if (!this.isDestroyed) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(() => this.connectSignaling(), 2000);
          }
        };

        ws.onerror = (err) => {
          console.warn('[WebRTCService] Erro no WebSocket de sinalização:', err);
          this.connectPromise = null;
          resolve(false);
        };
      } catch (err) {
        console.error('[WebRTCService] Falha ao criar WebSocket:', err);
        this.connectPromise = null;
        resolve(false);
      }
    });

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
      try {
        this.ws.send(JSON.stringify(payload));
        return;
      } catch {}
    }
    // Enfileira para enviar assim que o socket abrir
    if (this.pendingSignals.length > 50) this.pendingSignals.shift();
    this.pendingSignals.push(payload);
    this.connectSignaling().catch(() => {});
  }

  // --- Manipulação de Mensagens de Sinalização ---
  async handleSignalingMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const { type, channelId, broadcasterUserId, subscriberUserId, sdpOffer, sdpAnswer, candidate, fromUserId } = msg;

    // Espectador entrou ou pediu re-sincronização: cria oferta dedicada para ele
    if (type === 'stream:viewer-join') {
      if (this.localStream && subscriberUserId && subscriberUserId !== this.currentUserId) {
        console.log(`[WebRTCService] Criando oferta dedicada para espectador ${subscriberUserId}`);
        await this.createOfferForViewer(subscriberUserId);
      }
    }

    // Novo stream disponível no canal
    else if (type === 'stream:available') {
      console.log(`[WebRTCService] Stream disponível no canal ${channelId} por ${broadcasterUserId}`);
      this.broadcasterUserId = broadcasterUserId;
      this.emit('streamAvailable', { channelId, broadcasterUserId });

      if (!this.localStream && (!this.activeChannelId || this.activeChannelId === channelId)) {
        this.activeChannelId = channelId;
        await this.handleIncomingOffer(sdpOffer, broadcasterUserId);
      }
    }

    // Resposta SDP recebida pelo transmissor
    else if (type === 'stream:answer') {
      console.log(`[WebRTCService] Recebida SDP Answer de ${subscriberUserId}`);
      let pc = this.broadcasterPcs.get(subscriberUserId);
      if (!pc) {
        const initialPc = this.broadcasterPcs.get('initial');
        if (initialPc && initialPc.signalingState === 'have-local-offer') {
          pc = initialPc;
          this.broadcasterPcs.set(subscriberUserId, pc);
          this.broadcasterPcs.delete('initial');
        }
      }

      if (pc && pc.signalingState === 'have-local-offer') {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(sdpAnswer));
          // Aplica candidatos ICE que chegaram antes do answer
          const queued = this.pendingBroadcasterCandidates.get(subscriberUserId) ||
                         this.pendingBroadcasterCandidates.get('initial') || [];
          this.pendingBroadcasterCandidates.delete(subscriberUserId);
          this.pendingBroadcasterCandidates.delete('initial');
          for (const c of queued) {
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
          }
        } catch (e) {
          console.warn('[WebRTCService] Erro ao aplicar answer:', e);
        }
      } else if (this.localStream && subscriberUserId) {
        // Se a conexão inicial já estava ocupada ('stable'), gera uma oferta limpa exclusiva para este espectador
        console.log(`[WebRTCService] PC inicial já em uso; renegociando oferta exclusiva para ${subscriberUserId}`);
        await this.createOfferForViewer(subscriberUserId);
      }
    }

    // Candidato ICE recebido
    else if (type === 'stream:ice-candidate') {
      if (!candidate) return;
      const sender = fromUserId;
      if (this.localStream) {
        const pc = this.broadcasterPcs.get(sender) || this.broadcasterPcs.get('initial');
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.warn('[WebRTCService] ICE add error (broadcaster):', e);
          }
        } else {
          const key = sender || 'initial';
          if (!this.pendingBroadcasterCandidates.has(key)) {
            this.pendingBroadcasterCandidates.set(key, []);
          }
          this.pendingBroadcasterCandidates.get(key).push(candidate);
        }
      } else {
        if (this.viewerPc && this.viewerPc.remoteDescription && this.viewerPc.remoteDescription.type) {
          try {
            await this.viewerPc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.warn('[WebRTCService] ICE add error (viewer):', e);
          }
        } else {
          this.pendingViewerCandidates.push(candidate);
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
      const insertPos = cIndex !== -1 ? cIndex + 1 : (firstAIndex !== -1 ? firstAIndex : mVideoIndex + 1);
      lines.splice(insertPos, 0, 'b=AS:10000', 'b=TIAS:10000000');
    }

    return lines.join('\r\n');
  }

  // --- 1. Captura de Tela Nativa (1080p60 + Áudio) sem erros de restrição ---
  async startScreenCapture() {
    if (this.localStream && this.localStream.getVideoTracks().some(t => t.readyState === 'live')) {
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

    // 2. Fallback: DiscordNative desktopCapture com prioridade para tela inteira
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

  // Cria um RTCPeerConnection dedicado para um espectador (ou 'initial')
  async createOfferForViewer(targetUserId) {
    if (!this.localStream || !this.activeChannelId || !this.currentUserId) return null;

    const existing = this.broadcasterPcs.get(targetUserId);
    if (existing) {
      try { existing.close(); } catch {}
      this.broadcasterPcs.delete(targetUserId);
    }

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle'
    });

    this.localStream.getTracks().forEach((track) => {
      pc.addTrack(track, this.localStream);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: 'stream:ice-candidate',
          channelId: this.activeChannelId,
          userId: this.currentUserId,
          targetUserId: targetUserId === 'initial' ? undefined : targetUserId,
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
    this.broadcasterPcs.set(targetUserId, pc);

    if (targetUserId === 'initial') {
      this.sendSignal({
        type: 'stream:start',
        channelId: this.activeChannelId,
        userId: this.currentUserId,
        sdpOffer: pc.localDescription
      });
    } else {
      this.sendSignal({
        type: 'stream:offer',
        channelId: this.activeChannelId,
        userId: this.currentUserId,
        targetUserId,
        sdpOffer: pc.localDescription
      });
    }

    return pc;
  }

  async createAndSendInitialOffer() {
    return this.createOfferForViewer('initial');
  }

  // --- 2. Início de Transmissão (Broadcaster) ---
  async startBroadcast(channelId, userId) {
    this.activeChannelId = channelId;
    this.currentUserId = userId;
    await this.connectSignaling();

    const stream = await this.startScreenCapture();
    await this.createOfferForViewer('initial');

    console.log('[WebRTCService] Transmissão iniciada e anunciada para o canal:', channelId);
    return stream;
  }

  // --- 3. Inscrição e Recepção de Transmissão (Viewer) ---
  async subscribeToStream(channelId, userId, force = false) {
    if (channelId) this.activeChannelId = channelId;
    if (userId) this.currentUserId = userId;
    if (!this.activeChannelId || !this.currentUserId) return;

    await this.connectSignaling();

    // Se já estiver conectado ativamente recebendo tracks vivos, reaplica imediatamente no player!
    if (!force &&
        this.viewerPc &&
        (this.viewerPc.connectionState === 'connected' || this.viewerPc.iceConnectionState === 'connected' || this.viewerPc.iceConnectionState === 'completed') &&
        this.remoteStream && this.remoteStream.getTracks().some(t => t.readyState === 'live')) {
      console.log(`[WebRTCService] Sessão P2P ativa e saudável no canal ${this.activeChannelId}. Re-emitindo stream para o player.`);
      this.emit('remoteStream', this.remoteStream);
      return;
    }

    console.log(`[WebRTCService] Inscrevendo-se para assistir canal ${this.activeChannelId}...`);
    this.sendSignal({
      type: 'stream:subscribe',
      channelId: this.activeChannelId,
      userId: this.currentUserId
    });

    // Watchdog: se em 3.5s ainda não recebeu vídeo ativo, tenta renegociar automaticamente
    clearTimeout(this.viewerWatchdogTimer);
    this.viewerWatchdogTimer = setTimeout(() => {
      if (this.activeChannelId && !this.localStream) {
        const hasLiveVideo = this.remoteStream && this.remoteStream.getVideoTracks().some(t => t.readyState === 'live');
        const isConnected = this.viewerPc && (this.viewerPc.iceConnectionState === 'connected' || this.viewerPc.iceConnectionState === 'completed');
        if (!hasLiveVideo || !isConnected) {
          console.log('[WebRTCService] Watchdog: P2P ainda não estabilizou, solicitando nova oferta...');
          this.sendSignal({
            type: 'stream:subscribe',
            channelId: this.activeChannelId,
            userId: this.currentUserId
          });
        }
      }
    }, 3500);
  }

  async handleIncomingOffer(sdpOffer, broadcasterUserId) {
    if (!sdpOffer) return;

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

    pc.oniceconnectionstatechange = () => {
      if (this.viewerPc !== pc) return;
      const state = pc.iceConnectionState;
      console.log('[WebRTCService] Estado ICE do espectador:', state);
      if (state === 'failed') {
        console.warn('[WebRTCService] Conexão ICE falhou, renegociando automaticamente...');
        this.subscribeToStream(this.activeChannelId, this.currentUserId, true);
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
      clearTimeout(this.viewerWatchdogTimer);
      console.log('[WebRTCService] Total tracks no remoteStream:', this.remoteStream.getTracks().length);
      this.emit('remoteStream', this.remoteStream);
    };

    await pc.setRemoteDescription(new RTCSessionDescription(sdpOffer));

    // Aplica todos os candidatos ICE que chegaram antecipadamente
    while (this.pendingViewerCandidates.length > 0) {
      const c = this.pendingViewerCandidates.shift();
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (e) {
        console.warn('[WebRTCService] Erro ao drenar candidato ICE:', e);
      }
    }

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
    this.pendingBroadcasterCandidates.clear();

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
    clearTimeout(this.viewerWatchdogTimer);
    if (this.viewerPc) {
      try { this.viewerPc.close(); } catch {}
      this.viewerPc = null;
    }
    this.remoteStream = null;
    this.broadcasterUserId = null;
    this.pendingViewerCandidates = [];
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
    clearTimeout(this.viewerWatchdogTimer);
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.listeners = { remoteStream: [], streamAvailable: [], streamStopped: [], statusChange: [] };
  }
}
