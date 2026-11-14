/** Home clock + focus dialog rendering. Reads live state through callbacks. */
export function createClockView({
  $, icon, clockText, clockParts, formatSeconds, compactCountdown, taskProgress,
  sessionDeadlineMs, sessionBreakRemainingMs, timerSeconds, sessionMs, taskStart, taskEnd,
  types, mascotView,
  getState, getTask, getCurrentId, getFocusTaskId, getNow,
}) {
  function updateClocks() {
    const state = getState();
    const n = getNow(), at = n.getTime(), t = getTask(getCurrentId());
    mascotView.updateMascots(at);
    const focusSound = $('#focus-sound');
    if (focusSound) {
      focusSound.innerHTML = icon(state.settings.sound ? 'volume' : 'volume-off');
      focusSound.setAttribute('aria-label', state.settings.sound ? '关闭声音提醒' : '开启声音提醒');
    }
    $('#clock-mode').textContent = `${state.clock.mode === 'demo' ? '演示' : '北京'} ${clockText(n)}`;
    $('#clock-display').title = `${state.clock.mode === 'demo' ? '演示时间' : '北京时间'} · GMT+8`;
    const active = t && state.session?.taskId === t.id;
    const upcoming = t && !active && taskStart(t) > at;
    const partsNow = clockParts(n);
    const sec = t ? (upcoming ? (taskStart(t) - at) / 1000 : timerSeconds(t, at)) : partsNow.hours * 3600 + partsNow.minutes * 60 + partsNow.seconds;
    const countdown = upcoming ? compactCountdown(sec) : { days: 0, clockSeconds: sec };
    const parts = formatSeconds(countdown.clockSeconds).split(':');
    $('#main-timer').innerHTML = `${parts[0]}<span>:</span>${parts[1]}<small>:${parts[2]}</small>`;
    $('#timer-caption').textContent = !t ? '现在' : upcoming ? (countdown.days ? `距离开始 · ${countdown.days} 天` : '距离开始') : timerSeconds(t, at) <= 0 ? '时间到！' : '距离结束';
    const mainFraction = taskProgress(t, state.session, at);
    mascotView.syncTurtleJourney($('#main-journey'), t, mainFraction);
    const ftProgress = getTask(getFocusTaskId());
    const focusFraction = taskProgress(ftProgress, state.session, at);
    mascotView.syncTurtleJourney($('#focus-journey'), ftProgress, focusFraction);
    mascotView.updateMascots(at);
    $('#session-badge').textContent = !t ? '自由时刻' : t.completed ? '已完成' : active ? (state.session.paused ? '休息中' : '计时中') : taskEnd(t) <= at ? '待确认' : upcoming ? '即将开始' : '准备开始';
    let ms = state.history.filter(h => h.date === state.selectedDate && (h.type || getTask(h.taskId)?.type) === 'study').reduce((sum, h) => sum + h.ms, 0);
    if (state.session?.date === state.selectedDate && getTask(state.session.taskId)?.type === 'study') ms += sessionMs(at);
    $('#focused-count').innerHTML = `${Math.floor(ms / 60000)}<span> 分钟</span>`;
    if ($('#focus-dialog').open) {
      const ft = getTask(getFocusTaskId());
      if (!ft) return;
      $('#focus-title').textContent = ft.title;
      $('#focus-timer').textContent = formatSeconds(timerSeconds(ft, at));
      const focusActive = state.session?.taskId === ft.id;
      const deadline = focusActive ? sessionDeadlineMs(state.session, ft, at) : taskEnd(ft);
      $('#focus-end').textContent = `计划在 ${clockText(new Date(deadline))} 结束 · ${types[ft.type]}`;
      const breakLeft = focusActive ? sessionBreakRemainingMs(state.session, ft, at) : 0;
      $('#focus-status').textContent = focusActive ? (state.session.paused ? `休息 ${formatSeconds(breakLeft / 1000).slice(3)} · 到点自动继续` : '专注这一件！') : '准备，开始！';
      $('#pause-session').innerHTML = `${icon(focusActive && !state.session.paused ? 'pause' : 'play')}<span>${focusActive ? (state.session.paused ? '结束休息' : '休息 5 分钟') : '开始计时'}</span>`;
    }
  }
  return { updateClocks };
}
