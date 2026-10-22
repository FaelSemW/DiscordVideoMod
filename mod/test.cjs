const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const template = fs.readFileSync(require('node:path').join(__dirname, 'renderer.js'), 'utf8');
const overrides = {}, actions = [];
const dispatcher = { _actionHandlers: {}, dispatch(action) {
  actions.push(action);
  if (action.type.endsWith('CREATE')) overrides[action.experimentName] = { variantId: action.variantId };
  else delete overrides[action.experimentName];
} };
const exportsObject = {};
Object.defineProperty(exportsObject, 'store', { enumerable: true, get: () => ({getName: () => 'ApexExperimentStore', getClientOverrides: () => overrides}) });
Object.defineProperty(exportsObject, 'dispatcher', { enumerable: true, get: () => dispatcher });
const chunks = [];
chunks.push = function(entry) {
  Array.prototype.push.call(this, entry);
  entry[2]({c: {one: {exports: exportsObject}}, m: {one: () => '2026-08-video-guard'}});
  entry[2]({c: {}, m: {}}); // Last runtime is not necessarily the application runtime.
};
const context = {window: {webpackChunkdiscord_app: chunks}};
const run = enabled => vm.runInNewContext(template.replace('__RAFA_ENABLED__', String(enabled)), context);
assert.equal(run(true).status, 'applied');
assert.equal(run(true).verified, true);
assert.equal(actions.length, 1, 'idempotent application');
assert.equal(chunks.length, 0, 'temporary chunk removed');
assert.equal(run(false).status, 'disabled');
assert.equal(Object.keys(overrides).length, 0);
assert.equal(vm.runInNewContext(template.replace('__RAFA_ENABLED__','true'), {window: {}}).status, 'waiting-webpack');
console.log('PASS: apply, verify, idempotence, disable, lazy exports, missing runtime');
