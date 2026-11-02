import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateSession } from '../dist/update-session.mjs';

const baseURL = 'https://homework.example/student/index.html?mode=local';
const scriptURL = 'https://homework.example/student/sw.js';
const tick = () => new Promise(resolve => setImmediate(resolve));

class Worker extends EventTarget {
  constructor(url = scriptURL) { super(); this.scriptURL = url; this.state = 'installed'; }
  postMessage() {}
  setState(state) { this.state = state; this.dispatchEvent(new Event('statechange')); }
}

function setup(t, options = {}) {
  const serviceWorker = new EventTarget();
  const worker = new Worker();
  const locks = [], unlocks = [], reloads = [];
  let checks = 0, saves = 0;
  const guard = options.guard || { check: () => { checks++; return { ok: true }; }, prepare: async () => { saves++; return { ok: true }; } };
  const session = createUpdateSession({ serviceWorker, guard, baseURL, timeoutMs: options.timeoutMs, onLock: () => locks.push(true), onUnlock: result => unlocks.push(result), onReload: result => reloads.push(result), ...options });
  t.after(() => session.destroy());
  function message(type, { source = worker, transactionId = 'transaction-a', version = 'build-b', channel = true, marker = 'homework-clock-update', ...extra } = {}) {
    const responses = [];
    const event = new Event('message');
    Object.assign(event, { source, data: { source: marker, type, transactionId, version, ...extra }, ports: channel ? [{ postMessage: result => responses.push(result) }] : [] });
    serviceWorker.dispatchEvent(event);
    return responses;
  }
  const activate = (properties = {}) => message('ACTIVATED', { marker: 'homework-clock-offline', channel: false, ...properties });
  const controller = candidate => { serviceWorker.controller = candidate; serviceWorker.dispatchEvent(new Event('controllerchange')); };
  return { serviceWorker, worker, session, guard, locks, unlocks, reloads, message, activate, controller, get checks() { return checks; }, get saves() { return saves; } };
}

test('prepare freezes once without saving, repeated commit saves once, matching activation reloads once', async t => {
  const s = setup(t);
  assert.deepEqual(s.message('PREPARE_UPDATE'), [{ ready: true, protocol: 1 }]);
  assert.deepEqual(s.message('PREPARE_UPDATE'), [{ ready: true, protocol: 1 }]);
  assert.equal(s.session.isLocked(), true);
  assert.equal(s.locks.length, 1);
  assert.equal(s.checks, 1);
  assert.equal(s.saves, 0);
  const first = s.message('COMMIT_UPDATE'), second = s.message('COMMIT_UPDATE');
  await tick();
  assert.equal(s.saves, 1);
  assert.deepEqual(first, [{ ready: true, protocol: 1 }]);
  assert.deepEqual(second, first);
  s.worker.setState('activated'); s.activate(); s.activate(); s.controller(s.worker);
  assert.deepEqual(s.reloads, [{ transactionId: 'transaction-a', version: 'build-b' }]);
  assert.equal(s.unlocks.length, 0);
  assert.equal(s.session.isLocked(), true, 'old page stays frozen until navigation');
});

test('another prepared window reloads after the initiator commits without saving its stale snapshot', t => {
  const s = setup(t);
  s.message('PREPARE_UPDATE');
  s.worker.setState('activated'); s.activate();
  assert.equal(s.saves, 0);
  assert.equal(s.reloads.length, 1);
});

test('dirty or busy guard refuses preparation without freezing or writing', t => {
  for (const reason of ['recording', 'settings-draft', 'task-editing']) {
    const s = setup(t, { guard: { check: () => ({ ok: false, message: reason }), prepare: () => assert.fail('unsafe save') } });
    assert.deepEqual(s.message('PREPARE_UPDATE'), [{ ready: false, protocol: 1, message: reason }]);
    assert.equal(s.session.isLocked(), false);
    assert.equal(s.locks.length, 0);
  }
});

test('untrusted worker, wrong scope/script, malformed request or absent reply channel cannot lock', t => {
  const s = setup(t);
  for (const source of [undefined, null, {}, new Worker('https://other.example/student/sw.js'), new Worker('https://homework.example/other/sw.js'), new Worker(scriptURL + '?other=1'), { scriptURL }]) {
    // Explicit undefined in message options uses the fixture default, so use null.
    if (source === undefined) continue;
    assert.deepEqual(s.message('PREPARE_UPDATE', { source }), []);
  }
  assert.deepEqual(s.message('PREPARE_UPDATE', { channel: false }), []);
  assert.deepEqual(s.message('PREPARE_UPDATE', { marker: 'untrusted' }), []);
  for (const properties of [{ transactionId: '' }, { transactionId: null }, { version: '' }, { version: 'x'.repeat(257) }]) {
    assert.equal(s.message('PREPARE_UPDATE', properties)[0].ready, false);
  }
  assert.equal(s.session.isLocked(), false);
});

test('a different transaction, worker or version cannot commit, cancel or activate the locked page', async t => {
  const s = setup(t);
  s.message('PREPARE_UPDATE');
  s.worker.state = 'activated'; // Browser statechange can be queued after a message.
  for (const options of [{ transactionId: 'other' }, { version: 'older' }, { source: new Worker() }]) {
    assert.equal(s.message('PREPARE_UPDATE', options)[0].ready, false);
    const response = s.message('COMMIT_UPDATE', options); await tick();
    assert.equal(response[0].ready, false);
    assert.equal(s.message('CANCEL_UPDATE', options)[0].ready, false);
    s.activate(options);
  }
  assert.equal(s.saves, 0);
  assert.equal(s.reloads.length, 0);
  assert.equal(s.session.isLocked(), true);
  s.activate();
  assert.equal(s.reloads.length, 1, 'only the matching activation message can wake this queued state');
  assert.equal(s.unlocks.length, 0);
});

test('portless cancellation broadcasts unlock only the same worker, transaction and version', t => {
  const s = setup(t);
  s.message('PREPARE_UPDATE');
  for (const options of [{ transactionId: 'other' }, { version: 'older' }, { source: new Worker() }, { marker: 'untrusted' }]) {
    assert.deepEqual(s.message('CANCEL_UPDATE', { ...options, channel: false }), []);
    assert.equal(s.session.isLocked(), true);
  }
  assert.deepEqual(s.message('CANCEL_UPDATE', { channel: false, message: '另一个窗口有未保存内容。' }), []);
  assert.equal(s.session.isLocked(), false);
  assert.deepEqual(s.unlocks, [{ reason: 'cancelled', message: '另一个窗口有未保存内容。' }]);
});

test('commit storage failure is returned and cannot reload even if an activation signal arrives', async t => {
  for (const prepare of [async () => ({ ok: false, message: 'storage full' }), async () => { throw new Error('quota'); }]) {
    const s = setup(t, { guard: { check: () => ({ ok: true }), prepare } });
    s.message('PREPARE_UPDATE');
    const response = s.message('COMMIT_UPDATE'); await tick();
    assert.equal(response[0].ready, false);
    assert.ok(response[0].message);
    s.worker.setState('activated'); s.activate(); s.controller(s.worker);
    assert.equal(s.reloads.length, 0);
    s.worker.setState('redundant');
    assert.equal(s.session.isLocked(), false);
  }
});

test('activation arriving while the worker is activating waits for its activated state', t => {
  const s = setup(t);
  s.message('PREPARE_UPDATE');
  s.worker.setState('activating'); s.activate();
  assert.equal(s.reloads.length, 0);
  s.worker.setState('activated');
  assert.equal(s.reloads.length, 1);
});

test('controllerchange fallback requires the exact locked worker and activated state', t => {
  const s = setup(t);
  const other = new Worker(); other.setState('activated');
  s.controller(other);
  assert.equal(s.reloads.length, 0, 'an unsolicited controllerchange never reloads');
  s.message('PREPARE_UPDATE'); s.controller(other);
  assert.equal(s.reloads.length, 0);
  s.controller(s.worker);
  assert.equal(s.reloads.length, 0, 'installed controller is insufficient');
  s.worker.setState('activated');
  assert.equal(s.reloads.length, 1);
});

test('timeout unfreezes with a useful message and ignores later activation', async t => {
  const s = setup(t, { timeoutMs: 10 });
  s.message('PREPARE_UPDATE');
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(s.session.isLocked(), false);
  assert.equal(s.unlocks[0].reason, 'timeout');
  assert.ok(s.unlocks[0].message.includes('重试'));
  s.worker.setState('activated'); s.activate();
  assert.equal(s.reloads.length, 0);
});

test('timeout checks an activated matching controller when controllerchange was missed', async t => {
  const s = setup(t, { timeoutMs: 10 });
  s.message('PREPARE_UPDATE');
  // Deliberately do not dispatch either browser event.
  s.serviceWorker.controller = s.worker; s.worker.state = 'activated';
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(s.reloads.length, 1);
  assert.equal(s.unlocks.length, 0);
});

test('slow activation stays frozen past the preparation timeout and reloads once the prepared worker activates', async t => {
  const s = setup(t, { timeoutMs: 10 });
  s.message('PREPARE_UPDATE');
  s.message('COMMIT_UPDATE'); await tick();
  s.worker.setState('activating');
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(s.session.isLocked(), true);
  assert.equal(s.unlocks.length, 0);
  assert.equal(s.message('CANCEL_UPDATE')[0].ready, false, 'late cancellation cannot resume old code');
  assert.equal(s.session.isLocked(), true);
  s.worker.setState('activated'); s.controller(s.worker);
  assert.equal(s.reloads.length, 1);
  assert.equal(s.unlocks.length, 0);
});

test('activation watchdog reloads if the final statechange and claim messages are both missed', async t => {
  const s = setup(t, { timeoutMs: 10 });
  s.message('PREPARE_UPDATE');
  s.worker.setState('activating');
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(s.session.isLocked(), true);
  s.worker.state = 'activated';
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(s.reloads.length, 1);
  assert.equal(s.unlocks.length, 0);
});

test('timeout notices activation even when its statechange event was missed', async t => {
  const s = setup(t, { timeoutMs: 10 });
  s.message('PREPARE_UPDATE');
  s.worker.state = 'activating';
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(s.session.isLocked(), true);
  assert.equal(s.unlocks.length, 0);
  s.worker.setState('activated'); s.activate();
  assert.equal(s.reloads.length, 1);
});

test('the exact prepared worker reloads when activated even if its intent and claim are missing', async t => {
  const s = setup(t, { timeoutMs: 10 });
  s.message('PREPARE_UPDATE');
  s.worker.setState('activating');
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(s.session.isLocked(), true);
  assert.equal(s.unlocks.length, 0);
  assert.equal(s.reloads.length, 0);
  // Evicting the activation-intent cache means the worker neither claims the
  // page nor sends a matching transactionId, but a new navigation is safe.
  s.worker.setState('activated');
  assert.equal(s.serviceWorker.controller, undefined);
  assert.equal(s.reloads.length, 1);
  assert.equal(s.unlocks.length, 0);
});

test('a failed activation restores the page when the target worker becomes redundant', async t => {
  const s = setup(t, { timeoutMs: 10 });
  s.message('PREPARE_UPDATE');
  s.worker.setState('activating');
  await new Promise(resolve => setTimeout(resolve, 25));
  s.worker.setState('redundant');
  assert.equal(s.session.isLocked(), false);
  assert.equal(s.reloads.length, 0);
  assert.equal(s.unlocks[0].reason, 'failed');
  assert.ok(s.unlocks[0].message.includes('重试'));
  s.activate();
  assert.equal(s.reloads.length, 0);
});

test('cancel during an asynchronous commit refuses its late acknowledgement and permits a fresh attempt', async t => {
  let finish;
  let saves = 0;
  const s = setup(t, { guard: { check: () => ({ ok: true }), prepare: () => { saves++; return new Promise(resolve => { finish = resolve; }); } } });
  s.message('PREPARE_UPDATE');
  const late = s.message('COMMIT_UPDATE');
  s.message('CANCEL_UPDATE');
  finish({ ok: true }); await tick();
  assert.equal(late[0].ready, false);
  s.activate(); assert.equal(s.reloads.length, 0);
  s.message('PREPARE_UPDATE', { transactionId: 'transaction-b' });
  assert.equal(s.session.isLocked(), true);
  assert.equal(saves, 1);
});

test('destroy removes listeners, clears the lock and does not react to later messages', async t => {
  const s = setup(t, { timeoutMs: 10 });
  s.message('PREPARE_UPDATE');
  s.session.destroy(); s.session.destroy();
  assert.equal(s.session.isLocked(), false);
  assert.deepEqual(s.unlocks, [{ reason: 'destroyed', message: '' }]);
  assert.deepEqual(s.message('PREPARE_UPDATE'), []);
  s.worker.setState('activated'); s.activate(); s.controller(s.worker);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(s.reloads.length, 0);
  assert.equal(s.unlocks.length, 1);
});

test('failed lock or reload callbacks recover the page rather than leaving it frozen', t => {
  const lock = setup(t, { onLock: () => { throw new Error('cannot freeze'); } });
  assert.equal(lock.message('PREPARE_UPDATE')[0].ready, false);
  assert.equal(lock.session.isLocked(), false);
  assert.equal(lock.unlocks[0].reason, 'failed');
  const reload = setup(t, { onReload: () => { throw new Error('navigation failed'); } });
  reload.message('PREPARE_UPDATE'); reload.worker.setState('activated'); reload.activate();
  assert.equal(reload.session.isLocked(), false);
  assert.equal(reload.unlocks[0].reason, 'failed');
});

test('constructor rejects missing coordination dependencies or an unusable base URL', () => {
  assert.throws(() => createUpdateSession(), TypeError);
  assert.throws(() => createUpdateSession({ serviceWorker: new EventTarget(), guard: {} }), TypeError);
  assert.throws(() => createUpdateSession({ serviceWorker: new EventTarget(), guard: { check() {}, prepare() {} }, baseURL: 'relative' }), TypeError);
});
