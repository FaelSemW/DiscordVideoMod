const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/renderer.js','utf8').replace('__RAFA_ENABLED__','true');
function harness(online=true){
  const elements=new Map(),events={},subscriptions=[],calls=[];
  function element(tag){return {tagName:tag,style:{},children:[],isConnected:false,value:'',setAttribute(){},addEventListener(){},appendChild(child){this.children.push(child);child.parentElement=this;child.isConnected=true;if(child.id)elements.set(child.id,child);if(tag==='select'&&!this.value)this.value=child.value;},remove(){this.isConnected=false;if(this.id)elements.delete(this.id);},play:async()=>{}};}
  const document={body:element('body'),head:element('head'),createElement:element,getElementById:id=>elements.get(id),querySelectorAll:()=>[],addEventListener:(type,fn)=>events[type]=fn};
  let channel='123';const overrides={};
  const dispatcher={_actionHandlers:{},subscribe:(type,fn)=>subscriptions.push({type,fn}),dispatch:e=>{overrides[e.experimentName]={variantId:e.variantId};}};
  const chunks=[];chunks.push=e=>{Array.prototype.push.call(chunks,e);e[2]({m:{},c:{a:{exports:{dispatcher,store:{getName:()=> 'ApexExperimentStore',getClientOverrides:()=>overrides},user:{getName:()=> 'UserStore',getCurrentUser:()=>({id:'user'})},channel:{getVoiceChannelId:()=>channel}}}}});};
  const service={ws:{readyState:online?1:0},connectSignaling(){calls.push('connect');},async startBroadcast(...args){calls.push(args);return{};},stopBroadcast(){calls.push('stop');}};
  const window={webpackChunkdiscord_app:chunks,__zapWebRTCInstance:service,DiscordNative:{desktopCapture:{async getDesktopCaptureSources(){return[{id:'screen:7:0',name:'Tela escolhida'}];}}}};
  vm.runInNewContext(source,{window,document,console});
  function clickNative(){let prevented=0;events.click({target:{closest:()=>({})},preventDefault(){prevented++;},stopPropagation(){prevented++;},stopImmediatePropagation(){prevented++;}});return prevented;}
  return{window,elements,calls,subscriptions,clickNative,setChannel:id=>channel=id};
}
test('offline native click is stopped before Discord and explains failure',()=>{
 const h=harness(false);assert.equal(h.clickNative(),3);assert.deepEqual(h.calls,['connect']);assert.match(h.elements.get('zap-stream-error').textContent,/desconectado/);
});
test('online native click opens explicit picker without starting native Go Live or automatic capture',async()=>{
 const h=harness();assert.equal(h.clickNative(),3);await new Promise(setImmediate);
 assert.equal(h.calls.length,0);assert.ok(h.elements.get('zap-capture-picker'));
 assert.equal(h.subscriptions.some(s=>['STREAM_START','MEDIA_ENGINE_SET_GO_LIVE_SOURCE','STREAM_WATCH'].includes(s.type)),false);
 const picker=h.elements.get('zap-capture-picker');const choice=picker.children.find(c=>c.textContent==='Tela escolhida');await choice.onclick();
 assert.deepEqual(Array.from(h.calls[0]),['123','user']);assert.equal(h.window.__zapCaptureSourceId,'screen:7:0');
 assert.equal(h.window.__zapCaptureOptions.width,1920);assert.equal(h.window.__zapCaptureOptions.frameRate,60);
 assert.ok(h.elements.get('zap-custom-video-player'));
});
test('changing channel during source selection cancels capture',async()=>{
 const h=harness();h.clickNative();await new Promise(setImmediate);h.setChannel('456');
 await h.elements.get('zap-capture-picker').children.find(c=>c.textContent==='Tela escolhida').onclick();
 assert.equal(h.calls.length,0);assert.match(h.elements.get('zap-stream-error').textContent,/canal mudou/);
});
