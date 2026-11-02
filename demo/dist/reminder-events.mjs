import { dateAtTime, dateKey, durationMinutes } from './core.mjs';

const types = new Set(['study', 'life', 'play']);
const priority = { end: 0, warning: 1, start: 2 };

/** Collect foreground reminders crossed by this tick. The caller records keys
 * and plays one voice; this function does not mutate tasks or notification state.
 */
export function collectDueReminders(tasks, {
  fromMs, toMs, activeTaskId, finishedTaskId, notified = [],
} = {}) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return [];
  const day = dateKey(new Date(toMs));
  if (!day) return [];
  const sent = new Set(Array.isArray(notified) ? notified : []);
  const due = [];
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task || typeof task.id !== 'string' || !types.has(task.type) || task.completed || task.date !== day || task.id === finishedTaskId) continue;
    const duration = durationMinutes(task);
    if (!duration) continue;
    const start = dateAtTime(task.date, task.start).getTime();
    const end = dateAtTime(task.date, task.end).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const active = task.id === activeTaskId;
    const events = [];
    if (!active) events.push({ at: start, event: 'start', voice: 'schedule-start', text: `${task.title}的时间到了。` });
    if (task.type === 'play' && duration > 5) events.push({ at: end - 5 * 60_000, event: 'warning', voice: 'ending-soon', text: `${task.title}还有 5 分钟，准备慢慢收尾。` });
    if (!active) events.push({ at: end, event: 'end', voice: 'end', text: `${task.title}的时间结束啦。` });
    for (const event of events) {
      const key = `${task.id}:${task.start}:${task.end}:${event.event}`;
      if (fromMs < event.at && event.at <= toMs && !sent.has(key)) {
        sent.add(key);
        due.push({ key, taskId: task.id, voice: event.voice, text: event.text, at: event.at, priority: priority[event.event] });
      }
    }
  }
  due.sort((a, b) => a.at - b.at || a.priority - b.priority);
  return due.map(({ priority: _priority, ...event }) => event);
}
