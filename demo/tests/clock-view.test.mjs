import test from 'node:test';
import assert from 'node:assert/strict';
import { clockParts, dateAtTime, remainingSeconds } from '../dist/core.mjs';
import {
  createSession, pauseSession, sessionBreakRemainingMs, sessionDeadlineMs,
  sessionElapsedMs, sessionRemainingMs,
} from '../dist/session-timer.mjs';
import { compactCountdown, taskProgress } from '../dist/plan-view.mjs';
import { createClockView } from '../dist/clock-view.mjs';

const day = '2026-11-01';
const at = time => dateAtTime(day, time).getTime();
const types = { study: '学习', life: '生活', play: '娱乐' };
const taskStart = task => dateAtTime(task.date, task.start).getTime();
const taskEnd = task => dateAtTime(task.date, task.end).getTime();
// app.mjs keeps these four helpers as private closures and passes them in;
// reimplement them from the real core/session helpers so the view is exercised
// with the same formulas rather than with hard-coded strings.
const formatSeconds = value => {
  const seconds = Math.max(0, Math.ceil(value));
  return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60]
    .map(part => String(part).padStart(2, '0')).join(':');
};
const clockText = date => date.toLocaleTimeString('zh-CN', {
  timeZone: 'Asia/Shanghai', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
});

function fakeElement(selector) {
  return {
    selector,
    innerHTML: '',
    textContent: '',
    title: '',
    open: false,
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; },
  };
}

function setup({
  tasks = [], session = null, now = '11:00', sound = true, history = [],
  current = null, focus = null, focusOpen = false, clockMode = 'real',
} = {}) {
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, fakeElement(selector));
    return elements.get(selector);
  };
  const state = {
    tasks,
    selectedDate: day,
    history,
    session,
    settings: { sound, pet: true },
    clock: { mode: clockMode },
  };
  const getTask = id => state.tasks.find(task => task.id === id);
  const currentId = current?.id ?? null;
  const focusId = focus?.id ?? null;
  const timerSeconds = (task, atMs) => state.session?.taskId === task.id
    ? Math.ceil(sessionRemainingMs(state.session, task, atMs) / 1000)
    : remainingSeconds(task, new Date(atMs), task.date);
  const sessionMs = atMs => {
    const live = state.session;
    if (!live) return 0;
    const task = getTask(live.taskId);
    if (!task) return live.accumulatedMs || 0;
    return sessionElapsedMs(live, task, atMs);
  };
  const mascotCalls = [];
  const journeyCalls = [];
  const mascotView = {
    updateMascots: atMs => mascotCalls.push(atMs),
    syncTurtleJourney: (el, task, fraction) => journeyCalls.push({ el, task, fraction }),
  };
  const view = createClockView({
    $,
    icon: name => `<i data-icon="${name}"></i>`,
    clockText, clockParts, formatSeconds, compactCountdown, taskProgress,
    sessionDeadlineMs, sessionBreakRemainingMs, timerSeconds, sessionMs,
    taskStart, taskEnd, types, mascotView,
    getState: () => state,
    getTask,
    getCurrentId: () => currentId,
    getFocusTaskId: () => focusId,
    getNow: () => new Date(at(now)),
  });
  if (focusOpen) $('#focus-dialog').open = true;
  return { view, elements, state, mascotCalls, journeyCalls };
}

const study = { id: 'study', date: day, title: '语文预习', start: '10:00', end: '12:00', type: 'study', completed: false };

test('an idle clock shows Beijing time, free time and today\'s study minutes', () => {
  const { view, elements, mascotCalls } = setup({
    now: '09:05',
    history: [
      { date: day, type: 'study', ms: 25 * 60000 },
      { date: day, type: 'play', ms: 10 * 60000 },
      { date: '2026-10-31', type: 'study', ms: 60 * 60000 },
    ],
  });
  view.updateClocks();

  assert.equal(elements.get('#clock-mode').textContent, '北京 09:05');
  assert.equal(elements.get('#clock-display').title, '北京时间 · GMT+8');
  assert.equal(elements.get('#main-timer').innerHTML, '09<span>:</span>05<small>:00</small>');
  assert.equal(elements.get('#timer-caption').textContent, '现在');
  assert.equal(elements.get('#session-badge').textContent, '自由时刻');
  assert.equal(elements.get('#focused-count').innerHTML, '25<span> 分钟</span>');
  assert.equal(elements.get('#focus-sound').innerHTML, '<i data-icon="volume"></i>');
  assert.equal(elements.get('#focus-sound').getAttribute('aria-label'), '关闭声音提醒');
  assert.equal(elements.has('#focus-title'), false, 'a closed dialog is never written to');
  assert.deepEqual(mascotCalls, [at('09:05')]);
});

test('demo clock mode labels the simulated time', () => {
  const { view, elements } = setup({ now: '09:05', clockMode: 'demo' });
  view.updateClocks();
  assert.equal(elements.get('#clock-mode').textContent, '演示 09:05');
  assert.equal(elements.get('#clock-display').title, '演示时间 · GMT+8');
});

test('an upcoming plan counts down to its start, including multi-day waits', () => {
  const first = setup({ tasks: [study], current: study, now: '09:30' });
  first.view.updateClocks();
  assert.equal(first.elements.get('#main-timer').innerHTML, '00<span>:</span>30<small>:00</small>');
  assert.equal(first.elements.get('#timer-caption').textContent, '距离开始');
  assert.equal(first.elements.get('#session-badge').textContent, '即将开始');
  const mainJourney = first.journeyCalls.find(call => call.el === first.elements.get('#main-journey'));
  assert.equal(mainJourney.task, study);
  assert.equal(mainJourney.fraction, 0);

  const tomorrow = { ...study, id: 'tomorrow', date: '2026-11-02' };
  const later = setup({ tasks: [tomorrow], current: tomorrow, now: '09:30' });
  later.view.updateClocks();
  assert.equal(later.elements.get('#main-timer').innerHTML, '00<span>:</span>30<small>:00</small>');
  assert.equal(later.elements.get('#timer-caption').textContent, '距离开始 · 1 天');
});

test('a started plan shows the remaining slot, then the time-up copy', () => {
  const running = setup({ tasks: [study], current: study, now: '11:00' });
  running.view.updateClocks();
  assert.equal(running.elements.get('#main-timer').innerHTML, '01<span>:</span>00<small>:00</small>');
  assert.equal(running.elements.get('#timer-caption').textContent, '距离结束');
  assert.equal(running.elements.get('#session-badge').textContent, '准备开始');
  const mainJourney = running.journeyCalls.find(call => call.el === running.elements.get('#main-journey'));
  assert.equal(mainJourney.fraction, 0.5);

  const expired = setup({ tasks: [study], current: study, now: '12:30' });
  expired.view.updateClocks();
  assert.equal(expired.elements.get('#main-timer').innerHTML, '00<span>:</span>00<small>:00</small>');
  assert.equal(expired.elements.get('#timer-caption').textContent, '时间到！');
  assert.equal(expired.elements.get('#session-badge').textContent, '待确认');
});

test('the focus dialog shows plan details before a session starts', () => {
  const { view, elements } = setup({
    tasks: [study], current: study, focus: study, focusOpen: true, now: '09:30',
  });
  view.updateClocks();
  assert.equal(elements.get('#focus-title').textContent, '语文预习');
  assert.equal(elements.get('#focus-timer').textContent, '02:00:00');
  assert.equal(elements.get('#focus-end').textContent, '计划在 12:00 结束 · 学习');
  assert.equal(elements.get('#focus-status').textContent, '准备，开始！');
  assert.equal(elements.get('#pause-session').innerHTML, '<i data-icon="play"></i><span>开始计时</span>');
});

test('the focus dialog follows a live session and counts its study minutes', () => {
  const session = createSession(study, at('10:30'));
  const { view, elements } = setup({
    tasks: [study], session, current: study, focus: study, focusOpen: true, now: '11:00',
    history: [{ date: day, type: 'study', ms: 20 * 60000 }],
  });
  view.updateClocks();
  assert.equal(elements.get('#focus-title').textContent, '语文预习');
  assert.equal(elements.get('#focus-timer').textContent, '01:00:00');
  assert.equal(elements.get('#focus-end').textContent, '计划在 12:00 结束 · 学习');
  assert.equal(elements.get('#focus-status').textContent, '专注这一件！');
  assert.equal(elements.get('#pause-session').innerHTML, '<i data-icon="pause"></i><span>休息 5 分钟</span>');
  assert.equal(elements.get('#session-badge').textContent, '计时中');
  assert.equal(elements.get('#focused-count').innerHTML, '50<span> 分钟</span>');
});

test('the paused focus dialog keeps the deadline and shows the break countdown', () => {
  const paused = pauseSession(createSession(study, at('10:30')), study, at('10:50'));
  const { view, elements } = setup({
    tasks: [study], session: paused, current: study, focus: study, focusOpen: true, now: '10:52',
  });
  view.updateClocks();
  assert.equal(elements.get('#focus-timer').textContent, '01:08:00');
  assert.equal(elements.get('#focus-end').textContent, '计划在 12:00 结束 · 学习');
  assert.equal(elements.get('#focus-status').textContent, '休息 03:00 · 到点自动继续');
  assert.equal(elements.get('#pause-session').innerHTML, '<i data-icon="play"></i><span>结束休息</span>');
  assert.equal(elements.get('#session-badge').textContent, '休息中');
});

test('the sound toggle icon follows settings.sound', () => {
  const muted = setup({ sound: false, tasks: [study], current: study, focus: study, focusOpen: true });
  muted.view.updateClocks();
  assert.equal(muted.elements.get('#focus-sound').innerHTML, '<i data-icon="volume-off"></i>');
  assert.equal(muted.elements.get('#focus-sound').getAttribute('aria-label'), '开启声音提醒');

  const loud = setup({ sound: true, tasks: [study], current: study, focus: study, focusOpen: true });
  loud.view.updateClocks();
  assert.equal(loud.elements.get('#focus-sound').innerHTML, '<i data-icon="volume"></i>');
  assert.equal(loud.elements.get('#focus-sound').getAttribute('aria-label'), '关闭声音提醒');
});
