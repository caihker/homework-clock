/** Completion is a student action, independent of elapsed time or list filters. */
export function completionStats(tasks, selectedDate) {
  const studies = typeof selectedDate === 'string' && selectedDate
    ? (Array.isArray(tasks) ? tasks : []).filter(task => task?.date === selectedDate && task.type === 'study')
    : [];
  const total = studies.length;
  const completed = studies.filter(task => task.completed === true).length;
  const remaining = total - completed;
  const percent = total ? Math.round(completed / total * 100) : 0;
  return {
    total,
    completed,
    remaining,
    percent,
    empty: total === 0,
    label: total
      ? `已完成 ${completed} / ${total} 项作业，完成率 ${percent}%`
      : '这天还没有学习作业',
  };
}
