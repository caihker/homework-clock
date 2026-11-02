import { SCENES, normalizeSceneVoices } from './scene-voices.mjs';
import { TURTLE_LINES } from './voice-pack.mjs';
import { normalizeRecordingMime } from './audio-format.mjs';

const MAX_RECORDING_BYTES = 1024 * 1024;
const RECORDING_MS = 8000;
const PROCESSING_MS = 10000;
const sceneFor = key => SCENES.find(scene => scene.key === key);

function openRecorder(Recorder, stream) {
  // Prefer MP4/AAC on Safari; other browsers can select their supported codec.
  // Feature detection and constructor fallback also cover older implementations.
  const options = [];
  for (const mimeType of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    let supported = false;
    try { supported = Recorder.isTypeSupported?.(mimeType) === true; } catch {}
    if (supported) options.push({ mimeType, audioBitsPerSecond: 64000 }, { mimeType });
  }
  options.push({ audioBitsPerSecond: 64000 }, undefined);
  let error;
  for (const option of options) {
    try { return new Recorder(stream, option); } catch (cause) { error = cause; }
  }
  throw error;
}

/** Keep an asynchronous microphone request bound to one scene and one draft. */
export function createSceneRecorder({
  mediaDevices = globalThis.navigator?.mediaDevices,
  MediaRecorderClass = globalThis.MediaRecorder,
  FileReaderClass = globalThis.FileReader,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
  visibilityTarget = globalThis.document,
  onState = () => {},
  onRecording = () => {},
  onNotice = () => {},
} = {}) {
  let generation = 0;
  let active = null;
  const current = job => active === job && job.generation === generation;
  const stopTracks = stream => stream?.getTracks?.().forEach(track => track.stop());
  const publish = () => onState(active ? { key: active.key, phase: active.phase } : null);

  function clean(job) {
    clearTimer(job.timer);
    clearTimer(job.processingTimer);
    if (job.reader) {
      job.reader.onload = job.reader.onerror = job.reader.onabort = null;
      if (job.reader.readyState === 1) { try { job.reader.abort(); } catch {} }
    }
    if (job.recorder) {
      job.recorder.onstop = job.recorder.ondataavailable = job.recorder.onerror = null;
      if (job.recorder.state !== 'inactive') { try { job.recorder.stop(); } catch {} }
    }
    stopTracks(job.stream);
  }

  function finish(job, message) {
    if (!current(job)) return;
    active = null;
    clean(job);
    publish();
    if (message) onNotice(message);
  }

  function stop() {
    const job = active;
    if (!job || job.phase !== 'recording') return;
    job.phase = 'processing';
    clearTimer(job.timer);
    processingDeadline(job);
    publish();
    try { job.recorder.stop(); }
    catch { finish(job, '录音未能结束，请重新录制。'); }
  }

  function processingDeadline(job) {
    if (job.processingTimer) return;
    job.processingTimer = setTimer(() => finish(job, '整理录音等待过久，原来的录音已保留，请重试。'), PROCESSING_MS);
  }

  async function start(key) {
    if (active || !sceneFor(key)) return false;
    if (!mediaDevices?.getUserMedia || !MediaRecorderClass || !FileReaderClass) {
      onNotice('这个浏览器暂不支持录音，仍可使用内置语音。');
      return false;
    }
    const job = { key, generation: ++generation, phase: 'permission', chunks: [] };
    active = job;
    publish();
    try {
      const stream = await mediaDevices.getUserMedia({ audio: true });
      if (!current(job)) { stopTracks(stream); return false; }
      job.stream = stream;
      // A lower bitrate keeps seven short clips small. Safari may choose its
      // own codec/bitrate; the actual blob is still checked before accepting it.
      job.recorder = openRecorder(MediaRecorderClass, stream);
      const recorder = job.recorder;
      recorder.ondataavailable = event => { if (current(job) && event.data?.size) job.chunks.push(event.data); };
      recorder.onerror = () => finish(job, '这次录音没有完成，原来的录音已保留。');
      recorder.onstop = () => {
        if (!current(job)) return;
        clearTimer(job.timer);
        stopTracks(stream);
        job.phase = 'processing';
        processingDeadline(job);
        publish();
        try {
          const mime = normalizeRecordingMime(recorder.mimeType) || job.chunks.map(chunk => normalizeRecordingMime(chunk.type)).find(Boolean);
          const blob = new Blob(job.chunks, { type: mime });
          if (!blob.size) { finish(job, '没有录到声音，请再试一次。'); return; }
          if (blob.size > MAX_RECORDING_BYTES) { finish(job, '这段录音超过 1 MB，请录一段更短的提醒。'); return; }
          if (!mime) { finish(job, '浏览器未能识别录音格式，请重新录制。'); return; }
          const reader = job.reader = new FileReaderClass();
          reader.onload = () => {
            if (!current(job)) return;
            const normalized = normalizeSceneVoices({ voices: { [job.key]: reader.result } });
            if (!normalized[job.key]) {
              finish(job, '录音格式暂不支持，原来的录音已保留，请重试。'); return;
            }
            onRecording(job.key, normalized[job.key]);
            finish(job, `“${sceneFor(job.key).label}”录好了，记得点击“保存设置”。`);
          };
          reader.onerror = reader.onabort = () => finish(job, '录音未能整理完成，原来的录音已保留。');
          reader.readAsDataURL(blob);
        } catch { finish(job, '录音未能整理完成，原来的录音已保留。'); }
      };
      recorder.start();
      job.phase = 'recording';
      job.timer = setTimer(() => { if (current(job)) stop(); }, RECORDING_MS);
      publish();
      return true;
    } catch {
      if (current(job)) finish(job, job.stream ? '浏览器未能启动录音，请重试；原来的录音已保留。' : '没有获得麦克风权限，可以继续使用内置语音。');
      return false;
    }
  }

  function cancel() {
    generation++;
    const job = active;
    active = null;
    if (job) clean(job);
    publish();
  }
  visibilityTarget?.addEventListener?.('visibilitychange', () => {
    if (!visibilityTarget.hidden || !active) return;
    // Background timers may be delayed. Stop the microphone immediately when
    // leaving the app instead of relying on the eight-second timer to fire.
    cancel();
    onNotice('录音已中断，之前的录音已保留。请保持页面打开后重新录制。');
  });
  return { start, stop, cancel, isBusy: () => !!active, getState: () => active ? { key: active.key, phase: active.phase } : null };
}

const symbols = {
  mic: '<rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  volume: '<path d="m11 4-6 5H2v6h3l6 5V4Zm4 4c3 2 3 6 0 8m3-11c5 4 5 10 0 14"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${symbols[name]}</svg>`;
const escape = text => String(text).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));

/** A settings draft. Only the parent's Save button writes the returned voices. */
export function createSceneVoiceSettings({ container, player, onNotice = () => {}, onBusyChange = () => {}, onPreviewDefaultStart, onDefaultStartStatus, ...recordingOptions }) {
  let opened = false;
  let voices = normalizeSceneVoices({});
  let selected = 'start';
  container.innerHTML = `<section class="scene-voice-editor" aria-label="情景语音"><div class="scene-voice-heading"><h3>情景语音</h3><span class="scene-voice-count"></span></div><div class="scene-voice-selector" role="group" aria-label="选择情景">${SCENES.map(scene => `<button type="button" class="scene-voice-chip" data-scene="${scene.key}" data-voice-action="select" aria-pressed="false"><span>${escape(scene.label)}</span><span class="scene-voice-dot" aria-hidden="true"></span></button>`).join('')}</div><div class="scene-voice-card"><div class="scene-voice-title"><strong class="scene-voice-label"></strong><span class="scene-voice-status" role="status" aria-live="polite"></span></div><p class="scene-voice-hint"></p><div class="scene-voice-actions"><button type="button" class="button secondary small" data-voice-action="record"></button><button type="button" class="button secondary small" data-voice-action="preview">${icon('volume')}试听</button><button type="button" class="text-button scene-voice-reset" data-voice-action="reset">恢复默认</button></div><p class="scene-voice-message" role="status" aria-live="polite"></p></div><p class="scene-voice-intro">每段最长 8 秒，改好后点击“保存设置”。</p></section>`;
  const count = container.querySelector('.scene-voice-count');
  const label = container.querySelector('.scene-voice-label');
  const hint = container.querySelector('.scene-voice-hint');
  const status = container.querySelector('.scene-voice-status');
  const message = container.querySelector('.scene-voice-message');
  const controls = {
    record: container.querySelector('[data-voice-action="record"]'),
    preview: container.querySelector('[data-voice-action="preview"]'),
    reset: container.querySelector('[data-voice-action="reset"]'),
  };
  const chips = new Map(SCENES.map(scene => [scene.key, container.querySelector(`[data-voice-action="select"][data-scene="${scene.key}"]`)]));

  function render() {
    const job = recorder.getState();
    const scene = sceneFor(selected);
    const recording = job?.key === selected && job.phase === 'recording';
    count.textContent = `${Object.values(voices).filter(Boolean).length} / ${SCENES.length} 已录音`;
    for (const item of SCENES) {
      const chip = chips.get(item.key);
      chip.setAttribute('aria-pressed', String(selected === item.key));
      chip.setAttribute('aria-label', `${item.label}${voices[item.key] ? '，已录音' : ''}`);
      chip.dataset.recorded = voices[item.key] ? 'true' : 'false';
      chip.disabled = !!job;
    }
    label.textContent = scene.label;
    hint.textContent = scene.hint;
    const defaultStatus = selected === 'start' && onDefaultStartStatus ? onDefaultStartStatus() || '内置语音' : '内置语音';
    status.textContent = job ? ({ permission: '等待麦克风授权…', recording: '正在录音 · 最长 8 秒', processing: '正在整理录音…' }[job.phase]) : voices[selected] ? '已录音' : defaultStatus;
    status.dataset.recorded = voices[selected] ? 'true' : 'false';
    for (const button of Object.values(controls)) button.dataset.scene = selected;
    controls.record.innerHTML = `${icon(recording ? 'stop' : 'mic')}<span>${recording ? '结束录音' : '录制'}</span>`;
    controls.record.setAttribute('aria-label', `${recording ? '结束' : '录制'}${scene.label}${recording ? '录音' : ''}`);
    controls.preview.setAttribute('aria-label', `试听${scene.label}`);
    controls.reset.setAttribute('aria-label', `恢复${scene.label}默认语音`);
    controls.record.disabled = !!job && !recording;
    controls.preview.disabled = !!job;
    controls.reset.disabled = !!job || !voices[selected];
  }

  const recorder = createSceneRecorder({
    ...recordingOptions,
    onState: () => { onBusyChange(recorder.isBusy()); render(); },
    onRecording: (key, source) => { if (opened) voices[key] = source; },
    onNotice: text => { if (opened) { message.textContent = text; onNotice(text); } },
  });

  container.addEventListener('click', event => {
    const button = event.target.closest?.('button[data-voice-action]');
    if (!opened || !button || !container.contains(button) || button.disabled) return;
    const key = button.dataset.scene;
    if (!sceneFor(key)) return;
    const action = button.dataset.voiceAction;
    if (action === 'select') {
      if (recorder.isBusy() || selected === key) return;
      player.stop(); selected = key; message.textContent = ''; render();
    } else if (action === 'record') {
      if (recorder.getState()?.key === key) recorder.stop();
      else { player.stop(); message.textContent = ''; void recorder.start(key); }
    } else if (action === 'preview') {
      player.stop();
      if (voices[key]) void player.play(voices[key]);
      else if (key === 'start' && onPreviewDefaultStart) onPreviewDefaultStart();
      else void player.play(TURTLE_LINES[key].src);
    } else if (action === 'reset') {
      player.stop(); voices[key] = null; render();
      message.textContent = `“${sceneFor(key).label}”已恢复默认，点击“保存设置”后生效。`;
    }
  });

  function close() {
    opened = false;
    recorder.cancel(); player.stop();
    voices = normalizeSceneVoices({});
    selected = 'start'; message.textContent = '';
    render();
  }
  function open(settings) {
    close();
    voices = normalizeSceneVoices(settings);
    opened = true;
    render();
  }
  render();
  return { open, getVoices: () => ({ ...voices }), isBusy: recorder.isBusy, refresh: render, close };
}
