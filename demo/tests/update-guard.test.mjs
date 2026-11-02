import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateGuard, hasSettingsDraft } from '../dist/update-guard.mjs';
import { createSession, pauseSession, normalizeSession, sessionElapsedMs } from '../dist/session-timer.mjs';

const audio = 'data:audio/mp4;codecs=mp4a.40.2;base64,dm9pY2U=';
const settings = () => ({ sound: true, pet: true, companion: 'solid', code: '小皮开工了', message: '先做一道', voice: null, voices: { start: audio } });
const at = time => Date.parse(`2026-11-01T${time}:00+08:00`);

test('each uncommitted operation blocks reload without touching persisted data', async () => {
  for (const [flag, reason] of Object.entries({ recordingBusy: 'recording', composing: 'composing', importing: 'importing', settingsDirty: 'settings-draft', taskEditing: 'task-editing', pendingAction: 'pending-action', stateConflict: 'state-conflict' })) {
    let writes = 0;
    const guard = createUpdateGuard({ getStatus: () => ({ [flag]: true }), persist: () => { writes++; return true; } });
    const probe = guard.check();
    assert.equal(probe.ok, false, flag);
    assert.equal(probe.reason, reason, flag);
    assert.ok(probe.message.includes('更新'), flag);
    assert.equal((await guard.prepare()).reason, reason, flag);
    assert.equal(writes, 0, flag);
  }
});

test('permission and processing are recording-busy until the caller clears them', async () => {
  let status = { recordingBusy: true };
  let writes = 0;
  const guard = createUpdateGuard({ getStatus: () => status, persist: () => { writes++; return true; } });
  assert.equal((await guard.prepare()).reason, 'recording');
  status = { settingsDirty: true };
  assert.equal((await guard.prepare()).reason, 'settings-draft');
  status = {};
  assert.deepEqual(await guard.prepare(), { ok: true });
  assert.equal(writes, 1);
});

test('storage rejection, thrown errors and unconfirmed saves refuse reload and can retry', async () => {
  let result = false;
  const guard = createUpdateGuard({ getStatus: () => ({}), persist: () => {
    if (result instanceof Error) throw result;
    return result;
  } });
  for (const value of [false, undefined, 1, new Error('quota'), Promise.reject(new Error('denied'))]) {
    result = value;
    const check = await guard.prepare();
    assert.equal(check.ok, false);
    assert.equal(check.reason, 'storage');
  }
  result = true;
  assert.deepEqual(await guard.prepare(), { ok: true });
});

test('missing or failed page status never permits a save or reload', async () => {
  assert.throws(() => createUpdateGuard(), TypeError);
  assert.throws(() => createUpdateGuard({ getStatus: () => ({}) }), TypeError);
  for (const status of [null, undefined, false, [], Promise.resolve({})]) {
    let writes = 0;
    const guard = createUpdateGuard({ getStatus: () => status, persist: () => { writes++; return true; } });
    assert.equal((await guard.prepare()).reason, 'unavailable');
    assert.equal(writes, 0);
  }
  const guard = createUpdateGuard({ getStatus: () => { throw new Error('not ready'); }, persist: () => assert.fail('unsafe save') });
  assert.equal((await guard.prepare()).reason, 'unavailable');
});

test('concurrent update requests share one save and newly entered drafts still block reload', async () => {
  let finishSave;
  let status = {};
  let writes = 0;
  const guard = createUpdateGuard({ getStatus: () => status, persist: () => {
    writes++;
    return new Promise(resolve => { finishSave = resolve; });
  } });
  const first = guard.prepare(), second = guard.prepare();
  assert.equal(first, second);
  assert.equal(writes, 1);
  status = { settingsDirty: true };
  finishSave(true);
  assert.equal((await first).reason, 'settings-draft');
  status = {};
  const retry = guard.prepare();
  assert.equal(writes, 2);
  finishSave(true);
  assert.deepEqual(await retry, { ok: true });
});

test('saved timer and recordings reload without stopping, duplicating credit or moving the deadline', async () => {
  const task = { id: 'math', date: '2026-11-01', type: 'study', start: '10:00', end: '12:00' };
  for (const paused of [false, true]) {
    const session = paused ? pauseSession(createSession(task, at('10:00')), task, at('10:20')) : createSession(task, at('10:00'));
    const state = { tasks: [task], settings: settings(), session, history: [] };
    const before = structuredClone(state);
    let stored;
    const guard = createUpdateGuard({ getStatus: () => ({}), persist: () => { stored = JSON.stringify(state); return true; } });
    assert.deepEqual(await guard.prepare(), { ok: true });
    assert.deepEqual(state, before, 'guard must not archive or stop the live timer');
    const restored = JSON.parse(stored);
    restored.session = normalizeSession(restored.session, task, at('10:30'));
    assert.equal(restored.settings.voices.start, audio);
    assert.equal(restored.session.deadlineMs, at('12:00'));
    assert.equal(sessionElapsedMs(restored.session, task, at('10:30')), (paused ? 25 : 30) * 60_000);
    assert.deepEqual(restored.history, []);
  }
});

test('settings text, switches, companion and every recording are compared without mutating drafts', () => {
  const saved = settings();
  const unchanged = structuredClone(saved);
  assert.equal(hasSettingsDraft(saved, unchanged), false);
  for (const change of [
    s => { s.code += '！'; }, s => { s.message += '加油'; }, s => { s.code += ' '; },
    s => { s.sound = false; }, s => { s.pet = false; }, s => { s.companion = 'original'; },
    s => { s.voices.start = null; }, s => { s.voices.complete = audio; },
  ]) {
    const draft = structuredClone(saved); change(draft);
    const before = structuredClone(draft);
    assert.equal(hasSettingsDraft(saved, draft), true);
    assert.deepEqual(draft, before);
  }
  assert.deepEqual(saved, unchanged);
});

test('legacy voice and MIME serialization normalize while scene-specific defaults stay distinct', () => {
  const saved = { ...settings(), companion: undefined, voice: audio, voices: undefined };
  const draft = { ...settings(), companion: 'original', voices: { start: 'data:audio/mp4; codecs="mp4a.40.2";base64,dm9pY2U=' } };
  assert.equal(hasSettingsDraft(saved, draft), false);
  draft.voices.start = null;
  assert.equal(hasSettingsDraft(saved, draft), true);
  assert.equal(hasSettingsDraft(saved, null), false);
  assert.equal(hasSettingsDraft(saved, []), true);
});
