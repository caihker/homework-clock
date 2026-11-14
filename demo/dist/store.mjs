/** Pure load/normalize helpers for the single local state snapshot. */
import { dateAtTime, TASK_TYPES, validateTask } from './core.mjs';
import { normalizeCompanion } from './companion.mjs';
import { normalizeSceneVoices } from './scene-voices.mjs';
import { STATE_KEY, STATE_VERSION, RECOVERY_KEY, NOTE_MAX_LENGTH, TEMPLATE_MIN_MINUTES, TEMPLATE_MAX_MINUTES } from './schema.mjs';

export { STATE_KEY, STATE_VERSION, RECOVERY_KEY, NOTE_MAX_LENGTH, TEMPLATE_MIN_MINUTES, TEMPLATE_MAX_MINUTES };

const types = new Set(TASK_TYPES);
const TEMPLATE_TYPES = types;
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

/** A reusable plan template: title, type and duration (no calendar date). */
export function isStoredTemplateValid(template) {
  if (!record(template) || typeof template.id !== 'string' || !template.id.trim()) return false;
  if (typeof template.title !== 'string' || !template.title.trim() || template.title.length > 60) return false;
  if (!TEMPLATE_TYPES.has(template.type)) return false;
  return Number.isInteger(template.duration) && template.duration >= TEMPLATE_MIN_MINUTES && template.duration <= TEMPLATE_MAX_MINUTES;
}

/** A dated note has no time window; only its date and text are required. */
export function isStoredNoteValid(note) {
  if (!record(note) || typeof note.id !== 'string' || !note.id.trim()) return false;
  if (typeof note.date !== 'string' || !Number.isFinite(dateAtTime(note.date).getTime())) return false;
  return typeof note.text === 'string' && note.text.trim().length > 0 && note.text.length <= NOTE_MAX_LENGTH;
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
  let droppedNotes = 0;
  const notes = (Array.isArray(value.notes) ? value.notes : []).filter(note => {
    if (isStoredNoteValid(note)) return true;
    droppedNotes += 1;
    return false;
  });
  let droppedTemplates = 0;
  const templates = (Array.isArray(value.templates) ? value.templates : []).filter(template => {
    if (isStoredTemplateValid(template)) return true;
    droppedTemplates += 1;
    return false;
  });
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
      notes,
      templates,
      session,
      notified,
      clock,
    },
    droppedTasks,
    droppedHistory: (Array.isArray(value.history) ? value.history.length : 0) - history.length,
    droppedNotes,
    droppedTemplates,
  };
}

/** On a new real-world day, default the schedule to today; demo dates are intentional. */
export function dailyDate({ selectedDate, lastActiveDate, clockMode, today }) {
  if (!today) return selectedDate;
  if (clockMode === 'demo') return selectedDate;
  return lastActiveDate === today ? selectedDate : today;
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

/**
 * Read and normalize the single snapshot without owning recovery-UI policy.
 * Returns the raw bytes so the caller can preserve them before any write.
 */
export function inspectStorage({ storage, key = STATE_KEY, today, defaults = {}, createSampleState }) {
  if (typeof createSampleState !== 'function') throw new TypeError('inspectStorage needs createSampleState');
  let raw = null;
  let storageOK = true;
  try { raw = storage.getItem(key); } catch { storageOK = false; }
  if (!storageOK) return { status: 'empty', storageOK: false, raw, state: createSampleState(), loadIssue: null };
  const stored = classifyStoredState(raw);
  if (stored.status === 'ok') {
    const normalized = normalizeStoredState(stored.value, { defaults, today });
    const dropped = normalized.droppedTasks + normalized.droppedHistory + normalized.droppedNotes + normalized.droppedTemplates;
    return {
      status: 'ok', storageOK: true, raw, state: normalized.state,
      loadIssue: dropped ? { status: 'partial', dropped, preserved: false } : null,
    };
  }
  if (stored.status === 'empty') {
    return { status: 'empty', storageOK: true, raw, state: createSampleState(), loadIssue: null };
  }
  return {
    status: stored.status, storageOK: true, raw, state: createSampleState(),
    loadIssue: { status: stored.status === 'future' ? 'future' : 'invalid', version: stored.version, reason: stored.reason },
  };
}

/** Notes attached to one calendar day, preserving insertion order. */
export function notesForDate(notes, date) {
  return (Array.isArray(notes) ? notes : []).filter(note => note && note.date === date);
}
