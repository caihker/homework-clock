import { normalizeCompanion } from './companion.mjs';
import { completionStats } from './completion-stats.mjs';
import { toMinutes, toTime, validateTask, isConflict, remainingSeconds, dateKey, createSampleTasks, TIME_ZONE, dateAtTime, shiftDate, clockParts } from './core.mjs';
import { setupTimePicker, MIN_PICKER_MINUTES, MAX_START_MINUTES, MAX_PICKER_MINUTES, isWithinSchedulingWindow } from './time-picker.mjs?v=1.2.2';
import { createSession, normalizeSession, sessionElapsedMs, sessionRemainingMs, pauseSession, resumeSession, sessionDeadlineMs, sessionBreakRemainingMs } from './session-timer.mjs?v=0.4.1';
import { TURTLE_LINES, createVoicePlayer } from './voice-pack.mjs?v=1';
import { createBackup, parseBackup, MAX_BACKUP_BYTES } from './backup.mjs';
import { selectSceneVoice, countSceneVoices } from './scene-voices.mjs';
import { createSceneVoiceSettings } from './scene-voice-settings.mjs';
import { taskProgress, suggestStartMinutes, compactCountdown, nextTask, shiftSlot, slotFromDuration, weeklyDates, seriesFrom } from './plan-view.mjs';
import { collectDueReminders } from './reminder-events.mjs';
import { createUpdateGuard, hasSettingsDraft } from './update-guard.mjs';
import { createUpdateSession } from './update-session.mjs';
import { commitLocalState, readUpdateLock, releaseUpdateLock } from './update-storage.mjs';
import { STATE_KEY, RECOVERY_KEY, classifyStoredState, normalizeStoredState, pruneNotified, chooseRecoveryExport, inspectStorage, notesForDate, dailyDate } from './store.mjs';
import { TASK_TYPE_LABELS, DEFAULT_SETTINGS, TEMPLATE_MIN_MINUTES, TEMPLATE_MAX_MINUTES } from './schema.mjs';
import { buildCalendar } from './ics.mjs';
import { pickTurtleWord } from './turtle-words.mjs';
import { $, $$, icon, escape, categoryIcon, setIcons, setCategoryIcons } from './dom.mjs';
import { createTimelineView } from './timeline-view.mjs';
import { createMascotView } from './mascot-view.mjs';
import { createClockView } from './clock-view.mjs';


/** App controller: state, persistence, events and boot. Entry keeps only assembly. */
export function startApp() {
const STORE = STATE_KEY;
const UPDATE_LOCK = 'homework-clock-update-lock-v1';
// Defer the storage getter until a guarded helper calls it: Safari may deny
// even accessing localStorage, rather than only failing a write.
const stateStorage={getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value),removeItem:key=>localStorage.removeItem(key)};
const TYPES = TASK_TYPE_LABELS;
const timePicker = setupTimePicker();
const defaults = DEFAULT_SETTINGS;
const actualToday = dateKey(new Date());
const sampleState = () => ({ version: 1, localUseVersion: 1, tasks: createSampleTasks(actualToday), selectedDate: actualToday, settings: { ...defaults }, history: [], notes: [], templates: [], lastActiveDate: actualToday, session: null, notified: [], clock: { mode: 'real' } });
let state;
let storageOK = true;
let lastStoredRaw = null;
let recoveryRaw = null;
let originalRaw = null;
let loadIssue = null;
let writeBlocked = false;
let tickTimer = null;
let fatalReported = false;
let lastRejectionToast = 0;
let bootBarrier=readUpdateLock({storage:stateStorage,key:UPDATE_LOCK});
let updateLocked = !!bootBarrier;
let bootTimer;
let updateTransaction;
let saveFailure;
let importingBackup = false;
let composingInput = false;
const inspected = inspectStorage({ storage: stateStorage, today: actualToday, defaults, createSampleState: sampleState });
state = inspected.state;
storageOK = inspected.storageOK;
lastStoredRaw = inspected.raw;
// Daily default: after a new day (or first upgrade), show today instead of a
// stale day the user was viewing yesterday. Demo mode keeps its chosen date.
state.selectedDate = dailyDate({ selectedDate: state.selectedDate, lastActiveDate: state.lastActiveDate, clockMode: state.clock?.mode, today: actualToday });
if (state.clock?.mode !== 'demo') state.lastActiveDate = actualToday;
if (inspected.loadIssue) {
  loadIssue = inspected.loadIssue;
  originalRaw = lastStoredRaw;
  if (loadIssue.status === 'partial') {
    recoveryRaw = preserveRecovery(lastStoredRaw);
    if (recoveryRaw) loadIssue.preserved = true;
    // If the copy cannot be written, keep the original bytes safe by refusing
    // to overwrite them with the normalized result.
    else writeBlocked = true;
  } else {
    // Never overwrite bytes this version cannot read: keep a recovery copy and
    // stop automatic saves until the user exports, restores or resets.
    writeBlocked = true;
    recoveryRaw = preserveRecovery(lastStoredRaw);
  }
}
state.notes ||= [];
state.templates ||= [];
let filter = 'all';
let currentId = null;
let nextTaskId = null;
let focusTaskId = null;
let finishTaskId = null;
let lastTick;
let lastMinute = '';
let toastTimer;
let undoAction;
let confirmCallback;
const voicePlayer = createVoicePlayer({
  makeAudio: src => {const audio=$('#reminder-audio');audio.src=src;return audio;},
  cancelSpeech: () => window.speechSynthesis?.cancel(),
  onBlocked: () => toast('点击小喇叭试听一次，就能听到小乌龟的提醒。')
});
const sceneVoiceSettings = createSceneVoiceSettings({
  container: $('#scene-voice-settings'), player: voicePlayer,
  onNotice: message => toast(message),
  onBusyChange: busy => { $('#save-settings').disabled = busy; $('#edit-family-text').disabled=busy; $('#preview-family-text').disabled=busy; $$('[data-settings-tab]').forEach(button=>button.disabled=busy); },
  onPreviewDefaultStart: () => playFamily(true),
  onDefaultStartStatus: () => defaultStartStatus({code:$('#family-code').value.trim(),message:$('#family-message').value.trim()}),
});
['#family-code','#family-message'].forEach(selector=>{
  $(selector).addEventListener('input',event=>{if(!event.isComposing)sceneVoiceSettings.refresh();});
  $(selector).addEventListener('compositionend',()=>sceneVoiceSettings.refresh());
});

function now() { return new Date(state.clock?.mode === 'demo' ? state.clock.simulatedAt + Date.now() - state.clock.anchor : Date.now()); }
const taskStart = t => dateAtTime(t.date,t.start).getTime();
const taskEnd = t => dateAtTime(t.date,t.end).getTime();
const getTask = id => state.tasks.find(t => t.id === id);
const dayTasks = () => state.tasks.filter(t => t.date === state.selectedDate).sort((a,b) => toMinutes(a.start) - toMinutes(b.start));
const clockText = d => d.toLocaleTimeString('zh-CN', { timeZone: TIME_ZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
const clockMinutes = d => { const p=clockParts(d);return p.hours*60+p.minutes; };
function durationLabel(minutes) { const h = Math.floor(minutes / 60), m = minutes % 60; return `${h ? `${h} 小时` : ''}${h && m ? ' ' : ''}${m ? `${m} 分钟` : ''}` || '0 分钟'; }
function formatSeconds(n) { const s = Math.max(0, Math.ceil(n)); return [Math.floor(s/3600), Math.floor(s%3600/60), s%60].map(x=>String(x).padStart(2,'0')).join(':'); }
function preserveRecovery(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    if (localStorage.getItem(RECOVERY_KEY) !== raw) localStorage.setItem(RECOVERY_KEY, raw);
  } catch { return null; }
  return raw;
}
function updateSaveState() {
  const el = $('#save-state');
  if (!el) return;
  const failed = Boolean(loadIssue) || !storageOK;
  let text = '已保存在本机';
  if (loadIssue && loadIssue.status === 'partial') text = loadIssue.preserved === false
    ? `有 ${loadIssue.dropped} 条记录无法读取，且无法保存恢复副本，已暂停自动保存`
    : `有 ${loadIssue.dropped} 条记录无法读取，原始数据已保留`;
  else if (loadIssue) text = '本机数据待恢复，已暂停自动保存';
  else if (!storageOK) text = saveFailure === 'conflict' ? '其他窗口已保存新数据，请先导出当前备份再重开' : '暂未保存，请到设置导出备份';
  el.innerHTML = `${icon(failed ? 'x' : 'check')}${text}`;
  el.classList.toggle('save-failed', failed);
}
function persist({ updating = false } = {}) {
  if (updateLocked && !updating) return false;
  if (writeBlocked && !updating) { storageOK = false; saveFailure = 'blocked'; updateSaveState(); return false; }
  const saved=commitLocalState({storage:stateStorage,key:STORE,expectedRaw:lastStoredRaw,value:state});
  storageOK=saved.ok;saveFailure=saved.reason;if(saved.ok)lastStoredRaw=saved.raw;
  updateSaveState();
  return storageOK;
}
/** Start (or restart) the foreground clock loop after a recovery action. */
function startTicking() {
  if (tickTimer) clearInterval(tickTimer);
  lastTick = now().getTime();
  lastMinute = '';
  tickTimer = setInterval(() => { try { tick(); } catch (error) { reportFatal(error); } }, 1000);
}

const RECOVERY_VIEW = {
  invalid: { title: '本机数据无法读取', detail: '保存的数据格式已损坏。原始内容已另存为恢复副本；当前已暂停自动保存，请先导出原始数据，或从备份恢复。', export: true, restore: true, reset: true },
  future: { title: '本机数据来自更新版本', detail: '这台设备上的数据由更新版本的作业时钟写入，当前版本无法安全读取。请先更新程序；也可以导出原始数据后重置。', export: true, restore: true, reset: true },
  partial: { title: '部分记录无法读取', detail: '有部分安排或记录无法读取，已跳过并保留原始数据副本。当前数据可以继续保存。', export: true, dismiss: true },
  error: { title: '应用遇到问题', detail: '已暂停自动保存，避免写入不完整的数据。可以先导出当前数据，再刷新重试；也可确认重新开始。', export: true, retry: true, reset: true },
  reset: { title: '已恢复保存', detail: '当前数据已保存，页面已恢复自动保存与计时；如仍有异常，请刷新重试。', export: true, dismiss: true },
};
function showRecoveryBanner(mode) {
  const banner = $('#recovery-banner');
  if (!banner) return;
  const base = RECOVERY_VIEW[mode] || RECOVERY_VIEW.error;
  const partialFailed = mode === 'partial' && loadIssue?.preserved === false;
  const view = partialFailed ? { ...base, dismiss: false, reset: true } : base;
  banner.dataset.mode = mode;
  banner.hidden = false;
  $('#recovery-title').textContent = view.title;
  if (mode === 'partial') {
    $('#recovery-detail').textContent = partialFailed
      ? `有 ${loadIssue.dropped} 条安排或记录无法读取，且本机空间不足、无法保存恢复副本；已暂停自动保存，请先导出原始数据。`
      : `有 ${loadIssue.dropped} 条安排或记录无法读取，已跳过并保留原始数据副本。`;
  } else $('#recovery-detail').textContent = view.detail;
  const resetLabel = $('#recovery-reset');
  if (resetLabel) resetLabel.textContent = mode === 'error' ? '保存当前数据并继续' : '用示例数据重新开始';
  for (const name of ['export', 'restore', 'reset', 'dismiss', 'retry']) {
    const button = $(`#recovery-${name}`);
    if (button) button.hidden = !view[name];
  }
}
function hideRecoveryBanner() { const banner = $('#recovery-banner'); if (banner) banner.hidden = true; }
function downloadText(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function embeddedRecoveryRaw() {
  if (typeof recoveryRaw === 'string' && recoveryRaw) return recoveryRaw;
  if (typeof originalRaw === 'string' && originalRaw) return originalRaw;
  return null;
}
function recoveryCopyRaw() {
  return embeddedRecoveryRaw() || (() => { try { return localStorage.getItem(RECOVERY_KEY); } catch { return null; } })();
}
function refreshRecoveryCopyActions() {
  const actions = $('#recovery-copy-actions');
  if (!actions) return;
  actions.hidden = !recoveryCopyRaw();
  // Deleting the only copy while writes are blocked would lose the last
  // faithful bytes; keep it available until the read-only state is resolved.
  const del = $('#delete-recovery-copy');
  if (del) del.hidden = writeBlocked;
}
function exportRecoveryData() {
  const p = clockParts(new Date());
  const stamp = `${dateKey(new Date())}-${[p.hours, p.minutes, p.seconds].map(v => String(v).padStart(2, '0')).join('')}`;
  let serializedState = '';
  try {
    serializedState = classifyStoredState(lastStoredRaw).status === 'ok' ? lastStoredRaw : JSON.stringify(state);
  } catch { try { serializedState = JSON.stringify(state); } catch { /* nothing to export */ } }
  // In fatal-error mode only this incident's in-memory bytes are trustworthy;
  // a recovery copy kept from an older incident must not masquerade as current data.
  const persistedCopy = loadIssue?.status === 'error'
    ? null
    : (() => { try { return localStorage.getItem(RECOVERY_KEY); } catch { return null; } })();
  const candidate = chooseRecoveryExport({ recoveryRaw: embeddedRecoveryRaw(), originalRaw: persistedCopy, serializedState });
  if (!candidate) { toast('没有可导出的数据。'); return; }
  try {
    if (candidate.kind === 'recovered') {
      downloadText(candidate.text, `作业时钟-待恢复数据-${stamp}.json`);
      toast('原始数据已导出，请保存到“文件”App。');
    } else {
      downloadText(candidate.text, `作业时钟-当前数据-${stamp}.json`);
      toast('当前数据已导出，请保存到“文件”App。');
    }
  } catch { toast('导出失败，请检查浏览器存储与下载权限。'); }
}
function reportFatal(error) {
  try { console.error(error); } catch { /* console may be unavailable */ }
  if (fatalReported) return;
  fatalReported = true;
  writeBlocked = true;
  try { if (tickTimer) clearInterval(tickTimer); } catch { /* timer may not exist yet */ }
  tickTimer = null;
  try {
    loadIssue = { status: 'error' };
    showRecoveryBanner('error');
    updateSaveState();
  } catch { /* the page may be too broken to show the banner */ }
}
window.addEventListener('error', event => reportFatal(event.error || event.message));
// A rejected background task (for example a superseded audio play) must not
// freeze saving; genuine thrown errors still go through reportFatal().
window.addEventListener('unhandledrejection', event => {
  try { console.error(event.reason); } catch { /* console may be unavailable */ }
  const at = Date.now();
  if (!fatalReported && at - lastRejectionToast > 5000) {
    lastRejectionToast = at;
    toast('有一个后台操作没有完成，可以继续使用。');
  }
});
$('#recovery-export').onclick = exportRecoveryData;
$('#recovery-retry').onclick = () => location.reload();
$('#recovery-dismiss').onclick = () => { loadIssue = null; hideRecoveryBanner(); updateSaveState(); };
$('#recovery-restore').onclick = () => { openSettings(); setSettingsTab('local'); $('#import-backup').click(); };
$('#recovery-reset').onclick = () => {
  const errorMode = loadIssue?.status === 'error';
  confirmAction(
    errorMode ? '保存当前数据并继续？' : '用示例数据重新开始？',
    errorMode ? '将保存当前页面数据并恢复自动保存与计时；如果问题仍在，可刷新页面重试。' : '当前无法读取的原数据会先另存到本机恢复副本，建议先导出。',
    () => {
      if (!errorMode) {
        const rawToKeep = originalRaw || lastStoredRaw;
        if (rawToKeep && !preserveRecovery(rawToKeep)) {
          toast('无法保存原始数据副本，请先点“导出原始数据”，再重新开始。');
          return;
        }
      }
      writeBlocked = false;
      loadIssue = null;
      hideRecoveryBanner();
      const saved = persist();
      if (!saved) {
        writeBlocked = true;
        loadIssue = { status: 'error' };
        showRecoveryBanner('error');
        toast('重新开始未能保存，本机数据仍在，请先导出原始数据。');
        return;
      }
      fatalReported = false;
      refreshRecoveryCopyActions();
      startTicking();
      render();
      showRecoveryBanner('reset');
    });
};
$('#export-recovery-copy').onclick = exportRecoveryData;
$('#delete-recovery-copy').onclick = () => confirmAction('删除恢复副本？', '只删除本机保存的无法读取数据副本，当前计划和设置不受影响。删除后无法再导出，建议先导出。', () => {
  try { localStorage.removeItem(RECOVERY_KEY); } catch { /* storage may be unavailable */ }
  recoveryRaw = null;
  originalRaw = null;
  refreshRecoveryCopyActions();
  toast('恢复副本已删除。');
});
function toast(message, undo) {
  const topDialog = $$('dialog[open]').at(-1);
  (topDialog || document.body).append($('#toast'));
  clearTimeout(toastTimer); $('#toast-message').textContent = message;
  undoAction = undo; $('#toast-undo').hidden = !undo; $('#toast').classList.add('visible');
  toastTimer = setTimeout(()=>$('#toast').classList.remove('visible'), undo ? 8000 : 4300);
}
/** Success copy must not claim a save that the last persist did not confirm. */
function savedNotice(message) {
  return storageOK ? message : '当前更改暂未保存，请检查本机存储。';
}
$('#toast-undo').onclick = () => { if (undoAction) undoAction(); $('#toast').classList.remove('visible'); undoAction = null; };
function closeDialog(dialog) { if (dialog.open) dialog.close(); }
function showDialog(id) { const el=$(id); if(!el.open) el.showModal(); }
function confirmAction(title, message, callback) { $('#confirm-title').textContent=title; $('#confirm-message').textContent=message; confirmCallback=callback; showDialog('#confirm-dialog'); }
$('#confirm-cancel').onclick=()=>closeDialog($('#confirm-dialog'));
$('#confirm-ok').onclick=()=>{ closeDialog($('#confirm-dialog')); const callback=confirmCallback;confirmCallback=null;callback?.(); };
$$('.close-modal').forEach(button=>button.onclick=()=>{const dialog=button.closest('dialog');if(dialog?.id==='settings-dialog')requestSettingsClose();else closeDialog(dialog);});
$$('dialog.modal').forEach(d=>d.addEventListener('click',e=>{ if(e.target===d&&!updateLocked){ const b=d.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom){if(d.id==='settings-dialog')requestSettingsClose();else d.close();} } }));
$('#update-progress-dialog').addEventListener('cancel',event=>event.preventDefault());
$$('dialog').forEach(d=>d.addEventListener('close',()=>{if($('#toast').parentElement===d)($$('dialog[open]').at(-1)||document.body).append($('#toast'));}));

function sessionMs(at=now().getTime()) {
  const s=state.session; if(!s) return 0;
  const t=getTask(s.taskId); if(!t) return s.accumulatedMs || 0;
  return sessionElapsedMs(s,t,at);
}
function timerSeconds(t,at=now().getTime()) {
  return state.session?.taskId===t.id?Math.ceil(sessionRemainingMs(state.session,t,at)/1000):remainingSeconds(t,new Date(at),t.date);
}
function stopSession(at=now().getTime()) {
  if(!state.session)return;
  const s=state.session, ms=sessionMs(at);
  if(ms>0)state.history.push({id:crypto.randomUUID(), taskId:s.taskId,date:s.date,type:getTask(s.taskId)?.type||'study',ms});
  state.session=null; persist();
}
function chooseCurrent() {
  const tasks=dayTasks(),at=now().getTime();
  const active=state.session&&tasks.find(t=>t.id===state.session.taskId&&!t.completed&&sessionRemainingMs(state.session,t,at)>0);
  return active || tasks.find(t=>!t.completed&&taskStart(t)<=at&&taskEnd(t)>at) || tasks.find(t=>!t.completed&&taskStart(t)>at) || [...tasks].reverse().find(t=>t.type==='study'&&!t.completed&&taskEnd(t)<=at) || null;
}
const timelineView = createTimelineView({
  $, icon, escape, categoryIcon, types: TYPES, toMinutes, durationLabel,
  taskStart, taskEnd, dateKey, clockText,
  getState: () => state, getFilter: () => filter, getSelectedDate: () => state.selectedDate, getNow: () => now(),
});
function render() {
  const tasks=dayTasks(); const n=now(),at=n.getTime();const current=chooseCurrent(); currentId=current?.id||null;
  $('#day-picker').value=state.selectedDate;
  const selected=dateAtTime(state.selectedDate);
  $('#greeting-date').textContent=new Date().toLocaleDateString('zh-CN',{timeZone:TIME_ZONE,month:'long',day:'numeric',weekday:'long'});
  $('#selected-date-label').textContent=selected.toLocaleDateString('zh-CN',{timeZone:TIME_ZONE,month:'long',day:'numeric'});
  $('#day-picker').setAttribute('aria-label',`选择计划日期，当前 ${state.selectedDate}`);
  $('#schedule-title').firstChild.textContent=filter==='all'?(state.selectedDate===dateKey(n)?'今日安排 ':'这天安排 '):`${TYPES[filter]}安排 `;
  $('#task-count').textContent=tasks.filter(t=>filter==='all'||t.type===filter).length;
  $('#current-title').textContent=current?.title||'自由时间！';
  $('#current-range').textContent=current?`${current.start} — ${current.end}`:'休息一下，也很好。';
  const currentSession=current&&state.session?.taskId===current.id;
  const isUpcoming=current&&!currentSession&&taskStart(current)>at,expired=current&&!currentSession&&taskEnd(current)<=at;
  const canStartToday=current?.date===dateKey(n);
  $('#current-kicker').textContent=!current?'中场休息':expired?'记得收尾':isUpcoming?'下一项':'当前安排';
  $('#start-label').textContent=!current?'加个安排':expired?'确认完成':currentSession?'回到时钟':isUpcoming?(canStartToday?'现在开始':'查看安排'):current.type==='study'?'开始专注':'开始计时';
  $('#start-focus').querySelector('.icon').outerHTML=icon(expired?'check':isUpcoming&&!canStartToday?'calendar':'play');
  $('#current-footnote').textContent=state.settings.code || '开工，一起加油！';
  const study=tasks.filter(t=>t.type==='study');
  $('#completed-count').innerHTML=`${study.filter(t=>t.completed).length}<span> / ${study.length}</span>`;
  const summary=completionStats(state.tasks,state.selectedDate);
  const summaryDate=state.selectedDate===dateKey(new Date())?'今天':selected.toLocaleDateString('zh-CN',{timeZone:TIME_ZONE,month:'long',day:'numeric'});
  $('#homework-summary-date').textContent=summaryDate;
  $('#homework-summary-count').textContent=`${summary.completed} / ${summary.total}`;
  $('#homework-summary-percent').textContent=summary.empty?'—':`${summary.percent}%`;
  const summaryProgress=$('#homework-summary-progress');
  summaryProgress.setAttribute('aria-valuenow',String(summary.percent));summaryProgress.setAttribute('aria-valuetext',`${summaryDate}，${summary.label}`);
  summaryProgress.querySelector('span').style.width=`${summary.percent}%`;
  $('#homework-summary-note').textContent=summary.empty?'这天还没有学习作业':summary.remaining?`还剩 ${summary.remaining} 项学习作业`:'这天的学习作业都完成啦！';
  $('#pet-card').hidden=!state.settings.pet;
  $('.focus-pet').hidden=!state.settings.pet;
  $('.finish-mascot').hidden=!state.settings.pet;
  $('#copy-day').disabled=!tasks.length;
  $$('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===filter)));
  const upcoming=nextTask(tasks,current?.id,at);
  nextTaskId=upcoming?.id||null;
  $('#next-task').hidden=!upcoming;
  if(upcoming){
    $('#next-task-title').textContent=upcoming.title;
    const minutes=Math.max(1,Math.ceil((taskStart(upcoming)-at)/60000));
    const hours=Math.floor(minutes/60),rest=minutes%60;
    const when=hours?`${hours} 小时${rest?` ${rest} 分钟`:''}后`:`${minutes} 分钟后`;
    $('#next-task-time').textContent=`${upcoming.start} · ${when}`;
  }
  timelineView.renderTimeline(tasks,current,nextTaskId);
  timelineView.renderNotes();
  updateClocks();
}
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const mascotView = createMascotView({
  $, $$, taskStart, taskEnd,
  getState: () => state, getTask,
  getCurrentId: () => currentId, getFocusTaskId: () => focusTaskId, getFinishTaskId: () => finishTaskId,
  getNow: () => now(), isUpdateLocked: () => updateLocked, reducedMotion,
});
$$('.turtle-turn').forEach(button=>button.onclick=()=>{
 const task=getTask(button.closest('#focus-journey')?focusTaskId:currentId);
 mascotView.turn(task);updateClocks();
});

const clockView = createClockView({
  $, icon, clockText, clockParts, formatSeconds, compactCountdown, taskProgress,
  sessionDeadlineMs, sessionBreakRemainingMs, timerSeconds, sessionMs, taskStart, taskEnd,
  types: TYPES, mascotView,
  getState: () => state, getTask, getCurrentId: () => currentId, getFocusTaskId: () => focusTaskId, getNow: () => now(),
});
function updateClocks() { clockView.updateClocks(); }

function openTask(id,template) {
  if(!id&&state.clock?.mode!=='demo'&&state.selectedDate<dateKey(new Date()))setDate(dateKey(new Date()));
  taskEditingDate=state.selectedDate;
  const t=getTask(id);$('#task-form').reset();$('#form-error').textContent='';
  $('#task-id').value=t?.id||'';$('#task-title').value=t?.title||'';
  const start=suggestStartMinutes(dayTasks(),state.selectedDate,now().getTime());
  $('#task-start').value=t?.start||toTime(start);$('#task-end').value=t?.end||toTime(Math.min(start+30,MAX_PICKER_MINUTES));
  timePicker.sync();
  $(`input[name="task-type"][value="${t?.type||'study'}"]`).checked=true;
  $('#repeat-row').hidden=!!t;
  $('#repeat-weekly').checked=false;
  $('#repeat-hint').hidden=!t?.seriesId;
  $('#series-scope').hidden=!t?.seriesId;
  $('#delete-series').hidden=!t?.seriesId;
  $('#series-future').checked=false;
  if(t?.seriesId)$('#repeat-hint').textContent='这是每周重复中的一次；默认只改这一次，可勾选同时修改以后。';
  $('#task-dialog-title').textContent=t?'编辑安排':'添加安排';$('#delete-task').hidden=!t;
  renderCustomTemplates();showDialog('#task-dialog');if(template)applyTemplate(template);
}
const templates={study:{title:'学习',type:'study'},meal:{title:'吃饭',type:'life'},sport:{title:'运动',type:'life'},game:{title:'游戏',type:'play'}};
function applyTemplate(key) { if(!Object.hasOwn(templates,key))return;const t=templates[key];$('#task-title').value=t.title;$(`input[name="task-type"][value="${t.type}"]`).checked=true; }

function currentTemplateDuration(){const start=toMinutes($('#task-start').value),end=toMinutes($('#task-end').value);return Number.isFinite(start)&&Number.isFinite(end)&&end>start?end-start:0;}
let currentTurtleWord = '';
let taskEditingDate = null;
let noteEditingDate = null;
function renderTurtleWords(){
  const el = $('#turtle-words-text'); if (!el) return;
  currentTurtleWord = pickTurtleWord(currentTurtleWord);
  el.textContent = currentTurtleWord;
}
function renderCustomTemplates(){
  const box=$('#custom-template-chips');if(!box)return;
  const list=state.templates||[];box.hidden=!list.length;
  box.innerHTML=list.map(t=>`<button type="button" data-custom-template="${escape(t.id)}">${escape(t.title)}</button>`).join('');
}
function renderTemplateManager(){
  const box=$('#template-manager');if(!box)return;
  const list=state.templates||[];
  box.innerHTML=list.length?list.map(t=>`<div class="template-row"><span><strong>${escape(t.title)}</strong><small>${TYPES[t.type]} · ${t.duration} 分钟</small></span><button type="button" class="text-button" data-delete-template="${escape(t.id)}">删除</button></div>`).join(''):'<p class="muted">还没有常用计划。</p>';
}
function applyCustomTemplate(id){
  const t=(state.templates||[]).find(item=>item.id===id);if(!t)return;
  const slot=slotFromDuration($('#task-start').value,t.duration);
  if(!slot){$('#form-error').textContent='当前开始时间放不下这个常用计划，请先调整开始时间。';return;}
  $('#task-title').value=t.title;$(`input[name="task-type"][value="${t.type}"]`).checked=true;$('#task-end').value=slot.end;timePicker.sync();$('#form-error').textContent='';
}
function saveTemplate(){
  const title=$('#task-title').value.trim();
  if(!title){$('#form-error').textContent='先给这项安排起个名字吧。';return;}
  const duration=currentTemplateDuration();
  if(duration<TEMPLATE_MIN_MINUTES||duration>TEMPLATE_MAX_MINUTES){$('#form-error').textContent=`常用计划时长需在 ${TEMPLATE_MIN_MINUTES}–${TEMPLATE_MAX_MINUTES} 分钟。`;return;}
  const type=$('input[name="task-type"]:checked')?.value||'study';
  if((state.templates||[]).some(t=>t.title===title&&t.type===type&&t.duration===duration)){toast('这个常用计划已经有了。');return;}
  state.templates=[...(state.templates||[]),{id:crypto.randomUUID(),title,type,duration}];
  persist();renderCustomTemplates();toast(savedNotice('已存为常用计划。'));
}

function windowError(task){
  if(!isWithinSchedulingWindow(task.start,{maxMinutes:MAX_START_MINUTES}))return '开始时间请选择 08:00–21:00。';
  if(!isWithinSchedulingWindow(task.end))return '结束时间请选择 08:00–21:50。';
  return '';
}
$('#task-form').onsubmit=e=>{
  e.preventDefault();const old=getTask($('#task-id').value);
  const title=$('#task-title').value.trim(),type=$('input[name="task-type"]:checked').value;
  const task={...old,id:old?.id||crypto.randomUUID(),date:old?.date||taskEditingDate||state.selectedDate,title,start:$('#task-start').value,end:$('#task-end').value,type,subject:type==='study'?(title.includes('语文')?'语文':/数学|AMC/i.test(title)?'数学':title.includes('英语')?'英语':title.includes('科学')?'科学':''):'',completed:old?.completed||false};
  const error=validateTask(task,state.tasks);if(error){$('#form-error').textContent=error;return;}
  if(!old||old.start!==task.start||old.end!==task.end){
    const windowIssue=windowError(task);
    if(windowIssue){$('#form-error').textContent=windowIssue;return;}
  }
  const repeatWeeks=!old&&$('#repeat-weekly').checked?Number($('#repeat-weeks').value):0;
  if(repeatWeeks){
    const dates=weeklyDates(task.date,repeatWeeks);
    if(dates.length!==repeatWeeks){$('#form-error').textContent='无法生成重复日期，请检查开始日期。';return;}
    const seriesId=crypto.randomUUID();
    const instances=dates.map(date=>({...task,id:crypto.randomUUID(),date,seriesId,completed:false}));
    const trial=[...state.tasks];
    for(const instance of instances){
      const error=validateTask(instance,trial);
      if(error){$('#form-error').textContent=`${instance.date}：${error}`;return;}
      if(!isWithinSchedulingWindow(instance.start,{maxMinutes:MAX_START_MINUTES})||!isWithinSchedulingWindow(instance.end)){
        $('#form-error').textContent=`${instance.date} 的时间不在可选范围内。`;return;
      }
      trial.push(instance);
    }
    if(state.session?.taskId===task.id)stopSession();
    state.tasks.push(...instances);
    persist();closeDialog($('#task-dialog'));render();
    toast(savedNotice(storageOK?`已安排未来 ${repeatWeeks} 周，共 ${repeatWeeks} 次。`:'当前更改暂未保存，请检查浏览器存储。'));
    return;
  }
  if(old?.seriesId&&$('#series-future').checked){
    const later=seriesFrom(state.tasks,old.seriesId,old.date).filter(item=>item.id!==old.id&&!item.completed);
    const updated=later.map(item=>({...item,title,start:task.start,end:task.end,type,subject:task.subject}));
    const ids=new Set([old.id,...later.map(item=>item.id)]);
    const trial=state.tasks.filter(item=>!ids.has(item.id));
    for(const instance of [task,...updated]){
      const issue=validateTask(instance,trial);
      if(issue){$('#form-error').textContent=`${instance.date}：${issue}`;return;}
      if(!isWithinSchedulingWindow(instance.start,{maxMinutes:MAX_START_MINUTES})||!isWithinSchedulingWindow(instance.end)){
        $('#form-error').textContent=`${instance.date} 的时间不在可选范围内。`;return;
      }
      trial.push(instance);
    }
    if(state.session?.taskId&&ids.has(state.session.taskId)&&(old.start!==task.start||old.end!==task.end||old.type!==task.type))stopSession();
    const updates=new Map(updated.map(item=>[item.id,item]));
    state.tasks=state.tasks.map(item=>item.id===old.id?task:updates.get(item.id)||item);
    persist();closeDialog($('#task-dialog'));render();
    toast(savedNotice(storageOK?`已更新这一次及以后 ${updated.length+1} 次重复。`:'当前更改暂未保存，请检查浏览器存储。'));
    return;
  }
  if(state.session?.taskId===task.id&&(old.start!==task.start||old.end!==task.end||old.type!==task.type))stopSession();
  if(old)state.tasks=state.tasks.map(t=>t.id===old.id?task:t);else state.tasks.push(task);
  persist();closeDialog($('#task-dialog'));render();toast(storageOK?(old?'安排已更新，后面的时间保持不变。':'新安排已保存，慢慢来就好。'):'当前更改暂未保存，请检查浏览器存储。');
};
$('#delete-task').onclick=()=>{
  const t=getTask($('#task-id').value);if(!t)return;
  confirmAction('删除这项安排？',t.seriesId?`“${t.title}”是每周重复中的一次，只删除这一天，其他重复保留。`:`“${t.title}”将从这一天移除，其他安排保持原时间。`,()=>{
    if(state.session?.taskId===t.id)stopSession();state.tasks=state.tasks.filter(x=>x.id!==t.id);persist();closeDialog($('#task-dialog'));render();
    toast(savedNotice('安排已删除。'),()=>{if(validateTask(t,state.tasks)){toast('原时间已有其他安排，请重新添加。');return;}state.tasks.push(t);persist();render();});
  });
};
$('#delete-series').onclick=()=>{
  const t=getTask($('#task-id').value);if(!t?.seriesId)return;
  const members=seriesFrom(state.tasks,t.seriesId,t.date);
  if(!members.length)return;
  confirmAction('删除以后的所有重复？',`将删除“${t.title}”从 ${t.date} 起的 ${members.length} 次安排；之前的安排和记录保留。`,()=>{
    if(state.session&&members.some(item=>item.id===state.session.taskId))stopSession();
    state.tasks=state.tasks.filter(item=>!(item.seriesId===t.seriesId&&item.date>=t.date));
    persist();closeDialog($('#task-dialog'));render();
    toast(savedNotice(`已删除以后 ${members.length} 次重复。`),()=>{state.tasks.push(...members);persist();render();});
  });
};
$('#template-chips').onclick=e=>{const b=e.target.closest('[data-template]');if(b)applyTemplate(b.dataset.template);};
$('#custom-template-chips').onclick=e=>{const b=e.target.closest('[data-custom-template]');if(b)applyCustomTemplate(b.dataset.customTemplate);};
$('#save-template').onclick=saveTemplate;
$('#next-turtle-word').onclick=renderTurtleWords;
$('#template-manager').onclick=e=>{const b=e.target.closest('[data-delete-template]');if(!b)return;const id=b.dataset.deleteTemplate;const t=(state.templates||[]).find(item=>item.id===id);if(!t)return;confirmAction('删除常用计划？',`“${t.title}”将从常用计划中移除，已有安排不受影响。`,()=>{state.templates=(state.templates||[]).filter(item=>item.id!==id);persist();renderTemplateManager();renderCustomTemplates();toast(savedNotice('已删除常用计划。'));});};
function setTaskFormError(message){$('#form-error').textContent=message;}
function shiftTaskForm(delta){
  const slot=shiftSlot($('#task-start').value,$('#task-end').value,delta);
  if(!slot){setTaskFormError('已到可选时间边界（08:00–21:50）。');return;}
  const type=$('input[name="task-type"]:checked')?.value||'study';
  const id=$('#task-id').value||undefined;
  if(isConflict({id,date:state.selectedDate,start:slot.start,end:slot.end,type},state.tasks)){setTaskFormError('调整后与已有安排冲突。');return;}
  $('#task-start').value=slot.start;$('#task-end').value=slot.end;timePicker.sync();setTaskFormError('');
}
$('#task-shift-earlier').onclick=()=>shiftTaskForm(-10);
$('#task-shift-later').onclick=()=>shiftTaskForm(10);
$('#task-copy').onclick=()=>{
  const title=$('#task-title').value.trim();
  if(!title){setTaskFormError('先给这项安排起个名字吧。');return;}
  const original=getTask($('#task-id').value);
  const {seriesId:ignoredSeries,...originalRest}=original||{};
  const copy={...originalRest,id:crypto.randomUUID(),date:shiftDate(state.selectedDate,1),title,start:$('#task-start').value,end:$('#task-end').value,type:$('input[name="task-type"]:checked')?.value||'study',completed:false};
  const error=validateTask(copy,state.tasks);
  if(error){setTaskFormError('复制到明天会有冲突，请先调整时间。');return;}
  state.tasks.push(copy);persist();closeDialog($('#task-dialog'));render();toast(savedNotice('已复制到明天。'));
};
$('#add-task').onclick=$('#add-timeline').onclick=()=>openTask();

$('#next-task').onclick=()=>{ if(nextTaskId)openTask(nextTaskId); };
$('#timeline').onclick=e=>{
  const edit=e.target.closest('[data-edit]'),complete=e.target.closest('[data-complete]'),start=e.target.closest('[data-start]');
  if(start)startTask(getTask(start.dataset.start));else if(edit)openTask(edit.dataset.edit);else if(complete){const t=getTask(complete.dataset.complete);t.completed?undoComplete(t):completeTask(t);}else if(e.target.closest('[data-add]'))openTask();
};
function dayNotes(){return notesForDate(state.notes,state.selectedDate);}
function openNote(id){
  noteEditingDate=state.selectedDate;
  const note=(state.notes||[]).find(item=>item.id===id);
  $('#note-id').value=note?.id||'';
  $('#note-text').value=note?.text||'';
  $('#note-error').textContent='';
  $('#note-dialog-title').textContent=note?'编辑记事':'添加记事';
  $('#delete-note').hidden=!note;
  showDialog('#note-dialog');
  setTimeout(()=>$('#note-text').focus(),0);
}
function deleteNote(id){
  if(!(state.notes||[]).some(note=>note.id===id))return;
  confirmAction('删除这条记事？','删除后不能恢复。',()=>{
    state.notes=state.notes.filter(note=>note.id!==id);persist();closeDialog($('#note-dialog'));render();toast(savedNotice('记事已删除。'));
  });
}
function saveNote(){
  const text=$('#note-text').value.trim();
  if(!text){$('#note-error').textContent='写点什么再保存吧。';return;}
  if(text.length>300){$('#note-error').textContent='记事最多 300 个字。';return;}
  const id=$('#note-id').value;
  const existing=id&&(state.notes||[]).some(note=>note.id===id);
  if(existing)state.notes=state.notes.map(note=>note.id===id?{...note,text}:note);
  else state.notes=[...(state.notes||[]),{id:crypto.randomUUID(),date:noteEditingDate||state.selectedDate,text}];
  persist();closeDialog($('#note-dialog'));render();
  const savedAsNew = !!id && !existing;
  toast(savedNotice(existing?'记事已更新。':savedAsNew?'原记事已删除，已另存为一条新记事。':'记事已保存。'));
}
$('#add-note').onclick=()=>openNote();
$('#notes-list').onclick=event=>{
  const edit=event.target.closest('[data-note-edit]'),del=event.target.closest('[data-note-delete]');
  if(edit)openNote(edit.dataset.noteEdit);
  else if(del)deleteNote(del.dataset.noteDelete);
};
$('#save-note').onclick=saveNote;
$('#delete-note').onclick=()=>deleteNote($('#note-id').value);
function completeTask(t) {
  if(!t)return;const was=t.completed;if(state.session?.taskId===t.id)stopSession();t.completed=true;mascotView.celebrate(t);
  closeDialog($('#focus-dialog'));closeDialog($('#finish-dialog'));persist();render();
  playTurtle('complete');
  toast(savedNotice(`${t.title}完成啦，给自己一点掌声。`),()=>{mascotView.reset();t.completed=was;persist();render();});
}
function undoComplete(t){mascotView.reset();t.completed=false;persist();render();toast(savedNotice('已恢复为待完成，不会增加专注记录。'));}
function startTask(t) {
  if(!t)return;
  if(t.date!==dateKey(now())){
    if(t.type==='study'&&!t.completed&&taskEnd(t)<=now().getTime()){openFinish(t);return;}
    openTask(t.id);toast('请在计划当天开始计时。');return;
  }
  if(taskEnd(t)<=now().getTime()){openFinish(t);return;}
  const launch=()=>{
    const startsNew=state.session?.taskId!==t.id;
    if(startsNew){stopSession();state.session=createSession(t,now().getTime());}
    focusTaskId=t.id;persist();render();showDialog('#focus-dialog');updateClocks();if(startsNew)playFamily();
  };
  if(state.session&&state.session.taskId!==t.id)confirmAction('切换当前计时？','已经记录的专注时间会保留，然后开始这一项。',launch);else launch();
}
$('#start-focus').onclick=()=>{const t=getTask(currentId);if(!t)openTask();else startTask(t);};
$('#close-focus').onclick=()=>{closeDialog($('#focus-dialog'));render();};
$('#pause-session').onclick=()=>{
  if(!state.session){startTask(getTask(focusTaskId));return;}
  const t=getTask(state.session.taskId);if(!t)return;
  state.session=state.session.paused?resumeSession(state.session,t,now().getTime()):pauseSession(state.session,t,now().getTime());
  persist();render();updateClocks();
  playTurtle(state.session.paused?'break-start':'break-end');
};
$('#complete-session').onclick=()=>completeTask(getTask(focusTaskId));
$('#focus-sound').onclick=()=>{state.settings.sound=!state.settings.sound;if(!state.settings.sound)voicePlayer.stop();persist();toast(savedNotice(state.settings.sound?'声音提醒已开启。':'声音提醒已关闭。'));};
function openFinish(t) { finishTaskId=t.id;$('#finish-title').textContent=`${t.title}做完了吗？`;$('#finish-error').textContent='';closeDialog($('#focus-dialog'));showDialog('#finish-dialog');mascotView.updateMascots(now().getTime()); }
$('#finish-done').onclick=()=>completeTask(getTask(finishTaskId));
$('#finish-later').onclick=()=>{closeDialog($('#finish-dialog'));toast('已经记下，安排下一段时间时再接着做。');};
$('#finish-extend').onclick=()=>{
  const t=getTask(finishTaskId);if(!t)return;
  if(t.date!==dateKey(now())){$('#finish-error').textContent='这项属于其他日期，请在时间表中另安排一段时间。';return;}
  const ending=Math.max(toMinutes(t.end),clockMinutes(now()))+10;
  if(ending>MAX_PICKER_MINUTES){$('#finish-error').textContent='今天最晚安排到 21:50，请另选时间继续。';return;}
  const updated={...t,end:toTime(ending),completed:false};const error=validateTask(updated,state.tasks);
  if(error){$('#finish-error').textContent=error+' 请返回时间表调整。';return;}
  Object.assign(t,updated);closeDialog($('#finish-dialog'));persist();render();startTask(t);toast(savedNotice(`再给自己 10 分钟，计划 ${t.end} 结束。`));
};

function setDate(value) { if(!Number.isFinite(dateAtTime(value).getTime()))return;state.selectedDate=value;state.lastActiveDate=dateKey(new Date());filter='all';$$('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===filter));persist();render(); }
function moveDate(amount){const value=shiftDate(state.selectedDate,amount);if(value)setDate(value);}
$('#prev-day').onclick=()=>moveDate(-1);$('#next-day').onclick=()=>moveDate(1);$('#day-picker').onchange=e=>setDate(e.target.value);
$('#today-nav').onclick=()=>{const go=()=>{closeDialog($('#settings-dialog'));setDate(dateKey(now()));};if(hasUnsavedSettings())confirmAction('放弃未保存的设置？','有尚未保存的录音或改动，关闭后会丢失。',go);else go();};
$$('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;$$('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));$('.schedule-more').open=false;render();});
$('#copy-day').onclick=()=>{$('#copy-date').value=shiftDate(state.selectedDate,1);$('#copy-error').textContent='';showDialog('#copy-dialog');};
$('#confirm-copy').onclick=()=>{
  const date=$('#copy-date').value;if(!date){$('#copy-error').textContent='请选择要复制到的日期。';return;}
  if(date===state.selectedDate){$('#copy-error').textContent='请选择另一天，避免重复安排。';return;}
  const copies=dayTasks().map(t=>{const {seriesId,...rest}=t;return {...rest,id:crypto.randomUUID(),date,completed:false};});
  for(const t of copies){const error=validateTask(t,state.tasks);if(error){$('#copy-error').textContent=`${date} 已有时间冲突，请换一天或先调整安排。`;return;}}
  state.tasks.push(...copies);
  const existingNotes=new Set((state.notes||[]).filter(note=>note.date===date).map(note=>note.text));
  state.notes.push(...dayNotes().filter(note=>!existingNotes.has(note.text)).map(note=>({id:crypto.randomUUID(),date,text:note.text})));
  persist();closeDialog($('#copy-dialog'));setDate(date);toast(savedNotice('安排和记事已复制，新的一天慢慢来。'));
};
$('#demo-clock-settings').onclick=()=>showDialog('#clock-dialog');
function changeClock(value) {
  const change=()=>{stopSession();closeDialog($('#focus-dialog'));closeDialog($('#finish-dialog'));state.clock=value==='real'?{mode:'real'}:{mode:'demo',simulatedAt:dateAtTime(state.selectedDate,value).getTime(),anchor:Date.now()};state.selectedDate=dateKey(now());state.lastActiveDate=dateKey(new Date());lastTick=now().getTime();closeDialog($('#clock-dialog'));persist();render();toast(savedNotice(value==='real'?'已切换到北京时间（GMT+8）。':`已来到 ${value}，体验这一段时间。`));};
  state.session?confirmAction('切换演示时间？','当前计时将结束，已记录的时间会保留。',change):change();
}
$$('[data-clock]').forEach(b=>b.onclick=()=>changeClock(b.dataset.clock));$('#use-real-time').onclick=()=>changeClock('real');

function speak(text) {
  voicePlayer.stop();
  if(!('speechSynthesis' in window)){toast(text);return;}
  const utterance=new SpeechSynthesisUtterance(text);utterance.lang='zh-CN';utterance.rate=1;utterance.pitch=1.06;
  const voice=speechSynthesis.getVoices().find(v=>v.lang.startsWith('zh'));if(voice)utterance.voice=voice;
  speechSynthesis.speak(utterance);
}
function playTurtle(event, preview=false) {
  if((!preview&&!state.settings.sound)||sceneVoiceSettings.isBusy())return;
  const source=selectSceneVoice(event,state.settings)||TURTLE_LINES[event]?.src;
  if(source)void voicePlayer.play(source);
}
function defaultStartStatus(settings) {
  const text=`${settings.code||''} ${settings.message||''}`.trim();
  return text&&(settings.code!==defaults.code||settings.message!==defaults.message)?'家庭文字':'内置语音';
}
function playStartVoice(settings, preview=false) {
  if((!preview&&!settings.sound)||sceneVoiceSettings.isBusy())return;
  const source=selectSceneVoice('start',settings);
  if(source)void voicePlayer.play(source);
  else if(defaultStartStatus(settings)==='内置语音')void voicePlayer.play(TURTLE_LINES.start.src);
  else speak(`${settings.code} ${settings.message}`);
}
function playFamily(preview=false) {
  const settings=preview?{...state.settings,voices:sceneVoiceSettings.getVoices(),code:$('#family-code').value.trim(),message:$('#family-message').value.trim()}:state.settings;
  playStartVoice(settings,preview);
}
function setSettingsTab(name) {
  voicePlayer.stop();
  $$('[data-settings-tab]').forEach(button=>{
    const selected=button.dataset.settingsTab===name;
    button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
  });
  $$('[data-settings-panel]').forEach(panel=>{panel.hidden=panel.dataset.settingsPanel!==name;if(!panel.hidden)panel.scrollTop=0;});
}
$$('[data-settings-tab]').forEach(button=>{
  button.onclick=()=>setSettingsTab(button.dataset.settingsTab);
  button.onkeydown=event=>{
    const tabs=$$('[data-settings-tab]');let index=tabs.indexOf(button);
    if(event.key==='ArrowRight')index=(index+1)%tabs.length;
    else if(event.key==='ArrowLeft')index=(index+tabs.length-1)%tabs.length;
    else if(event.key==='Home')index=0;
    else if(event.key==='End')index=tabs.length-1;
    else return;
    event.preventDefault();if(tabs[index].disabled)return;
    setSettingsTab(tabs[index].dataset.settingsTab);tabs[index].focus();
  };
});
function openSettings(){
  $('#family-code').value=state.settings.code;$('#family-message').value=state.settings.message;
  $('#sound-enabled').checked=state.settings.sound;$('#pet-enabled').checked=state.settings.pet;
  $$('[name=companion]').forEach(input => { input.checked=input.value===normalizeCompanion(state.settings.companion); });
  setFamilyTextEditor(false);syncSettingsViewport();
  refreshRecoveryCopyActions();
  renderTemplateManager();
  sceneVoiceSettings.open(state.settings);setSettingsTab('sound');showDialog('#settings-dialog');
}
$('#settings-button').onclick=openSettings;
function setFamilyTextEditor(editing) {
  $('#sound-settings-main').hidden=editing;$('#family-text-editor').hidden=!editing;
  $('#settings-panel-sound').scrollTop=0;
}
function syncSettingsViewport() {
  const viewport=window.visualViewport, height=viewport?.height||window.innerHeight;
  const dialog=$('#settings-dialog');
  dialog.style.setProperty('--settings-viewport-height',`${height}px`);
  dialog.style.setProperty('--settings-viewport-top',`${(viewport?.offsetTop||0)+height/2}px`);
  dialog.classList.toggle('keyboard-open',height<window.innerHeight-100);
  const focused=document.activeElement;
  if(dialog.open&&focused?.matches('.family-text-input'))requestAnimationFrame(()=>focused.scrollIntoView({block:'nearest',inline:'nearest'}));
}
window.visualViewport?.addEventListener('resize',syncSettingsViewport);
window.visualViewport?.addEventListener('scroll',syncSettingsViewport);
window.addEventListener('resize',syncSettingsViewport);
$('#edit-family-text').onclick=()=>{setFamilyTextEditor(true);$('#family-code').focus();};
$('#close-family-text').onclick=()=>{setFamilyTextEditor(false);$('#edit-family-text').focus();};
$('#family-code').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();$('#family-message').focus();}});
$('#preview-family-text').onclick=()=>{
  if(sceneVoiceSettings.isBusy())return;
  const text=`${$('#family-code').value.trim()} ${$('#family-message').value.trim()}`.trim();
  if(text)speak(text);else toast('先输入一句开工文字，再来试听。');
};
$('#listen-family').onclick=()=>playStartVoice(state.settings,true);
function settingsDraft(){
  if(!$('#settings-dialog').open)return null;
  return {sound:$('#sound-enabled').checked,pet:$('#pet-enabled').checked,companion:$('[name=companion]:checked')?.value,code:$('#family-code').value,message:$('#family-message').value,voices:sceneVoiceSettings.getVoices()};
}
function hasUnsavedSettings(){
  return Boolean(settingsDraft())&&(hasSettingsDraft(state.settings,settingsDraft())||sceneVoiceSettings.isBusy());
}
function requestSettingsClose(){
  if(!$('#settings-dialog').open)return;
  if(!hasUnsavedSettings()){closeDialog($('#settings-dialog'));return;}
  confirmAction('放弃未保存的设置？','有尚未保存的录音或改动，关闭后会丢失。',()=>closeDialog($('#settings-dialog')));
}
$('#settings-dialog').addEventListener('cancel',event=>{event.preventDefault();requestSettingsClose();});
$('#settings-dialog').addEventListener('close',()=>sceneVoiceSettings.close());
$('#save-settings').onclick=()=>{
  if(writeBlocked){toast('本机数据待恢复，请先处理首页的恢复提示。');return;}
  if(sceneVoiceSettings.isBusy()){toast('请先结束录音，等整理完成后再保存设置。');return;}
  const settings={sound:$('#sound-enabled').checked,pet:$('#pet-enabled').checked,companion:normalizeCompanion($('[name=companion]:checked')?.value),code:$('#family-code').value.trim(),message:$('#family-message').value.trim(),voice:null,voices:sceneVoiceSettings.getVoices()};
  // Commit all seven recordings together. On storage failure, keep both the
  // previous saved state and this open draft so it can be shortened or retried.
  const saved=commitLocalState({storage:stateStorage,key:STORE,expectedRaw:lastStoredRaw,value:{...state,settings}});
  if(!saved.ok){toast(saved.reason==='conflict'?'其他窗口已保存新数据。设置和录音草稿尚未保存，请暂时不要关闭本页；导出的备份不包含这些草稿。':'本机存储空间不足或不可用，录音尚未保存。请缩短录音后再试，原设置已保留。');return;}
  lastStoredRaw=saved.raw;
  state.settings=settings;storageOK=true;saveFailure=null;updateSaveState();closeDialog($('#settings-dialog'));render();
  toast('情景语音和家庭设置已保存。');
};

function backupAvailable() {
  if (sceneVoiceSettings.isBusy()) { toast('请先结束录音并保存设置，再备份或恢复。'); return false; }
  return true;
}
let backupImportGeneration = 0;
function setBackupImportBusy(busy) {
  importingBackup = busy;
  $('#import-backup').disabled = busy;
}
function backupImportIsCurrent(generation) {
  return generation === backupImportGeneration && $('#settings-dialog').open && !updateLocked;
}
$('#settings-dialog').addEventListener('close', () => {
  // File.text() cannot be cancelled. Ignore its eventual result after closing.
  backupImportGeneration++;
  setBackupImportBusy(false);
});
$('#export-backup').onclick = () => {
  if (!backupAvailable()) return;
  try {
    const text = createBackup(state);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    const stamp=new Date(), p=clockParts(stamp);
    link.download = `作业时钟备份-${dateKey(stamp)}-${[p.hours,p.minutes,p.seconds].map(v=>String(v).padStart(2,'0')).join('')}.json`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    $('#backup-result').textContent = '备份已生成，请保存在“文件”App 中。包含计划、记事、常用计划、专注记录、家庭设置和录音。';
    toast('备份文件已生成，请保存到“文件”。');
  } catch (error) { $('#backup-result').textContent = error.message || '备份未能生成，请重试。'; }
};
$('#export-calendar').onclick = () => {
  if (!backupAvailable()) return;
  const tasks = dayTasks();
  if (!tasks.length) { toast('这一天还没有安排。'); return; }
  try {
    const text = buildCalendar(tasks, { date: state.selectedDate });
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
    const link = document.createElement('a');
    link.href = url; link.download = `作业时钟-${state.selectedDate}.ics`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('日历文件已生成，可用系统“日历”导入。');
  } catch { toast('日历文件生成失败，请重试。'); }
};
$('#import-backup').onclick = () => {
  if (importingBackup) { toast('正在读取备份，请稍候。'); return; }
  if (updateLocked) return;
  if (!backupAvailable()) return;
  $('#backup-file').value = ''; $('#backup-file').click();
};
$('#backup-file').onchange = async event => {
  const file = event.target.files?.[0]; if (!file) return;
  if (updateLocked || !$('#settings-dialog').open) return;
  const generation = ++backupImportGeneration;
  $('#backup-result').textContent = '';
  setBackupImportBusy(true);
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new Error('备份文件过大，请选择作业时钟导出的备份。');
    const text = await file.text();
    if (!backupImportIsCurrent(generation)) return;
    const restored = parseBackup(text);
    if (!backupAvailable()) return;
    confirmAction('恢复这份备份？', `包含 ${restored.tasks.length} 项安排、${restored.history.length} 条专注记录${countSceneVoices(restored.settings) ? `和 ${countSceneVoices(restored.settings)} 段情景录音` : ''}。${state.session ? '当前有计时进行中，请先结束或暂停计时。' : ''}将替换本机现有数据及未保存的设置；建议先导出本机备份。专注记录会保留，恢复后请手动开始计时。`, () => {
      if (!backupImportIsCurrent(generation)) return;
      if (state.session) { toast('当前还有计时进行中，请先结束或暂停计时，再恢复备份。'); return; }
      try { const serialized=JSON.stringify(restored);localStorage.setItem(STORE, serialized);lastStoredRaw=serialized; }
      catch { toast('本机存储空间不足或不可用，恢复未完成，原数据已保留。'); return; }
      voicePlayer.stop();
      $$('dialog[open]').forEach(closeDialog);
      state = restored;
  state.lastActiveDate = dateKey(new Date()); storageOK = true; writeBlocked = false; loadIssue = null;
      fatalReported = false;
      hideRecoveryBanner();
      updateSaveState();refreshRecoveryCopyActions();
      currentId = focusTaskId = finishTaskId = null;
      mascotView.reset(); filter = 'all';
      $$('[data-filter]').forEach(button => button.classList.toggle('active', button.dataset.filter === 'all'));
      startTicking();render();
      toast('备份已恢复，正在使用真实时间。');
    });
  } catch (error) { if (backupImportIsCurrent(generation)) $('#backup-result').textContent = error.message || '无法读取这份备份，原数据未改变。'; }
  finally { if (generation === backupImportGeneration) setBackupImportBusy(false); }
};
$('#reset-demo').onclick=()=>{if(writeBlocked){toast('本机数据待恢复，请先处理首页的恢复提示。');return;}confirmAction('重新体验示例？','当前浏览器中的计划和专注记录会重置，家庭设置会保留。',()=>{const resetDate=dateKey(new Date());state.tasks=createSampleTasks(resetDate);state.history=[];state.notes=[];state.session=null;state.notified=[];state.selectedDate=resetDate;state.clock={mode:'demo',simulatedAt:dateAtTime(resetDate,"10:20").getTime(),anchor:Date.now()};lastTick=now().getTime();closeDialog($('#settings-dialog'));closeDialog($('#focus-dialog'));closeDialog($('#finish-dialog'));filter='all';$$('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter==='all'));persist();render();toast(savedNotice('示例已就绪，开工！'));});};

function syncToday() {
  const today = dateKey(new Date());
  if (state.clock?.mode === 'demo' || state.lastActiveDate === today) return false;
  if ($('#task-dialog').open || $('#note-dialog').open) return false;
  state.lastActiveDate = today;
  state.selectedDate = today;
  filter = 'all';
  $$('[data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
  persist(); render();
  toast('新的一天，安排已切换到今天。');
  return true;
}

function tick({ silent = false } = {}) {
  if (document.hidden || updateLocked) return;
  if (syncToday()) return;
  if (document.hidden||updateLocked) return;
  const n=now(),at=n.getTime();
  let reminderVoice=null;
  const active=state.session&&getTask(state.session.taskId);
  if(state.session&&!active)stopSession();
  if(active){
    const wasResting=state.session.paused;
    state.session=normalizeSession(state.session,active,at);
    if(wasResting&&!state.session.paused){
      persist();render();
      if(at<taskEnd(active)){toast('休息结束，已自动继续专注统计。');reminderVoice='break-end';}
    }
  }
  let finishedTask=null;
  if(active&&at>=taskEnd(active)){
    finishedTask=active;
    stopSession(taskEnd(active));render();
    if(active.type==='study'&&!active.completed)openFinish(active);else{closeDialog($('#focus-dialog'));toast(`${active.title}的时间结束啦。`);}
    if(active.type==='study')toast(`${active.title}的时间结束啦。`);
    reminderVoice='end';
  }
  // Keep only today's reminder keys so long sessions cannot grow storage.
  const pruned=pruneNotified(state.notified,dateKey(n));
  const notifiedChanged=pruned.length!==state.notified.length;
  if(notifiedChanged)state.notified=pruned;
  const due=collectDueReminders(state.tasks,{fromMs:lastTick,toMs:at,activeTaskId:state.session?.taskId,finishedTaskId:finishedTask?.id,notified:state.notified});
  const messages=due.map(event=>event.text);
  for(const event of due){state.notified.push(event.key);reminderVoice ||= event.voice;}
  if(messages.length){toast(messages.join(' '));persist();}
  else if(notifiedChanged)persist();
  if(reminderVoice&&!silent)playTurtle(reminderVoice);
  lastTick=at;const minute=`${dateKey(n)}:${clockText(n)}`;
  if(minute!==lastMinute){lastMinute=minute;render();}else updateClocks();
}
document.addEventListener('compositionstart',()=>{composingInput=true;});
document.addEventListener('compositionend',()=>{composingInput=false;});
const updateGuard=createUpdateGuard({
  getStatus:()=>({
    recordingBusy:sceneVoiceSettings.isBusy(),composing:composingInput,importing:importingBackup,
    settingsDirty:hasSettingsDraft(state.settings,$('#settings-dialog').open?{
      sound:$('#sound-enabled').checked,pet:$('#pet-enabled').checked,
      companion:$('[name=companion]:checked')?.value,code:$('#family-code').value,message:$('#family-message').value,
      voices:sceneVoiceSettings.getVoices(),
    }:null),
    taskEditing:$('#task-dialog').open,
    stateConflict:!storageOK&&JSON.stringify(state)!==lastStoredRaw,
    pendingAction:['#copy-dialog','#confirm-dialog','#clock-dialog','#finish-dialog','#note-dialog'].some(selector=>$(selector).open),
  }),
  persist:()=>{
    if(writeBlocked)return false;
    const current=localStorage.getItem(STORE);
    // Another clean window can have an older in-memory snapshot. Its update
    // must retain the latest shared data rather than write the old snapshot.
    if(current!==lastStoredRaw){
      const remote=classifyStoredState(current);
      return remote.status==='ok';
    }
    if(!storageOK)return false;
    return persist({updating:true});
  },
});
if(navigator.serviceWorker)createUpdateSession({
  serviceWorker:navigator.serviceWorker,guard:updateGuard,baseURL:location.href,
  onLock:transaction=>{
    bootBarrier=null;clearTimeout(bootTimer);updateTransaction=transaction;
    localStorage.setItem(UPDATE_LOCK,JSON.stringify({...transaction,expiresAt:Date.now()+30000}));
    updateLocked=true;voicePlayer.stop();if(!$('#update-progress-dialog').open)$('#update-progress-dialog').showModal();document.body.inert=true;
  },
  onUnlock:({message}={})=>{
    releaseUpdateLock(stateStorage,UPDATE_LOCK,updateTransaction?.transactionId);
    document.body.inert=false;closeDialog($('#update-progress-dialog'));updateLocked=false;
    // Prepared pages had no drafts. Adopt the newer saved snapshot before
    // resuming autosave, while retaining the actionable cancellation message.
    try{const raw=localStorage.getItem(STORE);if(raw!==lastStoredRaw&&updateGuard.check().ok)adoptStoredState(raw);}catch{}
    window.dispatchEvent(new CustomEvent('homework-update-cancelled',{detail:{message}}));if(message)toast(message);
  },
  onReload:()=>{releaseUpdateLock(stateStorage,UPDATE_LOCK,updateTransaction?.transactionId);location.reload();},
});
window.addEventListener('storage', event => {
  if (event.key !== STORE || updateLocked || event.newValue == null || event.newValue === lastStoredRaw) return;
  // Another window may have repaired the data this page is waiting to recover.
  if (writeBlocked) {
    if (classifyStoredState(event.newValue).status === 'ok') toast('其他窗口已保存可读取的数据，刷新页面即可恢复。');
    return;
  }
  // Never replace the callback of the dialog that is already asking the user
  // to confirm a delete, reset or backup restore.
  if ($('#confirm-dialog').open || importingBackup) { toast('其他窗口已保存新数据；请完成当前操作后刷新页面。'); return; }
  if (state.session) { toast('当前正在计时，其他窗口的新数据暂不同步；结束后刷新即可。'); return; }
  const remote = classifyStoredState(event.newValue);
  if (remote.status !== 'ok') { toast('其他窗口保存的数据无法读取，当前页面数据已保留。'); return; }
  const adopt = () => {
    try { adoptStoredState(localStorage.getItem(STORE) ?? event.newValue); }
    catch (error) { reportFatal(error); }
  };
  let safe = false;
  try { safe = updateGuard.check().ok; } catch { safe = false; }
  if (safe) { adopt(); toast('其他窗口已保存新数据，已同步。'); }
  else confirmAction('其他窗口已保存新数据', '当前页面还有未完成的编辑。要放弃这些编辑并加载最新数据吗？', adopt);
});
function adoptStoredState(raw){
  const remote=classifyStoredState(raw);
  if(remote.status!=='ok')return false;
  const normalized=normalizeStoredState(remote.value,{defaults,today:dateKey(new Date())});
  const dropped=normalized.droppedTasks+normalized.droppedHistory+normalized.droppedNotes+normalized.droppedTemplates;
  let preserved=null;
  if(dropped){originalRaw=raw;preserved=recoveryRaw=preserveRecovery(raw);}
  state=normalized.state;
  if(dropped){
    loadIssue={status:'partial',dropped,preserved:!!preserved};
    if(!preserved)writeBlocked=true;
  }else{
    recoveryRaw=null;originalRaw=null;loadIssue=null;writeBlocked=false;
  }
  saveFailure=null;lastStoredRaw=raw;storageOK=true;fatalReported=false;
  hideRecoveryBanner();
  updateSaveState();refreshRecoveryCopyActions();
  if($('#settings-dialog').open){
    $('#family-code').value=state.settings.code;$('#family-message').value=state.settings.message;
    $('#sound-enabled').checked=state.settings.sound;$('#pet-enabled').checked=state.settings.pet;
    $$('[name=companion]').forEach(input=>input.checked=input.value===state.settings.companion);
    sceneVoiceSettings.open(state.settings);
  }
  if($('#focus-dialog').open&&state.session)focusTaskId=state.session.taskId;
  $$('dialog[open]').forEach(closeDialog);
  startTicking();
  render();
  if(loadIssue)showRecoveryBanner('partial');
  return true;
}
if(bootBarrier){
  const pending=bootBarrier;
  const reopen=()=>{if(bootBarrier!==pending)return;bootBarrier=null;clearTimeout(bootTimer);releaseUpdateLock(stateStorage,UPDATE_LOCK,pending.transactionId);location.reload();};
  if(!$('#update-progress-dialog').open)$('#update-progress-dialog').showModal();document.body.inert=true;
  navigator.serviceWorker?.addEventListener('message',event=>{
    if(event.source?.scriptURL!==new URL('./sw.js',location.href).href)return;
    const data=event.data;
    if(data?.version===pending.version&&data.transactionId===pending.transactionId&&['ACTIVATED','CANCEL_UPDATE'].includes(data.type))reopen();
  });
  window.addEventListener('storage',event=>{if(event.key===UPDATE_LOCK&&!readUpdateLock({storage:stateStorage,key:UPDATE_LOCK}))reopen();});
  bootTimer=setTimeout(reopen,Math.max(0,pending.expiresAt-Date.now())+100);
  if(!readUpdateLock({storage:stateStorage,key:UPDATE_LOCK}))reopen();
}
renderTurtleWords();setIcons();setCategoryIcons();mascotView.renderCompanionPreviews();
let bootError=null;
try {
  // Upgrade old demo installs once; an explicit later demo selection is retained.
  if (!state.localUseVersion) {
    if (state.clock.mode === 'demo') { stopSession(); state.clock = { mode: 'real' }; state.selectedDate = actualToday; }
    state.lastActiveDate = actualToday;
    state.localUseVersion = 1;
  }
  lastTick=now().getTime();
  if(state.session){
    const t=getTask(state.session.taskId);
    if(!t)stopSession();
    else{
      state.session=normalizeSession(state.session,t,now().getTime());
      if(now().getTime()>=taskEnd(t))stopSession(taskEnd(t));
    }
  }
} catch (error) { bootError = error; }
try { render(); } catch (error) { bootError ||= error; }
if (!writeBlocked && !bootError) persist();
startTicking();
if (loadIssue) showRecoveryBanner(loadIssue.status === 'future' ? 'future' : loadIssue.status === 'partial' ? 'partial' : 'invalid');
updateSaveState();
if (bootError) reportFatal(bootError);
window.addEventListener('homework-offline-ready', () => toast('离线准备完成，可以添加到主屏幕啦。'));
document.addEventListener('visibilitychange',()=>{
  if(document.hidden) { voicePlayer.stop(); return; }
  // Refresh fixed deadlines without replaying reminders missed while away.
  lastTick=now().getTime();tick({silent:true});
});
}
