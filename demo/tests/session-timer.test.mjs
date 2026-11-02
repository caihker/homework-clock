import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSession, normalizeSession, sessionElapsedMs, sessionRemainingMs,
  pauseSession, resumeSession, sessionDeadlineMs, sessionBreakRemainingMs,
} from '../dist/session-timer.mjs';

const minute = 60_000;
const at = (hour, minutes = 0, second = 0) => new Date(`2026-11-01T${[hour, minutes, second].map(value => String(value).padStart(2, '0')).join(':')}+08:00`).getTime();
const task = Object.freeze({ id: 'chinese', date: '2026-11-01', start: '10:00', end: '12:00' });

test('early manual start runs until the original planned end, including the extra early time', () => {
  const lunch = Object.freeze({ id: 'lunch', date: '2026-11-01', start: '12:30', end: '13:30' });
  const session = createSession(lunch, at(12, 10));
  assert.equal(session.budgetMs, 80 * minute);
  assert.equal(sessionRemainingMs(session, lunch, at(12, 10)), 80 * minute);
  assert.equal(sessionRemainingMs(session, lunch, at(12, 30)), 60 * minute);
  assert.equal(sessionElapsedMs(session, lunch, at(12, 30)), 20 * minute);
  assert.equal(sessionDeadlineMs(session, lunch, at(12, 30)), at(13, 30));
  assert.equal(lunch.start, '12:30');
  assert.equal(lunch.end, '13:30');
});

test('late starts and expired sessions retain the original plan deadline', () => {
  const session = createSession(task, at(10, 20));
  assert.equal(session.budgetMs, 100 * minute);
  assert.equal(sessionRemainingMs(session, task, at(11)), 60 * minute);
  assert.equal(sessionDeadlineMs(session, task, at(11)), at(12));
  assert.equal(sessionElapsedMs(session, task, at(13)), 100 * minute);
  assert.equal(sessionRemainingMs(session, task, at(13)), 0);
  assert.equal(createSession(task, at(12, 1)).budgetMs, 0);
});

test('five-minute breaks freeze focus credit while the plan countdown keeps decreasing', () => {
  const original = createSession(task, at(10, 20));
  const paused = pauseSession(original, task, at(10, 40));
  assert.equal(paused.breakEndsAt, at(10, 45));
  assert.equal(sessionElapsedMs(paused, task, at(10, 42)), 20 * minute);
  assert.equal(sessionRemainingMs(paused, task, at(10, 40)), 80 * minute);
  assert.equal(sessionRemainingMs(paused, task, at(10, 42)), 78 * minute);
  assert.equal(sessionBreakRemainingMs(paused, task, at(10, 42)), 3 * minute);
  assert.equal(sessionDeadlineMs(paused, task, at(10, 42)), at(12));
  assert.deepEqual(pauseSession(paused, task, at(10, 42)), paused);
  assert.equal(original.paused, false);
});

test('break expiry resumes from its real endpoint even without intervening app ticks', () => {
  const paused = pauseSession(createSession(task, at(10, 20)), task, at(10, 40));
  const resumed = normalizeSession(paused, task, at(10, 47));
  assert.equal(resumed.paused, false);
  assert.equal(resumed.startedAt, at(10, 45));
  assert.equal(sessionElapsedMs(resumed, task, at(10, 47)), 22 * minute);
  assert.equal(sessionRemainingMs(resumed, task, at(10, 47)), 73 * minute);
  assert.equal(sessionBreakRemainingMs(resumed, task, at(10, 47)), 0);
  assert.deepEqual(resumeSession(paused, task, at(10, 47)), resumed);
  assert.equal(paused.paused, true);
});

test('ending a break early resumes only from the manual resume point', () => {
  const paused = pauseSession(createSession(task, at(10, 20)), task, at(10, 40));
  const resumed = resumeSession(paused, task, at(10, 42));
  assert.equal(resumed.paused, false);
  assert.equal(resumed.startedAt, at(10, 42));
  assert.equal(sessionElapsedMs(resumed, task, at(10, 45)), 23 * minute);
  assert.equal(sessionRemainingMs(resumed, task, at(10, 45)), 75 * minute);
  assert.equal(sessionBreakRemainingMs(resumed, task, at(10, 45)), 0);
  assert.deepEqual(resumeSession(resumed, task, at(10, 43)), resumed);
});

test('breaks are truncated at the deadline and cannot add focus credit after it', () => {
  const paused = pauseSession(createSession(task, at(11, 50)), task, at(11, 58));
  assert.equal(paused.breakEndsAt, at(12));
  assert.equal(sessionBreakRemainingMs(paused, task, at(11, 59)), minute);
  const restored = normalizeSession(paused, task, at(12, 20));
  assert.equal(restored.paused, false);
  assert.equal(sessionRemainingMs(restored, task, at(12, 20)), 0);
  assert.equal(sessionElapsedMs(restored, task, at(12, 20)), 8 * minute);
  assert.equal(sessionDeadlineMs(restored, task, at(12, 20)), at(12));
  assert.equal(pauseSession(restored, task, at(12, 21)).paused, false);
});

test('serialized breaks recover both before and after five minutes without losing time', () => {
  const paused = pauseSession(createSession(task, at(10, 20)), task, at(10, 40));
  const saved = JSON.stringify(paused);
  const during = normalizeSession(JSON.parse(saved), task, at(10, 42));
  assert.equal(during.paused, true);
  assert.equal(sessionElapsedMs(during, task, at(10, 42)), 20 * minute);
  const later = normalizeSession(JSON.parse(saved), task, at(10, 50));
  assert.equal(later.startedAt, at(10, 45));
  assert.equal(sessionElapsedMs(later, task, at(10, 50)), 25 * minute);
  assert.equal(sessionRemainingMs(later, task, at(10, 50)), 70 * minute);
});

test('legacy paused records begin one five-minute break at their known or migrated pause point', () => {
  const legacy = Object.freeze({ taskId: task.id, date: task.date, accumulatedMs: 20 * minute, startedAt: at(10, 20), paused: true });
  const migrated = normalizeSession(legacy, task, at(11));
  assert.equal(migrated.pausedAt, at(11));
  assert.equal(migrated.breakEndsAt, at(11, 5));
  assert.equal(normalizeSession(migrated, task, at(11, 2)).breakEndsAt, at(11, 5));
  assert.equal(sessionElapsedMs(migrated, task, at(11, 8)), 23 * minute);
  const knownPause = normalizeSession({ ...legacy, pausedAt: at(10, 40) }, task, at(10, 48));
  assert.equal(knownPause.startedAt, at(10, 45));
  assert.equal(sessionElapsedMs(knownPause, task, at(10, 48)), 23 * minute);
  assert.equal('breakEndsAt' in legacy, false);
});

test('old moving budgets and deadline fields cannot extend the fixed plan', () => {
  const legacy = { taskId: task.id, date: task.date, accumulatedMs: 20 * minute, startedAt: at(10, 30), paused: false, budgetMs: 999 * minute, deadlineMs: at(18) };
  const normalized = normalizeSession(legacy, task, at(11));
  assert.equal(normalized.deadlineMs, at(12));
  assert.equal(sessionDeadlineMs(normalized, task, at(11)), at(12));
  assert.equal(sessionRemainingMs(normalized, task, at(11)), 60 * minute);
  assert.equal(sessionElapsedMs(normalized, task, at(14)), 110 * minute);
});

test('multiple breaks exclude only actual break time and never move the deadline', () => {
  let session = createSession(task, at(10));
  session = pauseSession(session, task, at(10, 20));
  session = normalizeSession(session, task, at(10, 25));
  session = pauseSession(session, task, at(10, 45));
  assert.equal(session.accumulatedMs, 40 * minute);
  session = normalizeSession(session, task, at(11));
  assert.equal(sessionElapsedMs(session, task, at(11)), 50 * minute);
  assert.equal(sessionRemainingMs(session, task, at(11)), 60 * minute);
  assert.equal(sessionDeadlineMs(session, task, at(11)), at(12));
});

test('clock rollback and malformed credits do not produce negative timers', () => {
  const session = { ...createSession(task, at(10)), accumulatedMs: 20 * minute, startedAt: at(10, 30) };
  assert.equal(sessionElapsedMs(session, task, at(10, 15)), 20 * minute);
  const paused = pauseSession(session, task, at(10, 40));
  assert.equal(sessionBreakRemainingMs(paused, task, at(10, 35)), 5 * minute);
  const malformed = normalizeSession({ ...session, accumulatedMs: -5, budgetMs: -1 }, task, at(10));
  assert.equal(sessionElapsedMs(malformed, task, at(9)), 0);
  assert.equal(sessionRemainingMs(malformed, task, at(16)), 0);
  assert.equal(sessionElapsedMs(null, task, at(10)), 0);
  assert.equal(sessionRemainingMs(null, task, at(10)), 0);
  assert.equal(sessionBreakRemainingMs(null, task, at(10)), 0);
  assert.equal(sessionDeadlineMs(null, task, at(10)), null);
});
