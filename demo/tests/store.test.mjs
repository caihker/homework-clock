import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATE_KEY, STATE_VERSION, RECOVERY_KEY, classifyStoredState, isStoredTaskValid,
  normalizeStoredState, pruneNotified, chooseRecoveryExport,
} from '../dist/store.mjs';

const TODAY = '2026-11-02';
const defaults = {
  sound: true, pet: true, companion: 'original',
  code: '小皮开工了', message: '先做一道，进入状态就容易啦。', voice: null,
};
const task = (overrides = {}) => ({
  id: 'chinese', date: TODAY, title: '语文预习', start: '10:00', end: '11:00',
  type: 'study', subject: '语文', completed: false, ...overrides,
});
const snapshot = (overrides = {}) => ({
  version: 1, localUseVersion: 1, tasks: [task()], selectedDate: TODAY,
  settings: { ...defaults }, history: [], session: null, notified: [], clock: { mode: 'real' },
  ...overrides,
});
const normalize = value => normalizeStoredState(value, { defaults, today: TODAY });

test('the stored key and version are stable and shared with the app', () => {
  assert.equal(STATE_KEY, 'homework-clock-demo-v1');
  assert.equal(STATE_VERSION, 1);
  assert.equal(RECOVERY_KEY, 'homework-clock-demo-v1-recovery');
});

test('missing or empty storage means a fresh install', () => {
  for (const raw of [null, undefined, '']) assert.deepEqual(classifyStoredState(raw), { status: 'empty' });
});

test('unparseable bytes are invalid and never silently replaced', () => {
  assert.deepEqual(classifyStoredState('{oops'), { status: 'invalid', reason: 'json' });
  assert.deepEqual(classifyStoredState('undefined'), { status: 'invalid', reason: 'json' });
});

test('non-object snapshots and unusable core fields are invalid', () => {
  for (const raw of ['[]', '"text"', '42', 'null', 'true']) {
    assert.equal(classifyStoredState(raw).status, 'invalid');
  }
  assert.deepEqual(classifyStoredState(JSON.stringify({ version: 1 })), { status: 'invalid', reason: 'tasks' });
  assert.deepEqual(classifyStoredState(JSON.stringify({ version: 1, tasks: [] })), { status: 'invalid', reason: 'settings' });
  assert.deepEqual(classifyStoredState(JSON.stringify({ version: 1, tasks: [], settings: [] })), { status: 'invalid', reason: 'settings' });
  assert.deepEqual(classifyStoredState(JSON.stringify({ version: 0, tasks: [], settings: {} })), { status: 'invalid', reason: 'version' });
  assert.deepEqual(classifyStoredState(JSON.stringify({ version: '1', tasks: [], settings: {} })), { status: 'invalid', reason: 'version' });
});

test('a newer snapshot is reported as future so this version must not overwrite it', () => {
  assert.deepEqual(classifyStoredState(JSON.stringify({ version: 2, tasks: [], settings: {} })), { status: 'future', version: 2 });
});

test('a well-formed v1 snapshot is readable', () => {
  const result = classifyStoredState(JSON.stringify(snapshot()));
  assert.equal(result.status, 'ok');
  assert.equal(result.value.tasks.length, 1);
});

test('only complete, timed tasks are readable', () => {
  assert.equal(isStoredTaskValid(task()), true);
  for (const broken of [
    task({ id: '' }), task({ id: 5 }), task({ type: 'other' }), task({ date: '2026-13-01' }),
    task({ title: '  ' }), task({ start: '25:00' }), task({ end: '09:00' }), null, [],
  ]) assert.equal(isStoredTaskValid(broken), false, JSON.stringify(broken));
});

test('normalization fills defaults, migrates the legacy recording and legacy code', () => {
  const { state } = normalize(snapshot({
    settings: { voice: null, code: '小熊开工了', companion: 'solid' },
  }));
  assert.equal(state.settings.sound, true);
  assert.equal(state.settings.pet, true);
  assert.equal(state.settings.companion, 'solid');
  assert.equal(state.settings.code, defaults.code);
  assert.equal(state.settings.voice, null);
  assert.deepEqual(Object.keys(state.settings.voices).sort(), ['break-end', 'break-start', 'complete', 'end', 'ending-soon', 'schedule-start', 'start']);
  assert.equal(state.version, 1);
});

test('unreadable tasks and history entries are dropped and counted, never kept half-valid', () => {
  const { state, droppedTasks, droppedHistory } = normalize(snapshot({
    tasks: [task(), task({ id: 'broken', start: 'bad' }), null],
    history: [{ ms: 1000 }, { ms: -1 }, { ms: 'x' }, null],
  }));
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].id, 'chinese');
  assert.equal(droppedTasks, 2);
  assert.equal(state.history.length, 1);
  assert.equal(droppedHistory, 3);
});

test('only today-prefixed reminder keys are retained', () => {
  const { state } = normalize(snapshot({
    notified: [`${TODAY}:chinese:10:00:11:00:start`, '2026-11-01:old:10:00:11:00:end', 'chinese:10:00:11:00:start', 7],
  }));
  assert.deepEqual(state.notified, [`${TODAY}:chinese:10:00:11:00:start`]);
});

test('pruneNotified is total and does not mutate its input', () => {
  const input = [`${TODAY}:a:x:y:start`, '2026-11-01:b:x:y:end', null];
  const before = structuredClone(input);
  assert.deepEqual(pruneNotified(input, TODAY), [`${TODAY}:a:x:y:start`]);
  assert.deepEqual(input, before);
  assert.deepEqual(pruneNotified('not-an-array', TODAY), []);
  assert.deepEqual(pruneNotified(input, ''), []);
});

test('invalid selected date, clock and session values fall back safely', () => {
  const { state } = normalize(snapshot({
    selectedDate: '2026-02-30', clock: { mode: 'demo', simulatedAt: 'x' }, session: 'broken',
  }));
  assert.equal(state.selectedDate, TODAY);
  assert.deepEqual(state.clock, { mode: 'real' });
  assert.equal(state.session, null);
});

test('a valid demo clock and selected date survive normalization', () => {
  const { state } = normalize(snapshot({
    selectedDate: '2026-11-01',
    clock: { mode: 'demo', simulatedAt: 1761944400000, anchor: 1761944400000 },
  }));
  assert.equal(state.selectedDate, '2026-11-01');
  assert.equal(state.clock.mode, 'demo');
});

test('unknown top-level fields are retained for forward-compatible exports', () => {
  const { state } = normalize(snapshot({ futureField: { keep: true } }));
  assert.deepEqual(state.futureField, { keep: true });
});

test('recovery export prefers preserved bytes over the normalized live state', () => {
  assert.deepEqual(
    chooseRecoveryExport({ recoveryRaw: '{"version":2}', originalRaw: '{"version":1}', serializedState: '{"version":1,"tasks":[]}' }),
    { text: '{"version":2}', kind: 'recovered' },
  );
  assert.deepEqual(
    chooseRecoveryExport({ recoveryRaw: null, originalRaw: '{oops', serializedState: '{"tasks":[]}' }),
    { text: '{oops', kind: 'recovered' },
  );
  assert.deepEqual(
    chooseRecoveryExport({ recoveryRaw: '', originalRaw: null, serializedState: '{"tasks":[]}' }),
    { text: '{"tasks":[]}', kind: 'current' },
  );
});

test('recovery export fails closed when nothing can be exported', () => {
  assert.equal(chooseRecoveryExport(), null);
  assert.equal(chooseRecoveryExport({ recoveryRaw: null, originalRaw: null, serializedState: '' }), null);
  assert.equal(chooseRecoveryExport({ recoveryRaw: 42, originalRaw: undefined, serializedState: null }), null);
});
