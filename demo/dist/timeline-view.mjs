/**
 * Timeline and day-note rendering. Depends only on the callbacks passed in, so
 * the same markup can be unit-tested with a fake document.
 */
import { notesForDate } from './store.mjs';
import { nowMarkerIndex } from './plan-view.mjs';

export function createTimelineView({
  $, icon, escape, categoryIcon, types, toMinutes, durationLabel,
  taskStart, taskEnd, dateKey, clockText,
  getState, getFilter, getSelectedDate, getNow,
}) {
  function renderTimeline(tasks, current, nextId) {
    const state = getState();
    const filter = getFilter();
    const visible = tasks.filter(t => filter === 'all' || t.type === filter);
    if (!visible.length) {
      const hasTasks = tasks.length > 0;
      $('#timeline').innerHTML = `<div class="empty-state">${state.settings.pet ? '<img class="empty-mascot" src="./assets/turtle-mascot.png" alt="小乌龟陪你安排新的一天">' : '<div class="empty-icon">' + icon('sun') + '</div>'}<h3>${hasTasks ? '这里还空着' : '今天还没有安排'}</h3><button class="button secondary" data-add>${hasTasks ? '加一项' : '添加第一项'}</button></div>`;
      return;
    }
    const at = getNow().getTime();
    const showNow = filter === 'all' && getSelectedDate() === dateKey(new Date(at));
    const markerIndex = showNow ? nowMarkerIndex(tasks, at) : -1;
    const nowRow = `<div class="now-row" role="presentation"><span class="now-line"></span><span class="now-label">现在 ${clockText(new Date(at))}</span></div>`;
    const nextToStart = tasks.find(t => !t.completed && t.date === dateKey(new Date(at)) && taskStart(t) > at && t.id !== state.session?.taskId);
    $('#timeline').innerHTML = visible.map((t, i) => {
      const running = state.session?.taskId === t.id;
      const live = !t.completed && t.id === current?.id && (running || taskStart(t) <= at && taskEnd(t) > at);
      const nextMark = t.id === nextId;
      const status = t.completed ? '已完成' : running ? (state.session.paused ? '休息中' : '计时中') : taskEnd(t) <= at && t.type === 'study' ? '待确认' : (nextMark ? '下一项' : '');
      const manualStart = t.id === nextToStart?.id && t.id !== current?.id ? `<button class="task-start" data-start="${escape(t.id)}" aria-label="现在开始：${escape(t.title)}" title="现在开始">${icon('play')}</button>` : '';
      const item = `<article class="timeline-item ${live ? 'is-current' : ''} ${t.completed ? 'is-completed' : ''}" data-type="${t.type}"${t.id === current?.id ? ' aria-current="step"' : ''}><div class="time-column"><span class="start-time">${t.start}</span><span class="end-time">${t.end}</span></div><div class="timeline-rail"><span class="timeline-dot">${categoryIcon(t.type)}</span></div><button class="task-content" data-edit="${escape(t.id)}" aria-label="编辑${escape(t.title)}"><span class="task-meta"><span class="type-label">${types[t.type]}</span>${status ? `<span class="task-status ${live ? 'live' : ''} ${nextMark && !live ? 'next' : ''}">${status}</span>` : ''}</span><span class="task-name">${escape(t.title)}</span></button>${manualStart}<button class="task-check ${t.completed ? 'checked' : ''}" data-complete="${escape(t.id)}" aria-label="${t.completed ? '撤销完成' : '标记完成'}：${escape(t.title)}">${t.completed ? icon('check') : ''}</button><button class="task-edit" data-edit="${escape(t.id)}" aria-label="编辑${escape(t.title)}">${icon('more')}</button></article>`;
      const next = visible[i + 1], gap = next ? toMinutes(next.start) - toMinutes(t.end) : 0;
      return (showNow && i === markerIndex ? nowRow : '') + item + (filter === 'all' && gap > 0 ? `<div class="gap-row"><span class="gap-line"></span><span class="gap-label">空闲 ${durationLabel(gap)}</span></div>` : '');
    }).join('') + (showNow && markerIndex >= visible.length ? nowRow : '');
  }

  function renderNotes() {
    const notes = notesForDate(getState().notes, getSelectedDate());
    const list = $('#notes-list');
    if (!notes.length) { list.innerHTML = '<li class="note-empty">今天还没有记事</li>'; return; }
    list.innerHTML = notes.map(note => `<li class="note-item"><button type="button" class="note-text" data-note-edit="${escape(note.id)}">${escape(note.text)}</button><button type="button" class="note-delete" data-note-delete="${escape(note.id)}" aria-label="删除记事">${icon('trash')}</button></li>`).join('');
  }

  return { renderTimeline, renderNotes };
}
