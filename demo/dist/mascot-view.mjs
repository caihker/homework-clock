/** Companion/turtle rendering: moods, animation frames, progress and celebration. */
import { companionAsset, companionFraming, normalizeCompanion } from './companion.mjs';
import { advanceTurtle } from './turtle-travel.mjs?v=progress-sync-1';
import { mascotMood, moodLabels } from './mascot.mjs';
import { sessionDeadlineMs } from './session-timer.mjs';

export function createMascotView({
  $, $$, taskStart, taskEnd, getState, getTask, getCurrentId, getFocusTaskId, getFinishTaskId,
  getNow, isUpdateLocked, reducedMotion,
}) {
  let celebration = null;
  const turtleTrips = new Map();

  function tripFor(task) {
    const key = task?.id || 'idle';
    if (!turtleTrips.has(key)) turtleTrips.set(key, { position: 0, progress: null, direction: 1 });
    return turtleTrips.get(key);
  }
  function turn(task) { tripFor(task).direction *= -1; }
  function syncTurtleJourney(el, task, progress) {
    const trip = tripFor(task);
    Object.assign(trip, advanceTurtle(trip, progress));
    el.style.setProperty('--task-progress', `${trip.progress * 100}%`);
    const track = el.querySelector('[role="progressbar"]');
    track.setAttribute('aria-valuenow', String(Math.round(trip.progress * 100)));
    el.querySelector('button').setAttribute('aria-label', `小乌龟向${trip.direction === 1 ? '右' : '左'}，点击调头`);
    el.querySelector('button').hidden = !getState().settings.pet;
  }
  function frameCompanion(el, style, asset, options) {
    el.dataset.companionStyle = normalizeCompanion(style);
    const frame = companionFraming(style, asset, options);
    el.classList.add('companion-art');
    el.style.setProperty('--companion-scale', String(frame.scale));
    el.style.setProperty('--companion-x', `${frame.x}%`);
    el.style.setProperty('--companion-y', `${frame.y}%`);
  }
  function renderCompanionPreviews() {
    $$('[data-companion-preview]').forEach(el => {
      // Keep the settings preview static: switching to the solid style must not
      // pull its animation frames into the launch path.
      const style = el.dataset.companionPreview;
      const src = style === 'original' ? './assets/turtle-mascot.png' : companionAsset(style, 'ready', false);
      if (el.getAttribute('src') !== src) el.setAttribute('src', src);
      frameCompanion(el, style, 'ready', { animated: false, preview: true });
    });
  }
  /** Fall back to the cached still frame when a lazy companion frame cannot load. */
  function companionFallback(el) {
    const style = normalizeCompanion(el.dataset.companionStyle || el.dataset.companionPreview || 'original');
    el.dataset.companionFallback = style;
    const still = style === 'solid' ? './assets/motion-solid/still.png' : './assets/turtle-mascot.png';
    if (el.getAttribute('src') !== still) el.setAttribute('src', still);
  }
  document.addEventListener('error', event => {
    const el = event.target;
    if (el instanceof HTMLImageElement && el.classList.contains('companion-art')) companionFallback(el);
  }, true);
  // A later online session may fetch the lazy frames again.
  window.addEventListener('online', () => $$('.companion-art').forEach(el => { delete el.dataset.companionFallback; }));

  function updateMascots(at) {
    if (isUpdateLocked()) return;
    const state = getState();
    const celebrateNow = celebration && Date.now() < celebration.until && state.selectedDate === celebration.date;
    const apply = (el, task, extra = false) => {
      if (!el) return;
      const active = task && state.session?.taskId === task.id;
      const end = active ? sessionDeadlineMs(state.session, task, at) : task && taskEnd(task);
      const start = active ? Math.min(taskStart(task), state.session.startedAt) : task && taskStart(task);
      const mood = mascotMood({ task, session: state.session, at, start, end, celebrating: extra });
      // Blender-rendered joint animation. Switch sources only when needed so
      // the frame sequence keeps playing across clock ticks. The non-default
      // style is lazy: if its frame cannot load, stay on the cached still frame.
      const style = normalizeCompanion(state.settings.companion);
      const animated = state.settings.pet && !reducedMotion.matches && !document.hidden && el.dataset.companionFallback !== style;
      const asset = mood === 'happy' ? 'happy-jump' : mood === 'walking' ? `walking-${tripFor(task).direction === 1 ? 'right' : 'left'}` : mood;
      const src = companionAsset(style, asset, animated);
      frameCompanion(el, style, asset, { animated });
      el.classList.toggle('face-right', mood !== 'walking' && mood !== 'happy' && tripFor(task).direction === 1 && !!el.closest('.turtle-turn'));
      el.classList.toggle('face-right-static', !animated && tripFor(task).direction === 1 && !!el.closest('.turtle-turn'));
      if (el.getAttribute('src') !== src) el.setAttribute('src', src);
      if (el.dataset.mood !== mood) { el.dataset.mood = mood; el.alt = moodLabels[mood]; }
    };
    apply($('.pet-illustration'), getTask(getCurrentId()), celebrateNow);
    $('.pet-illustration').hidden = !state.settings.pet || !celebrateNow;
    apply($('.progress-turtle'), getTask(getCurrentId()));
    apply($('.focus-pet img'), getTask(getFocusTaskId()));
    apply($('.finish-mascot'), getTask(getFinishTaskId()));
    $$('.empty-mascot').forEach(el => apply(el, null));
  }
  function celebrate(task) {
    celebration = { date: task.date, until: Date.now() + 5000 };
    updateMascots(getNow().getTime());
  }
  function reset() {
    celebration = null;
    turtleTrips.clear();
  }
  reducedMotion.addEventListener('change', () => { renderCompanionPreviews(); updateMascots(getNow().getTime()); });
  document.addEventListener('visibilitychange', () => updateMascots(getNow().getTime()));

  return { updateMascots, syncTurtleJourney, renderCompanionPreviews, celebrate, reset, turn };
}
