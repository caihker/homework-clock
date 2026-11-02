import test from 'node:test';
import assert from 'node:assert/strict';
import { dateAtTime } from '../dist/core.mjs';
import { collectDueReminders } from '../dist/reminder-events.mjs';

const day = '2026-11-01';
const at = (time, date = day) => dateAtTime(date, time).getTime();
const play = { id: 'game', date: day, title: '游戏时间', type: 'play', start: '14:00', end: '15:00', completed: false };
const meal = { id: 'meal', date: day, title: '午饭', type: 'life', start: '12:30', end: '13:30', completed: false };

test('a running entertainment session still receives its five-minute warning', () => {
  const options = { fromMs: at('14:54'), toMs: at('14:55'), activeTaskId: play.id };
  const before = structuredClone(play);
  const events = collectDueReminders([play], options);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    key: 'game:14:00:15:00:warning', taskId: 'game', voice: 'ending-soon',
    text: '游戏时间还有 5 分钟，准备慢慢收尾。', at: at('14:55'),
  });
  assert.deepEqual(play, before);
});

test('manual starts do not repeat schedule-start or the separately handled active deadline', () => {
  assert.deepEqual(collectDueReminders([play], { fromMs: at('13:59'), toMs: at('14:00'), activeTaskId: play.id }), []);
  assert.deepEqual(collectDueReminders([play], { fromMs: at('14:59'), toMs: at('15:00'), activeTaskId: play.id }), []);
  const schedule = collectDueReminders([play], { fromMs: at('13:59'), toMs: at('14:00') });
  assert.equal(schedule[0].voice, 'schedule-start');
});

test('life slots have an end reminder, and an already finished task is not repeated', () => {
  const options = { fromMs: at('13:29'), toMs: at('13:30') };
  assert.equal(collectDueReminders([meal], options)[0].voice, 'end');
  assert.deepEqual(collectDueReminders([meal], { ...options, finishedTaskId: meal.id }), []);
  assert.deepEqual(collectDueReminders([{ ...meal, completed: true }], options), []);
});

test('equal-time transitions order end, warning, then start regardless of task array order', () => {
  const study = { ...meal, id: 'study', title: '数学', type: 'study', start: '15:00', end: '16:00' };
  const endingMeal = { ...meal, start: '14:00', end: '15:00' };
  const warningGame = { ...play, end: '15:05' };
  const events = collectDueReminders([study, warningGame, endingMeal], { fromMs: at('14:59'), toMs: at('15:00') });
  assert.deepEqual(events.map(event => event.voice), ['end', 'ending-soon', 'schedule-start']);
  assert.ok(events.every(event => !Object.hasOwn(event, 'priority')));
});

test('the target tick uses the GMT+8 calendar day and skips stored keys without mutation', () => {
  const early = { ...play, start: '00:00', end: '00:10' };
  const prior = { ...early, id: 'prior', date: '2026-10-31' };
  const options = { fromMs: at('00:00') - 1000, toMs: at('00:00') };
  const events = collectDueReminders([early, prior], options);
  assert.equal(events.length, 1);
  assert.equal(events[0].taskId, 'game');
  const notified = [events[0].key];
  assert.deepEqual(collectDueReminders([early], { ...options, notified }), []);
  assert.deepEqual(notified, [events[0].key]);
  assert.deepEqual(collectDueReminders([early], { fromMs: options.toMs, toMs: options.toMs + 1000 }), []);
});

test('short entertainment, clock rollback and non-advancing ticks do not add reminders', () => {
  const short = { ...play, start: '14:55' };
  assert.deepEqual(collectDueReminders([short], { fromMs: at('14:54'), toMs: at('14:55'), activeTaskId: short.id }), []);
  for (const options of [{ fromMs: at('15:00'), toMs: at('14:00') }, { fromMs: at('14:00'), toMs: at('14:00') }, { fromMs: NaN, toMs: at('14:00') }]) {
    assert.deepEqual(collectDueReminders([play], options), []);
  }
});
