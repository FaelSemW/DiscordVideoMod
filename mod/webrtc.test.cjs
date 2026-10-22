const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function service() {
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
    RTCSessionDescription: function(x) { return x; }, WebSocket: { OPEN: 1, CONNECTING: 0 } };
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
