import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = new URL('../dist/', import.meta.url);

/** Every shipped script must be syntax-checked, including generated sw.js. */
export async function listSyntaxFiles(directory = dist) {
  return (await readdir(directory))
    .filter(name => name.endsWith('.mjs') || name === 'sw.js')
    .sort()
    .map(name => new URL(name, directory));
}

async function main() {
  const files = await listSyntaxFiles();
  for (const file of files) {
    execFileSync(process.execPath, ['--check', fileURLToPath(file)], { stdio: 'inherit' });
  }
  process.stdout.write(`Syntax OK: ${files.length} scripts\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
