import test from 'node:test';
import assert from 'node:assert/strict';
import { dateAtTime } from '../dist/core.mjs';
import { createSession, pauseSession, resumeSession } from '../dist/session-timer.mjs';
import { taskProgress, suggestStartMinutes, compactCountdown } from '../dist/plan-view.mjs';

const task = { id: 'math', date: '2026-11-01', title: '数学试卷', start: '10:00', end: '12:00', type: 'study' };
const at = time => dateAtTime(task.date, time).getTime();
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('early and late starts share one elapsed-slot progress in every view', () => {
  const early = createSession(task, at('09:30'));
  closeTo(taskProgress(task, early, at('10:00')), 30 / 150);
  closeTo(taskProgress(task, early, at('11:00')), 90 / 150);
  const late = createSession(task, at('10:30'));
  closeTo(taskProgress(task, late, at('10:30')), 0);
  closeTo(taskProgress(task, late, at('11:00')), 30 / 90);
  closeTo(taskProgress(task, late, at('12:30')), 1);
  closeTo(taskProgress(task, null, at('11:00')), 0.5);
  closeTo(taskProgress(task, { ...late, taskId: 'another' }, at('11:00')), 0.5);
});

test('breaks do not reset or freeze the planned countdown progress', () => {
  const original = createSession(task, at('10:20'));
  const snapshot = structuredClone(original);
  const resting = pauseSession(original, task, at('10:40'));
  closeTo(taskProgress(task, resting, at('10:42')), 22 / 100);
  const resumed = resumeSession(resting, task, at('10:43'));
  closeTo(taskProgress(task, resumed, at('10:50')), 30 / 100);
  closeTo(taskProgress(task, resting, at('10:50')), 30 / 100);
  assert.deepEqual(original, snapshot, 'view calculation must not mutate the live timer');
});

test('progress clamps invalid inputs and both plan endpoints', () => {
  assert.equal(taskProgress(task, null, at('09:00')), 0);
  assert.equal(taskProgress(task, null, at('13:00')), 1);
  assert.equal(taskProgress(null, null, at('11:00')), 0);
  assert.equal(taskProgress({ ...task, date: 'bad' }, null, at('11:00')), 0);
  assert.equal(taskProgress(task, null, NaN), 0);
});

test('today starts after both now and the last plan, while empty other days start at 08:00', () => {
  assert.equal(suggestStartMinutes([task], task.date, at('14:23')), 14 * 60 + 30);
  assert.equal(suggestStartMinutes([task], task.date, at('09:00')), 12 * 60);
  assert.equal(suggestStartMinutes([], task.date, at('10:20') + 1000), 10 * 60 + 30);
  assert.equal(suggestStartMinutes([], '2026-11-02', at('19:30')), 8 * 60);
  assert.equal(suggestStartMinutes([], '2026-10-31', at('19:30')), 8 * 60);
  assert.equal(suggestStartMinutes([{ ...task, date: '2026-11-02' }], '2026-11-02', at('19:30')), 12 * 60);
  assert.equal(suggestStartMinutes([], task.date, at('22:00')), 21 * 60);
});

test('late endings never push a suggested start beyond the unchanged 21:00 start limit', () => {
  const late = { ...task, start: '21:00', end: '21:50' };
  const snapshot = structuredClone(late);
  assert.equal(suggestStartMinutes([late], task.date, at('20:00')), 21 * 60);
  assert.equal(suggestStartMinutes([{ ...late, date: '2026-11-02' }], '2026-11-02', at('20:00')), 21 * 60);
  assert.equal(suggestStartMinutes([], task.date, at('20:50') + 1000), 21 * 60);
  assert.deepEqual(late, snapshot);
});

test('day compaction preserves every second without widening distant clocks', () => {
  assert.deepEqual(compactCountdown(90 * 86400 + 12 * 3600 + 1), { days: 90, clockSeconds: 43201 });
  assert.deepEqual(compactCountdown(86399.2), { days: 1, clockSeconds: 0 });
  assert.deepEqual(compactCountdown(3599.1), { days: 0, clockSeconds: 3600 });
  assert.deepEqual(compactCountdown(-1), { days: 0, clockSeconds: 0 });
  assert.deepEqual(compactCountdown(NaN), { days: 0, clockSeconds: 0 });
});
