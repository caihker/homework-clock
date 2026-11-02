/** Pure scheduling helpers. Every calendar value uses Beijing time (GMT+8). */

export const TIME_ZONE = 'Asia/Shanghai';
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function beijingDate(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return new Date(NaN);
  return new Date(date.getTime() + BEIJING_OFFSET_MS);
}

/** Convert a strict HH:mm value to minutes since midnight; invalid input is NaN. */
export function toMinutes(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return NaN;
  const [hours, minutes] = value.split(':').map(Number);
  if (hours > 23 || minutes > 59) return NaN;
  return hours * 60 + minutes;
}

/** Format whole minutes within a single day. Out-of-range values return ''. */
export function toTime(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) return '';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Date key in fixed GMT+8, independent of the device's configured time zone. */
export function dateKey(date = new Date()) {
  const value = beijingDate(date);
  const year = value.getUTCFullYear();
  if (!Number.isInteger(year) || year < 1 || year > 9999) return '';
  return `${String(year).padStart(4, '0')}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

/** Strict calendar date and HH:mm interpreted as GMT+8; invalid input is Invalid Date. */
export function dateAtTime(key, time = '12:00') {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key) || !Number.isFinite(toMinutes(time))) return new Date(NaN);
  const [year, month, day] = key.split('-').map(Number);
  if (year < 1 || year > 9999) return new Date(NaN);
  const minutes = toMinutes(time);
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  if (value.getUTCFullYear() !== year || value.getUTCMonth() + 1 !== month || value.getUTCDate() !== day) return new Date(NaN);
  return new Date(value.getTime() - BEIJING_OFFSET_MS);
}

/** Shift calendar days in either direction, including across months and years. */
export function shiftDate(key, days) {
  const value = dateAtTime(key);
  if (!Number.isSafeInteger(days) || !Number.isFinite(value.getTime())) return '';
  value.setUTCDate(value.getUTCDate() + days);
  return dateKey(value);
}

/** Clock components in fixed GMT+8, for timer labels and minute boundaries. */
export function clockParts(date = new Date()) {
  const value = beijingDate(date);
  return { hours: value.getUTCHours(), minutes: value.getUTCMinutes(), seconds: value.getUTCSeconds() };
}

/** Invalid, reversed, and cross-midnight intervals have zero duration. */
export function durationMinutes(task) {
  const start = toMinutes(task?.start);
  const end = toMinutes(task?.end);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : 0;
}

/**
 * Intervals are [start, end): back-to-back plans are valid. An edit does not
 * conflict with itself; tasks explicitly belonging to another date are skipped.
 */
export function isConflict(task, tasks = []) {
  if (!durationMinutes(task) || !Array.isArray(tasks)) return false;
  const start = toMinutes(task.start);
  const end = toMinutes(task.end);
  return tasks.some((other) => {
    if (!other || (task.id != null && other.id === task.id)) return false;
    if (task.date && other.date && task.date !== other.date) return false;
    if (!durationMinutes(other)) return false;
    return start < toMinutes(other.end) && toMinutes(other.start) < end;
  });
}

/** Return a user-facing validation error, or '' when the plan can be saved. */
export function validateTask(task, tasks = []) {
  if (!task || typeof task.title !== 'string' || !task.title.trim()) {
    return '先给这项安排起个名字吧。';
  }
  if (task.date != null && !Number.isFinite(dateAtTime(task.date).getTime())) return '请选择有效的日期。';
  if (!Number.isFinite(toMinutes(task.start)) || !Number.isFinite(toMinutes(task.end))) {
    return '请选择有效的开始和结束时间。';
  }
  if (toMinutes(task.end) <= toMinutes(task.start)) {
    return '结束时间要晚于开始时间，跨天的安排请分成两项。';
  }
  if (task.type != null && !['study', 'life', 'play'].includes(task.type)) {
    return '请选择学习、生活或娱乐。';
  }
  if (isConflict(task, tasks)) return '这个时间已经有安排了，换个时间试试。';
  return '';
}

/**
 * Fixed-slot countdown: late starts retain the original end. Before the slot,
 * return its full duration; after its end return zero. Resolve the selected
 * calendar day in GMT+8, regardless of the device's local time zone.
 */
export function remainingSeconds(task, now = new Date(), selectedDate = task?.date || dateKey(now)) {
  const duration = durationMinutes(task);
  const start = dateAtTime(selectedDate, task?.start);
  const end = dateAtTime(selectedDate, task?.end);
  if (!duration || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || !(now instanceof Date) || Number.isNaN(now.getTime())) return 0;
  if (now <= start) return duration * 60;
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 1000));
}

/** The four user-provided sample plans, recreated as independent records. */
export function createSampleTasks(selectedDate = dateKey()) {
  if (!Number.isFinite(dateAtTime(selectedDate).getTime())) return [];
  return [
    { id: `${selectedDate}-chinese`, date: selectedDate, title: '语文预习', start: '10:00', end: '12:00', type: 'study', subject: '语文', completed: false },
    { id: `${selectedDate}-lunch`, date: selectedDate, title: '出去吃午饭', start: '12:30', end: '13:30', type: 'life', subject: '', completed: false },
    { id: `${selectedDate}-game`, date: selectedDate, title: '游戏时间', start: '14:00', end: '15:00', type: 'play', subject: '', completed: false },
    { id: `${selectedDate}-amc`, date: selectedDate, title: '模拟 AMC 数学试卷', start: '15:30', end: '17:50', type: 'study', subject: '数学', completed: false },
  ];
}
