import test from 'node:test';
import assert from 'node:assert/strict';
import { commitLocalState, readUpdateLock, releaseUpdateLock } from '../dist/update-storage.mjs';

const DATA = 'homework-clock-demo-v1';
const LOCK = 'homework-clock-update-lock';
const now = 1793512800000;
const lock = (overrides = {}) => ({ transactionId: 'update-a', version: 'build-b', expiresAt: now + 45000, ...overrides });

function memory(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [], removes = [];
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => { writes.push([key, value]); values.set(key, value); },
    removeItem: key => { removes.push(key); values.delete(key); },
  };
  return { storage, values, writes, removes };
}

test('a stale page cannot overwrite another page after an update is cancelled', () => {
  const original = JSON.stringify({ tasks: ['语文预习'], settings: { voices: {} } });
  const s = memory({ [DATA]: original, [LOCK]: JSON.stringify(lock()) });
  const pageA = JSON.parse(original), pageB = JSON.parse(original);
  pageB.tasks.push('数学试卷'); pageB.settings.voices.complete = 'data:audio/mp4;base64,dm9pY2U=';
  const savedB = commitLocalState({ storage: s.storage, key: DATA, expectedRaw: original, value: pageB });
  assert.equal(savedB.ok, true);
  releaseUpdateLock(s.storage, LOCK, 'update-a');
  pageA.tasks.push('旧窗口草稿');
  const rejectedA = commitLocalState({ storage: s.storage, key: DATA, expectedRaw: original, value: pageA });
  assert.deepEqual(rejectedA, { ok: false, reason: 'conflict', currentRaw: savedB.raw });
  assert.equal(s.storage.getItem(DATA), savedB.raw);
  assert.equal(s.writes.length, 1);
  assert.equal(JSON.parse(s.storage.getItem(DATA)).settings.voices.complete, pageB.settings.voices.complete);
});

test('first save accepts only a genuinely empty key and successful saves return exact raw JSON', () => {
  const s = memory({ untouched: 'keep' });
  const value = { tasks: [{ title: '阅读' }], history: [] };
  const result = commitLocalState({ storage: s.storage, key: DATA, expectedRaw: null, value });
  assert.deepEqual(result, { ok: true, raw: JSON.stringify(value) });
  assert.equal(s.storage.getItem(DATA), result.raw);
  assert.equal(s.storage.getItem('untouched'), 'keep');
  assert.deepEqual(s.writes.map(([key]) => key), [DATA]);
  const second = commitLocalState({ storage: s.storage, key: DATA, expectedRaw: null, value: { tasks: [] } });
  assert.equal(second.reason, 'conflict');
  assert.equal(s.writes.length, 1);
});

test('a 1 MiB recording and the live session survive the checkpoint byte for byte', () => {
  const bytes = Buffer.alloc(1024 * 1024, 0xa5);
  const voice = `data:audio/mp4;codecs=mp4a.40.2;base64,${bytes.toString('base64')}`;
  const value = { tasks: [{ id: 'math', completed: false }], history: [], settings: { voices: { start: voice } }, session: { startedAt: now, deadlineMs: now + 600000, paused: false } };
  const before = structuredClone(value);
  const s = memory();
  const result = commitLocalState({ storage: s.storage, key: DATA, expectedRaw: null, value });
  assert.equal(result.ok, true);
  const restored = JSON.parse(s.storage.getItem(DATA));
  assert.equal(restored.settings.voices.start, voice);
  assert.deepEqual(Buffer.from(restored.settings.voices.start.split(',')[1], 'base64'), bytes);
  assert.deepEqual(restored.session, before.session);
  assert.deepEqual(value, before);
});

test('quota and get failures never report a successful checkpoint or erase the old value', () => {
  const original = JSON.stringify({ tasks: ['原安排'] });
  const s = memory({ [DATA]: original, untouched: 'keep' });
  const quota = { ...s.storage, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
  assert.deepEqual(commitLocalState({ storage: quota, key: DATA, expectedRaw: original, value: {} }), { ok: false, reason: 'storage' });
  assert.equal(s.storage.getItem(DATA), original);
  let writes = 0;
  const unreadable = { getItem: () => { throw new Error('denied'); }, setItem: () => writes++ };
  assert.deepEqual(commitLocalState({ storage: unreadable, key: DATA, expectedRaw: original, value: {} }), { ok: false, reason: 'storage' });
  assert.equal(writes, 0);
  assert.deepEqual([...s.values], [[DATA, original], ['untouched', 'keep']]);
  assert.equal(s.removes.length, 0);
});

test('serialization failures never write, and conflicts are checked before serialization', () => {
  const s = memory({ [DATA]: 'existing' });
  const cyclic = {}; cyclic.self = cyclic;
  for (const value of [cyclic, { count: 1n }, undefined, () => {}]) {
    assert.deepEqual(commitLocalState({ storage: s.storage, key: DATA, expectedRaw: 'existing', value }), { ok: false, reason: 'storage' });
  }
  let serialized = false;
  const value = { toJSON() { serialized = true; throw new Error('not needed'); } };
  assert.deepEqual(commitLocalState({ storage: s.storage, key: DATA, expectedRaw: 'stale', value }), { ok: false, reason: 'conflict', currentRaw: 'existing' });
  assert.equal(serialized, false);
  assert.equal(s.writes.length, 0);
  assert.equal(s.storage.getItem(DATA), 'existing');
});

test('only valid update barriers within sixty seconds are read, without storage mutation', () => {
  const s = memory({ [LOCK]: JSON.stringify(lock()), [DATA]: 'keep' });
  assert.deepEqual(readUpdateLock({ storage: s.storage, key: LOCK, now }), lock());
  for (const expiresAt of [now + 1, now + 60000]) {
    s.values.set(LOCK, JSON.stringify(lock({ expiresAt })));
    assert.equal(readUpdateLock({ storage: s.storage, key: LOCK, now }).expiresAt, expiresAt);
  }
  assert.equal(s.writes.length, 0);
  assert.equal(s.removes.length, 0);
  assert.equal(s.storage.getItem(DATA), 'keep');
});

test('expired, distant, malformed or illegal transaction/version locks fail closed as absent', () => {
  const s = memory();
  const invalid = [null, [], false, {}, 'lock', lock({ expiresAt: now }), lock({ expiresAt: now - 1 }), lock({ expiresAt: now + 60001 }), lock({ expiresAt: now + 0.5 }), lock({ expiresAt: String(now + 1000) }), lock({ transactionId: '' }), lock({ transactionId: ' ' }), lock({ transactionId: 'has space' }), lock({ transactionId: 'line\nbreak' }), lock({ transactionId: false }), lock({ transactionId: 'x'.repeat(257) }), lock({ version: '' }), lock({ version: 'unsafe\u0000version' }), lock({ version: 1 })];
  for (const value of invalid) {
    s.values.set(LOCK, JSON.stringify(value));
    assert.equal(readUpdateLock({ storage: s.storage, key: LOCK, now }), null, JSON.stringify(value));
  }
  s.values.set(LOCK, 'not json');
  assert.equal(readUpdateLock({ storage: s.storage, key: LOCK, now }), null);
  s.values.delete(LOCK);
  assert.equal(readUpdateLock({ storage: s.storage, key: LOCK, now }), null);
  s.values.set(LOCK, JSON.stringify(lock()));
  for (const invalidNow of [NaN, Infinity, undefined, null, 'now']) {
    if (invalidNow === undefined) continue; // The public default deliberately uses Date.now().
    assert.equal(readUpdateLock({ storage: s.storage, key: LOCK, now: invalidNow }), null);
  }
  assert.equal(s.writes.length, 0);
  assert.equal(s.removes.length, 0);
});

test('release removes only the matching transaction, including its expired barrier', () => {
  const s = memory({ [LOCK]: JSON.stringify(lock()), [DATA]: 'keep', untouched: 'keep too' });
  for (const wrong of ['update-other', '', undefined, null, 42, 'invalid id']) {
    releaseUpdateLock(s.storage, LOCK, wrong);
    assert.notEqual(s.storage.getItem(LOCK), null);
  }
  assert.equal(s.removes.length, 0);
  releaseUpdateLock(s.storage, LOCK, 'update-a');
  assert.equal(s.storage.getItem(LOCK), null);
  assert.deepEqual(s.removes, [LOCK]);
  s.values.set(LOCK, JSON.stringify(lock({ expiresAt: now - 1 })));
  releaseUpdateLock(s.storage, LOCK, 'update-a');
  assert.equal(s.storage.getItem(LOCK), null);
  assert.equal(s.storage.getItem(DATA), 'keep');
  assert.equal(s.storage.getItem('untouched'), 'keep too');
  assert.equal(s.writes.length, 0);
});

test('malformed barriers and denied storage are harmless to read or release', () => {
  const s = memory({ [LOCK]: '{bad json', [DATA]: 'keep' });
  releaseUpdateLock(s.storage, LOCK, 'update-a');
  assert.equal(s.storage.getItem(LOCK), '{bad json');
  const denied = { getItem() { throw new Error('denied'); }, removeItem() { assert.fail('must not remove'); } };
  assert.equal(readUpdateLock({ storage: denied, key: LOCK, now }), null);
  assert.doesNotThrow(() => releaseUpdateLock(denied, LOCK, 'update-a'));
  const cannotRemove = { getItem: () => JSON.stringify(lock()), removeItem: () => { throw new Error('denied'); } };
  assert.doesNotThrow(() => releaseUpdateLock(cannotRemove, LOCK, 'update-a'));
  assert.equal(s.storage.getItem(DATA), 'keep');
});
