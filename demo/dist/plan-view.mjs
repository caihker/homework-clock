import { clockParts, dateAtTime, dateKey, durationMinutes, toMinutes } from './core.mjs';
import { normalizeSession, sessionRemainingMs } from './session-timer.mjs';
import { MIN_PICKER_MINUTES, MAX_START_MINUTES } from './time-picker.mjs';

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
