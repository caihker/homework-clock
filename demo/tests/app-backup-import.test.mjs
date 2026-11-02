import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createBackup, parseBackup, MAX_BACKUP_BYTES } from '../dist/backup.mjs';
import { countSceneVoices, normalizeSceneVoices } from '../dist/scene-voices.mjs';
import { normalizeCompanion } from '../dist/companion.mjs';
import { createUpdateGuard, hasSettingsDraft } from '../dist/update-guard.mjs';
import { commitLocalState } from '../dist/update-storage.mjs';

const app = readFileSync(new URL('../dist/app.mjs', import.meta.url), 'utf8');
const handlers = app.slice(app.indexOf("$('#save-settings').onclick="), app.indexOf("$('#reset-demo').onclick="));
const guard = app.slice(app.indexOf('const updateGuard=createUpdateGuard('), app.indexOf('if(navigator.serviceWorker)createUpdateSession('));
const STORE = 'homework-clock-demo-v1';
const fixture = (title = '原计划') => ({
  version: 1, tasks: [{ id: title, date: '2026-11-02', title, start: '10:00', end: '12:00', type: 'study', completed: false }],
  selectedDate: '2026-11-02', settings: { sound: true, pet: true, companion: 'original', code: '小皮开工了', message: '', voice: null, voices: normalizeSceneVoices({}) },
  history: [], session: null, clock: { mode: 'real' }, notified: [],
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { resolve, reject, promise, file: { size: 100, text: () => promise } };
};

// Run the shipped handlers and update guard together, with only the browser
// surface replaced. Deferred File reads reproduce real overlapping selections.
function setup() {
  const elements = new Map(), messages = [], confirmations = [], writes = [];
  const element = selector => {
    if (!elements.has(selector)) {
      const listeners = new Map();
      elements.set(selector, {
        open: false, disabled: false, value: '', checked: false, textContent: '', clicks: 0,
        addEventListener(name, callback) { const list = listeners.get(name) || []; list.push(callback); listeners.set(name, list); },
        click() { this.clicks++; },
        close() { this.open = false; for (const callback of listeners.get('close') || []) callback(); },
      });
    }
    return elements.get(selector);
  };
  const state = fixture(), values = new Map([[STORE, JSON.stringify(state)]]);
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { writes.push([key, value]); values.set(key, value); },
  };
  let recordingBusy = false, voiceDraft = { ...state.settings.voices };
  element('#settings-dialog').open = true;
  for (const key of ['sound', 'pet']) element(`#${key}-enabled`).checked = state.settings[key];
  element('#family-code').value = state.settings.code;
  element('#family-message').value = state.settings.message;
  element('[name=companion]:checked').value = state.settings.companion;
  const context = vm.createContext({
    $: element,
    $$: selector => selector === 'dialog[open]' ? [...elements.values()].filter(item => item.open) : [],
    state, STORE, stateStorage: storage, localStorage: storage, lastStoredRaw: JSON.stringify(state),
    importingBackup: false, updateLocked: false, composingInput: false, storageOK: true,
    currentId: null, focusTaskId: null, finishTaskId: null, celebration: null, filter: 'all', lastTick: 0, lastMinute: '',
    turtleTrips: new Map(), sceneVoiceSettings: { isBusy: () => recordingBusy, getVoices: () => ({ ...voiceDraft }) },
    toast: message => messages.push(message), createBackup, parseBackup, MAX_BACKUP_BYTES, countSceneVoices,
    normalizeCompanion, createUpdateGuard, hasSettingsDraft, commitLocalState,
    closeDialog: dialog => { if (dialog.open) dialog.close(); },
    voicePlayer: { stop() {} }, persist: () => true, render() {}, now: () => new Date('2026-11-02T11:00:00+08:00'),
    confirmAction: (title, message, callback) => { confirmations.push({ title, message, callback }); element('#confirm-dialog').open = true; },
  });
  vm.runInContext(`${handlers}\n${guard}\nglobalThis.guard=updateGuard;`, context);
  return {
    context, element, messages, confirmations, writes, values,
    change: file => element('#backup-file').onchange({ target: { files: file ? [file] : [] } }),
    setRecordingBusy: value => { recordingBusy = value; },
    setVoiceDraft: value => { voiceDraft = value; },
    accept: () => { element('#confirm-dialog').close(); confirmations.at(-1).callback(); },
  };
}

test('a pending read blocks the import button and the real one-click update guard', async () => {
  const h = setup(), read = deferred(), pending = h.change(read.file);
  assert.equal(h.element('#import-backup').disabled, true);
  assert.equal(h.context.guard.check().reason, 'importing');
  assert.equal((await h.context.guard.prepare()).reason, 'importing');
  h.element('#import-backup').onclick();
  assert.equal(h.element('#backup-file').clicks, 0);
  read.resolve(createBackup(fixture('恢复计划'))); await pending;
  assert.equal(h.element('#import-backup').disabled, false);
  assert.equal(h.context.importingBackup, false);
  assert.equal(h.confirmations.length, 1);
  assert.equal(h.context.guard.check().reason, 'pending-action');
  h.element('#confirm-dialog').close();
  assert.equal(h.context.guard.check().ok, true);
});

for (const result of ['valid', 'invalid', 'rejected']) {
  test(`an older ${result} read cannot clear a newer pending import or display stale results`, async () => {
    const h = setup(), old = deferred(), latest = deferred();
    const first = h.change(old.file), second = h.change(latest.file);
    if (result === 'rejected') old.reject(new Error('旧文件读取失败'));
    else old.resolve(result === 'valid' ? createBackup(fixture('旧计划')) : '{invalid');
    await first;
    assert.equal(h.context.importingBackup, true);
    assert.equal(h.element('#import-backup').disabled, true);
    assert.equal(h.context.guard.check().reason, 'importing');
    assert.equal(h.element('#backup-result').textContent, '');
    assert.equal(h.confirmations.length, 0);
    latest.resolve(createBackup(fixture('最新计划'))); await second;
    assert.equal(h.confirmations.length, 1);
    h.accept();
    assert.equal(h.context.state.tasks[0].title, '最新计划');
    assert.equal(h.context.importingBackup, false);
  });
}

for (const result of ['valid', 'rejected']) {
  test(`a late old ${result} result cannot overwrite a newer successful confirmation`, async () => {
    const h = setup(), old = deferred(), latest = deferred();
    const first = h.change(old.file), second = h.change(latest.file);
    latest.resolve(createBackup(fixture('最新计划'))); await second;
    if (result === 'valid') old.resolve(createBackup(fixture('晚到的旧计划')));
    else old.reject(new Error('晚到的旧错误'));
    await first;
    assert.equal(h.element('#backup-result').textContent, '');
    assert.equal(h.confirmations.length, 1);
    assert.equal(h.context.importingBackup, false);
    assert.equal(h.element('#import-backup').disabled, false);
    h.accept();
    assert.equal(h.context.state.tasks[0].title, '最新计划');
  });
}

test('a confirmation from closed settings cannot later replace local data', async () => {
  const h = setup(), before = h.values.get(STORE);
  await h.change({ size: 100, text: async () => createBackup(fixture('已关闭的恢复计划')) });
  assert.equal(h.confirmations.length, 1);
  h.element('#settings-dialog').close();
  h.accept();
  assert.equal(h.values.get(STORE), before);
  assert.equal(h.writes.length, 0);
  assert.equal(h.context.state.tasks[0].title, '原计划');
});

test('closing settings cancels its read; reopening can read without the old callback interfering', async () => {
  const h = setup(), old = deferred(), latest = deferred();
  const first = h.change(old.file);
  h.element('#settings-dialog').close();
  assert.equal(h.context.importingBackup, false);
  assert.equal(h.element('#import-backup').disabled, false);
  assert.equal(h.context.guard.check().ok, true);
  h.element('#settings-dialog').open = true;
  const second = h.change(latest.file);
  old.resolve(createBackup(fixture('已关闭的计划'))); await first;
  assert.equal(h.context.importingBackup, true);
  assert.equal(h.confirmations.length, 0);
  latest.resolve(createBackup(fixture('重新选择的计划'))); await second;
  assert.equal(h.confirmations.length, 1);
  h.accept();
  assert.equal(h.context.state.tasks[0].title, '重新选择的计划');
});

test('update locking ignores both new file selections and a pending read result', async () => {
  const h = setup(), read = deferred();
  h.context.updateLocked = true;
  let reads = 0;
  await h.change({ size: 10, text: () => { reads++; return Promise.resolve('{}'); } });
  assert.equal(reads, 0);
  h.context.updateLocked = false;
  const pending = h.change(read.file);
  h.context.updateLocked = true;
  read.resolve(createBackup(fixture('晚到计划'))); await pending;
  assert.equal(h.confirmations.length, 0);
  assert.equal(h.context.importingBackup, false);
  assert.equal(h.element('#import-backup').disabled, false);
  assert.equal(h.writes.length, 0);
});

test('a current read failure preserves all data and allows retry; cancellation is a no-op', async () => {
  const h = setup(), read = deferred(), before = h.values.get(STORE);
  await h.change(null);
  assert.equal(h.context.importingBackup, false);
  const pending = h.change(read.file);
  read.reject(new Error('文件读取失败')); await pending;
  assert.equal(h.element('#backup-result').textContent, '文件读取失败');
  assert.equal(h.element('#import-backup').disabled, false);
  assert.equal(h.context.importingBackup, false);
  assert.equal(h.values.get(STORE), before);
  assert.equal(h.confirmations.length, 0);
  h.element('#import-backup').onclick();
  assert.equal(h.element('#backup-file').clicks, 1);
});

test('a stale settings save retains recordings and does not recommend closing their unsaved draft', () => {
  const h = setup(), clip = 'data:audio/mp4;base64,dm9pY2U=';
  h.setVoiceDraft({ ...h.context.state.settings.voices, start: clip });
  const newer = JSON.stringify(fixture('其他窗口的新计划'));
  h.values.set(STORE, newer);
  h.element('#save-settings').onclick();
  assert.equal(h.values.get(STORE), newer);
  assert.equal(h.element('#settings-dialog').open, true);
  assert.equal(h.context.sceneVoiceSettings.getVoices().start, clip);
  assert.equal(h.context.state.settings.voices.start, null);
  assert.match(h.messages.at(-1), /不要关闭/);
  assert.doesNotMatch(h.messages.at(-1), /重新打开/);
});
