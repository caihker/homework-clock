import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../dist/app.mjs', import.meta.url), 'utf8');

/** Extract a named function body so regressions are caught structurally. */
function functionBody(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name}() must exist in app.mjs`);
  const signatureEnd = source.indexOf(') {', start);
  assert.notEqual(signatureEnd, -1, `${name}() must have a body`);
  const open = signatureEnd + 2;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}()`);
}

test('render() never writes storage; mutations persist explicitly', () => {
  const body = functionBody('render');
  assert.doesNotMatch(body, /\bpersist\s*\(/, 'render() must stay a pure view update');
  assert.match(body, /updateClocks\(\);/);
});

test('persist() refuses automatic writes while the snapshot needs recovery', () => {
  const body = functionBody('persist');
  assert.match(body, /if \(writeBlocked && !updating\)/, 'recovery mode must block autosave');
  assert.match(body, /commitLocalState\(/, 'the guarded commit helper must remain the only writer');
});

test('saving settings commits once instead of writing through render() again', () => {
  const start = source.indexOf("$('#save-settings').onclick=");
  const end = source.indexOf('function backupAvailable()');
  assert.ok(start >= 0 && end > start, 'save-settings handler must exist');
  const handler = source.slice(start, end);
  assert.match(handler, /commitLocalState\(/);
  assert.doesNotMatch(handler, /\bpersist\s*\(/, 'a committed settings save must not write twice');
});

test('the boot path persists once and starts a guarded tick loop', () => {
  const start = source.indexOf('let bootError=null;');
  const end = source.indexOf("window.addEventListener('homework-offline-ready'");
  assert.ok(start >= 0 && end > start, 'boot block must exist');
  const block = source.slice(start, end);
  assert.match(block, /if \(!writeBlocked && !bootError\) persist\(\);/);
  assert.match(block, /startTicking\(\);/);
  assert.match(block, /reportFatal\(bootError\);/);
  const ticking = functionBody('startTicking');
  assert.match(ticking, /lastTick = now\(\)\.getTime\(\);/);
  assert.match(ticking, /lastMinute = '';/);
  assert.match(ticking, /setInterval\(\(\)\s*=>\s*\{[^}]*tick\(\)/);
});

test('every recovery exit restarts the clock loop', () => {
  const calls = source.match(/startTicking\(\);/g) || [];
  assert.ok(calls.length >= 4, 'reset, backup restore, adoption and boot must restart ticking');
  assert.match(functionBody('reportFatal'), /tickTimer = null;/, 'a fatal error must clear the loop handle');
});
