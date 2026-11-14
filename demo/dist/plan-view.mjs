import { clockParts, dateAtTime, dateKey, durationMinutes, toMinutes, toTime, shiftDate } from './core.mjs';
import { normalizeSession, sessionRemainingMs } from './session-timer.mjs';
import { MIN_PICKER_MINUTES, MAX_START_MINUTES, MAX_PICKER_MINUTES } from './time-picker.mjs';

const clampFraction = value => Math.min(1, Math.max(0, value));

/** One progress definition for both the home clock and full-screen clock.
 * A new session's budget is its fixed deadline minus its first manual start.
 * Normalization retains that budget while breaks only change focus credit.
 */
export function taskProgress(task, session, atMs) {
  if (!Number.isFinite(atMs) || !durationMinutes(task)) return 0;
  const start = dateAtTime(task?.date, task?.start).getTime();
  const end = dateAtTime(task?.date, task?.end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  if (session && session.taskId === task.id) {
    const normalized = normalizeSession(session, task, atMs);
    return clampFraction(1 - sessionRemainingMs(normalized, task, atMs) / Math.max(1, normalized.budgetMs));
  }
  return clampFraction((atMs - start) / (end - start));
}

/** Suggest a ten-minute slot anchor without importing the current hour into
 * another calendar day. The last legal start stays 21:00 when the day is full;
 * an end time may extend to 21:50 without extending the allowed start hours.
 */
export function suggestStartMinutes(tasks, selectedDate, atMs = Date.now()) {
  const ends = (Array.isArray(tasks) ? tasks : [])
    .filter(task => task?.date === selectedDate && durationMinutes(task))
    .map(task => toMinutes(task.end));
  let suggestion = Math.max(MIN_PICKER_MINUTES, ...ends);
  const at = new Date(atMs);
  if (Number.isFinite(at.getTime()) && selectedDate === dateKey(at)) {
    const { hours, minutes, seconds } = clockParts(at);
    suggestion = Math.max(suggestion, hours * 60 + minutes + seconds / 60);
  }
  return Math.min(MAX_START_MINUTES, Math.max(MIN_PICKER_MINUTES, Math.ceil(suggestion / 10) * 10));
}

/** Keep a distant plan's clock below 24 hours; display its days separately. */
export function compactCountdown(seconds) {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0;
  return { days: Math.floor(whole / 86400), clockSeconds: whole % 86400 };
}

/**
 * The first incomplete plan that starts after the current slot (or after now
 * when nothing is current). Used for the home card's "下一项" summary.
 */
export function nextTask(tasks, currentId, atMs) {
  if (!Number.isFinite(atMs)) return null;
  const list = (Array.isArray(tasks) ? tasks : [])
    .filter(task => task && !task.completed && Number.isFinite(dateAtTime(task?.date, task?.start).getTime()))
    .sort((a, b) => dateAtTime(a.date, a.start).getTime() - dateAtTime(b.date, b.start).getTime());
  const currentIndex = currentId ? list.findIndex(task => task.id === currentId) : -1;
  const candidates = currentIndex >= 0 ? list.slice(currentIndex + 1) : list;
  return candidates.find(task => dateAtTime(task.date, task.start).getTime() > atMs) || null;
}

/**
 * Insertion index for the "现在" line in a day-sorted task list. Returns the
 * count of plans that have already started, so equal boundaries stay stable.
 */
export function nowMarkerIndex(tasks, atMs) {
  if (!Number.isFinite(atMs) || !Array.isArray(tasks)) return -1;
  const list = tasks
    .filter(task => task && Number.isFinite(dateAtTime(task?.date, task?.start).getTime()))
    .sort((a, b) => dateAtTime(a.date, a.start).getTime() - dateAtTime(b.date, b.start).getTime());
  const index = list.findIndex(task => dateAtTime(task.date, task.start).getTime() > atMs);
  return index === -1 ? list.length : index;
}

/**
 * Shift a planned slot by whole ten-minute steps without leaving the picker
 * window. Returns null for invalid input or a boundary-crossing result.
 */
export function shiftSlot(start, end, deltaMinutes, { minStart = MIN_PICKER_MINUTES, maxStart = MAX_START_MINUTES, maxEnd = MAX_PICKER_MINUTES } = {}) {
  const from = toMinutes(start), to = toMinutes(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isInteger(deltaMinutes)) return null;
  const nextStart = from + deltaMinutes, nextEnd = to + deltaMinutes;
  if (nextStart < minStart || nextStart > maxStart || nextEnd > maxEnd || nextEnd <= nextStart) return null;
  return { start: toTime(nextStart), end: toTime(nextEnd) };
}

/** A template only stores duration; keep the chosen start when applying it. */
export function slotFromDuration(start, duration, { minStart = MIN_PICKER_MINUTES, maxStart = MAX_START_MINUTES, maxEnd = MAX_PICKER_MINUTES } = {}) {
  const from = toMinutes(start);
  if (!Number.isFinite(from) || !Number.isInteger(duration) || duration < 10) return null;
  if (from < minStart || from > maxStart) return null;
  const end = Math.min(maxEnd, from + duration);
  if (end <= from) return null;
  return { start: toTime(from), end: toTime(end) };
}

/** Same weekday, one instance per week, starting with the selected day. */
export function weeklyDates(startDate, weeks) {
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) return [];
  if (!Number.isFinite(dateAtTime(startDate).getTime())) return [];
  const dates = [];
  for (let index = 0; index < weeks; index += 1) {
    const date = shiftDate(startDate, index * 7);
    if (!date) return [];
    dates.push(date);
  }
  return dates;
}
