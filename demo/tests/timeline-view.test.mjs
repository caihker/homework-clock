import test from 'node:test';
import assert from 'node:assert/strict';
import { dateAtTime, dateKey, toMinutes } from '../dist/core.mjs';
import { createTimelineView } from '../dist/timeline-view.mjs';

const day = '2026-11-01';
const taskStart = task => dateAtTime(task.date, task.start).getTime();
const taskEnd = task => dateAtTime(task.date, task.end).getTime();
const durationLabel = minutes => `${Math.floor(minutes / 60)} 小时`;

function setup({ tasks, notes = [], now = '11:00', filter = 'all' } = {}) {
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '' });
    return elements.get(selector);
  };
  const view = createTimelineView({
    $,
    icon: name => `<i data-icon="${name}">`,
    escape: value => String(value),
    categoryIcon: type => `<b data-cat="${type}">`,
    types: { study: '学习', life: '生活', play: '娱乐' },
    toMinutes,
    durationLabel,
    taskStart,
    taskEnd,
    dateKey,
    clockText: () => '11:00',
    getState: () => ({ settings: { pet: true }, session: null, notes }),
    getFilter: () => filter,
    getSelectedDate: () => day,
    getNow: () => new Date(dateAtTime(day, now)),
  });
  return { view, elements, $ };
}

const study = { id: 'study', date: day, title: '语文预习', start: '10:00', end: '12:00', type: 'study', completed: false };
const lunch = { id: 'lunch', date: day, title: '午饭', start: '14:00', end: '15:00', type: 'life', completed: false };

test('timeline renders current, next, gap and the now marker', () => {
  const { view, elements } = setup({ tasks: [lunch, study], now: '11:00' });
  view.renderTimeline([study, lunch], study, lunch.id);
  const html = elements.get('#timeline').innerHTML;
  assert.match(html, /is-current/);
  assert.match(html, /aria-current="step"/);
  assert.match(html, /下一项/);
  assert.match(html, /空闲 2 小时/);
  assert.match(html, /现在 11:00/);
  assert.match(html, /data-start="lunch"/);
});

test('empty and filtered timelines use the design copy', () => {
  const empty = setup({ tasks: [] });
  empty.view.renderTimeline([], null, null);
  assert.match(empty.elements.get('#timeline').innerHTML, /今天还没有安排/);
  assert.match(empty.elements.get('#timeline').innerHTML, /添加第一项/);

  const filtered = setup({ tasks: [study], filter: 'play' });
  filtered.view.renderTimeline([study], null, null);
  assert.match(filtered.elements.get('#timeline').innerHTML, /这里还空着/);
});

test('notes render by date with edit and delete affordances', () => {
  const withNote = setup({ tasks: [], notes: [{ id: 'n1', date: day, text: '带卷子' }] });
  withNote.view.renderNotes();
  const html = withNote.elements.get('#notes-list').innerHTML;
  assert.match(html, /带卷子/);
  assert.match(html, /data-note-edit="n1"/);
  assert.match(html, /data-note-delete="n1"/);

  const noNote = setup({ tasks: [], notes: [] });
  noNote.view.renderNotes();
  assert.match(noNote.elements.get('#notes-list').innerHTML, /今天还没有记事/);
});
