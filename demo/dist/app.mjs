import { companionAsset, companionFraming, normalizeCompanion } from './companion.mjs';
import { completionStats } from './completion-stats.mjs';
import { advanceTurtle } from './turtle-travel.mjs?v=progress-sync-1';
import { mascotMood, moodLabels } from './mascot.mjs';
import { toMinutes, toTime, validateTask, remainingSeconds, dateKey, createSampleTasks, TIME_ZONE, dateAtTime, shiftDate, clockParts } from './core.mjs';
import { setupTimePicker, MAX_START_MINUTES, MAX_PICKER_MINUTES, isWithinSchedulingWindow } from './time-picker.mjs?v=1.2.2';
import { createSession, normalizeSession, sessionElapsedMs, sessionRemainingMs, pauseSession, resumeSession, sessionDeadlineMs, sessionBreakRemainingMs } from './session-timer.mjs?v=0.4.1';
import { TURTLE_LINES, createVoicePlayer } from './voice-pack.mjs?v=1';
import { createBackup, parseBackup, MAX_BACKUP_BYTES } from './backup.mjs';
import { normalizeSceneVoices, selectSceneVoice, countSceneVoices } from './scene-voices.mjs';
import { createSceneVoiceSettings } from './scene-voice-settings.mjs';
import { taskProgress, suggestStartMinutes, compactCountdown } from './plan-view.mjs';
import { collectDueReminders } from './reminder-events.mjs';
import { createUpdateGuard, hasSettingsDraft } from './update-guard.mjs';
import { createUpdateSession } from './update-session.mjs';
import { commitLocalState, readUpdateLock, releaseUpdateLock } from './update-storage.mjs';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const STORE = 'homework-clock-demo-v1';
const UPDATE_LOCK = 'homework-clock-update-lock-v1';
// Defer the storage getter until a guarded helper calls it: Safari may deny
// even accessing localStorage, rather than only failing a write.
const stateStorage={getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value),removeItem:key=>localStorage.removeItem(key)};
const TYPES = { study: '学习', life: '生活', play: '娱乐' };
const CATEGORY_ICONS = { study:'learning', life:'life', play:'play' };
const categoryIcon = type => `<img class="category-icon" src="./assets/category-flat-byg/${CATEGORY_ICONS[type] || CATEGORY_ICONS.study}.png" width="64" height="64" alt="" aria-hidden="true" decoding="async" draggable="false">`;
const paths = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-9 9 9 5 9-5M3 17l9 5 9-5"/>',
  leaf: '<path d="M20 3C8 2 2 8 5 16c6 7 16 0 15-13ZM4 21 15 10"/>',
  settings: '<path d="m9 4 1-2h4l1 2 3 2 3 1v4l-2 1-1 3 1 3-3 3-3-1-3 1-3 1-3-3 1-3-1-3-2-1V7l3-1 3-2Z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>', 'chevron-left': '<path d="m15 5-7 7 7 7"/>', 'chevron-right': '<path d="m9 5 7 7-7 7"/>',
  'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>', 'arrow-left': '<path d="M20 12H4m6-6-6 6 6 6"/>',
  sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4"/>',
  play: '<path d="m8 4 12 8-12 8V4Z"/>', pause: '<path d="M8 5v14M16 5v14"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
  volume: '<path d="m11 4-6 5H2v6h3l6 5V4Zm4 4c3 2 3 6 0 8m3-11c5 4 5 10 0 14"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>', check: '<path d="m5 12 4 4L19 6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="3"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  book: '<path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1Zm0 0v15"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  game: '<path d="M7 7h10c4 0 6 12 3 13-2 1-4-3-6-3h-4c-2 0-4 4-6 3C1 19 3 7 7 7Z"/><path d="M7 10v6m-3-3h6m6-1h.1m3 3h.1M10 7V4h4V2"/>',
  mic: '<rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.clock}</svg>`;
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const setIcons = () => $$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const setCategoryIcons = () => $$('[data-category]').forEach(el => { el.innerHTML = categoryIcon(el.dataset.category); });
const timePicker = setupTimePicker();
const defaults = { sound: true, pet: true, companion: 'original', code: '小皮开工了', message: '先做一道，进入状态就容易啦。', voice: null };
const actualToday = dateKey(new Date());
let state;
let storageOK = true;
let lastStoredRaw = null;
let bootBarrier=readUpdateLock({storage:stateStorage,key:UPDATE_LOCK});
let updateLocked = !!bootBarrier;
let bootTimer;
let updateTransaction;
let saveFailure;
let importingBackup = false;
let composingInput = false;
try {
  lastStoredRaw = localStorage.getItem(STORE);
  const saved = JSON.parse(lastStoredRaw);
  state = saved?.version === 1 && Array.isArray(saved.tasks) ? saved : null;
} catch { storageOK = false; }
if (!state) state = { version: 1, localUseVersion: 1, tasks: createSampleTasks(actualToday), selectedDate: actualToday, settings: { ...defaults }, history: [], session: null, notified: [], clock: { mode: 'real' } };
state.settings = { ...defaults, ...state.settings };
state.settings.companion = normalizeCompanion(state.settings.companion);
state.settings.voices = normalizeSceneVoices(state.settings);
state.settings.voice = null;
if (['小熊开工啦！', '小熊开工了'].includes(state.settings.code)) state.settings.code = defaults.code;
state.history ||= [];
state.notified ||= [];
state.tasks = state.tasks.filter(t => t && typeof t.id === 'string' && TYPES[t.type] && !validateTask(t, []));
if (!Number.isFinite(dateAtTime(state.selectedDate).getTime())) state.selectedDate=actualToday;
state.clock ||= { mode: 'real' };
let filter = 'all';
let currentId = null;
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
function persist({ updating = false } = {}) {
  if(updateLocked&&!updating)return false;
  const saved=commitLocalState({storage:stateStorage,key:STORE,expectedRaw:lastStoredRaw,value:state});
  storageOK=saved.ok;saveFailure=saved.reason;if(saved.ok)lastStoredRaw=saved.raw;
  const el = $('#save-state');
  if (el) { el.innerHTML = `${icon(storageOK ? 'check' : 'x')}${storageOK ? '已保存在本机' : saveFailure==='conflict'?'其他窗口已保存新数据，请先导出当前备份再重开':'暂未保存，请到设置导出备份'}`; el.classList.toggle('save-failed', !storageOK); }
  return storageOK;
}
function toast(message, undo) {
  const topDialog = $$('dialog[open]').at(-1);
  (topDialog || document.body).append($('#toast'));
  clearTimeout(toastTimer); $('#toast-message').textContent = message;
  undoAction = undo; $('#toast-undo').hidden = !undo; $('#toast').classList.add('visible');
  toastTimer = setTimeout(()=>$('#toast').classList.remove('visible'), undo ? 8000 : 4300);
}
$('#toast-undo').onclick = () => { if (undoAction) undoAction(); $('#toast').classList.remove('visible'); undoAction = null; };
function closeDialog(dialog) { if (dialog.open) dialog.close(); }
function showDialog(id) { const el=$(id); if(!el.open) el.showModal(); }
function confirmAction(title, message, callback) { $('#confirm-title').textContent=title; $('#confirm-message').textContent=message; confirmCallback=callback; showDialog('#confirm-dialog'); }
$('#confirm-cancel').onclick=()=>closeDialog($('#confirm-dialog'));
$('#confirm-ok').onclick=()=>{ closeDialog($('#confirm-dialog')); const callback=confirmCallback;confirmCallback=null;callback?.(); };
$$('.close-modal').forEach(button=>button.onclick=()=>closeDialog(button.closest('dialog')));
$$('dialog.modal').forEach(d=>d.addEventListener('click',e=>{ if(e.target===d&&!updateLocked){ const b=d.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)d.close(); } }));
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
  renderTimeline(tasks,current);
  updateClocks();persist();
}
function renderTimeline(tasks,current) {
  const visible=tasks.filter(t=>filter==='all'||t.type===filter);
  if(!visible.length) { $('#timeline').innerHTML=`<div class="empty-state">${state.settings.pet?'<img class="empty-mascot" src="./assets/turtle-mascot.png" alt="小乌龟陪你安排新的一天">':'<div class="empty-icon">'+icon('sun')+'</div>'}<h3>${tasks.length?'这里还空着':'新的一天，怎么安排？'}</h3><button class="button secondary" data-add>加一项</button></div>`;return; }
  const at=now().getTime();
  const nextToStart=tasks.find(t=>!t.completed&&t.date===dateKey(new Date(at))&&taskStart(t)>at&&t.id!==state.session?.taskId);
  $('#timeline').innerHTML=visible.map((t,i)=>{
    const running=state.session?.taskId===t.id;
    const live=!t.completed&&t.id===current?.id&&(running||taskStart(t)<=at&&taskEnd(t)>at);
    const status=t.completed?'已完成':running?(state.session.paused?'休息中':'计时中'):taskEnd(t)<=at&&t.type==='study'?'待确认':'';
    const manualStart=t.id===nextToStart?.id&&t.id!==current?.id?`<button class="task-start" data-start="${escape(t.id)}" aria-label="现在开始：${escape(t.title)}" title="现在开始">${icon('play')}</button>`:'';
    const item=`<article class="timeline-item ${live?'is-current':''} ${t.completed?'is-completed':''}" data-type="${t.type}"><div class="time-column"><span class="start-time">${t.start}</span><span class="end-time">${t.end}</span></div><div class="timeline-rail"><span class="timeline-dot">${categoryIcon(t.type)}</span></div><button class="task-content" data-edit="${escape(t.id)}" aria-label="编辑${escape(t.title)}"><span class="task-meta"><span class="type-label">${TYPES[t.type]}</span>${status?`<span class="task-status ${live?'live':''}">${status}</span>`:''}</span><span class="task-name">${escape(t.title)}</span></button>${manualStart}<button class="task-check ${t.completed?'checked':''}" data-complete="${escape(t.id)}" aria-label="${t.completed?'撤销完成':'标记完成'}：${escape(t.title)}">${t.completed?icon('check'):''}</button><button class="task-edit" data-edit="${escape(t.id)}" aria-label="编辑${escape(t.title)}">${icon('more')}</button></article>`;
    const next=visible[i+1],gap=next?toMinutes(next.start)-toMinutes(t.end):0;
    return item+(filter==='all'&&gap>0?`<div class="gap-row"><span class="gap-line"></span><span class="gap-label">空闲 ${durationLabel(gap)}</span></div>`:'');
  }).join('');
}
let celebration = null;
const turtleTrips = new Map();
function tripFor(task) {
 const key=task?.id || 'idle';
 if(!turtleTrips.has(key)) turtleTrips.set(key,{position:0,progress:null,direction:1});
 return turtleTrips.get(key);
}
$$('.turtle-turn').forEach(button=>button.onclick=()=>{
 const task=getTask(button.closest('#focus-journey')?focusTaskId:currentId);
 tripFor(task).direction *= -1;
 updateClocks();
});
function syncTurtleJourney(el,task,progress) {
 const trip=tripFor(task);Object.assign(trip,advanceTurtle(trip,progress));
 el.style.setProperty('--task-progress',`${trip.progress*100}%`);
 const track=el.querySelector('[role="progressbar"]');
 track.setAttribute('aria-valuenow',String(Math.round(trip.progress*100)));
 el.querySelector('button').setAttribute('aria-label',`小乌龟向${trip.direction===1?'右':'左'}，点击调头`);
 el.querySelector('button').hidden=!state.settings.pet;
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
function frameCompanion(el,style,asset,options){
  const frame=companionFraming(style,asset,options);el.classList.add('companion-art');
  el.style.setProperty('--companion-scale',String(frame.scale));el.style.setProperty('--companion-x',`${frame.x}%`);el.style.setProperty('--companion-y',`${frame.y}%`);
}
function renderCompanionPreviews(){
  $$('[data-companion-preview]').forEach(el=>{
    const style=el.dataset.companionPreview,animated=!reducedMotion.matches;
    const src=style==='original'?'./assets/turtle-mascot.png':companionAsset(style,'ready',animated);
    if(el.getAttribute('src')!==src)el.setAttribute('src',src);
    frameCompanion(el,style,'ready',{animated,preview:true});
  });
}
reducedMotion.addEventListener('change', () => {renderCompanionPreviews();updateMascots(now().getTime());});
document.addEventListener('visibilitychange', () => updateMascots(now().getTime()));
function updateMascots(at) {
  if(updateLocked)return;
  const celebrate = celebration && Date.now() < celebration.until && state.selectedDate === celebration.date;
  const apply = (el, task, extra = false) => {
    const active=task&&state.session?.taskId===task.id;
    const end=active?sessionDeadlineMs(state.session,task,at):task&&taskEnd(task);
    const start=active?Math.min(taskStart(task),state.session.startedAt):task&&taskStart(task);
    const mood = mascotMood({task, session: state.session, at, start, end, celebrating: extra});
    // Blender-rendered joint animation. Switch sources only when needed so
    // the frame sequence keeps playing across clock ticks.
    const animated = state.settings.pet && !reducedMotion.matches && !document.hidden;
    const asset = mood==='happy'?'happy-jump':mood==='walking'?`walking-${tripFor(task).direction===1?'right':'left'}`:mood;
    const src = companionAsset(state.settings.companion, asset, animated);
    frameCompanion(el,state.settings.companion,asset,{animated});
    el.classList.toggle('face-right', mood!=='walking' && mood!=='happy' && tripFor(task).direction===1 && !!el.closest('.turtle-turn'));
    el.classList.toggle('face-right-static', !animated && tripFor(task).direction===1 && !!el.closest('.turtle-turn'));
    if (el.getAttribute('src') !== src) el.setAttribute('src', src);
    if (el.dataset.mood !== mood) { el.dataset.mood = mood; el.alt = moodLabels[mood]; }
  };
  apply($('.pet-illustration'), getTask(currentId), celebrate);
  $('.pet-illustration').hidden=!state.settings.pet || !celebrate;
  apply($('.progress-turtle'), getTask(currentId));
  apply($('.focus-pet img'), getTask(focusTaskId));
  apply($('.finish-mascot'), getTask(finishTaskId));
  $$('.empty-mascot').forEach(el => apply(el, null));
}
function celebrateTask(t) {
  celebration = {date:t.date, until:Date.now()+5000};
  updateMascots(now().getTime());
}
function updateClocks() {
  const n=now(),at=n.getTime(),t=getTask(currentId);
  updateMascots(at);
  $('#clock-mode').textContent=`${state.clock.mode==='demo'?'演示':'北京'} ${clockText(n)}`;
  $('#demo-clock').title=`${state.clock.mode==='demo'?'演示时间':'北京时间'} · GMT+8`;
  const active=t&&state.session?.taskId===t.id;
  const upcoming=t&&!active&&taskStart(t)>at;
  const partsNow=clockParts(n);
  const sec=t?(upcoming?(taskStart(t)-at)/1000:timerSeconds(t,at)):partsNow.hours*3600+partsNow.minutes*60+partsNow.seconds;
  const countdown=upcoming?compactCountdown(sec):{days:0,clockSeconds:sec};
  const parts=formatSeconds(countdown.clockSeconds).split(':');
  $('#main-timer').innerHTML=`${parts[0]}<span>:</span>${parts[1]}<small>:${parts[2]}</small>`;
  $('#timer-caption').textContent=!t?'现在':upcoming?(countdown.days?`距离开始 · ${countdown.days} 天`:'距离开始'):timerSeconds(t,at)<=0?'时间到！':'距离结束';
  const mainFraction=taskProgress(t,state.session,at);
  syncTurtleJourney($('#main-journey'),t,mainFraction);
  const ftProgress=getTask(focusTaskId);
  const focusFraction=taskProgress(ftProgress,state.session,at);
  syncTurtleJourney($('#focus-journey'),ftProgress,focusFraction);
  updateMascots(at);
  $('#session-badge').textContent=!t?'自由时刻':t.completed?'已完成':active?(state.session.paused?'休息中':'计时中'):taskEnd(t)<=at?'待确认':upcoming?'即将开始':'准备开始';
  let ms=state.history.filter(h=>h.date===state.selectedDate&&(h.type||getTask(h.taskId)?.type)==='study').reduce((sum,h)=>sum+h.ms,0);
  if(state.session?.date===state.selectedDate&&getTask(state.session.taskId)?.type==='study')ms+=sessionMs(at);
  $('#focused-count').innerHTML=`${Math.floor(ms/60000)}<span> 分钟</span>`;
  if($('#focus-dialog').open) {
    const ft=getTask(focusTaskId);if(!ft)return;
    $('#focus-title').textContent=ft.title;
    $('#focus-timer').textContent=formatSeconds(timerSeconds(ft,at));
    const active=state.session?.taskId===ft.id;
    const deadline=active?sessionDeadlineMs(state.session,ft,at):taskEnd(ft);
    $('#focus-end').textContent=`计划在 ${clockText(new Date(deadline))} 结束 · ${TYPES[ft.type]}`;
    const breakLeft=active?sessionBreakRemainingMs(state.session,ft,at):0;
    $('#focus-status').textContent=active?(state.session.paused?`休息 ${formatSeconds(breakLeft/1000).slice(3)} · 到点自动继续`:'专注这一件！'):'准备，开始！';
    $('#pause-session').innerHTML=`${icon(active&&!state.session.paused?'pause':'play')}<span>${active?(state.session.paused?'结束休息':'休息 5 分钟'):'开始计时'}</span>`;
  }
}

function openTask(id,template) {
  const t=getTask(id);$('#task-form').reset();$('#form-error').textContent='';
  $('#task-id').value=t?.id||'';$('#task-title').value=t?.title||'';
  const start=suggestStartMinutes(dayTasks(),state.selectedDate,now().getTime());
  $('#task-start').value=t?.start||toTime(start);$('#task-end').value=t?.end||toTime(Math.min(start+30,MAX_PICKER_MINUTES));
  timePicker.sync();
  $(`input[name="task-type"][value="${t?.type||'study'}"]`).checked=true;
  $('#task-dialog-title').textContent=t?'编辑安排':'添加安排';$('#delete-task').hidden=!t;
  showDialog('#task-dialog');if(template)applyTemplate(template);
}
const templates={study:{title:'学习',type:'study'},meal:{title:'吃饭',type:'life'},sport:{title:'运动',type:'life'},game:{title:'游戏',type:'play'}};
function applyTemplate(key) { if(!Object.hasOwn(templates,key))return;const t=templates[key];$('#task-title').value=t.title;$(`input[name="task-type"][value="${t.type}"]`).checked=true; }
$('#task-form').onsubmit=e=>{
  e.preventDefault();const old=getTask($('#task-id').value);
  const title=$('#task-title').value.trim(),type=$('input[name="task-type"]:checked').value;
  const task={...old,id:old?.id||crypto.randomUUID(),date:state.selectedDate,title,start:$('#task-start').value,end:$('#task-end').value,type,subject:type==='study'?(title.includes('语文')?'语文':/数学|AMC/i.test(title)?'数学':title.includes('英语')?'英语':title.includes('科学')?'科学':''):'',completed:old?.completed||false};
  const error=validateTask(task,state.tasks);if(error){$('#form-error').textContent=error;return;}
  if(!old||old.start!==task.start||old.end!==task.end){
    if(!isWithinSchedulingWindow(task.start,{maxMinutes:MAX_START_MINUTES})){$('#form-error').textContent='开始时间请选择 08:00–21:00。';return;}
    if(!isWithinSchedulingWindow(task.end)){$('#form-error').textContent='结束时间请选择 08:00–21:50。';return;}
  }
  if(state.session?.taskId===task.id&&(old.start!==task.start||old.end!==task.end||old.type!==task.type))stopSession();
  if(old)state.tasks=state.tasks.map(t=>t.id===old.id?task:t);else state.tasks.push(task);
  persist();closeDialog($('#task-dialog'));render();toast(storageOK?(old?'安排已更新，后面的时间保持不变。':'新安排已保存，慢慢来就好。'):'当前更改暂未保存，请检查浏览器存储。');
};
$('#delete-task').onclick=()=>{
  const t=getTask($('#task-id').value);if(!t)return;
  confirmAction('删除这项安排？',`“${t.title}”将从这一天移除，其他安排保持原时间。`,()=>{
    if(state.session?.taskId===t.id)stopSession();state.tasks=state.tasks.filter(x=>x.id!==t.id);persist();closeDialog($('#task-dialog'));render();
    toast('安排已删除。',()=>{if(validateTask(t,state.tasks)){toast('原时间已有其他安排，请重新添加。');return;}state.tasks.push(t);persist();render();});
  });
};
$('#template-chips').onclick=e=>{const b=e.target.closest('[data-template]');if(b)applyTemplate(b.dataset.template);};
$('#add-task').onclick=$('#add-timeline').onclick=()=>openTask();
$('#templates-nav').onclick=()=>{closeDialog($('#settings-dialog'));openTask();$('#template-chips').classList.add('highlight');setTimeout(()=>$('#template-chips').classList.remove('highlight'),1800);};
$('#timeline').onclick=e=>{
  const edit=e.target.closest('[data-edit]'),complete=e.target.closest('[data-complete]'),start=e.target.closest('[data-start]');
  if(start)startTask(getTask(start.dataset.start));else if(edit)openTask(edit.dataset.edit);else if(complete){const t=getTask(complete.dataset.complete);t.completed?undoComplete(t):completeTask(t);}else if(e.target.closest('[data-add]'))openTask();
};
function completeTask(t) {
  if(!t)return;const was=t.completed;if(state.session?.taskId===t.id)stopSession();t.completed=true;celebration={date:t.date,until:Date.now()+5000};
  closeDialog($('#focus-dialog'));closeDialog($('#finish-dialog'));persist();render();
  playTurtle('complete');
  toast(`${t.title}完成啦，给自己一点掌声。`,()=>{celebration=null;t.completed=was;persist();render();});
}
function undoComplete(t){celebration=null;t.completed=false;persist();render();toast('已恢复为待完成，不会增加专注记录。');}
function startTask(t) {
  if(!t)return;
  if(t.date!==dateKey(now())){openTask(t.id);toast('请在计划当天开始计时。');return;}
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
$('#focus-sound').onclick=()=>{state.settings.sound=!state.settings.sound;if(!state.settings.sound)voicePlayer.stop();persist();toast(state.settings.sound?'声音提醒已开启。':'声音提醒已关闭。');};
function openFinish(t) { finishTaskId=t.id;$('#finish-title').textContent=`${t.title}做完了吗？`;$('#finish-error').textContent='';closeDialog($('#focus-dialog'));showDialog('#finish-dialog');updateMascots(now().getTime()); }
$('#finish-done').onclick=()=>completeTask(getTask(finishTaskId));
$('#finish-later').onclick=()=>{closeDialog($('#finish-dialog'));toast('已经记下，安排下一段时间时再接着做。');};
$('#finish-extend').onclick=()=>{
  const t=getTask(finishTaskId);if(!t)return;
  if(t.date!==dateKey(now())){$('#finish-error').textContent='这项属于其他日期，请在时间表中另安排一段时间。';return;}
  const ending=Math.max(toMinutes(t.end),clockMinutes(now()))+10;
  if(ending>MAX_PICKER_MINUTES){$('#finish-error').textContent='今天最晚安排到 21:50，请另选时间继续。';return;}
  const updated={...t,end:toTime(ending),completed:false};const error=validateTask(updated,state.tasks);
  if(error){$('#finish-error').textContent=error+' 请返回时间表调整。';return;}
  Object.assign(t,updated);closeDialog($('#finish-dialog'));persist();render();startTask(t);toast(`再给自己 10 分钟，计划 ${t.end} 结束。`);
};

function setDate(value) { if(!Number.isFinite(dateAtTime(value).getTime()))return;state.selectedDate=value;filter='all';$$('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===filter));persist();render(); }
function moveDate(amount){const value=shiftDate(state.selectedDate,amount);if(value)setDate(value);}
$('#prev-day').onclick=()=>moveDate(-1);$('#next-day').onclick=()=>moveDate(1);$('#day-picker').onchange=e=>setDate(e.target.value);
$('#today-nav').onclick=()=>{closeDialog($('#settings-dialog'));setDate(dateKey(now()));};
$$('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;$$('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));$('.schedule-more').open=false;render();});
$('#copy-day').onclick=()=>{$('#copy-date').value=shiftDate(state.selectedDate,1);$('#copy-error').textContent='';showDialog('#copy-dialog');};
$('#confirm-copy').onclick=()=>{
  const date=$('#copy-date').value;if(!date){$('#copy-error').textContent='请选择要复制到的日期。';return;}
  if(date===state.selectedDate){$('#copy-error').textContent='请选择另一天，避免重复安排。';return;}
  const copies=dayTasks().map(t=>({...t,id:crypto.randomUUID(),date,completed:false}));
  for(const t of copies){const error=validateTask(t,state.tasks);if(error){$('#copy-error').textContent=`${date} 已有时间冲突，请换一天或先调整安排。`;return;}}
  state.tasks.push(...copies);persist();closeDialog($('#copy-dialog'));setDate(date);toast('安排已复制，新的一天慢慢来。');
};
$('#demo-clock').onclick=()=>showDialog('#clock-dialog');
function changeClock(value) {
  const change=()=>{stopSession();closeDialog($('#focus-dialog'));closeDialog($('#finish-dialog'));state.clock=value==='real'?{mode:'real'}:{mode:'demo',simulatedAt:dateAtTime(state.selectedDate,value).getTime(),anchor:Date.now()};state.selectedDate=dateKey(now());lastTick=now().getTime();closeDialog($('#clock-dialog'));persist();render();toast(value==='real'?'已切换到北京时间（GMT+8）。':`已来到 ${value}，体验这一段时间。`);};
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
$('#settings-dialog').addEventListener('close',()=>sceneVoiceSettings.close());
$('#save-settings').onclick=()=>{
  if(sceneVoiceSettings.isBusy()){toast('请先结束录音，等整理完成后再保存设置。');return;}
  const settings={sound:$('#sound-enabled').checked,pet:$('#pet-enabled').checked,companion:normalizeCompanion($('[name=companion]:checked')?.value),code:$('#family-code').value.trim(),message:$('#family-message').value.trim(),voice:null,voices:sceneVoiceSettings.getVoices()};
  // Commit all seven recordings together. On storage failure, keep both the
  // previous saved state and this open draft so it can be shortened or retried.
  const saved=commitLocalState({storage:stateStorage,key:STORE,expectedRaw:lastStoredRaw,value:{...state,settings}});
  if(!saved.ok){toast(saved.reason==='conflict'?'其他窗口已保存新数据。设置和录音草稿尚未保存，请暂时不要关闭本页；导出的备份不包含这些草稿。':'本机存储空间不足或不可用，录音尚未保存。请缩短录音后再试，原设置已保留。');return;}
  lastStoredRaw=saved.raw;
  state.settings=settings;persist();closeDialog($('#settings-dialog'));render();
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
    $('#backup-result').textContent = '备份已生成，请保存在“文件”App 中。包含已保存的家庭设置和录音。';
    toast('备份文件已生成，请保存到“文件”。');
  } catch (error) { $('#backup-result').textContent = error.message || '备份未能生成，请重试。'; }
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
    confirmAction('恢复这份备份？', `包含 ${restored.tasks.length} 项安排、${restored.history.length} 条专注记录${countSceneVoices(restored.settings) ? `和 ${countSceneVoices(restored.settings)} 段情景录音` : ''}。将替换本机现有数据及未保存的设置；建议先导出本机备份。专注记录会保留，恢复后请手动开始计时。`, () => {
      if (!backupImportIsCurrent(generation)) return;
      try { const serialized=JSON.stringify(restored);localStorage.setItem(STORE, serialized);lastStoredRaw=serialized; }
      catch { toast('本机存储空间不足或不可用，恢复未完成，原数据已保留。'); return; }
      voicePlayer.stop();
      $$('dialog[open]').forEach(closeDialog);
      state = restored; storageOK = true;
      currentId = focusTaskId = finishTaskId = null;
      celebration = null; turtleTrips.clear(); filter = 'all';
      $$('[data-filter]').forEach(button => button.classList.toggle('active', button.dataset.filter === 'all'));
      lastTick = now().getTime(); lastMinute = ''; render();
      toast('备份已恢复，正在使用真实时间。');
    });
  } catch (error) { if (backupImportIsCurrent(generation)) $('#backup-result').textContent = error.message || '无法读取这份备份，原数据未改变。'; }
  finally { if (generation === backupImportGeneration) setBackupImportBusy(false); }
};
$('#reset-demo').onclick=()=>confirmAction('重新体验示例？','当前浏览器中的计划和专注记录会重置，家庭设置会保留。',()=>{const resetDate=dateKey(new Date());state.tasks=createSampleTasks(resetDate);state.history=[];state.session=null;state.notified=[];state.selectedDate=resetDate;state.clock={mode:'demo',simulatedAt:dateAtTime(resetDate,"10:20").getTime(),anchor:Date.now()};lastTick=now().getTime();closeDialog($('#settings-dialog'));closeDialog($('#focus-dialog'));closeDialog($('#finish-dialog'));filter='all';$$('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter==='all'));persist();render();toast('示例已就绪，开工！');});

function tick({ silent = false } = {}) {
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
  const due=collectDueReminders(state.tasks,{fromMs:lastTick,toMs:at,activeTaskId:state.session?.taskId,finishedTaskId:finishedTask?.id,notified:state.notified});
  const messages=due.map(event=>event.text);
  for(const event of due){state.notified.push(event.key);reminderVoice ||= event.voice;}
  if(messages.length){toast(messages.join(' '));persist();}
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
    pendingAction:['#copy-dialog','#confirm-dialog','#clock-dialog','#finish-dialog'].some(selector=>$(selector).open),
  }),
  persist:()=>{
    const current=localStorage.getItem(STORE);
    // Another clean window can have an older in-memory snapshot. Its update
    // must retain the latest shared data rather than write the old snapshot.
    if(current!==lastStoredRaw){const saved=JSON.parse(current);return saved?.version===1&&Array.isArray(saved.tasks)&&!!saved.settings;}
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
function adoptStoredState(raw){
  const saved=JSON.parse(raw);
  if(saved?.version!==1||!Array.isArray(saved.tasks)||!saved.settings)return;
  state=saved;state.settings.companion=normalizeCompanion(state.settings.companion);state.settings.voices=normalizeSceneVoices(state.settings);
  state.history||=[];state.notified||=[];lastStoredRaw=raw;storageOK=true;
  if($('#settings-dialog').open){
    $('#family-code').value=state.settings.code;$('#family-message').value=state.settings.message;
    $('#sound-enabled').checked=state.settings.sound;$('#pet-enabled').checked=state.settings.pet;
    $$('[name=companion]').forEach(input=>input.checked=input.value===state.settings.companion);
    sceneVoiceSettings.open(state.settings);
  }
  if($('#focus-dialog').open&&state.session)focusTaskId=state.session.taskId;
  render();
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
setIcons();setCategoryIcons();renderCompanionPreviews();
// Upgrade old demo installs once; an explicit later demo selection is retained.
if (!state.localUseVersion) {
  if (state.clock.mode === 'demo') { stopSession(); state.clock = { mode: 'real' }; state.selectedDate = actualToday; }
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
render();setInterval(tick,1000);
window.addEventListener('homework-offline-ready', () => toast('离线准备完成，可以添加到主屏幕啦。'));
document.addEventListener('visibilitychange',()=>{
  if(document.hidden) { voicePlayer.stop(); return; }
  // Refresh fixed deadlines without replaying reminders missed while away.
  lastTick=now().getTime();tick({silent:true});
});
