import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { shiftDate, validateTask } from '../dist/core.mjs';
import { weeklySchedule } from '../dist/plan-view.mjs';
import { isWithinSchedulingWindow, MAX_START_MINUTES } from '../dist/time-picker.mjs';

const source = readFileSync(new URL('../dist/app-controller.mjs', import.meta.url), 'utf8');
const block = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));

function form(tasks) {
  const fields = new Map();
  const $ = key => {
    if (!fields.has(key)) fields.set(key, {});
    return fields.get(key);
  };
  const state = {tasks};
  const controls = vm.createContext({
    $, $$: () => [{value: '5'}], state, weeklySchedule, shiftDate, validateTask,
    crypto: {randomUUID}, isWithinSchedulingWindow, MAX_START_MINUTES,
    taskEditingDate: '2026-11-18', getTask: () => null, persist() {}, render() {},
    closeDialog() {}, toast() {}, savedNotice: text => text,
    setTaskFormError: text => { $('#form-error').textContent = text; },
  });
  vm.runInContext(block('function windowError(', "$('#delete-task').onclick") +
    block('function readWeeklySchedule(', "$('#next-turtle-word').onclick"), controls);
  $('#repeat-weekly').checked = true;
  $('#repeat-end-mode').value = 'count';
  $('#repeat-weeks').value = '4';
  $('#task-title').value = '数学';
  $('input[name="task-type"]:checked').value = 'study';
  $('#task-start').value = '10:00';
  $('#task-end').value = '11:00';
  $('#repeat-weekly').onchange();
  return {$, save: () => $('#task-form').onsubmit({preventDefault() {}})};
}
const occupied = date => ({date, id:'other', title:'语文', type:'study', start:'10:00', end:'11:00'});

test('a busy opening date outside the series does not block the previewed Fridays', () => {
  const tasks = [occupied('2026-11-18')];
  const {$, save} = form(tasks);
  assert.equal($('#repeat-preview').textContent, '预计 4 次 · 2026-11-20 至 2026-12-11');
  save();
  assert.deepEqual(tasks.slice(1).map(t => t.date), ['2026-11-20','2026-11-27','2026-12-04','2026-12-11']);
});

test('a conflict on the final Friday rejects the entire series', () => {
  const tasks = [occupied('2026-12-11')];
  const {$, save} = form(tasks);
  save();
  assert.match($('#form-error').textContent, /2026-12-11.*语文/);
  assert.equal(tasks.length, 1);
});

test('an unused invalid end date is disabled when saving by count or without repetition', () => {
  const {$} = form([]);
  $('#repeat-end-mode').value = 'date';
  $('#repeat-until').value = '2026-11-17';
  $('#repeat-end-mode').onchange();
  assert.match($('#repeat-preview').textContent, /早于/);
  $('#repeat-end-mode').value = 'count';
  $('#repeat-end-mode').onchange();
  assert.equal($('#repeat-until').disabled, true);
  assert.match($('#repeat-preview').textContent, /预计 4 次/);
  $('#repeat-weekly').checked = false;
  $('#repeat-weekly').onchange();
  assert.equal($('#repeat-preview').hidden, true);
  assert.equal($('#repeat-weeks').hidden, true);
});
