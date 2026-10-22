const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('events sent through a previously bound dispatch reach mod; late user store is refreshed', async () => {
  const listeners = new Map(), overrides = {}, calls = [];
  const dispatcher = {
    _actionHandlers: {},
    subscribe(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
    dispatch(event) {
      if (event.type === 'APEX_EXPERIMENT_OVERRIDE_CREATE') overrides[event.experimentName] = { variantId: event.variantId };
      for (const fn of listeners.get(event.type) || []) fn(event);
    }
  };
  const savedDispatch = dispatcher.dispatch.bind(dispatcher);
  const modules = { a: { exports: { dispatcher, store: {getName: () => 'ApexExperimentStore', getClientOverrides: () => overrides } } } };
  const chunks = [];
  chunks.push = entry => { Array.prototype.push.call(chunks, entry); entry[2]({ c: modules, m: {} }); };
  const window = { webpackChunkdiscord_app: chunks, __zapWebRTCInstance: {
    startBroadcast: async (...args) => { calls.push(args); return {}; }
  } };
  const context = vm.createContext({ window, console });
  const source = fs.readFileSync(__dirname + '/renderer.js', 'utf8').replace('__RAFA_ENABLED__', 'true');
  vm.runInContext(source, context);
  modules.user = { exports: { getName: () => 'UserStore', getCurrentUser: () => ({ id: 'user' }) } };
  modules.channel = { exports: { getVoiceChannelId: () => '123' } };
  vm.runInContext(source, context);
  savedDispatch({ type: 'MEDIA_ENGINE_SET_GO_LIVE_SOURCE', sourceId: 'screen:1:0' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.deepEqual(Array.from(calls[0]), ['123', 'user']);
  assert.equal(window.__zapCaptureSourceId, 'screen:1:0');
  assert.equal(listeners.get('MEDIA_ENGINE_SET_GO_LIVE_SOURCE').length, 1);
});

test('offline screen-share click is cancelled and gives visible feedback', () => {
  let click, notice, attempts = 0;
  const document = {
    head: { appendChild() {} }, body: { appendChild(el) { notice = el; } },
    getElementById() { return null; }, querySelectorAll() { return []; },
    createElement() { return { style: {}, setAttribute() {}, addEventListener() {} }; },
    addEventListener(type, fn) { if (type === 'click') click = fn; }
  };
  const overrides = {};
  const dispatcher = { _actionHandlers: {}, subscribe() {}, dispatch(e) { overrides[e.experimentName] = {variantId:e.variantId}; } };
  const chunks = [];
  chunks.push = entry => { Array.prototype.push.call(chunks,entry); entry[2]({m:{},c:{a:{exports:{dispatcher,store:{getName:()=> 'ApexExperimentStore',getClientOverrides:()=>overrides}}}}}); };
  const window = {webpackChunkdiscord_app:chunks,__zapWebRTCInstance:{ws:{readyState:0},connectSignaling(){ attempts++; }}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/renderer.js','utf8').replace('__RAFA_ENABLED__','true'),{window,document,console});
  let prevented = 0;
  click({target:{closest:()=>({})},preventDefault(){prevented++;},stopPropagation(){prevented++;},stopImmediatePropagation(){prevented++;}});
  assert.equal(prevented,3); assert.equal(attempts,1); assert.match(notice.textContent,/desconectado/);
});
