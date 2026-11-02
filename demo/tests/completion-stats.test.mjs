import test from 'node:test';
import assert from 'node:assert/strict';
import { completionStats } from '../dist/completion-stats.mjs';

const date = '2026-11-01';
const study = (id, completed = false, extra = {}) => ({ id, date, type: 'study', completed, ...extra });
const empty = { total: 0, completed: 0, remaining: 0, percent: 0, empty: true, label: '这天还没有学习作业' };

test('only school study tasks on the selected date enter the completion count', () => {
  const tasks = [
    study('chinese', true), study('math'),
    study('yesterday', true, { date: '2026-10-31' }),
    study('tomorrow', true, { date: '2026-11-02' }),
    study('lunch', true, { type: 'life' }),
    study('game', true, { type: 'play' }),
  ];
  assert.deepEqual(completionStats(tasks, date), {
    total: 2, completed: 1, remaining: 1, percent: 50, empty: false,
    label: '已完成 1 / 2 项作业，完成率 50%',
  });
  assert.equal(completionStats(tasks, '2026-10-31').completed, 1);
  assert.equal(completionStats(tasks, '2026-11-02').percent, 100);
});

test('completion and undo are reflected immediately without adding or removing tasks', () => {
  const tasks = [study('math'), study('english')];
  assert.equal(completionStats(tasks, date).completed, 0);
  tasks[0].completed = true;
  assert.equal(completionStats(tasks, date).percent, 50);
  tasks[0].completed = false;
  assert.equal(completionStats(tasks, date).remaining, 2);
  assert.equal(completionStats(tasks, date).total, 2);
});

test('an empty study day reports 0/0 and 0 percent rather than a completed day', () => {
  assert.deepEqual(completionStats([], date), empty);
  assert.deepEqual(completionStats([
    study('lunch', true, { type: 'life' }), study('game', false, { type: 'play' }),
  ], date), empty);
  assert.deepEqual(completionStats([study('other', true, { date: '2026-11-02' })], date), empty);
});

test('integer percentages round fractional completion and reach 100 only when all are done', () => {
  const tasks = [study('one', true), study('two'), study('three')];
  assert.equal(completionStats(tasks, date).percent, 33);
  tasks[1].completed = true;
  assert.equal(completionStats(tasks, date).percent, 67);
  tasks[2].completed = true;
  assert.equal(completionStats(tasks, date).percent, 100);
  assert.equal(completionStats(tasks, date).remaining, 0);
});

test('elapsed plans do not become completed and explicitly completed future plans stay completed', () => {
  const tasks = [
    study('past', false, { start: '08:00', end: '08:10' }),
    study('future', true, { start: '20:50', end: '21:00' }),
  ];
  assert.equal(completionStats(tasks, date).completed, 1);
  assert.equal(completionStats(tasks, date).remaining, 1);
  // A stored "false" string or numeric marker must not be counted as true.
  assert.equal(completionStats([study('bad', 'false'), study('numeric', 1)], date).completed, 0);
});

test('statistics neither sort nor mutate the input tasks or their metadata', () => {
  const tasks = Object.freeze([
    Object.freeze(study('second', true, { start: '14:00', end: '15:00', title: '数学' })),
    Object.freeze(study('first', false, { start: '10:00', end: '11:00', title: '语文' })),
  ]);
  const before = structuredClone(tasks);
  const result = completionStats(tasks, date);
  assert.equal(result.completed, 1);
  assert.deepEqual(tasks, before);
});

test('missing data and a missing selected date produce a safe empty result', () => {
  for (const tasks of [undefined, null, false, {}, 'tasks']) {
    assert.deepEqual(completionStats(tasks, date), empty);
  }
  assert.deepEqual(completionStats([null, false, {}, study('valid', true)], date).completed, 1);
  for (const selected of [undefined, null, '', 0]) {
    assert.deepEqual(completionStats([study('missing-date', true, { date: selected })], selected), empty);
  }
});
