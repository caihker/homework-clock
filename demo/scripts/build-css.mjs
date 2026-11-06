import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const demo = dirname(dirname(fileURLToPath(import.meta.url)));
const styles = join(demo, 'styles');
const dist = join(demo, 'dist');

/**
 * Load order is behaviour: later files intentionally override earlier ones.
 * Keep this list identical to the former <link> order in index.html.
 */
export const STYLE_ORDER = Object.freeze([
  'font-faces.css',
  'styles.css',
  'time-picker.css',
  'session-controls.css',
  'voice-pack.css',
  'ipad.css',
  'fonts.css',
  'category-icons.css',
  'local-use.css',
  'pwa.css',
  'scene-voice-settings.css',
  'settings.css',
  'companion-size.css',
]);

/** Concatenate CSS sources in load order; URLs resolve from the dist root. */
export async function buildCss() {
  const parts = [];
  for (const name of STYLE_ORDER) {
    const source = await readFile(join(styles, name), 'utf8');
    parts.push(`/* ${name} */\n${source.trimEnd()}`);
  }
  return `${parts.join('\n\n')}\n`;
}

async function main() {
  const bundle = await buildCss();
  const destination = join(dist, 'site.css');
  if (process.argv.includes('--check')) {
    const current = await readFile(destination, 'utf8').catch(() => '');
    if (current !== bundle) throw new Error('dist/site.css 已过期，请先运行 node scripts/build-css.mjs');
    process.stdout.write(`Stylesheet bundle is current: ${STYLE_ORDER.length} sources\n`);
  } else {
    await writeFile(destination, bundle);
    process.stdout.write(`Stylesheet bundle: ${STYLE_ORDER.length} sources -> site.css\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
