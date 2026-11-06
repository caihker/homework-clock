import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { collectOfflineAssets } from '../scripts/build-offline.mjs';
import { moodLabels } from '../dist/mascot.mjs';
import { TURTLE_LINES } from '../dist/voice-pack.mjs';

const dist = new URL('../dist/', import.meta.url);
const base = new URL('https://homework-clock.example/');
const assets = await collectOfflineAssets();
const included = new Map(assets.map(asset => [asset.url, asset]));
const hash = content => createHash('sha256').update(content).digest('hex');
const read = key => readFile(new URL(key, dist), 'utf8');

function required(reference, owner = './index.html') {
  if (/^(?:data:|blob:|#)/i.test(reference)) return null;
  const url = new URL(reference, new URL(owner, base));
  if (url.origin !== base.origin || url.pathname.endsWith('/')) return null;
  const key = '.' + decodeURIComponent(url.pathname);
  assert.ok(included.has(key), `${owner} needs ${reference}, missing from offline resources`);
  return key;
}

function localImports(source) {
  return [...source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"](\.{1,2}\/[^'"]+)['"]/g),
    ...source.matchAll(/\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)].map(match => match[1]);
}

test('canonical homepage is embedded exactly, with the original UTF-8 bytes and hash', async () => {
  const homepage = included.get('./index.html');
  const source = await readFile(new URL('./index.html', dist));
  assert.equal(homepage.inline, source.toString('utf8'));
  assert.equal(homepage.bytes, source.length);
  assert.equal(homepage.sha256, hash(Buffer.from(homepage.inline, 'utf8')));
  assert.ok(assets.filter(asset => Object.hasOwn(asset, 'inline')).every(asset => asset.url === './index.html'));
});

test('homepage, stylesheets, manifest and the complete static module graph are available offline', async () => {
  const homepage = await read('./index.html');
  const modules = [];
  const stylesheets = [];
  for (const match of homepage.matchAll(/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/g)) {
    const key = required(match[1]);
    if (key?.endsWith('.mjs') || key?.endsWith('.js')) modules.push(key);
    if (key?.endsWith('.css')) stylesheets.push(key);
  }
  const visited = new Set();
  while (modules.length) {
    const key = modules.shift();
    if (visited.has(key)) continue;
    visited.add(key);
    const source = await read(key);
    for (const reference of localImports(source)) {
      const dependency = required(reference, key);
      if (dependency?.endsWith('.mjs') || dependency?.endsWith('.js')) modules.push(dependency);
    }
    // Static artwork in JS is also needed for empty plans and reduced motion.
    for (const match of source.matchAll(/(['"`])(\.\/assets\/[^'"`]+)\1/g)) {
      if (!match[2].includes('${')) required(match[2], key);
    }
    for (const legacy of ['category-3d-v2/', 'category-flat-v1/', 'motion/']) {
      assert.ok(!source.includes(`./assets/${legacy}`), `${key} still uses a retired asset directory`);
    }
  }
  assert.ok(visited.has('./app.mjs') && visited.has('./pwa.mjs'));
  for (const key of stylesheets) {
    const source = await read(key);
    for (const match of source.matchAll(/url\(\s*['"]?([^'"\)]+)['"]?\s*\)/g)) required(match[1].trim(), key);
  }
  const manifest = JSON.parse(await read('./manifest.webmanifest'));
  for (const icon of manifest.icons) required(icon.src, './manifest.webmanifest');
});

test('all dynamic voices, mascot states, category variants and complete font files stay cached', async () => {
  for (const voice of Object.values(TURTLE_LINES)) required(voice.src, './voice-pack.mjs');
  const animationFiles = new Set(Object.keys(moodLabels).flatMap(mood =>
    mood === 'walking' ? ['walking-left', 'walking-right'] : [mood === 'happy' ? 'happy-jump' : mood]));
  for (const name of animationFiles) required(`./assets/motion-original-v2/${name}.webp`, './app.mjs');
  for (const name of ['learning', 'life', 'play']) required(`./assets/category-flat-byg/${name}.png`, './app.mjs');
  // Full font files must be retained even when only a core subset has rendered.
  for (const name of await readdir(new URL('./assets/fonts/', dist))) {
    if (name.endsWith('.woff2')) required(`./assets/fonts/${name}`, './font-faces.css');
  }
  for (const name of await readdir(new URL('./assets/voice-pack-v1/', dist))) {
    if (name.endsWith('.mp3')) required(`./assets/voice-pack-v1/${name}`, './voice-pack.mjs');
  }
});

test('retired runtime variants are archived outside the deployable dist', async () => {
  const deployed = await readdir(new URL('./assets/', dist));
  const archived = new URL('../../design-assets/retired-runtime-assets/', import.meta.url);
  for (const directory of ['category-3d-v2', 'category-flat-v1', 'motion']) {
    assert.ok(!deployed.includes(directory), `${directory} must not be deployed`);
    const files = await readdir(new URL(`${directory}/`, archived));
    assert.ok(files.length > 0, `${directory} sources must stay archived`);
    assert.ok(!assets.some(asset => asset.url.startsWith(`./assets/${directory}/`)));
  }
  assert.ok(assets.some(asset => asset.url.startsWith('./assets/motion-original-v2/')));
  assert.ok(!included.has('./sw.js'));
});

test('optional solid companion animations and still frame are cached', () => {
  for (const name of ['ready.webp','waiting.webp','rest.webp','happy-jump.webp','walking-left.webp','walking-right.webp','still.png']) required(`./assets/motion-solid/${name}`);
});

test('first-screen images stay within the install budget', () => {
  const limits = {
    './assets/category-flat-byg/learning.png': 120 * 1024,
    './assets/category-flat-byg/life.png': 120 * 1024,
    './assets/category-flat-byg/play.png': 120 * 1024,
    './assets/turtle-icon.png': 120 * 1024,
    './assets/turtle-mascot.png': 350 * 1024,
  };
  let total = 0;
  for (const [key, limit] of Object.entries(limits)) {
    const asset = included.get(key);
    assert.ok(asset, `${key} must be offline cached`);
    assert.ok(asset.bytes <= limit, `${key} is ${asset.bytes} bytes, budget ${limit}`);
    total += asset.bytes;
  }
  assert.ok(total <= 800 * 1024, `first-screen images total ${total} bytes, budget 800 KiB`);
});
