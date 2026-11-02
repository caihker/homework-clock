import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const { version } = JSON.parse(await read('../demo/package.json'));
assert.match(version, /^\d+\.\d+\.\d+$/, 'Use a numeric major.minor.patch version.');
const html = await read('../demo/dist/index.html');
assert.ok(html.includes(`<span class="settings-version">v${version}</span>`), 'Settings footer must match package version.');
for (const entry of ['app.mjs', 'pwa.mjs']) {
  assert.ok(html.includes(`./${entry}?v=${version}"`), `${entry} entry version must match package version.`);
}
const changelog = await read('../CHANGELOG.md');
assert.ok(changelog.includes(`## [${version}]`), 'Current version needs a changelog entry.');
if (process.env.GITHUB_REF_TYPE === 'tag') {
  assert.equal(process.env.GITHUB_REF_NAME, `v${version}`, 'Release tag must match package version.');
}
console.log(`Version is consistent: v${version}`);
