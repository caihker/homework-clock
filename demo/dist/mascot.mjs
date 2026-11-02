/** Derive presentation only; never mutate a task or its timer. */
export function mascotMood({task, session, at, start, end, celebrating = false}) {
  if (celebrating || task?.completed) return 'happy';
  if (!task) return 'rest';
  if (at >= end) return 'ready';
  if (at < start) return 'waiting';
  if (session?.taskId === task.id) return session.paused ? 'rest' : 'walking';
  return 'waiting';
}
export const moodLabels = {waiting:'小乌龟轻轻摇摆，等你开工',walking:'小乌龟慢慢爬行，陪你专注',rest:'小乌龟安静休息',ready:'小乌龟探头提醒你收尾',happy:'小乌龟开心庆祝完成'};
