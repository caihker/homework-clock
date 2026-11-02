import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createBackup, parseBackup, MAX_BACKUP_BYTES } from '../dist/backup.mjs';
import { createSession, pauseSession } from '../dist/session-timer.mjs';

const minute = 60_000;
const at = (hour, minutes = 0) => Date.parse(`2026-11-01T${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+08:00`);
const task = { id: 'chinese', date: '2026-11-01', title: '语文预习', start: '10:00', end: '12:00', type: 'study', subject: '语文', completed: true };
const sceneKeys = ['start', 'schedule-start', 'break-start', 'break-end', 'ending-soon', 'end', 'complete'];
const voiceMap = (overrides = {}) => Object.fromEntries(sceneKeys.map(key => [key, overrides[key] ?? null]));
const fixture = () => ({
  version: 1,
  tasks: [{ ...task }],
  selectedDate: task.date,
  settings: { sound: true, pet: true, code: '小皮开工了', message: '先做一道！', voice: 'data:audio/mp4;codecs=mp4a.40.2;base64,YXVkaW8=' },
  history: [{ id: 'earlier', taskId: 'deleted-task', date: task.date, type: 'study', ms: 15 * minute }],
  session: null,
  clock: { mode: 'real' },
  notified: ['chinese:10:00:12:00:start'],
});

test('Safari quoted and spaced MP4 recordings survive all seven scenes and legacy backup migration', () => {
  const original = fixture();
  const raw = 'data:audio/mp4; codecs="mp4a.40.2";base64,dm9pY2U=';
  const expected = 'data:audio/mp4;codecs=mp4a.40.2;base64,dm9pY2U=';
  original.settings.voice = raw;
  assert.equal(parseBackup(JSON.stringify(original)).settings.voices.start, expected);
  original.settings.voices = Object.fromEntries(sceneKeys.map(key => [key, raw]));
  const restored = parseBackup(createBackup(original));
  for (const key of sceneKeys) assert.equal(restored.settings.voices[key], expected);
  assert.equal(original.settings.voice, raw);
  assert.ok(Object.values(original.settings.voices).every(value => value === raw));
});

test('backup round trip retains plans, completion, deleted-task history, settings and recording', () => {
  const original = fixture();
  const exported = createBackup(original, at(11));
  const envelope = JSON.parse(exported);
  assert.equal(envelope.schema, 'homework-clock-backup');
  assert.equal(envelope.version, 1);
  assert.equal(envelope.exportedAt, new Date(at(11)).toISOString());
  const restored = parseBackup(exported);
  assert.deepEqual(restored, {
    ...original,
    localUseVersion: 1,
    settings: { ...original.settings, companion: 'original', voice: null, voices: voiceMap({ start: original.settings.voice }) },
  });
  restored.tasks[0].title = '新名字';
  assert.equal(original.tasks[0].title, '语文预习');
});

test('an active break is archived once at export, without changing the live timer', () => {
  const original = fixture();
  original.session = pauseSession(createSession(task, at(10, 20)), task, at(10, 40));
  const before = structuredClone(original);
  const restored = parseBackup(createBackup(original, at(10, 47)));
  assert.equal(restored.session, null);
  assert.deepEqual(restored.clock, { mode: 'real' });
  assert.equal(restored.history.length, 2);
  assert.equal(restored.history[1].ms, 22 * minute);
  assert.deepEqual(original, before);
  const secondRestore = parseBackup(createBackup(restored, at(11)));
  assert.deepEqual(secondRestore.history, restored.history);
});

test('expired timers stop at the fixed plan end and demo timers use their simulated time', () => {
  const original = fixture();
  original.session = createSession(task, at(10, 20));
  assert.equal(parseBackup(createBackup(original, at(14))).history[1].ms, 100 * minute);
  original.clock = { mode: 'demo', simulatedAt: at(10, 40), anchor: at(17) };
  const restored = parseBackup(createBackup(original, at(17, 5)));
  assert.equal(restored.history[1].ms, 25 * minute);
  assert.deepEqual(restored.clock, { mode: 'real' });
});

test('legacy v1 JSON can migrate, with a fresh real clock and no restored live timer', () => {
  const original = fixture();
  delete original.settings.sound;
  delete original.settings.voice;
  delete original.tasks[0].completed;
  delete original.history[0].type;
  const restored = parseBackup(JSON.stringify(original));
  assert.equal(restored.localUseVersion, 1);
  assert.equal(restored.settings.sound, true);
  assert.equal(restored.settings.voice, null);
  assert.deepEqual(restored.settings.voices, voiceMap());
  assert.equal(restored.tasks[0].completed, false);
  assert.equal(restored.session, null);
  // Legacy non-ten-minute times are not silently changed during migration.
  original.tasks[0].start = '07:35';
  assert.equal(parseBackup(JSON.stringify(original)).tasks[0].start, '07:35');
});

test('malformed, unrelated, oversized, future-version and prototype-bearing files are rejected', () => {
  for (const input of ['not JSON', 'null', '[]', '{}', '{"hello":"world"}', ' '.repeat(MAX_BACKUP_BYTES + 1)]) {
    assert.throws(() => parseBackup(input));
  }
  const envelope = JSON.parse(createBackup(fixture(), at(11)));
  envelope.version = 2;
  assert.throws(() => parseBackup(JSON.stringify(envelope)));
  const proto = JSON.stringify(fixture()).replace('"version":1', '"version":1,"__proto__":{"polluted":true}');
  assert.throws(() => parseBackup(proto));
  assert.equal({}.polluted, undefined);
  const largeUnicode = fixture();
  largeUnicode.settings.code = '皮'.repeat(41);
  assert.throws(() => createBackup(largeUnicode));
});

test('task dates, ids, types, times, overlap and settings types must be valid before restore', () => {
  const changes = [
    state => { state.selectedDate = '2026-02-30'; },
    state => { state.tasks[0].date = '2026-13-01'; },
    state => { state.tasks[0].type = 'other'; },
    state => { state.tasks[0].start = '25:00'; },
    state => { state.tasks[0].end = '09:00'; },
    state => { state.tasks.push({ ...state.tasks[0] }); },
    state => { state.tasks.push({ ...state.tasks[0], id: 'overlap', start: '11:00' }); },
    state => { state.settings.sound = 'true'; },
    state => { state.tasks[0].completed = 'false'; },
    state => { state.history[0].ms = -1; },
    state => { state.history[0].ms = 86400001; },
  ];
  for (const change of changes) {
    const original = fixture();
    change(original);
    assert.throws(() => parseBackup(JSON.stringify(original)));
  }
  const adjacent = fixture();
  adjacent.tasks.push({ ...task, id: 'lunch', start: '12:00', end: '12:30', type: 'life' });
  assert.equal(parseBackup(JSON.stringify(adjacent)).tasks.length, 2);
});

test('restored family audio must be a small embedded audio recording, never an external or script URL', () => {
  const unsafe = [
    'https://example.com/track.mp3',
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:audio/mp4;base64,broken===',
    'data:audio/mp4;base64,AA=A',
    `data:audio/mp4;base64,${'A'.repeat(Math.ceil(1024 * 1024 / 3) * 4 + 4)}`,
  ];
  for (const voice of unsafe) {
    const original = fixture();
    original.settings.voice = voice;
    assert.throws(() => parseBackup(JSON.stringify(original)));
  }
  for (const mime of ['webm;codecs=opus', 'ogg;codecs=opus', 'mp4', 'mpeg']) {
    const original = fixture();
    original.settings.voice = `data:audio/${mime};base64,YXVkaW8=`;
    const restored = parseBackup(createBackup(original));
    assert.equal(restored.settings.voice, null);
    assert.equal(restored.settings.voices.start, original.settings.voice);
  }
});

test('seven independent scene recordings survive a backup round trip without mutating the original', () => {
  const original = fixture();
  const voices = Object.fromEntries(sceneKeys.map(key => [key, `data:audio/mp4;base64,${Buffer.from(`voice-${key}`).toString('base64')}`]));
  original.settings.voices = voices;
  const before = structuredClone(original);
  const exported = createBackup(original, at(11));
  const restored = parseBackup(exported);
  assert.deepEqual(restored.settings.voices, voices);
  assert.equal(restored.settings.voice, null);
  assert.deepEqual(restored.history, original.history);
  assert.deepEqual(original, before);
  assert.equal(JSON.parse(exported).version, 1);
  assert.deepEqual(Object.keys(restored.settings.voices), sceneKeys);
});

test('old v1 envelopes and partial scene maps migrate the single recording only to manual start', () => {
  const original = fixture();
  const oldEnvelope = { schema: 'homework-clock-backup', version: 1, exportedAt: new Date(at(11)).toISOString(), state: original };
  const migrated = parseBackup(JSON.stringify(oldEnvelope));
  assert.deepEqual(migrated.settings.voices, voiceMap({ start: original.settings.voice }));
  assert.equal(migrated.settings.voice, null);
  const completion = 'data:audio/ogg;codecs=opus;base64,Y29tcGxldGU=';
  original.settings.voices = { complete: completion };
  assert.deepEqual(parseBackup(createBackup(original)).settings.voices, voiceMap({ start: original.settings.voice, complete: completion }));
  original.settings.voices.start = undefined;
  assert.equal(parseBackup(createBackup(original)).settings.voices.start, original.settings.voice);
});

test('restoring a scene default does not revive a legacy recording or affect another scene', () => {
  const original = fixture();
  const rest = 'data:audio/webm;codecs=opus;base64,cmVzdA==';
  original.settings.voices = { start: null, 'break-start': rest };
  const restored = parseBackup(JSON.stringify(original));
  assert.deepEqual(restored.settings.voices, voiceMap({ 'break-start': rest }));
  assert.equal(restored.settings.voice, null);
  assert.deepEqual(parseBackup(createBackup(restored)).settings.voices, restored.settings.voices);
  assert.equal(original.settings.voice, fixture().settings.voice);
});

test('scene recording imports reject unknown scenes, malformed maps and unsafe audio before restore', () => {
  for (const voices of [null, [], 'voice', { unknown: null }, { constructor: null }, JSON.parse('{"__proto__":null}')]) {
    const original = fixture();
    original.settings.voices = voices;
    assert.throws(() => parseBackup(JSON.stringify(original)));
  }
  for (const value of ['https://example.com/voice.mp3', 'javascript:alert(1)', 'blob:temporary', 'data:text/html;base64,YQ==', 'data:audio/mp4;base64,AA=A', false, 1, {}]) {
    const original = fixture();
    original.settings.voices = { 'break-end': value };
    assert.throws(() => createBackup(original));
  }
  const oversized = fixture();
  oversized.settings.voices = { end: `data:audio/mp4;base64,${Buffer.alloc(1024 * 1024 + 1).toString('base64')}` };
  assert.throws(() => createBackup(oversized), /录音/);
});

test('the 16 MiB backup budget can retain seven recordings at the per-scene limit', () => {
  assert.equal(MAX_BACKUP_BYTES, 16 * 1024 * 1024);
  const original = fixture();
  const voice = `data:audio/mp4;base64,${Buffer.alloc(1024 * 1024, 1).toString('base64')}`;
  original.settings.voice = null;
  original.settings.voices = voiceMap(Object.fromEntries(sceneKeys.map(key => [key, voice])));
  const exported = createBackup(original, at(11));
  assert.ok(Buffer.byteLength(exported) > 8 * 1024 * 1024, 'the previous limit was too small for seven maximum-size recordings');
  assert.ok(Buffer.byteLength(exported) < MAX_BACKUP_BYTES);
  const restored = parseBackup(exported);
  for (const key of sceneKeys) assert.equal(restored.settings.voices[key], voice);
});

test('malicious or disconnected timing records do not enter a restored state', () => {
  const changes = [
    state => { state.session.taskId = 'missing'; },
    state => { state.session.date = '2026-11-02'; },
    state => { state.session.startedAt = at(13); },
    state => { state.session.accumulatedMs = -1; },
    state => { state.session.paused = 'false'; },
    state => { state.session.pausedAt = at(9); },
    state => { state.session.breakEndsAt = at(13); },
    state => { state.clock = { mode: 'demo', simulatedAt: null, anchor: at(10) }; },
  ];
  for (const change of changes) {
    const original = fixture();
    original.session = createSession(task, at(10));
    change(original);
    assert.throws(() => parseBackup(JSON.stringify(original)));
  }
});

test('GMT+8 backup validation and active-session credit are identical in UTC and Los Angeles', () => {
  const backupURL = new URL('../dist/backup.mjs', import.meta.url).href;
  const sessionURL = new URL('../dist/session-timer.mjs', import.meta.url).href;
  const script = `
    import { createBackup, parseBackup } from ${JSON.stringify(backupURL)};
    import { createSession, pauseSession } from ${JSON.stringify(sessionURL)};
    const state = ${JSON.stringify(fixture())};
    const task = state.tasks[0];
    state.session = pauseSession(createSession(task, ${at(10, 20)}), task, ${at(10, 40)});
    const text = createBackup(state, ${at(10, 47)});
    const restored = parseBackup(text);
    if (restored.history[1].ms !== ${22 * minute}) throw new Error('wrong focus credit');
    if (restored.history[0].ms !== state.history[0].ms) throw new Error('changed recorded history');
    if (restored.settings.voices.start !== state.settings.voice || restored.settings.voice !== null) throw new Error('changed recording');
    if (restored.tasks[0].date !== '2026-11-01' || restored.selectedDate !== '2026-11-01') throw new Error('changed calendar date');
    const late = { ...state, session: createSession(task, ${at(10, 20)}) };
    if (parseBackup(createBackup(late, ${at(14)})).history[1].ms !== ${100 * minute}) throw new Error('wrong fixed deadline');
    process.stdout.write(text);
  `;
  const snapshots = ['Asia/Shanghai', 'UTC', 'America/Los_Angeles'].map(TZ => {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, TZ } });
    assert.equal(run.status, 0, `${TZ}: ${run.stderr}`);
    return run.stdout;
  });
  assert.equal(snapshots[1], snapshots[0]);
  assert.equal(snapshots[2], snapshots[0]);
});

test('companion selection survives a backup round trip', () => {
  const original = fixture();
  original.settings.companion = 'solid';
  assert.equal(parseBackup(createBackup(original)).settings.companion, 'solid');
});
