import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneRecorder } from '../dist/scene-voice-settings.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const stream = () => { const track = { stopped: false, stop() { this.stopped = true; } }; return { track, getTracks: () => [track] }; };

function setup({ permission, chunks = [new Blob(['voice'], { type: 'audio/mp4' })], permissionError, startError, manualRead = false, readError = false, missingStop = false, result = 'data:audio/mp4;base64,dm9pY2U=', visibilityTarget, recorderMime = 'audio/mp4', supportedTypes, rejectOptions = () => false } = {}) {
  const devices = [];
  const recorders = [];
  const attempts = [];
  const readers = [];
  const recordings = [];
  const notices = [];
  const states = [];
  const timers = new Set();
  class Recorder {
    constructor(device, options) {
      attempts.push(options);
      if (rejectOptions(options)) throw new Error('unsupported options');
      this.device = device; this.options = options; this.state = 'inactive'; this.mimeType = recorderMime; recorders.push(this);
    }
    start() { if (startError) throw startError; this.state = 'recording'; }
    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      const onData = this.ondataavailable, onStop = this.onstop;
      if (!missingStop) queueMicrotask(() => { for (const data of chunks) onData?.({ data }); onStop?.(); });
    }
  }
  if (supportedTypes) Recorder.isTypeSupported = mime => supportedTypes.includes(mime);
  class Reader {
    constructor() { readers.push(this); this.readyState = 0; }
    readAsDataURL(blob) {
      this.blob = blob; this.readyState = 1;
      if (readError) throw new Error('cannot read');
      if (!manualRead) queueMicrotask(() => this.finish());
    }
    finish() { this.readyState = 2; this.result = result; this.onload?.(); }
    abort() { this.aborted = true; this.readyState = 2; this.onabort?.(); }
  }
  const controller = createSceneRecorder({
    mediaDevices: { getUserMedia: async () => {
      if (permissionError) throw permissionError;
      const device = permission ? await permission : stream(); devices.push(device); return device;
    } },
    MediaRecorderClass: Recorder,
    FileReaderClass: Reader,
    visibilityTarget,
    setTimer: (callback, ms) => { assert.ok([8000, 10000].includes(ms)); const timer = { callback, ms }; timers.add(timer); return timer; },
    clearTimer: timer => timers.delete(timer),
    onState: state => states.push(state),
    onRecording: (key, source) => recordings.push({ key, source }),
    onNotice: message => notices.push(message),
  });
  return { controller, devices, recorders, readers, recordings, notices, states, timers, attempts };
}

test('Safari-style MP4 metadata records and saves a normalized source', async () => {
  for (const mime of ['audio/mp4; codecs="mp4a.40.2"', 'audio/mp4; codecs=mp4a.40.2']) {
    const s = setup({ recorderMime: mime, supportedTypes: ['audio/mp4'], result: `data:${mime};base64,dm9pY2U=` });
    await s.controller.start('start'); s.controller.stop(); await tick();
    assert.equal(s.recorders[0].options.mimeType, 'audio/mp4');
    assert.equal(s.readers[0].blob.type, 'audio/mp4;codecs=mp4a.40.2');
    assert.equal(Buffer.from(await s.readers[0].blob.arrayBuffer()).toString(), 'voice');
    assert.deepEqual(s.recordings, [{ key: 'start', source: 'data:audio/mp4;codecs=mp4a.40.2;base64,dm9pY2U=' }]);
    assert.equal(s.controller.isBusy(), false);
    assert.equal(s.devices[0].track.stopped, true);
  }
});

test('unsupported MP4 falls back to a feature-detected WebM recorder', async () => {
  const s = setup({ supportedTypes: ['audio/webm;codecs=opus'], recorderMime: 'audio/webm;codecs="opus"', result: 'data:audio/webm;codecs="opus";base64,dm9pY2U=' });
  await s.controller.start('complete'); s.controller.stop(); await tick();
  assert.equal(s.recorders[0].options.mimeType, 'audio/webm;codecs=opus');
  assert.equal(s.recordings[0].source, 'data:audio/webm;codecs=opus;base64,dm9pY2U=');
});

test('recorder construction retries MIME without bitrate and native default without options', async () => {
  const withMime = setup({ supportedTypes: ['audio/mp4'], rejectOptions: options => !!options?.audioBitsPerSecond });
  assert.equal(await withMime.controller.start('start'), true);
  assert.deepEqual(withMime.recorders[0].options, { mimeType: 'audio/mp4' });
  withMime.controller.cancel();
  const defaults = setup({ supportedTypes: ['audio/mp4'], rejectOptions: options => options !== undefined });
  assert.equal(await defaults.controller.start('start'), true);
  assert.equal(defaults.recorders[0].options, undefined);
  defaults.controller.cancel();
});

test('when recorder MIME is absent the actual audio chunk provides the format', async () => {
  const s = setup({ recorderMime: '', chunks: [new Blob(['voice'], { type: 'audio/mp4; codecs="mp4a.40.2"' })] });
  await s.controller.start('end'); s.controller.stop(); await tick();
  assert.equal(s.readers[0].blob.type, 'audio/mp4;codecs=mp4a.40.2');
  assert.equal(s.recordings.length, 1);
});

test('one scene owns the microphone through permission, recording and conversion', async () => {
  let allow;
  const permission = new Promise(resolve => { allow = resolve; });
  const s = setup({ permission, manualRead: true });
  const start = s.controller.start('break-start');
  assert.equal(s.controller.isBusy(), true);
  assert.deepEqual(s.controller.getState(), { key: 'break-start', phase: 'permission' });
  assert.equal(await s.controller.start('complete'), false);
  allow(stream()); await start;
  assert.equal(s.recorders[0].options.audioBitsPerSecond, 64000);
  assert.deepEqual(s.controller.getState(), { key: 'break-start', phase: 'recording' });
  s.controller.stop(); await tick();
  assert.equal(s.devices[0].track.stopped, true);
  assert.equal(s.controller.isBusy(), true);
  assert.deepEqual(s.controller.getState(), { key: 'break-start', phase: 'processing' });
  assert.equal(await s.controller.start('complete'), false);
  s.readers[0].finish();
  assert.equal(s.controller.isBusy(), false);
  assert.deepEqual(s.recordings, [{ key: 'break-start', source: 'data:audio/mp4;base64,dm9pY2U=' }]);
  assert.equal(s.timers.size, 0);
});

test('closing during permission prevents a later stream from starting or changing a draft', async () => {
  let allow;
  const permission = new Promise(resolve => { allow = resolve; });
  const s = setup({ permission });
  const start = s.controller.start('start');
  s.controller.cancel();
  assert.equal(s.controller.isBusy(), false);
  const late = stream(); allow(late); await start;
  assert.equal(late.track.stopped, true);
  assert.equal(s.recorders.length, 0);
  assert.deepEqual(s.recordings, []);
});

test('closing during conversion ignores a late old callback and does not overwrite another scene', async () => {
  const s = setup({ manualRead: true });
  await s.controller.start('start'); s.controller.stop(); await tick();
  const old = s.readers[0]; const lateCallback = old.onload;
  s.controller.cancel();
  assert.equal(old.aborted, true);
  await s.controller.start('complete'); s.controller.stop(); await tick();
  old.result = 'data:audio/mp4;base64,b2xk'; lateCallback();
  assert.deepEqual(s.recordings, []);
  s.readers[1].finish();
  assert.deepEqual(s.recordings.map(item => item.key), ['complete']);
  assert.ok(s.devices.every(device => device.track.stopped));
});

test('hiding the app cancels an unresolved microphone request and releases a late stream', async () => {
  const visibility = new EventTarget(); visibility.hidden = false;
  let allow;
  const permission = new Promise(resolve => { allow = resolve; });
  const s = setup({ permission, visibilityTarget: visibility });
  const start = s.controller.start('start');
  visibility.hidden = true; visibility.dispatchEvent(new Event('visibilitychange'));
  assert.equal(s.controller.isBusy(), false);
  const late = stream(); allow(late); await start;
  assert.equal(late.track.stopped, true);
  assert.equal(s.recorders.length, 0);
  assert.deepEqual(s.recordings, []);
  assert.equal(s.notices.length, 1);
});

test('hiding the app stops recording without accepting a partial clip or resuming it', async () => {
  const visibility = new EventTarget(); visibility.hidden = false;
  const s = setup({ visibilityTarget: visibility });
  await s.controller.start('break-start');
  const oldTimer = [...s.timers].find(timer => timer.ms === 8000);
  visibility.hidden = true; visibility.dispatchEvent(new Event('visibilitychange')); await tick();
  assert.equal(s.devices[0].track.stopped, true);
  assert.equal(s.recorders[0].state, 'inactive');
  assert.equal(s.controller.isBusy(), false);
  assert.equal(s.timers.size, 0);
  assert.deepEqual(s.recordings, []);
  visibility.hidden = false; visibility.dispatchEvent(new Event('visibilitychange'));
  assert.equal(s.controller.isBusy(), false);
  await s.controller.start('complete');
  oldTimer.callback();
  assert.equal(s.controller.getState().key, 'complete');
  s.controller.cancel();
});

test('hiding during conversion aborts its reader and ignores its late result', async () => {
  const visibility = new EventTarget(); visibility.hidden = false;
  const s = setup({ visibilityTarget: visibility, manualRead: true });
  await s.controller.start('end'); s.controller.stop(); await tick();
  const old = s.readers[0], late = old.onload;
  visibility.hidden = true; visibility.dispatchEvent(new Event('visibilitychange'));
  assert.equal(old.aborted, true);
  assert.equal(s.controller.isBusy(), false);
  assert.equal(s.timers.size, 0);
  old.result = 'data:audio/mp4;base64,b2xk'; late();
  assert.deepEqual(s.recordings, []);
  assert.equal(s.notices.length, 1);
});

test('the eight-second limit stops recording, produces one clip and releases the microphone', async () => {
  const s = setup();
  await s.controller.start('end');
  const timer = [...s.timers][0]; timer.callback();
  await tick();
  assert.equal(s.controller.isBusy(), false);
  assert.equal(s.recordings.length, 1);
  assert.equal(s.recordings[0].key, 'end');
  assert.equal(s.devices[0].track.stopped, true);
  assert.equal(s.timers.size, 0);
});

test('a late automatic-stop callback from a cancelled scene cannot stop a newer recording', async () => {
  const s = setup();
  await s.controller.start('start');
  const oldTimer = [...s.timers].find(timer => timer.ms === 8000);
  s.controller.cancel();
  await s.controller.start('complete');
  oldTimer.callback();
  assert.deepEqual(s.controller.getState(), { key: 'complete', phase: 'recording' });
  assert.equal(s.recorders[1].state, 'recording');
  s.controller.stop(); await tick();
  assert.deepEqual(s.recordings.map(item => item.key), ['complete']);
});

test('empty or oversized recordings are rejected without replacing an existing scene clip', async () => {
  for (const chunks of [[], [new Blob([new Uint8Array(1024 * 1024 + 1)], { type: 'audio/mp4' })]]) {
    const s = setup({ chunks });
    await s.controller.start('end'); s.controller.stop(); await tick();
    assert.equal(s.controller.isBusy(), false);
    assert.equal(s.recordings.length, 0);
    assert.equal(s.devices[0].track.stopped, true);
    assert.equal(s.notices.length, 1);
  }
});

test('permission denial and a recorder start error settle the busy state and release tracks', async () => {
  for (const options of [{ permissionError: new Error('denied') }, { startError: new Error('unavailable') }]) {
    const s = setup(options);
    assert.equal(await s.controller.start('start'), false);
    assert.equal(s.controller.isBusy(), false);
    assert.equal(s.recordings.length, 0);
    assert.ok(s.devices.every(device => device.track.stopped));
  }
});

test('failed FileReader or unsupported output leaves no saved clip and releases busy', async () => {
  for (const options of [{ readError: true }, { result: 'data:text/html;base64,dm9pY2U=' }, { result: 'data:audio/mp4;base64,broken===' }]) {
    const s = setup(options);
    await s.controller.start('start'); s.controller.stop(); await tick();
    assert.equal(s.controller.isBusy(), false);
    assert.deepEqual(s.recordings, []);
    assert.equal(s.devices[0].track.stopped, true);
    assert.equal(s.timers.size, 0);
  }
});

test('missing recorder stop or FileReader completion has a finite processing deadline', async () => {
  for (const options of [{ missingStop: true }, { manualRead: true }]) {
    const s = setup(options);
    await s.controller.start('end'); s.controller.stop(); await tick();
    assert.equal(s.controller.isBusy(), true);
    const timer = [...s.timers].find(timer => timer.ms === 10000);
    assert.ok(timer); timer.callback();
    assert.equal(s.controller.isBusy(), false);
    assert.deepEqual(s.recordings, []);
    assert.equal(s.timers.size, 0);
    assert.equal(s.devices[0].track.stopped, true);
  }
});
