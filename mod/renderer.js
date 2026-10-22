(() => {
  const enabled = __RAFA_ENABLED__;
  window.__zapEnabled = enabled;
  function report(message) {
    window.__zapLastError = { message: String(message), at: Date.now() };
    console.error('[DiscordMod]', message);
    if (typeof document === 'undefined') return;
    let notice = document.getElementById('zap-stream-error');
    if (!notice) {
      notice = document.createElement('div'); notice.id = 'zap-stream-error'; notice.setAttribute('role', 'alert');
      notice.style.cssText = 'position:fixed;bottom:85px;left:20px;z-index:2147483647;max-width:420px;padding:14px;background:#412329;color:white;border-radius:8px';
      notice.addEventListener('click', () => notice.remove()); document.body?.appendChild(notice);
    }
    notice.textContent = String(message) + ' (clique para fechar)';
  }
  const chunks = window.webpackChunkdiscord_app;
  if (!chunks?.push) return { status: 'waiting-webpack', verified: false };
  const runtimes = [];
  chunks.push([[Symbol('zap-native-adapter')], {}, req => runtimes.push(req)]); chunks.pop();
  const req = runtimes.sort((a,b) => Object.keys(b?.c || {}).length - Object.keys(a?.c || {}).length)[0];
  if (!req?.c) return { status: 'waiting-cache' };
  for (const [id,factory] of Object.entries(req.m || {})) {
    if (/displayName="(GatewayConnectionStore|StreamRTCConnectionStore|ApplicationStreamingStore|VideoStreamStore|MediaEngineStore|UserStore|SelectedChannelStore)"|ApexExperimentStore/.test(String(factory))) {
      try { req(id); } catch {}
    }
  }
  const candidates = [];
  for (const module of Object.values(req.c)) {
    const value = module?.exports;
    if (!value || !['object','function'].includes(typeof value)) continue;
    candidates.push(value);
    for (const key of Object.keys(value)) { try { if (value[key] && ['object','function'].includes(typeof value[key])) candidates.push(value[key]); } catch {} }
  }
  const named = name => candidates.find(c => { try { return c.getName?.() === name || c.constructor?.displayName === name; } catch { return false; } });
  const experiment = named('ApexExperimentStore');
  const dispatcher = experiment?._dispatcher || candidates.find(c => typeof c.dispatch === 'function' && c._actionHandlers);
  const userStore = named('UserStore') || candidates.find(c => typeof c.getCurrentUser === 'function');
  const channelStore = named('ChannelStore') || candidates.find(c => typeof c.getChannel === 'function' && typeof c.getDMFromUserId === 'function');
  const selected = named('SelectedChannelStore') || candidates.find(c => typeof c.getVoiceChannelId === 'function');
  const media = named('MediaEngineStore'), streams = named('ApplicationStreamingStore'), videoStore = named('VideoStreamStore');
  const React = candidates.find(c => typeof c.createElement === 'function' && typeof c.useEffect === 'function' && typeof c.useRef === 'function');
  let verified = false;
  if (experiment && dispatcher) {
    const name = '2026-08-video-guard';
    const previous = experiment.getClientOverrides()?.[name];
    if (enabled && previous?.variantId !== -1) dispatcher.dispatch({ type:'APEX_EXPERIMENT_OVERRIDE_CREATE', experimentName:name, variantId:-1 });
    if (!enabled && previous != null) dispatcher.dispatch({ type:'APEX_EXPERIMENT_OVERRIDE_DELETE', experimentName:name });
    verified = enabled ? experiment.getClientOverrides()?.[name]?.variantId === -1 : experiment.getClientOverrides()?.[name] == null;
  }

  // Block official stream gateway actions even if a later native UI hook is unavailable.
  if(enabled && dispatcher && !window.__zapGatewayGuard){
    const handlers=dispatcher._actionHandlers;
    const nodes=typeof handlers._nodes?.values==='function'?Array.from(handlers._nodes.values()):Object.values(handlers._dependencyGraph?.nodes || {});
    const gateway=nodes.find(node=>node.name==='GatewayConnectionStore');
    if(gateway && typeof handlers._invalidateCaches==='function'){
      for(const type of ['STREAM_START','STREAM_WATCH','STREAM_STOP','STREAM_SET_PAUSED','STREAM_CREATE']){
        const original=gateway.actionHandler[type];if(typeof original!=='function')continue;
        gateway.actionHandler[type]=event=>{
          if(!window.__zapEnabled)return original(event);
          const bridge=window.__zapNativeBridge;
          if(bridge?.ready)bridge.defer(()=>bridge.handleAction(event));
          else if(type==='STREAM_START'||type==='STREAM_WATCH')report('Integração nativa indisponível. A transmissão oficial foi bloqueada.');
          return false;
        };
      }
      handlers._invalidateCaches();window.__zapGatewayGuard=true;
    }
  }

  class NativeStreamBridge {
    constructor(dependencies, service) {
      Object.assign(this,dependencies); this.service=service;
      this.records=new Map(); this.videoSources=new Map(); this.restores=[]; this.settings=null; this.pendingStart=null;
      this.ready=false; this.startedSource=null; this.subscriptionRemovers=[]; this.sequence=0;
    }
    currentUser() { return this.userStore?.getCurrentUser?.(); }
    channel() { return this.selected?.getVoiceChannelId?.(); }
    descriptor(channelId,ownerId,guildId) {
      const guild = guildId ?? this.channelStore?.getChannel?.(channelId)?.getGuildId?.() ?? null;
      return { streamType:guild?'guild':'call', guildId:guild, channelId, ownerId, discoverable:true };
    }
    key(record) { return record.streamType==='guild' ? `guild:${record.guildId}:${record.channelId}:${record.ownerId}` : `call:${record.channelId}:${record.ownerId}`; }
    nodes() {
      const handlers=this.dispatcher._actionHandlers;
      if (handlers._nodes instanceof Map || typeof handlers._nodes?.values==='function') return Array.from(handlers._nodes.values());
      return Object.values(handlers._dependencyGraph?.nodes || {});
    }
    method(target,key,replacement) {
      const original=target[key]; target[key]=replacement(original);
      if (target[key]===original) throw Error('Método nativo não pode ser adaptado: '+key);
      this.restores.push(()=>{target[key]=original;});
    }
    action(node,type,handler) {
      if (typeof node.actionHandler?.[type]!=='function') return;
      this.method(node.actionHandler,type,original=>event=>window.__zapEnabled ? handler(event,original) : original(event));
    }
    defer(fn) { Promise.resolve().then(fn).catch(error=>report(error.message)); }
    dispatch(event) { this.dispatcher.dispatch({...event,__zapNative:true}); }
    changed() { this.streams.emitChange?.(); this.media.emitChange?.(); this.videoStore.emitChange?.(); }
    install() {
      const nodes=this.nodes();
      const gateway=nodes.find(n=>n.name==='GatewayConnectionStore');
      const rtc=nodes.find(n=>n.name==='StreamRTCConnectionStore');
      const mediaNode=nodes.find(n=>n.name==='MediaEngineStore');
      if (!window.__zapGatewayGuard || !gateway || !rtc || !mediaNode || !this.React || !this.streams || !this.media?.getVideoComponent || !this.videoStore) return false;
      if (typeof this.dispatcher._actionHandlers._invalidateCaches!=='function') return false;
      try {
        // A native RTC session must never be created with the custom signaling metadata.
        for (const type of Object.keys(rtc.actionHandler).filter(t=>t.startsWith('STREAM_'))) this.action(rtc,type,()=>false);
        this.action(mediaNode,'MEDIA_ENGINE_SET_GO_LIVE_SOURCE',event=>{
          this.settings=event.settings || null;
          this.defer(()=>this.maybeStart());
          return true;
        });
        const appNode=nodes.find(n=>n.name==='ApplicationStreamingStore');
        if (appNode) for (const type of ['STREAM_CREATE','STREAM_UPDATE','STREAM_DELETE']) this.action(appNode,type,(event,original)=>event.__zapNative?original(event):false);
        this.method(this.media,'getGoLiveSource',original=>(...args)=>window.__zapEnabled && this.pendingStart && this.settings?.desktopSettings
          ? {desktopSource:{id:this.settings.desktopSettings.sourceId},quality:this.settings.qualityOptions || {resolution:720,frameRate:30}}
          : original.apply(this.media,args));
        if(typeof this.media.getGoLiveContext==='function') this.method(this.media,'getGoLiveContext',original=>(...args)=>window.__zapEnabled && this.pendingStart ? (this.settings?.context || 'stream') : original.apply(this.media,args));
        const bridge=this;
        this.method(this.media,'getVideoComponent',original=>function(...args){
          const NativeVideo=original.apply(this,args);
          if(!window.__zapEnabled)return NativeVideo;
          if(!bridge.VideoComponent || bridge.originalVideo!==NativeVideo){
            bridge.originalVideo=NativeVideo;
            bridge.VideoComponent=function VideoComponent(props){
              const entry=bridge.videoSources.get(props.streamId);
              return entry ? bridge.React.createElement(bridge.CustomVideo,{...props,entry}) : bridge.React.createElement(NativeVideo,props);
            };
          }
          return bridge.VideoComponent;
        });
        // The original lists and badges receive backend-owned streams, without spoofing voice state.
        for (const name of ['getAllApplicationStreams','getAllApplicationStreamsForChannel']) this.method(this.streams,name,original=>(...args)=>{
          if(!window.__zapEnabled)return original.apply(this.streams,args);
          return [...this.records.values()].map(r=>r.descriptor).filter(r=>name!=='getAllApplicationStreamsForChannel'||r.channelId===args[0]);
        });
        for (const name of ['getStreamForUser','getAnyStreamForUser','getAnyDiscoverableStreamForUser']) this.method(this.streams,name,original=>(userId,guildId)=>{
          if(!window.__zapEnabled)return original.call(this.streams,userId,guildId);
          return [...this.records.values()].find(r=>r.descriptor.ownerId===userId&&(guildId===undefined||r.descriptor.guildId===guildId))?.descriptor || null;
        });
        this.CustomVideo=function CustomVideo(props){
          const {entry,...nativeProps}=props;
          const ref=bridge.React.useRef(null);
          bridge.React.useEffect(()=>{
            const video=ref.current;if(!video)return;
            video.srcObject=entry.stream;
            const updateAudio=()=>{
              const volume=bridge.media.getLocalVolume?.(entry.descriptor.ownerId,'stream') ?? 100;
              video.volume=Math.max(0,Math.min(1,volume/100));
              video.muted=entry.local || Boolean(bridge.media.isLocalMute?.(entry.descriptor.ownerId,'stream'));
            };
            updateAudio();bridge.media.addChangeListener?.(updateAudio);
            video.play().catch(()=>report('O Discord bloqueou a reprodução automática. Clique na área do vídeo para reproduzir.'));
            return()=>{bridge.media.removeChangeListener?.(updateAudio);video.srcObject=null;};
          },[entry.stream]);
          return bridge.React.createElement('video',{
            ref, className:nativeProps.className, autoPlay:true, playsInline:true, muted:entry.local,
            style:{...nativeProps.style,width:'100%',height:'100%',objectFit:'contain'},
            onLoadedData:()=>nativeProps.onReady?.(),
            onClick:()=>ref.current?.play().catch(error=>report(error.message)),
            onDoubleClick:nativeProps.onDoubleClick,onContextMenu:nativeProps.onContextMenu
          });
        };
        this.dispatcher._actionHandlers._invalidateCaches();
        this.ready=true;
        const subscribe=(type,callback)=>{this.dispatcher.subscribe(type,callback);this.subscriptionRemovers.push(()=>this.dispatcher.unsubscribe?.(type,callback));};
        subscribe('STREAM_CLOSE',e=>{if(window.__zapEnabled)this.defer(()=>this.stop(e.streamKey));});
        subscribe('STREAM_UPDATE_SETTINGS',e=>{if(window.__zapEnabled)this.defer(()=>this.updateQuality(e));});
        this.service.on('streamAvailable',({channelId,broadcasterUserId})=>{
          const descriptor=this.descriptor(channelId,broadcasterUserId),key=this.key(descriptor);
          if(!this.records.has(key))this.records.set(key,{descriptor,stream:null,local:false});
          this.changed();
        });
        this.service.on('remoteStream',stream=>this.publish(stream,false));
        this.service.on('streamStopped',()=>{this.clearRemote();if(!this.service.localStream && this.pendingStart)this.stop();});
        this.service.on('statusChange',event=>{if(['error','warning'].includes(event.status))report(event.message);});
        return true;
      } catch(error){this.restore();report('Integração nativa incompatível: '+error.message);return false;}
    }
    restore(){for(const undo of this.restores.reverse())undo();this.restores=[];this.dispatcher._actionHandlers._invalidateCaches?.();this.ready=false;}
    async handleAction(event){
      if(!this.ready)return;
      if(event.type==='STREAM_START'){
        this.pendingStart=event;await this.maybeStart();
      }else if(event.type==='STREAM_WATCH'){
        const record=this.records.get(event.streamKey);
        if(!record){report('Esta transmissão não está disponível no seu backend. Os dois participantes precisam do mod.');return;}
        if(record.stream){this.publish(record.stream,record.local,record.descriptor);return;}
        await this.service.subscribeToStream(record.descriptor.channelId,this.currentUser().id);
      }else if(event.type==='STREAM_STOP')this.stop(event.streamKey);
      else if(event.type==='STREAM_SET_PAUSED')for(const track of this.service.localStream?.getVideoTracks() || [])track.enabled=!event.paused;
    }
    async maybeStart(){
      const source=this.settings?.desktopSettings?.sourceId;
      if(!source){if(this.service.localStream || this.service.startPromise)this.stop();return;}
      if(!this.pendingStart)return;
      const start=this.pendingStart, user=this.currentUser();
      if(!user || start.channelId!==this.channel())return;
      if(this.service.localStream && this.startedSource===source){await this.updateQuality(this.settings.qualityOptions);return;}
      if(this.service.startPromise)return;
      if(this.service.localStream)this.service.stopBroadcast();
      const quality=this.settings.qualityOptions || {resolution:720,frameRate:30};
      window.__zapCaptureSourceId=source;
      window.__zapCaptureOptions={width:Math.round(quality.resolution*16/9),height:quality.resolution,frameRate:quality.frameRate,audio:this.settings.desktopSettings.sound!==false};
      this.startedSource=source;
      try {
        const stream=await this.service.startBroadcast(start.channelId,user.id);
        if(this.settings?.desktopSettings?.sourceId!==source){this.service.stopBroadcast();this.startedSource=null;await this.maybeStart();return;}
        this.publish(stream,true,this.descriptor(start.channelId,user.id,start.guildId));
      }catch(error){this.startedSource=null;this.stop();report('Falha ao capturar a tela selecionada no Discord: '+error.message);}
    }
    publish(stream,local,descriptor){
      const owner=local?this.currentUser()?.id:this.service.broadcasterUserId;
      if(!descriptor)descriptor=this.descriptor(this.service.activeChannelId,owner);
      if(!descriptor.ownerId||!descriptor.channelId)return;
      const key=this.key(descriptor),videoId='zap:'+key;
      const entry={stream,local,descriptor};this.records.set(key,entry);this.videoSources.set(videoId,entry);
      this.defer(()=>{
        this.dispatch({type:'STREAM_CREATE',streamKey:key,region:'custom',viewerIds:[],paused:false});
        this.dispatch({type:'RTC_CONNECTION_VIDEO',userId:descriptor.ownerId,guildId:descriptor.guildId,streamId:videoId,context:'stream'});
        this.changed();
      });
    }
    async updateQuality(options){
      const track=this.service.localStream?.getVideoTracks()[0];if(!track||!options)return;
      const constraints={};if(Number.isFinite(options.resolution))constraints.height={ideal:options.resolution};if(Number.isFinite(options.frameRate))constraints.frameRate={ideal:options.frameRate};
      if(Object.keys(constraints).length)await track.applyConstraints(constraints);
    }
    remove(key,keepAvailable=false){
      const record=this.records.get(key);if(!record)return;
      if(keepAvailable)this.records.set(key,{descriptor:record.descriptor,stream:null,local:false});else this.records.delete(key);
      this.videoSources.delete('zap:'+key);
      this.defer(()=>{
        this.dispatch({type:'RTC_CONNECTION_VIDEO',userId:record.descriptor.ownerId,guildId:record.descriptor.guildId,streamId:null,context:'stream'});
        this.dispatch({type:'STREAM_DELETE',streamKey:key,unavailable:false});this.changed();
      });
    }
    stop(key){
      const own=this.currentUser()?.id;
      const record=key?this.records.get(key):null;
      if(!key||record?.local||key.endsWith(':'+own)){
        this.pendingStart=null;this.settings=null;this.startedSource=null;this.service.stopBroadcast();
        for(const [k,r]of this.records)if(r.local)this.remove(k);
      }else{this.service.stopViewing();this.remove(key,true);}
    }
    clearRemote(){for(const [key,record]of this.records)if(!record.local)this.remove(key);}
    leave(){this.stop();this.service.leaveChannel();for(const key of [...this.records.keys()])this.remove(key);}
  }

  if(!window.__zapWebRTCInstance && enabled && window.WebRTCService)window.__zapWebRTCInstance=new window.WebRTCService();
  const service=window.__zapWebRTCInstance;
  if(enabled && service && dispatcher && !window.__zapNativeBridge?.ready){
    const bridge=new NativeStreamBridge({dispatcher,userStore,channelStore,selected,media,streams,videoStore,React},service);
    if(bridge.install()){window.__zapNativeBridge=bridge;service.connectSignaling();}
  }
  const bridge=window.__zapNativeBridge;
  if(!enabled){bridge?.leave();bridge?.restore();service?.destroy();}
  if(enabled && bridge?.ready){
    const channel=bridge.channel();
    if(channel!==bridge.lastChannel && (!channel || bridge.currentUser())){
      bridge.lastChannel=channel;bridge.leave();
      if(channel && bridge.currentUser())service.subscribeToStream(channel,bridge.currentUser().id).catch(error=>report(error.message));
    }
  }
  // Compatibility failure blocks only the share button; it never opens an alternate UI.
  if(typeof document!=='undefined'&&!window.__zapNativeButtonGuard){
    window.__zapNativeButtonGuard=true;
    document.addEventListener('click',event=>{
      if(!window.__zapEnabled)return;
      const button=event.target?.closest?.('button[aria-label="Compartilhe sua tela"], button[aria-label="Share Your Screen"], button[aria-label="Compartilhar sua tela"], [role="button"][aria-label="Compartilhe sua tela"], [role="button"][aria-label="Share Your Screen"]');
      if(button && (!window.__zapNativeBridge?.ready || service?.ws?.readyState!==1)){
        event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
        report(window.__zapNativeBridge?.ready?'Backend desconectado. Aguarde a reconexão.':'A integração nativa ainda não está pronta nesta versão do Discord.');
      }
    },true);
  }
  return {status:enabled?(bridge?.ready?'native-adapter-ready':verified?'applied':'waiting-native-adapter'):'disabled',verified,
    integration:{version:window.__DISCORD_MOD_VERSION__,nativeAdapter:Boolean(bridge?.ready),signalingState:service?.ws?.readyState,capturing:Boolean(service?.localStream),receiving:Boolean(service?.remoteStream),peerState:service?.viewerPc?.connectionState,lastError:window.__zapLastError}};
})();
