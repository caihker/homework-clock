import { normalizeCompanion } from './companion.mjs';
import { dateAtTime, dateKey, toMinutes, validateTask } from './core.mjs';
import { sessionElapsedMs } from './session-timer.mjs';
import { SCENES, normalizeSceneVoices } from './scene-voices.mjs';
import { readEmbeddedAudio } from './audio-format.mjs';

export const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
const MAX_RECORDING_BYTES = 1024 * 1024;
const SCENE_KEYS = SCENES.map(scene => scene.key);
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TIMESTAMP = Date.UTC(10000, 0, 1) - 1;
const SCHEMA = 'homework-clock-backup';
const TYPES = new Set(['study', 'life', 'play']);
const DEFAULT_SETTINGS = { sound: true, pet: true, code: '小皮开工了', message: '先做一道，进入状态就容易啦。', voice: null };

function fail(message = '备份内容不完整或格式不正确，请选择作业时钟导出的文件。') {
  throw new Error(message);
}

function record(value, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  if (Object.keys(value).some(key => !allowedKeys.includes(key))) fail();
  return value;
}

function text(value, max, { empty = false } = {}) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail();
  return value;
}

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) fail('备份中有无效日期，未恢复任何数据。');
  const date = dateAtTime(value);
  if (dateKey(date) !== value) fail('备份中有无效日期，未恢复任何数据。');
  return value;
}

function timestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) fail('备份中的计时数据不正确。');
  return value;
}

function milliseconds(value, max = DAY_MS) {
  if (!Number.isFinite(value) || value < 0 || value > max) fail('备份中的专注时长不正确。');
  return value;
}

function boolean(value) {
  if (typeof value !== 'boolean') fail();
  return value;
}

function list(value, max) {
  if (!Array.isArray(value) || value.length > max) fail('备份中的记录数量超出支持范围。');
  return value;
}

function recording(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_RECORDING_BYTES / 3) * 4 + 280) fail('备份中的录音过大或格式不正确。');
  // Only self-contained audio is restored. Never fetch an imported URL.
  const audio = readEmbeddedAudio(value);
  if (!audio) fail('备份中的录音格式不正确。');
  if (audio.bytes > MAX_RECORDING_BYTES) fail('备份中的录音超过 1 MB，请使用较小的备份。');
  return audio.source;
}

function settings(value) {
  record(value, ['sound', 'pet', 'companion', 'code', 'message', 'voice', 'voices']);
  // Validate before migration: imported audio must remain embedded and bounded,
  // including a legacy recording that is superseded by a scene override.
  const legacyVoice = recording(value.voice);
  let voices;
  if (value.voices !== undefined) {
    record(value.voices, SCENE_KEYS);
    voices = Object.fromEntries(Object.entries(value.voices)
      .filter(([, voice]) => voice !== undefined)
      .map(([key, voice]) => [key, recording(voice)]));
  }
  return {
    sound: value.sound === undefined ? DEFAULT_SETTINGS.sound : boolean(value.sound),
    companion: normalizeCompanion(value.companion),
    pet: value.pet === undefined ? DEFAULT_SETTINGS.pet : boolean(value.pet),
    code: value.code === undefined ? DEFAULT_SETTINGS.code : text(value.code, 40, { empty: true }),
    message: value.message === undefined ? DEFAULT_SETTINGS.message : text(value.message, 120, { empty: true }),
    voice: null,
    voices: normalizeSceneVoices({ voice: legacyVoice, ...(voices === undefined ? {} : { voices }) }),
  };
}

function tasks(value) {
  const ids = new Set();
  const days = new Map();
  const result = list(value, 20000).map(task => {
    record(task, ['id', 'date', 'title', 'start', 'end', 'type', 'subject', 'completed']);
    const clean = {
      id: text(task.id, 200),
      date: calendarDate(task.date),
      title: text(task.title, 60),
      start: task.start,
      end: task.end,
      type: task.type,
      subject: task.subject === undefined ? '' : text(task.subject, 60, { empty: true }),
      completed: task.completed === undefined ? false : boolean(task.completed),
    };
    if (!TYPES.has(clean.type) || validateTask(clean, [])) fail('备份中的安排内容或起止时间不正确。');
    if (ids.has(clean.id)) fail('备份中有重复安排，未恢复任何数据。');
    ids.add(clean.id);
    if (!days.has(clean.date)) days.set(clean.date, []);
    days.get(clean.date).push(clean);
    return clean;
  });
  // Sort each day once instead of doing a quadratic conflict scan on large files.
  for (const day of days.values()) {
    day.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    for (let i = 1; i < day.length; i++) {
      if (toMinutes(day[i].start) < toMinutes(day[i - 1].end)) fail('备份中有时间重叠的安排，未恢复任何数据。');
    }
  }
  return result;
}

function history(value) {
  const ids = new Set();
  return list(value, 50000).map(item => {
    record(item, ['id', 'taskId', 'date', 'type', 'ms']);
    const clean = {
      id: text(item.id, 200),
      taskId: text(item.taskId, 200),
      date: calendarDate(item.date),
      ms: milliseconds(item.ms),
    };
    if (item.type !== undefined) {
      if (!TYPES.has(item.type)) fail();
      clean.type = item.type;
    }
    if (ids.has(clean.id)) fail('备份中有重复记录，未恢复任何数据。');
    ids.add(clean.id);
    // History can outlive a deleted task; keep those records intact.
    return clean;
  });
}

function clock(value) {
  if (value === undefined) return { mode: 'real' };
  record(value, ['mode', 'simulatedAt', 'anchor']);
  for (const key of ['simulatedAt', 'anchor']) {
    if (value[key] !== undefined) timestamp(value[key]);
  }
  if (value.mode === 'real') return { mode: 'real' };
  if (value.mode !== 'demo') fail('备份中的时钟设置不正确。');
  return { mode: 'demo', simulatedAt: timestamp(value.simulatedAt), anchor: timestamp(value.anchor) };
}

function session(value, allTasks) {
  if (value === null || value === undefined) return null;
  record(value, ['taskId', 'date', 'deadlineMs', 'budgetMs', 'accumulatedMs', 'startedAt', 'paused', 'pausedAt', 'breakEndsAt']);
  const taskId = text(value.taskId, 200);
  const date = calendarDate(value.date);
  const task = allTasks.find(item => item.id === taskId);
  if (!task || task.date !== date) fail('备份中的计时对应不到有效安排。');
  const clean = {
    taskId, date,
    startedAt: timestamp(value.startedAt),
    accumulatedMs: milliseconds(value.accumulatedMs ?? 0),
    paused: value.paused === undefined ? false : boolean(value.paused),
  };
  for (const key of ['deadlineMs', 'pausedAt', 'breakEndsAt']) {
    if (value[key] !== undefined) clean[key] = value[key] === null ? null : timestamp(value[key]);
  }
  if (value.budgetMs !== undefined) clean.budgetMs = milliseconds(value.budgetMs);
  const startOfDay = dateAtTime(date, '00:00').getTime();
  const deadline = dateAtTime(date, task.end).getTime();
  // Manual starts may precede a plan, but always belong to its calendar day.
  if (clean.startedAt < startOfDay || clean.startedAt > deadline) fail('备份中的计时起点不正确。');
  if (clean.pausedAt != null && (clean.pausedAt < clean.startedAt || clean.pausedAt > deadline)) fail('备份中的休息时间不正确。');
  if (clean.breakEndsAt != null && (clean.pausedAt == null || clean.breakEndsAt < clean.pausedAt || clean.breakEndsAt > deadline)) fail('备份中的休息时间不正确。');
  return clean;
}

function validateState(value) {
  record(value, ['version', 'localUseVersion', 'tasks', 'selectedDate', 'settings', 'history', 'session', 'notified', 'clock']);
  if (value.version !== 1 || (value.localUseVersion !== undefined && value.localUseVersion !== 1)) fail('这个备份版本暂不支持，请使用对应版本的作业时钟。');
  const clean = {
    version: 1,
    localUseVersion: 1,
    tasks: tasks(value.tasks),
    selectedDate: calendarDate(value.selectedDate),
    settings: settings(value.settings),
    history: history(value.history),
    notified: list(value.notified ?? [], 100000).map(item => text(item, 300)),
    clock: clock(value.clock),
    session: null,
  };
  clean.session = session(value.session, clean.tasks);
  return clean;
}

function effectiveTime(state, at) {
  return timestamp(state.clock.mode === 'demo' ? state.clock.simulatedAt + at - state.clock.anchor : at);
}

function archiveSession(state, at) {
  if (state.session) {
    const task = state.tasks.find(item => item.id === state.session.taskId);
    const ms = Math.min(DAY_MS, sessionElapsedMs(state.session, task, at));
    if (ms > 0) {
      if (state.history.length >= 50000) fail('专注记录过多，暂时无法创建完整备份。');
      let id = `backup-session-${at}-${state.history.length}`;
      const ids = new Set(state.history.map(item => item.id));
      while (ids.has(id)) id += '-1';
      state.history.push({ id, taskId: task.id, date: task.date, type: task.type, ms });
    }
  }
  state.session = null;
  state.clock = { mode: 'real' };
  return state;
}

function checkSize(value) {
  if (typeof value !== 'string') fail();
  if (value.length > MAX_BACKUP_BYTES || new TextEncoder().encode(value).byteLength > MAX_BACKUP_BYTES) fail('备份文件超过 16 MB，未恢复任何数据。');
}

/** Export a separate snapshot; the live session and live state remain untouched. */
export function createBackup(value, exportedAtMs = Date.now()) {
  const at = timestamp(exportedAtMs);
  const state = validateState(value);
  archiveSession(state, effectiveTime(state, at));
  const result = JSON.stringify({ schema: SCHEMA, version: 1, exportedAt: new Date(at).toISOString(), state });
  checkSize(result);
  return result;
}

/** Parse atomically before the caller confirms/replaces storage. Never resumes a timer. */
export function parseBackup(value) {
  checkSize(value);
  let data;
  try { data = JSON.parse(value); } catch { fail('无法读取这个文件，请选择作业时钟导出的 JSON 备份。'); }
  let exportedAt = Date.now();
  let state;
  if (data?.schema !== undefined) {
    record(data, ['schema', 'version', 'exportedAt', 'state']);
    if (data.schema !== SCHEMA || data.version !== 1) fail('这个文件不是支持的作业时钟备份。');
    if (typeof data.exportedAt !== 'string') fail();
    exportedAt = Date.parse(data.exportedAt);
    timestamp(exportedAt);
    if (new Date(exportedAt).toISOString() !== data.exportedAt) fail('备份中的导出日期不正确。');
    state = validateState(data.state);
  } else {
    // Also accept the original v1 localStorage JSON for an existing user's migration.
    state = validateState(data);
  }
  // A hand-edited or legacy file may still have a live session. Snapshot its
  // accumulated credit at export/import time, then require a deliberate new start.
  return archiveSession(state, effectiveTime(state, exportedAt));
}
