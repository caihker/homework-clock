import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../dist/app-controller.mjs', import.meta.url), 'utf8');
const timelineView = await readFile(new URL('../dist/timeline-view.mjs', import.meta.url), 'utf8');

test('the home page discloses foreground-only reminders and no app limits', () => {
  assert.match(html, /仅前台提醒 · 不限制其他 App/);
  assert.match(html, /本版本不提供应用限制/);
  assert.match(html, /提醒仅在应用打开时生效，本版本不限制其他 App/);
});

test('closing settings asks before discarding an unsaved draft', () => {
  assert.match(app, /function requestSettingsClose\(\)/);
  assert.match(app, /hasSettingsDraft\(state\.settings,settingsDraft\(\)\)/);
  assert.match(app, /dialog\?\.id==='settings-dialog'\)requestSettingsClose\(\)/);
  assert.match(app, /settings-dialog'\)\.addEventListener\('cancel'/);
});

test('the day timeline offers free-text notes without a time window', () => {
  assert.match(html, /id="notes-list"/);
  assert.match(html, /id="add-note"/);
  assert.match(html, /id="note-dialog"/);
  assert.match(html, /maxlength="300"/);
  assert.match(timelineView, /function renderNotes\(\)/);
  assert.match(app, /state\.notes=\[\.\.\.\(state\.notes\|\|\[\]\)/);
});
