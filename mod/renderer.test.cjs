const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/renderer.js','utf8').replace('__RAFA_ENABLED__','true');
const tick=()=>new Promise(setImmediate);
function harness({compatible=true}={}){
 const calls=[],events=[],listeners={},nodes=new Map();const overrides={};
 const node=(name,actions)=>{const n={name,actionHandler:actions};nodes.set(name,n);return n;};
 node('GatewayConnectionStore',Object.fromEntries(['STREAM_START','STREAM_WATCH','STREAM_STOP','STREAM_CREATE','STREAM_SET_PAUSED','VOICE_STATE_UPDATE'].map(t=>[t,()=>calls.push('official:'+t)])));
 if(compatible)node('StreamRTCConnectionStore',Object.fromEntries(['STREAM_START','STREAM_CREATE','STREAM_SERVER_UPDATE','STREAM_DELETE','STREAM_UPDATE'].map(t=>[t,()=>calls.push('rtc:'+t)])));
 node('MediaEngineStore',{'MEDIA_ENGINE_SET_GO_LIVE_SOURCE':()=>calls.push('native-capture')});
 node('ApplicationStreamingStore',Object.fromEntries(['STREAM_CREATE','STREAM_UPDATE','STREAM_DELETE'].map(t=>[t,()=>calls.push('ui:'+t)])));
 const dispatcher={_actionHandlers:{_nodes:nodes,_invalidateCaches(){calls.push('invalidate');}},subscribe(t,fn){(listeners[t]??=[]).push(fn);},unsubscribe(){},dispatch(e){events.push(e);if(e.type==='APEX_EXPERIMENT_OVERRIDE_CREATE')overrides[e.experimentName]={variantId:e.variantId};for(const n of nodes.values())n.actionHandler[e.type]?.(e);for(const fn of listeners[e.type]||[])fn(e);}};
 const streams={getName:()=> 'ApplicationStreamingStore',emitChange(){},getAllApplicationStreams:()=>[],getAllApplicationStreamsForChannel:()=>[],getStreamForUser:()=>null,getAnyStreamForUser:()=>null,getAnyDiscoverableStreamForUser:()=>null};
 const NativeVideo=function NativeVideo(){};
 const media={getName:()=> 'MediaEngineStore',getGoLiveSource:()=>null,getVideoComponent:()=>NativeVideo,emitChange(){},getLocalVolume:()=>100};
 let channel='123';
 const user={getName:()=> 'UserStore',getCurrentUser:()=>({id:'10'})};
 const selected={getName:()=> 'SelectedChannelStore',getVoiceChannelId:()=>channel};
 const channelStore={getName:()=> 'ChannelStore',getChannel:()=>({getGuildId:()=> '99'})};
 const React={createElement:(type,props)=>({type,props}),useEffect(){},useRef:()=>({current:null})};
 const track={readyState:'live',kind:'video',applyConstraints:async c=>calls.push(['constraints',c]),stop(){}};
 const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
 const serviceListeners={};
 const service={ws:{readyState:1},localStream:null,activeChannelId:null,on(t,fn){serviceListeners[t]=fn;},emit(t,e){serviceListeners[t]?.(e);},connectSignaling:async()=>true,async startBroadcast(c,u){calls.push(['capture',c,u]);this.activeChannelId=c;this.localStream=stream;return stream;},stopBroadcast(){calls.push('stop');this.localStream=null;},stopViewing(){calls.push('stopViewing');},leaveChannel(){this.activeChannelId=null;},async subscribeToStream(c,u){this.activeChannelId=c;calls.push(['subscribe',c,u]);}};
 const elements=new Map();let click;
 const document={body:{appendChild(e){elements.set(e.id,e);}},getElementById:id=>elements.get(id),createElement:()=>({style:{},setAttribute(){},addEventListener(){}}),addEventListener(type,fn){if(type==='click')click=fn;}};
 const modules={a:{exports:{dispatcher,media,streams,user,selected,channelStore,React,video:{getName:()=> 'VideoStreamStore',emitChange(){}},experiment:{getName:()=> 'ApexExperimentStore',getClientOverrides:()=>overrides}}}};
 const chunks=[];chunks.push=e=>{Array.prototype.push.call(chunks,e);e[2]({m:{},c:modules});};
 const window={webpackChunkdiscord_app:chunks,__zapWebRTCInstance:service};const context=vm.createContext({window,document,console});
 const result=vm.runInContext(source,context);calls.length=0;events.length=0;
 return{window,service,calls,events,dispatcher,media,streams,track,stream,NativeVideo,elements,result,setChannel:c=>channel=c,rerun:()=>vm.runInContext(source,context),click:()=>{let count=0;click({target:{closest:()=>({})},preventDefault(){count++;},stopPropagation(){count++;},stopImmediatePropagation(){count++;}});return count;}};
}
const settings={desktopSettings:{sourceId:'screen:7:0',sound:false},qualityOptions:{resolution:1080,frameRate:60},context:'stream'};
const start={type:'STREAM_START',streamType:'guild',guildId:'99',channelId:'123'};
test('native picker remains native; no separate buttons, dialog or player is created',()=>{
 const h=harness();assert.equal(h.result.integration.nativeAdapter,true);assert.equal(h.click(),0);assert.equal(h.elements.size,0);
});
test('settings payload and native start drive custom capture, without gateway or native RTC',async()=>{
 const h=harness();h.dispatcher.dispatch({type:'MEDIA_ENGINE_SET_GO_LIVE_SOURCE',settings});await tick();assert.equal(h.calls.some(c=>Array.isArray(c)&&c[0]==='capture'),false);
 h.dispatcher.dispatch(start);await tick();await tick();
 assert.equal(h.calls.filter(c=>Array.isArray(c)&&c[0]==='capture').length,1);assert.equal(h.calls.some(c=>typeof c==='string'&&(/official:|rtc:|native-capture/).test(c)),false);
 assert.equal(h.window.__zapCaptureSourceId,'screen:7:0');assert.equal(h.window.__zapCaptureOptions.height,1080);assert.equal(h.window.__zapCaptureOptions.audio,false);
 assert.ok(h.events.some(e=>e.type==='RTC_CONNECTION_VIDEO'&&e.streamId==='zap:guild:99:123:10'));
 assert.equal(h.streams.getStreamForUser('10','99').channelId,'123');
});
test('start before settings also waits for the actual native selection',async()=>{
 const h=harness();h.dispatcher.dispatch(start);await tick();assert.equal(h.calls.some(c=>Array.isArray(c)&&c[0]==='capture'),false);
 h.dispatcher.dispatch({type:'MEDIA_ENGINE_SET_GO_LIVE_SOURCE',settings});await tick();assert.equal(h.service.localStream,h.stream);
});
test('native video component receives custom MediaStream; camera stays native',async()=>{
 const h=harness();h.dispatcher.dispatch(start);h.dispatcher.dispatch({type:'MEDIA_ENGINE_SET_GO_LIVE_SOURCE',settings});await tick();
 const Component=h.media.getVideoComponent();const camera=Component({streamId:'official-camera'});assert.equal(camera.type,h.NativeVideo);
 const video=Component({streamId:'zap:guild:99:123:10'});assert.equal(video.props.entry.stream,h.stream);
 const element=video.type(video.props);assert.equal(element.type,'video');assert.equal(element.props.controls,undefined);
});
test('native quality and stop controls update the capture and remove stream metadata',async()=>{
 const h=harness();h.dispatcher.dispatch(start);h.dispatcher.dispatch({type:'MEDIA_ENGINE_SET_GO_LIVE_SOURCE',settings});await tick();
 h.dispatcher.dispatch({type:'STREAM_UPDATE_SETTINGS',resolution:720,frameRate:30});await tick();assert.ok(h.calls.some(c=>Array.isArray(c)&&c[0]==='constraints'&&c[1].height.ideal===720));
 h.dispatcher.dispatch({type:'STREAM_STOP',streamKey:'guild:99:123:10'});await tick();assert.equal(h.service.localStream,null);assert.equal(h.streams.getStreamForUser('10','99'),null);
 assert.equal(h.calls.includes('official:STREAM_STOP'),false);
});
test('missing native hooks fail closed, preserving the ordinary voice path',()=>{
 const h=harness({compatible:false});assert.equal(h.result.integration.nativeAdapter,false);assert.equal(h.click(),3);
 h.dispatcher.dispatch(start);assert.equal(h.calls.includes('official:STREAM_START'),false);
 h.dispatcher.dispatch({type:'VOICE_STATE_UPDATE'});assert.ok(h.calls.includes('official:VOICE_STATE_UPDATE'));
});
test('viewer receives native stream metadata and native close clears reception',async()=>{
 const h=harness();h.service.activeChannelId='123';h.service.broadcasterUserId='20';h.service.emit('remoteStream',h.stream);await tick();
 assert.equal(h.streams.getStreamForUser('20','99').ownerId,'20');
 h.dispatcher.dispatch({type:'STREAM_WATCH',streamKey:'guild:99:123:20'});await tick();assert.equal(h.calls.includes('official:STREAM_WATCH'),false);
 h.dispatcher.dispatch({type:'STREAM_CLOSE',streamKey:'guild:99:123:20'});await tick();assert.ok(h.calls.includes('stopViewing'));assert.equal(h.streams.getStreamForUser('20','99').ownerId,'20');
 h.dispatcher.dispatch({type:'STREAM_WATCH',streamKey:'guild:99:123:20'});await tick();assert.ok(h.calls.some(c=>Array.isArray(c)&&c[0]==='subscribe'));
 h.service.emit('streamStopped');await tick();assert.equal(h.streams.getStreamForUser('20','99'),null);
});
test('injection is idempotent and leaving voice stops capture',async()=>{
 const h=harness();const original=h.media.getVideoComponent;h.rerun();assert.equal(h.media.getVideoComponent,original);
 h.dispatcher.dispatch(start);h.dispatcher.dispatch({type:'MEDIA_ENGINE_SET_GO_LIVE_SOURCE',settings});await tick();h.setChannel(null);h.rerun();await tick();assert.equal(h.service.localStream,null);
});
