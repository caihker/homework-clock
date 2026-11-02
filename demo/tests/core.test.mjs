import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toMinutes, toTime, dateKey, dateAtTime, shiftDate, clockParts, durationMinutes, isConflict,
  validateTask, remainingSeconds, createSampleTasks,
} from '../dist/core.mjs';

const base = { id: 'chinese', date: '2026-11-01', title: '语文预习', start: '10:00', end: '12:00', type: 'study' };

test('strict time parsing and formatting cover day boundaries', () => {
  assert.equal(toMinutes('00:00'), 0);
  assert.equal(toMinutes('10:20'), 620);
  assert.equal(toMinutes('23:59'), 1439);
  for (const invalid of ['24:00', '12:60', '9:00', '12:0', '', null, 600]) {
    assert.ok(Number.isNaN(toMinutes(invalid)), `${invalid} must be invalid`);
  }
  assert.equal(toTime(0), '00:00');
  assert.equal(toTime(620), '10:20');
  assert.equal(toTime(1439), '23:59');
  for (const invalid of [-1, 1440, NaN, 1.5, '600']) assert.equal(toTime(invalid), '');
});

test('date keys and clock fields follow GMT+8 at the UTC day boundary', () => {
  assert.equal(dateKey(new Date('2026-10-31T16:05:00Z')), '2026-11-01');
  assert.equal(dateKey(new Date('2026-01-09T15:59:00Z')), '2026-01-09');
  assert.deepEqual(clockParts(new Date('2026-10-31T16:05:08Z')), { hours: 0, minutes: 5, seconds: 8 });
  assert.equal(dateKey(new Date('not-a-date')), '');
});

test('calendar navigation works in both directions across months, years and leap days', () => {
  assert.equal(shiftDate('2026-11-01', -1), '2026-10-31');
  assert.equal(shiftDate('2026-10-31', 1), '2026-11-01');
  assert.equal(shiftDate('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDate('2025-12-31', 1), '2026-01-01');
  assert.equal(shiftDate('2024-03-01', -1), '2024-02-29');
  assert.equal(shiftDate('2024-02-29', 1), '2024-03-01');
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
  for (const key of ['2026-11-01', '2024-03-01', '2026-01-01']) assert.equal(shiftDate(shiftDate(key, -3), 3), key);
  assert.equal(shiftDate('2026-02-30', -1), '');
  assert.equal(shiftDate('2026-11-01', 1.5), '');
  assert.equal(shiftDate('0001-01-01', -1), '');
  assert.equal(shiftDate('9999-12-31', 1), '');
});

test('date and time construction rejects rollover and fixes plan slots to GMT+8', () => {
  assert.equal(dateAtTime('2026-11-01', '10:20').toISOString(), '2026-11-01T02:20:00.000Z');
  assert.equal(dateAtTime('2026-11-01').toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(dateKey(dateAtTime('0001-01-01', '00:00')), '0001-01-01');
  for (const [key, time] of [['2026-02-30','10:00'], ['2026-13-01','10:00'], ['2026-11-01','24:00'], ['0000-01-01','12:00']]) assert.ok(Number.isNaN(dateAtTime(key, time).getTime()));
});

test('task validation rejects empty names, bad dates, reversed and cross-day times', () => {
  assert.equal(validateTask(base), '');
  assert.ok(validateTask({ ...base, title: '  ' }));
  assert.ok(validateTask({ ...base, date: '2026-02-30' }));
  assert.ok(validateTask({ ...base, start: '24:00' }));
  assert.ok(validateTask({ ...base, end: '10:00' }));
  assert.ok(validateTask({ ...base, start: '23:00', end: '01:00' }));
  assert.ok(validateTask({ ...base, type: 'unknown' }));
  assert.equal(durationMinutes(base), 120);
  assert.equal(durationMinutes({ ...base, end: '09:00' }), 0);
  assert.equal(durationMinutes(null), 0);
});

test('adjacent plans are valid but intersecting, contained and equal slots conflict', () => {
  assert.equal(isConflict({ ...base, id: 'later', start: '12:00', end: '12:30' }, [base]), false);
  assert.equal(isConflict({ ...base, id: 'earlier', start: '09:00', end: '10:00' }, [base]), false);
  assert.equal(isConflict({ ...base, id: 'overlap', start: '11:00', end: '12:30' }, [base]), true);
  assert.equal(isConflict({ ...base, id: 'within', start: '10:30', end: '11:00' }, [base]), true);
  assert.equal(isConflict({ ...base, id: 'covers', start: '09:00', end: '13:00' }, [base]), true);
  assert.equal(isConflict({ ...base, id: 'equal' }, [base]), true);
  assert.ok(validateTask({ ...base, id: 'overlap' }, [base]));
});

test('editing the same record and plans on different dates do not conflict', () => {
  assert.equal(isConflict(base, [base]), false);
  assert.equal(validateTask(base, [base]), '');
  assert.equal(isConflict({ ...base, id: 'tomorrow', date: '2026-11-02' }, [base]), false);
});

test('late starts retain the original finish and countdown cannot become negative', () => {
  assert.equal(remainingSeconds(base, new Date('2026-11-01T10:20:00+08:00')), 100 * 60);
  assert.equal(remainingSeconds(base, new Date('2026-11-01T11:00:00+08:00')), 60 * 60);
  assert.equal(remainingSeconds(base, new Date('2026-11-01T11:59:59+08:00')), 1);
  assert.equal(remainingSeconds(base, new Date('2026-11-01T12:00:00+08:00')), 0);
  assert.equal(remainingSeconds(base, new Date('2026-11-01T13:00:00+08:00')), 0);
  assert.equal(remainingSeconds(base, new Date('2026-11-01T09:00:00+08:00')), 120 * 60);
  assert.equal(remainingSeconds(base, new Date('2026-11-02T10:00:00+08:00')), 0);
  assert.equal(remainingSeconds(base, new Date(), '2026-02-30'), 0);
});

test('sample plans preserve all four requested slots and independent mutable state', () => {
  const tasks = createSampleTasks('2026-11-01');
  assert.equal(tasks.length, 4);
  assert.deepEqual(tasks.map(({ start, end }) => [start, end]), [
    ['10:00', '12:00'], ['12:30', '13:30'], ['14:00', '15:00'], ['15:30', '17:50'],
  ]);
  assert.deepEqual(tasks.map(({ type }) => type), ['study', 'life', 'play', 'study']);
  assert.equal(new Set(tasks.map(({ id }) => id)).size, 4);
  for (const task of tasks) {
    assert.equal(task.date, '2026-11-01');
    assert.equal(task.completed, false);
    assert.equal(validateTask(task, tasks), '');
  }
  tasks[0].completed = true;
  assert.equal(createSampleTasks('2026-11-01')[0].completed, false);
  assert.deepEqual(createSampleTasks('bad-date'), []);
});
