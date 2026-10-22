const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function service(environment = {}) {
  class PC {
    constructor() { this.connectionState = 'new'; this.remoteDescription = null; this.candidates = []; }
    addTrack() {} close() { this.connectionState = 'closed'; }
    async createOffer() { return { type: 'offer', sdp: 'native-sdp' }; }
    async createAnswer() { return { type: 'answer', sdp: 'native-answer' }; }
    async setLocalDescription(sdp) { this.localDescription = sdp; }
    async setRemoteDescription(sdp) { this.remoteDescription = sdp; }
    async addIceCandidate(c) { assert.ok(this.remoteDescription); this.candidates.push(c); }
    getSenders() { return []; }
  }
  const context = { console, setTimeout, clearTimeout, setInterval, clearInterval, RTCPeerConnection: PC,
    RTCSessionDescription: function(x) { return x; }, WebSocket: { OPEN: 1, CONNECTING: 0 }, ...environment };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(__dirname + '/webrtcService.js', 'utf8').replace('export class WebRTCService', 'globalThis.Service = class WebRTCService'), context);
  const s = new context.Service();
  s.messages = []; s.sendSignal = msg => s.messages.push(msg);
  s.connectSignaling = async () => true;
  return s;
}
test('concurrent start captures once and announces no shared offer', async () => {
  const s = service(); let captures = 0;
  const track = { readyState: 'live', stop() {} };
  s.startScreenCapture = async () => { captures++; await Promise.resolve(); return s.localStream = { getVideoTracks: () => [track], getTracks: () => [track] }; };
  await Promise.all([s.startBroadcast('room', 'host'), s.startBroadcast('room', 'host')]);
  assert.equal(captures, 1); assert.equal(s.messages.length, 1);
  assert.equal(s.messages[0].protocolVersion, 2); assert.equal(s.messages[0].sdpOffer, undefined);
  await s.createBroadcasterPeerConnection('viewer1'); await s.createBroadcasterPeerConnection('viewer2');
  assert.equal(s.broadcasterPcs.size, 2);
  assert.notEqual(s.broadcasterPcs.get('viewer1'), s.broadcasterPcs.get('viewer2'));
});

test('native fallback uses getDesktopCaptureSources and honors selected window', async () => {
  let captured;
  const stream = { getVideoTracks: () => [{ addEventListener() {} }] };
  const s = service({
    window: { __zapCaptureSourceId: 'window:42:0', DiscordNative: { desktopCapture: {
      async getDesktopCaptureSources() { return [{id:'screen:0:0'}, {id:'window:42:0'}]; }
    } } },
    navigator: { mediaDevices: {
      async getDisplayMedia() { throw new Error('display unavailable'); },
      async getUserMedia(constraints) { captured = constraints; return stream; }
    } }
  });
  assert.equal(await s.startScreenCapture(), stream);
  assert.equal(captured.video.mandatory.chromeMediaSourceId, 'window:42:0');
});

test('capture failure preserves original display error', async () => {
  const s = service({ window: {__zapCaptureSourceId:'screen:0:0'}, navigator: {mediaDevices:{async getDisplayMedia(){throw new Error('display denied');}}} });
  await assert.rejects(s.startScreenCapture(), /getDisplayMedia: Error: display denied/);
});

test('desktop audio failure retries video only and emits a warning', async () => {
  const requests = [], warnings = [];
  const stream = { getVideoTracks: () => [{addEventListener(){}}] };
  const s = service({window:{__zapCaptureSourceId:'screen:0:0',DiscordNative:{desktopCapture:{async getDesktopCaptureSources(){return [{id:'screen:0:0'}];}}}},navigator:{mediaDevices:{async getUserMedia(request){requests.push(request); if(request.audio)throw Error('loopback unavailable'); return stream;}}}});
  s.on('statusChange', event => warnings.push(event));
  assert.equal(await s.startScreenCapture(),stream);
  assert.equal(requests.length,2); assert.equal(requests[1].audio,false);
  assert.equal(warnings[0].status,'warning'); assert.match(warnings[0].message,/sem áudio/);
});

test('missing selected source never captures a different screen', async () => {
  let captured = false;
  const s = service({ window: {__zapCaptureSourceId:'window:missing',DiscordNative:{desktopCapture:{async getDesktopCaptureSources(){return [{id:'screen:0:0'}];}}}},navigator:{mediaDevices:{async getUserMedia(){captured=true;}}} });
  await assert.rejects(s.startScreenCapture(), /selecionada/);
  assert.equal(captured,false);
});
test('ICE received before offer is queued and flushed after remote description', async () => {
  const s = service(); s.activeChannelId = 'room'; s.currentUserId = 'viewer';
  await s.handleSignalingMessage(JSON.stringify({ type: 'stream:ice-candidate', channelId: 'room', fromUserId: 'host', candidate: { candidate: 'early' } }));
  assert.equal(s.pendingIce.get('host').length, 1);
  await s.handleIncomingOffer({ type: 'offer', sdp: 'native' }, 'host');
  assert.equal(s.viewerPc.candidates.length, 1); assert.equal(s.pendingIce.size, 0);
});
test('viewer leaving does not announce broadcaster stop; wrong-channel signals ignored', async () => {
  const s = service(); s.activeChannelId = 'room'; s.currentUserId = 'viewer';
  await s.handleSignalingMessage(JSON.stringify({ type: 'stream:ice-candidate', channelId: 'other', fromUserId: 'host', candidate: {} }));
  assert.equal(s.pendingIce.size, 0); s.leaveChannel();
  assert.equal(s.messages.filter(x => x.type === 'stream:stop').length, 0);
});
test('stop during capture cancels late announcement', async () => {
  const s = service(); let complete; let stopped = false; let began;
  const started = new Promise(resolve => { began = resolve; });
  s.startScreenCapture = () => new Promise(resolve => { complete = () => resolve(s.localStream = { getTracks: () => [{ stop() { stopped = true; } }] }); began(); });
  const pending = s.startBroadcast('room', 'host'); await started;
  s.stopBroadcast(); complete(); await assert.rejects(pending, /cancelada/);
  assert.equal(stopped, true); assert.equal(s.messages.length, 0);
});

test('no selection cannot silently capture the first monitor', async () => {
  let captured=false;
  const s=service({window:{},navigator:{mediaDevices:{async getDisplayMedia(){captured=true;}}}});
  await assert.rejects(s.startScreenCapture(), /Selecione/); assert.equal(captured,false);
});
test('duplicate subscriber does not tear down a negotiating peer', async () => {
  const s=service(); s.localStream={getTracks:()=>[]};
  await s.createBroadcasterPeerConnection('viewer'); const pc=s.broadcasterPcs.get('viewer');
  await s.createBroadcasterPeerConnection('viewer');
  assert.equal(s.broadcasterPcs.get('viewer'),pc);
  assert.equal(s.messages.filter(m=>m.type==='stream:offer').length,1);
  s.stopBroadcast(); assert.equal(s.peerTimers.size,0);
});
test('channel change resumes viewing; manually stopped viewer ignores late offers', async () => {
  const s=service(); s.activeChannelId='old'; await s.subscribeToStream('new','viewer');
  assert.equal(s.viewingPaused,false);
  s.stopViewing(); await s.handleIncomingOffer({type:'offer',sdp:'late'},'host');
  assert.equal(s.viewerPc,null);
});
test('failed peer gives explicit network error and removes dead player', async () => {
  const s=service();const errors=[],stops=[];
  s.on('statusChange',e=>errors.push(e)); s.on('streamStopped',e=>stops.push(e));
  await s.handleIncomingOffer({type:'offer',sdp:'offer'},'host');
  const pc=s.viewerPc; pc.connectionState='failed';pc.onconnectionstatechange();
  assert.equal(s.viewerPc,null);assert.equal(stops.length,1);
  assert.match(errors.at(-1).message,/TURN/);assert.equal(s.peerTimers.size,0);
});
