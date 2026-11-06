import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { buildCss, STYLE_ORDER } from '../scripts/build-css.mjs';

const dist = new URL('../dist/', import.meta.url);
const styles = new URL('../styles/', import.meta.url);

test('the shipped stylesheet is exactly the ordered concatenation of its sources', async () => {
  const shipped = await readFile(new URL('./site.css', dist), 'utf8');
  assert.equal(shipped, await buildCss());
});

test('the homepage loads one stylesheet and every source is covered once', async () => {
  const html = await readFile(new URL('./index.html', dist), 'utf8');
  const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(links, ['./site.css?v=1']);
  const sources = (await readdir(styles)).filter(name => name.endsWith('.css')).sort();
  assert.deepEqual([...STYLE_ORDER].sort(), sources);
  assert.equal(new Set(STYLE_ORDER).size, STYLE_ORDER.length);
});
