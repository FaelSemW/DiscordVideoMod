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
    this._currentSourceId = null;

    // Espectador (Viewer)
    this.viewerPc = null;
    this.remoteStream = null;
    this.broadcasterUserId = null;
    this._viewerNegotiationStart = 0;
    this._lastOfferSdp = null;

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

  // --- Tratamento de SDP: Vídeo 1080p60 estável (6 Mbps) ---
  setHighBitrate(sdp) {
    if (!sdp) return sdp;
    let lines = sdp.split(/\r?\n/);

    let opusPayload = null;
    let inAudio = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('m=audio')) {
        inAudio = true;
        continue;
      }
      if (line.startsWith('m=video')) {
        inAudio = false;
        continue;
      }
      if (line.startsWith('m=')) {
        inAudio = false;
      }

      if (inAudio) {
        const matchOpus = line.match(/^a=rtpmap:(\d+)\s+opus\/48000/i);
        if (matchOpus) {
          opusPayload = matchOpus[1];
        }
      }

      if (line.startsWith('b=AS:') || line.startsWith('b=TIAS:')) {
        lines.splice(i, 1);
        i--;
      }
    }

    if (opusPayload) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(`a=fmtp:${opusPayload}`)) {
          let fmtp = lines[i];
          if (!fmtp.includes('stereo=')) fmtp += ';stereo=1';
          if (!fmtp.includes('sprop-stereo=')) fmtp += ';sprop-stereo=1';
          if (!fmtp.includes('maxaveragebitrate=')) fmtp += ';maxaveragebitrate=320000';
          if (!fmtp.includes('maxplaybackrate=')) fmtp += ';maxplaybackrate=48000';
          if (!fmtp.includes('cbr=')) fmtp += ';cbr=1';
          if (!fmtp.includes('usedtx=')) fmtp += ';usedtx=0';
          lines[i] = fmtp;
        }
      }
    }

    const mAudioIdx = lines.findIndex(l => l.startsWith('m=audio'));
    if (mAudioIdx !== -1) {
      let insertPos = mAudioIdx + 1;
      for (let j = mAudioIdx + 1; j < lines.length && !lines[j].startsWith('m='); j++) {
        if (lines[j].startsWith('c=')) {
          insertPos = j + 1;
          break;
        }
      }
      lines.splice(insertPos, 0, 'b=AS:320', 'b=TIAS:320000');
    }

    // Taxa de bitrate de vídeo calibrada (6.0 Mbps) para 1080p60 liso sem perda de pacotes UDP
    const mVideoIdx = lines.findIndex(l => l.startsWith('m=video'));
    if (mVideoIdx !== -1) {
      let insertPos = mVideoIdx + 1;
      for (let j = mVideoIdx + 1; j < lines.length && !lines[j].startsWith('m='); j++) {
        if (lines[j].startsWith('c=')) {
          insertPos = j + 1;
          break;
        }
      }
      lines.splice(insertPos, 0, 'b=AS:6000', 'b=TIAS:6000000');
    }

    return lines.join('\r\n');
  }

  // --- 1. Captura de Tela/Janela Nativa (1080p60 Vídeo Exclusivo) ---
  async startScreenCapture(forceRestart = false) {
    if (this.localStream && !forceRestart) {
      const hasLiveTrack = this.localStream.getVideoTracks().some(t => t.readyState === 'live');
      if (hasLiveTrack) return this.localStream;
    }

    if (this.localStream) {
      const oldStream = this.localStream;
      this.localStream = null;
      try {
        oldStream.getTracks().forEach(t => t.stop());
      } catch {}
    }

    console.log('[WebRTCService] Solicitando captura de vídeo 1080p60...');

    const videoConstraints = {
      width: { ideal: 1920, max: 1920 },
      height: { ideal: 1080, max: 1080 },
      frameRate: { ideal: 60, max: 60 }
    };

    // 1. getDisplayMedia interceptado pelo main.cjs para capturar exatamente a janela/aplicativo/tela escolhida
    if (navigator.mediaDevices?.getDisplayMedia) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: videoConstraints,
          audio: false
        });

        const vTrack = stream.getVideoTracks()[0];
        if (vTrack && 'contentHint' in vTrack) {
          vTrack.contentHint = 'motion';
        }

        this.localStream = stream;
        this._currentSourceId = window.__lastPickedSourceId || null;
        this.setupStreamEndedHandler(stream);
        return stream;
      } catch (videoErr) {
        console.warn('[WebRTCService] getDisplayMedia falhou, tentando fallback:', videoErr);
      }
    }

    // 2. Fallback: DiscordNative desktopCapture respeitando a janela ou tela selecionada
    if (window.DiscordNative?.desktopCapture?.getSources) {
      const sources = await window.DiscordNative.desktopCapture.getSources({ types: ['screen', 'window'] });
      if (sources && sources.length > 0) {
        let target = null;
        const reqId = window.__lastPickedSourceId;
        const reqName = window.__lastPickedSourceName;
        if (reqId) {
          target = sources.find(s => s.id === reqId);
          if (!target && reqId.startsWith('window:')) {
            const hwnd = reqId.split(':')[1];
            if (hwnd) target = sources.find(s => s.id.startsWith(`window:${hwnd}:`) || s.id === `window:${hwnd}`);
          }
        }
        if (!target && reqName) {
          const normReq = reqName.trim().toLowerCase();
          target = sources.find(s => s.name && s.name.trim().toLowerCase() === normReq) ||
                   sources.find(s => s.name && s.name.toLowerCase().includes(normReq));
        }
        if (!target) {
          target = sources.find(s => s.id.startsWith('screen:')) || sources[0];
        }
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
        const vTrack = stream.getVideoTracks()[0];
        if (vTrack && 'contentHint' in vTrack) {
          vTrack.contentHint = 'motion';
        }
        this.localStream = stream;
        this._currentSourceId = reqId || target.id;
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
        if (this.localStream === stream) {
          console.log('[WebRTCService] Captura de vídeo encerrada pelo sistema.');
          this.stopBroadcast();
        }
      });
    }
  }

  // --- 2. Início ou Troca de Transmissão (Broadcaster) ---
  async startBroadcast(channelId, userId, { forceRestart = false } = {}) {
    const isSameChannel = this.activeChannelId === channelId && this.currentUserId === userId;
    const pickedId = window.__lastPickedSourceId || null;
    const sourceChanged = Boolean(pickedId && this._currentSourceId && pickedId !== this._currentSourceId);

    this.activeChannelId = channelId;
    this.currentUserId = userId;
    await this.connectSignaling();

    const shouldRestartCapture = forceRestart || sourceChanged || !this.localStream;
    const hadActivePeers = isSameChannel && this.broadcasterPcs.size > 0;

    const stream = await this.startScreenCapture(shouldRestartCapture);
    const newVideoTrack = stream.getVideoTracks()[0];

    // Se já há espectadores conectados neste canal e o usuário apenas trocou a janela transmitida,
    // substitui o track de vídeo em tempo real (replaceTrack) sem derrubar a conexão P2P!
    if (hadActivePeers && newVideoTrack) {
      for (const [peerKey, pc] of this.broadcasterPcs.entries()) {
        if (peerKey === 'initial') continue;
        try {
          const senders = pc.getSenders ? pc.getSenders() : [];
          const vSender = senders.find(s => s.track && s.track.kind === 'video') || senders[0];
          if (vSender && typeof vSender.replaceTrack === 'function') {
            await vSender.replaceTrack(newVideoTrack);
          }
        } catch (e) {
          console.warn('[WebRTCService] Erro em replaceTrack:', e);
        }
      }
    }

    // Cria/atualiza a oferta 'initial' para novos espectadores
    const oldInitial = this.broadcasterPcs.get('initial');
    if (oldInitial) {
      try { oldInitial.close(); } catch {}
      this.broadcasterPcs.delete('initial');
    }

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

    // Configura parâmetros de codificação de vídeo para 60 FPS estável a 6.0 Mbps sem quedas de frames
    try {
      const senders = pc.getSenders ? pc.getSenders() : [];
      for (const sender of senders) {
        if (sender.track && sender.track.kind === 'video' && typeof sender.getParameters === 'function') {
          const params = sender.getParameters();
          if (params && params.encodings && params.encodings[0]) {
            params.encodings[0].maxBitrate = 6000000;
            params.encodings[0].maxFramerate = 60;
            params.encodings[0].priority = 'high';
            params.encodings[0].networkPriority = 'high';
            params.encodings[0].degradationPreference = 'maintain-framerate';
            sender.setParameters(params).catch(() => {});
          }
        }
      }
    } catch (e) {}

    this.broadcasterPcs.set('initial', pc);
    return pc;
  }

  // Quando a oferta 'initial' é usada por um espectador, aguarda a conexão estabilizar (2.5s) antes de gerar a próxima oferta standby,
  // evitando colisão de sinalização ou reconexão desnecessária no espectador recém-conectado.
  scheduleOfferRotation(usedPc) {
    let done = false;
    const rotate = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      setTimeout(() => this.rotateOffer(), 2500);
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
      console.log('[WebRTCService] Nova oferta standby anunciada para próximos espectadores.');
    } catch (e) {
      console.warn('[WebRTCService] Falha ao renovar oferta:', e);
    }
  }

  // --- 3. Inscrição e Recepção de Transmissão (Viewer) ---
  async subscribeToStream(channelId, userId) {
    this.activeChannelId = channelId;
    this.currentUserId = userId;
    await this.connectSignaling();

    if (this.viewerPc &&
        (this.viewerPc.connectionState === 'connected' ||
         this.viewerPc.iceConnectionState === 'connected' ||
         this.viewerPc.iceConnectionState === 'completed') &&
        this.remoteStream && this.remoteStream.getVideoTracks().some(t => t.readyState === 'live')) {
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

    const isHealthy = this.viewerPc &&
      this.broadcasterUserId === broadcasterUserId &&
      (this.viewerPc.connectionState === 'connected' ||
       this.viewerPc.iceConnectionState === 'connected' ||
       this.viewerPc.iceConnectionState === 'completed') &&
      this.remoteStream &&
      this.remoteStream.getVideoTracks().some(t => t.readyState === 'live');

    if (isHealthy) {
      console.log('[WebRTCService] Sessão P2P de vídeo já saudável. Mantendo fluxo sem interrupção.');
      return;
    }

    // Evita derrubar uma negociação em andamento se recebermos a mesma oferta duplicada em menos de 5s
    const incomingSdp = typeof sdpOffer === 'object' ? sdpOffer.sdp : String(sdpOffer);
    const isNegotiatingSame = this.viewerPc &&
      this.broadcasterUserId === broadcasterUserId &&
      (Date.now() - this._viewerNegotiationStart < 5000) &&
      (this.viewerPc.connectionState === 'connecting' || this.viewerPc.iceConnectionState === 'checking') &&
      this._lastOfferSdp === incomingSdp;

    if (isNegotiatingSame) {
      return;
    }

    if (this.viewerPc) {
      try { this.viewerPc.close(); } catch {}
      this.viewerPc = null;
    }

    this._viewerNegotiationStart = Date.now();
    this._lastOfferSdp = incomingSdp;

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
      if (event.track.kind === 'video' && 'contentHint' in event.track) {
        event.track.contentHint = 'motion';
      }
      try {
        const receivers = pc.getReceivers ? pc.getReceivers() : [];
        for (const r of receivers) {
          if (r.track && r.track.kind === 'video') {
            if ('playoutDelayHint' in r) r.playoutDelayHint = 0;
            if ('jitterBufferTarget' in r) r.jitterBufferTarget = 0;
          }
        }
      } catch (e) {}

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
      this.emit('remoteStream', this.remoteStream);
    };

    const offerObj = (typeof sdpOffer === 'object' && sdpOffer.sdp)
      ? new RTCSessionDescription({ type: sdpOffer.type, sdp: this.setHighBitrate(sdpOffer.sdp) })
      : new RTCSessionDescription(sdpOffer);

    await pc.setRemoteDescription(offerObj);

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
      const s = this.localStream;
      this.localStream = null;
      try { s.getTracks().forEach((track) => track.stop()); } catch {}
    }
    this._currentSourceId = null;

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
    this._viewerNegotiationStart = 0;
    this._lastOfferSdp = null;
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
