import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendar } from '../dist/ics.mjs';

const day = '2026-11-14';
const task = (overrides = {}) => ({ id: 'a', date: day, title: '语文预习', start: '10:00', end: '12:00', type: 'study', subject: '语文', ...overrides });

test('one day of plans becomes ordered calendar events with GMT+8 times', () => {
  const text = buildCalendar([task({ id: 'b', title: '午饭', start: '12:30', end: '13:30', type: 'life', subject: '' }), task()], { date: day, now: new Date('2026-11-14T02:00:00Z') });
  assert.match(text, /^BEGIN:VCALENDAR\r\n/);
  assert.match(text, /END:VCALENDAR\r\n$/);
  assert.equal((text.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.ok(text.indexOf('SUMMARY:语文预习') < text.indexOf('SUMMARY:午饭'));
  assert.match(text, /DTSTART;TZID=Asia\/Shanghai:20261114T100000/);
  assert.match(text, /DTEND;TZID=Asia\/Shanghai:20261114T120000/);
  assert.match(text, /DTSTAMP:20261114T020000Z/);
  assert.match(text, /DESCRIPTION:类型：学习 · 科目：语文/);
});

test('calendar text escapes backslashes, commas, semicolons and newlines', () => {
  const text = buildCalendar([task({ title: '数学, 语文; 复习\\练习', subject: '数学' })], { date: day, now: new Date('2026-11-14T00:00:00Z') });
  assert.match(text, /SUMMARY:数学\\, 语文\\; 复习\\\\练习/);
});

test('empty days and invalid plans produce a valid empty calendar', () => {
  const empty = buildCalendar([], { date: day });
  assert.match(empty, /BEGIN:VCALENDAR/);
  assert.match(empty, /END:VCALENDAR/);
  assert.equal((empty.match(/BEGIN:VEVENT/g) || []).length, 0);
  const invalid = buildCalendar([task(), null, task({ end: '09:00' })], { date: day });
  assert.equal((invalid.match(/BEGIN:VEVENT/g) || []).length, 1);
});
