/** Generate a standards-compliant .ics for one day of plans (no server needed). */
const TYPE_LABELS = { study: '学习', life: '生活', play: '娱乐' };

function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function localStamp(date, time) {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

export function buildCalendar(tasks, { date, now = new Date() } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const events = (Array.isArray(tasks) ? tasks : [])
    .filter(task => task && task.date === date && typeof task.title === 'string' && task.title.trim() && /^\d{2}:\d{2}$/.test(task.start) && /^\d{2}:\d{2}$/.test(task.end) && task.start < task.end)
    .slice()
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
    .map(task => {
      const description = [`类型：${TYPE_LABELS[task.type] || ''}`, task.subject ? `科目：${task.subject}` : '']
        .filter(Boolean).join(' · ');
      return [
        'BEGIN:VEVENT',
        `UID:${escapeText(task.id)}@homework-clock`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=Asia/Shanghai:${localStamp(task.date, task.start)}`,
        `DTEND;TZID=Asia/Shanghai:${localStamp(task.date, task.end)}`,
        `SUMMARY:${escapeText(task.title)}`,
        ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []),
        'END:VEVENT',
      ].join('\r\n');
    });
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Homework Clock//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
