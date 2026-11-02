import { readEmbeddedAudio } from './audio-format.mjs';

/** The same event keys used by the bundled character voice pack. */
export const SCENES = Object.freeze([
  { key: 'start', label: '手动开工', hint: '点击开始专注或开始计时时播放。' },
  { key: 'schedule-start', label: '计划开始提醒', hint: '计划开始时间到了，提醒你准备开工。' },
  { key: 'break-start', label: '开始休息', hint: '点击休息 5 分钟时播放。' },
  { key: 'break-end', label: '休息结束', hint: '休息到点或提前结束休息时播放。' },
  { key: 'ending-soon', label: '提前 5 分钟收尾', hint: '娱乐时间结束前 5 分钟播放。' },
  { key: 'end', label: '时间到', hint: '计划结束时提醒你收尾。' },
  { key: 'complete', label: '完成鼓励', hint: '点击完成后，为你加油。' },
].map(scene => Object.freeze(scene)));

const sceneKeys = new Set(SCENES.map(scene => scene.key));
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const record = value => value && typeof value === 'object' && !Array.isArray(value);

function embeddedAudio(value) {
  // Recordings are stored inside this device's data, never as remote URLs or
  // short-lived blob URLs. Size limits are checked when recording/importing.
  return readEmbeddedAudio(value)?.source ?? null;
}

/**
 * Build an independent map without changing saved settings. An old single
 * recording belongs only to manual start. An explicit null means the user
 * restored that scene's default and must not revive the old recording.
 */
export function normalizeSceneVoices(settings) {
  const source = record(settings) ? settings : {};
  const voices = own(source, 'voices') && record(source.voices) ? source.voices : {};
  const result = Object.fromEntries(SCENES.map(({ key }) => [key, embeddedAudio(own(voices, key) ? voices[key] : null)]));
  if ((!own(voices, 'start') || voices.start === undefined) && own(source, 'voice')) {
    result.start = embeddedAudio(source.voice);
  }
  return result;
}

/** Select only the requested scene; the caller supplies the built-in fallback. */
export function selectSceneVoice(event, settings) {
  if (!sceneKeys.has(event)) return null;
  return normalizeSceneVoices(settings)[event];
}

export function countSceneVoices(settings) {
  return Object.values(normalizeSceneVoices(settings)).filter(Boolean).length;
}
