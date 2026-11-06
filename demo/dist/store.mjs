/** Pure load/normalize helpers for the single local state snapshot. */
import { dateAtTime, TASK_TYPES, validateTask } from './core.mjs';
import { normalizeCompanion } from './companion.mjs';
import { normalizeSceneVoices } from './scene-voices.mjs';

export const STATE_KEY = 'homework-clock-demo-v1';
export const STATE_VERSION = 1;
/** The last unreadable snapshot is kept here so it can still be exported. */
export const RECOVERY_KEY = 'homework-clock-demo-v1-recovery';

const types = new Set(TASK_TYPES);
const record = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * Classify raw localStorage bytes without modifying them. `invalid` and
 * `future` mean the caller must preserve the raw value and stop auto-saving.
 */
export function classifyStoredState(raw) {
  if (raw === null || raw === undefined || raw === '') return { status: 'empty' };
  let value;
  try { value = JSON.parse(raw); } catch { return { status: 'invalid', reason: 'json' }; }
  if (!record(value)) return { status: 'invalid', reason: 'shape' };
  if (!Number.isInteger(value.version) || value.version < 1) return { status: 'invalid', reason: 'version' };
  if (value.version > STATE_VERSION) return { status: 'future', version: value.version };
  if (value.version !== STATE_VERSION) return { status: 'invalid', reason: 'version' };
  if (!Array.isArray(value.tasks)) return { status: 'invalid', reason: 'tasks' };
  if (!record(value.settings)) return { status: 'invalid', reason: 'settings' };
  return { status: 'ok', value };
}

/** A task is readable only when it is complete enough to show and time. */
export function isStoredTaskValid(task) {
  if (!record(task) || typeof task.id !== 'string' || !task.id.trim() || !types.has(task.type)) return false;
  if (typeof task.date !== 'string' || !Number.isFinite(dateAtTime(task.date).getTime())) return false;
  return !validateTask(task, []);
}

/**
 * Build a fresh, normalized state from a structurally valid snapshot.
 * Unknown top-level fields are retained; unreadable entries are dropped and
 * counted so the caller can warn instead of silently discarding them.
 */
export function normalizeStoredState(value, { defaults = {}, today } = {}) {
  const settings = { ...defaults, ...(record(value.settings) ? value.settings : {}) };
  settings.companion = normalizeCompanion(settings.companion);
  settings.voices = normalizeSceneVoices(settings);
  // A legacy single recording is migrated into settings.voices.
  settings.voice = null;
  if (['小熊开工啦！', '小熊开工了'].includes(settings.code) && own(defaults, 'code')) settings.code = defaults.code;
  let droppedTasks = 0;
  const tasks = (Array.isArray(value.tasks) ? value.tasks : []).filter(task => {
    if (isStoredTaskValid(task)) return true;
    droppedTasks += 1;
    return false;
  });
  const history = (Array.isArray(value.history) ? value.history : [])
    .filter(entry => record(entry) && Number.isFinite(entry.ms) && entry.ms >= 0);
  const notified = pruneNotified(value.notified, today);
  let selectedDate = today;
  if (Number.isFinite(dateAtTime(value.selectedDate).getTime())) selectedDate = value.selectedDate;
  const session = record(value.session) ? value.session : null;
  const clock = record(value.clock) && (value.clock.mode === 'real' ||
    (value.clock.mode === 'demo' && Number.isFinite(value.clock.simulatedAt) && Number.isFinite(value.clock.anchor)))
    ? value.clock
    : { mode: 'real' };
  return {
    state: {
      ...value,
      version: STATE_VERSION,
      tasks,
      settings,
      selectedDate,
      history,
      session,
      notified,
      clock,
    },
    droppedTasks,
    droppedHistory: (Array.isArray(value.history) ? value.history.length : 0) - history.length,
  };
}

/** Reminder keys carry their GMT+8 day, so only today's keys need to be kept. */
export function pruneNotified(notified, today) {
  if (typeof today !== 'string' || !today) return [];
  const prefix = `${today}:`;
  return (Array.isArray(notified) ? notified : [])
    .filter(key => typeof key === 'string' && key.length <= 300 && key.startsWith(prefix));
}

/**
 * Pick the most faithful bytes to hand to the user. A preserved recovery copy
 * or the original unreadable snapshot must win over the normalized live state,
 * which may already contain sample data or dropped records.
 */
export function chooseRecoveryExport({ recoveryRaw = null, originalRaw = null, serializedState = '' } = {}) {
  for (const value of [recoveryRaw, originalRaw]) {
    if (typeof value === 'string' && value.length > 0) return { text: value, kind: 'recovered' };
  }
  if (typeof serializedState === 'string' && serializedState.length > 0) return { text: serializedState, kind: 'current' };
  return null;
}
