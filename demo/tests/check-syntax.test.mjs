import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { listSyntaxFiles } from '../scripts/check-syntax.mjs';

const dist = new URL('../dist/', import.meta.url);

test('syntax check covers every shipped .mjs module and the generated worker', async () => {
  const checked = (await listSyntaxFiles()).map(file => file.pathname.split('/').pop());
  const modules = (await readdir(dist)).filter(name => name.endsWith('.mjs'));
  assert.deepEqual([...checked].sort(), [...modules, 'sw.js'].sort());
});

test('the package check script runs the shared syntax checker before the manifest check', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts.check, /check-syntax\.mjs/);
  assert.match(pkg.scripts.check, /build-offline\.mjs --check/);
});
