import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';

const template = await readFile(new URL('../scripts/service-worker.template.js', import.meta.url), 'utf8');
const scope = 'https://clock.example.test/homework/';
const prefix = `homework-clock:${scope}:`;
const hash = content => createHash('sha256').update(content).digest('hex');
const resources = {
  './index.html': '<!doctype html><html>作业时钟</html>',
  './app.mjs': 'export const version = "old";',
  './assets/voice.mp3': Uint8Array.from([10, 20, 30, 40, 50, 60]),
  './assets/never-used.woff2': Uint8Array.from([1, 5, 9]),
};

function storage({ beforePut } = {}) {
  const stores = new Map();
  return {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async match(key) { return entries.get(String(key))?.clone(); },
        async put(key, value) { await beforePut?.(String(key), value); entries.set(String(key), value.clone()); },
        async delete(key) { return entries.delete(String(key)); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
}

function worker({ version = 'old', files = resources, cacheStorage = storage(), overrides = {}, network = true, inline = {}, fastTimers = false, windows = [], lookupClient, onSkipWaiting, now = Date.now } = {}) {
  const handlers = new Map();
  const messages = [];
  const requests = [];
  const actions = { skipWaiting: 0, claim: 0 };
  const currentWindows = () => typeof windows === 'function' ? windows() : windows;
  const build = {
    version,
    assets: Object.entries(files).map(([url, content]) => ({ url, sha256: hash(content), ...(Object.hasOwn(inline, url) ? { inline: inline[url] } : {}) })),
  };
  const context = vm.createContext({
    BUILD: build,
    URL, Request, Response, Headers, AbortController, MessageChannel,
    Date: class extends Date { static now() { return now(); } },
    setTimeout: fastTimers ? (fn, ms) => setTimeout(fn, Math.min(ms, 40)) : setTimeout,
    clearTimeout,
    crypto: webcrypto,
    caches: cacheStorage,
    fetch: async request => {
      requests.push(request);
      if (!network) throw new Error('offline');
      const local = './' + new URL(request.url).pathname.slice(new URL(scope).pathname.length);
      const content = Object.hasOwn(overrides, local) ? overrides[local] : files[local];
      if (typeof content === 'function') return content(request);
      if (content instanceof Response) return content.clone();
      if (content === undefined) return new Response('missing', { status: 404 });
      return new Response(content, { headers: { 'Content-Type': local.endsWith('.mp3') ? 'audio/mpeg' : 'text/plain' } });
    },
    self: {
      registration: { scope },
      clients: {
        matchAll: async () => [{ postMessage: message => messages.push(message) }, ...currentWindows()],
        get: async id => lookupClient ? lookupClient(id) : currentWindows().find(client => client.id === id),
        claim: async () => { actions.claim++; },
      },
      skipWaiting: async () => { actions.skipWaiting++; await onSkipWaiting?.(); },
      addEventListener: (name, handler) => handlers.set(name, handler),
    },
  });
  vm.runInContext(template, context);
  return {
    cacheStorage, messages, requests, actions,
    async dispatch(name, properties = {}) {
      let waiting;
      let response;
      handlers.get(name)?.({
        ...properties,
        waitUntil: promise => { waiting = promise; },
        respondWith: promise => { response = promise; },
      });
      await waiting;
      return response;
    },
    async status(type = 'OFFLINE_STATUS') {
      let result;
      await this.dispatch('message', { data: { type }, ports: [{ postMessage: value => { result = value; } }] });
      return result;
    },
    async apply(clientId = 'initiator', data = {}) {
      let result;
      await this.dispatch('message', { data: { type: 'APPLY_UPDATE', version, transactionId: 'update-test', ...data }, source: { id: clientId }, ports: [{ postMessage: value => { result = value; } }] });
      return result;
    },
    request(path, { range, navigate = false } = {}) {
      return this.dispatch('fetch', { request: { url: new URL(path, scope).href, method: 'GET', mode: navigate ? 'navigate' : 'cors', headers: new Headers(range ? { range } : {}) } });
    },
  };
}

function windowClient(id, { url = scope, type = 'window', prepare = { ready: true, protocol: 1 }, commit = { ready: true }, onMessage } = {}) {
  const messages = [];
  return {
    id, url, type, messages,
    postMessage(message, ports = []) {
      messages.push(message);
      onMessage?.(message);
      if (!ports[0]) return;
      const reply = message.type === 'PREPARE_UPDATE' ? prepare : message.type === 'COMMIT_UPDATE' ? commit : undefined;
      if (reply !== undefined) queueMicrotask(() => ports[0].postMessage(reply));
    },
  };
}

test('one-click activation coordinates every window before committing and skipping waiting', async () => {
  const initiator = windowClient('initiator');
  const sibling = windowClient('sibling');
  const otherScope = windowClient('other', { url: 'https://clock.example.test/other/' });
  const instance = worker({ windows: [initiator, sibling, otherScope] });
  await instance.dispatch('install');
  assert.equal(instance.actions.skipWaiting, 0, 'installation alone must continue waiting');
  assert.equal((await instance.status()).canApplyUpdate, true);
  const result = await instance.apply();
  assert.equal(result.ready, true);
  assert.equal(result.activating, true);
  assert.equal(instance.actions.skipWaiting, 1);
  assert.deepEqual(initiator.messages.filter(m => m.source === 'homework-clock-update').map(m => m.type), ['PREPARE_UPDATE', 'COMMIT_UPDATE']);
  assert.deepEqual(sibling.messages.filter(m => m.source === 'homework-clock-update').map(m => m.type), ['PREPARE_UPDATE']);
  assert.equal(otherScope.messages.filter(m => m.source === 'homework-clock-update').length, 0);
  await instance.dispatch('activate');
  assert.equal(instance.actions.claim, 1);
  assert.equal(instance.messages.find(m => m.type === 'ACTIVATED').transactionId, 'update-test');
});

test('explicit activation intent survives a restarted worker and keeps old windows caches', async () => {
  const cacheStorage = storage();
  await worker({ cacheStorage }).dispatch('install');
  const initiator = windowClient('initiator');
  const next = worker({ version: 'next', cacheStorage, windows: [initiator] });
  await next.dispatch('install');
  assert.equal((await next.apply()).ready, true);
  const restarted = worker({ version: 'next', cacheStorage, windows: [initiator] });
  await restarted.dispatch('activate');
  assert.equal(restarted.actions.claim, 1);
  assert.deepEqual(await cacheStorage.keys(), [prefix + 'old', prefix + 'next']);
  const nextCache = await cacheStorage.open(prefix + 'next');
  assert.equal(await nextCache.match(new URL('./.homework-clock-update-intent', scope).href), undefined);
  assert.equal((await worker({ cacheStorage, network: false }).status()).ready, true);
});

test('evicting the complete waiting cache repairs assets but loses the optional activation intent and claim', async () => {
  const cacheStorage = storage();
  const initiator = windowClient('initiator');
  const next = worker({ version: 'next', cacheStorage, windows: [initiator] });
  await next.dispatch('install');
  assert.equal((await next.apply()).ready, true);
  await cacheStorage.delete(prefix + 'next');
  await next.dispatch('activate');
  assert.equal((await next.status()).ready, true, 'new navigation can safely use the repaired active worker');
  assert.equal(next.actions.claim, 0, 'cache eviction also removed the activation intent');
  const activated = next.messages.find(message => message.type === 'ACTIVATED');
  assert.equal(activated.version, 'next');
  assert.equal(activated.transactionId, undefined);
});

test('ordinary activation does not claim open windows or drop their old snapshot', async () => {
  const cacheStorage = storage();
  await worker({ cacheStorage }).dispatch('install');
  const next = worker({ version: 'next', cacheStorage, windows: [windowClient('existing')] });
  await next.dispatch('install'); await next.dispatch('activate');
  assert.equal(next.actions.skipWaiting, 0);
  assert.equal(next.actions.claim, 0);
  assert.deepEqual(await cacheStorage.keys(), [prefix + 'old', prefix + 'next']);
});

test('apply rejects foreign clients, missing clients, stale versions and incomplete resources', async () => {
  for (const client of [windowClient('initiator', { url: 'https://other.example.test/homework/' }), windowClient('initiator', { url: 'https://clock.example.test/homework-elsewhere/' }), windowClient('initiator', { type: 'worker' }), undefined]) {
    const instance = worker({ lookupClient: () => client, windows: client ? [client] : [] });
    await instance.dispatch('install');
    assert.equal((await instance.apply()).error.reason, 'source');
    assert.equal(instance.actions.skipWaiting, 0);
  }
  const client = windowClient('initiator');
  const instance = worker({ windows: [client] });
  await instance.dispatch('install');
  assert.equal((await instance.apply('initiator', { version: 'stale' })).error.reason, 'version');
  assert.equal((await instance.apply('initiator', { transactionId: '' })).error.reason, 'source');
  await (await instance.cacheStorage.open(prefix + 'old')).delete(new URL('./app.mjs', scope).href);
  assert.equal((await instance.apply()).error.reason, 'incomplete');
  assert.equal(instance.actions.skipWaiting, 0);
  assert.equal(client.messages.some(m => m.type === 'PREPARE_UPDATE'), false);
});

test('a busy, unsupported or unresponsive sibling cancels the whole update before commit', async () => {
  for (const prepare of [{ ready: false, message: '另一个窗口正在录音。' }, { ready: true }, undefined]) {
    const initiator = windowClient('initiator');
    const sibling = windowClient('sibling');
    // Explicit undefined represents an old page without a coordinator.
    sibling.postMessage = (message, ports = []) => {
      sibling.messages.push(message);
      if (message.type === 'PREPARE_UPDATE' && prepare !== undefined) queueMicrotask(() => ports[0].postMessage(prepare));
    };
    const instance = worker({ windows: [initiator, sibling], fastTimers: true });
    await instance.dispatch('install');
    const result = await instance.apply();
    assert.equal(result.ready, false);
    assert.equal(result.error.reason, 'client');
    if(prepare?.message){assert.match(result.error.message,/另一个作业时钟窗口/);for(const client of [initiator,sibling])assert.ok(client.messages.some(m=>m.type==='CANCEL_UPDATE'&&m.message===result.error.message));}
    assert.equal(instance.actions.skipWaiting, 0);
    assert.equal(initiator.messages.some(m => m.type === 'COMMIT_UPDATE'), false);
    for (const client of [initiator, sibling]) assert.ok(client.messages.some(m => m.type === 'CANCEL_UPDATE' && m.transactionId === 'update-test'));
  }
});

test('unresponsive windows do not prevent the other participants from receiving preparation', async () => {
  const blocked = windowClient('blocked');
  blocked.postMessage = message => blocked.messages.push(message);
  const initiator = windowClient('initiator');
  const sibling = windowClient('sibling');
  const instance = worker({ windows: [blocked, initiator, sibling], fastTimers: true });
  await instance.dispatch('install');
  const pending = instance.apply();
  await new Promise(resolve => setImmediate(resolve));
  for (const client of [blocked, initiator, sibling]) assert.ok(client.messages.some(message => message.type === 'PREPARE_UPDATE'));
  const result = await pending;
  assert.equal(result.error.reason, 'client');
  for (const client of [blocked, initiator, sibling]) assert.ok(client.messages.some(message => message.type === 'CANCEL_UPDATE'));
  assert.equal(instance.actions.skipWaiting, 0);
});

test('storage refusal and resources evicted after commit keep the original worker', async () => {
  for (const evict of [false, true]) {
    const initiator = windowClient('initiator', {
      commit: { ready: evict, message: '本机数据未能保存。' },
      onMessage: message => { if (evict && message.type === 'COMMIT_UPDATE') cacheStorage.stores.get(prefix + 'old').delete(new URL('./app.mjs', scope).href); },
    });
    const cacheStorage = storage();
    const instance = worker({ cacheStorage, windows: [initiator] });
    await instance.dispatch('install');
    const result = await instance.apply();
    assert.equal(result.ready, false);
    assert.equal(result.error.reason, evict ? 'incomplete' : 'client');
    assert.equal(instance.actions.skipWaiting, 0);
    assert.ok(initiator.messages.some(m => m.type === 'CANCEL_UPDATE'));
  }
});

test('activation metadata storage failure releases every participant without skipping waiting', async () => {
  const initiator = windowClient('initiator');
  const sibling = windowClient('sibling');
  const cacheStorage = storage({ beforePut(key) { if (key.endsWith('.homework-clock-update-intent')) throw new DOMException('full', 'QuotaExceededError'); } });
  const instance = worker({ cacheStorage, windows: [initiator, sibling] });
  await instance.dispatch('install');
  const result = await instance.apply();
  assert.equal(result.ready, false);
  assert.equal(result.error.reason, 'storage');
  assert.equal(instance.actions.skipWaiting, 0);
  for (const client of [initiator, sibling]) assert.ok(client.messages.some(message => message.type === 'CANCEL_UPDATE'));
  assert.equal((await instance.status()).ready, true);
});

test('a newly opened window or vanished initiator cancels before skipping waiting', async () => {
  for (const phase of ['PREPARE_UPDATE', 'COMMIT_UPDATE']) {
    for (const disappear of [false, true]) {
      let windows;
      const initiator = windowClient('initiator', { onMessage: message => {
        if (message.type === phase) windows = disappear ? [] : [initiator, windowClient('new-window')];
      } });
      windows = [initiator];
      const instance = worker({ windows: () => windows });
      await instance.dispatch('install');
      const result = await instance.apply();
      assert.equal(result.ready, false);
      assert.equal(result.error.reason, 'client');
      assert.equal(instance.actions.skipWaiting, 0);
      assert.ok(initiator.messages.some(m => m.type === 'CANCEL_UPDATE'));
    }
  }
});

test('a window opened during the final activation-intent write still cancels the update', async () => {
  const initiator = windowClient('initiator');
  const newcomer = windowClient('during-storage');
  const windows = [initiator];
  const cacheStorage = storage({ beforePut(key) {
    if (key.endsWith('.homework-clock-update-intent')) windows.push(newcomer);
  } });
  const instance = worker({ cacheStorage, windows: () => windows });
  await instance.dispatch('install');
  const result = await instance.apply();
  assert.equal(result.ready, false);
  assert.equal(result.error.reason, 'client');
  assert.equal(instance.actions.skipWaiting, 0);
  for (const client of windows) assert.ok(client.messages.some(message => message.type === 'CANCEL_UPDATE'));
  const cache = await cacheStorage.open(prefix + 'old');
  assert.equal(await cache.match(new URL('./.homework-clock-update-intent', scope).href), undefined);
});

test('expired preparation, commit or intent storage cannot activate after a page unlocks', async () => {
  for (const phase of ['PREPARE_UPDATE', 'COMMIT_UPDATE', 'intent-storage']) {
    let currentTime = 1000;
    let persistedExpiresAt;
    const initiator = windowClient('initiator', { onMessage: message => {
      if (message.type === phase) currentTime = 21000;
    } });
    const cacheStorage = storage({ async beforePut(key, value) {
      if (!key.endsWith('.homework-clock-update-intent')) return;
      persistedExpiresAt = (await value.clone().json()).expiresAt;
      if (phase === 'intent-storage') currentTime = 21000;
    } });
    const instance = worker({ cacheStorage, windows: [initiator], now: () => currentTime });
    await instance.dispatch('install');
    // A caller cannot extend the worker's internally bounded transaction.
    const result = await instance.apply('initiator', { expiresAt: Number.MAX_SAFE_INTEGER });
    assert.equal(result.ready, false, phase);
    assert.equal(result.error.reason, 'timeout', phase);
    assert.equal(instance.actions.skipWaiting, 0, phase);
    const prepare = initiator.messages.find(message => message.type === 'PREPARE_UPDATE');
    assert.equal(prepare.expiresAt, 21000);
    const cancelled = initiator.messages.find(message => message.type === 'CANCEL_UPDATE');
    assert.equal(cancelled.expiresAt, 21000);
    assert.equal(cancelled.message, result.error.message);
    if (phase === 'intent-storage') assert.equal(persistedExpiresAt, 21000);
    const cache = await cacheStorage.open(prefix + 'old');
    assert.equal(await cache.match(new URL('./.homework-clock-update-intent', scope).href), undefined);
    assert.equal((await instance.status()).ready, true);
  }
});

test('parallel apply requests share no extra commit and skipWaiting failures release windows', async () => {
  let resume;
  const accepted = new Promise(resolve => { resume = resolve; });
  const initiator = windowClient('initiator');
  const instance = worker({ windows: [initiator], onSkipWaiting: () => accepted });
  await instance.dispatch('install');
  const first = instance.apply();
  await new Promise(resolve => setImmediate(resolve));
  const duplicate = await instance.apply('initiator', { transactionId: 'other-click' });
  assert.equal(duplicate.ready, false);
  resume(); await first;
  assert.equal(instance.actions.skipWaiting, 1);
  assert.equal(initiator.messages.filter(m => m.type === 'COMMIT_UPDATE').length, 1);

  const refusing = worker({ windows: [initiator], onSkipWaiting: () => { throw new Error('cannot activate'); } });
  await refusing.dispatch('install');
  assert.equal((await refusing.apply()).ready, false);
  assert.ok(initiator.messages.some(m => m.type === 'CANCEL_UPDATE'));
  await refusing.dispatch('activate');
  assert.equal(refusing.actions.claim, 0, 'failed skipWaiting must remove its activation intent');
});

test('first install includes unused resources and cache cleanup is limited to this app scope', async () => {
  const instance = worker();
  const other = 'another-app:cache';
  const anotherScope = 'homework-clock:https://clock.example.test/other/:old';
  await instance.cacheStorage.open(prefix + 'previous');
  await instance.cacheStorage.open(other);
  await instance.cacheStorage.open(anotherScope);
  await instance.dispatch('install');
  assert.equal((await instance.status()).ready, true);
  assert.equal(instance.requests.length, Object.keys(resources).length);
  assert.ok(instance.requests.every(request => request.redirect === 'error' && request.cache === 'reload'));
  assert.ok(instance.requests.some(request => request.url.endsWith('never-used.woff2')));
  // Installing a new snapshot does not delete the one currently in use.
  assert.ok((await instance.cacheStorage.keys()).includes(prefix + 'previous'));
  await instance.dispatch('activate');
  assert.deepEqual((await instance.cacheStorage.keys()).sort(), [other, anotherScope, prefix + 'old'].sort());
});

test('failed downloads retain verified partial entries without replacing the old snapshot', async () => {
  const cacheStorage = storage();
  const old = worker({ cacheStorage });
  await old.dispatch('install');
  const next = worker({ version: 'next', cacheStorage, overrides: { './app.mjs': 'unexpected content from another release' } });
  await assert.rejects(next.dispatch('install'), /integrity/);
  assert.deepEqual(await cacheStorage.keys(), [prefix + 'old', prefix + 'next']);
  assert.equal((await old.status()).ready, true);
  assert.equal((await next.status()).ready, false);
  const partial = await cacheStorage.open(prefix + 'next');
  assert.ok(await partial.match(new URL('./index.html', scope).href));
  assert.equal(await partial.match(new URL('./app.mjs', scope).href), undefined);
  const error = next.messages.find(message => message.type === 'FAILED').error;
  assert.equal(error.reason, 'integrity');
  assert.equal(error.path, './app.mjs');
  assert.equal(next.requests.filter(request => request.url.endsWith('app.mjs')).length, 1);
});

test('an installed update leaves the active build intact until activation', async () => {
  const cacheStorage = storage();
  const old = worker({ cacheStorage });
  await old.dispatch('install');
  const files = { ...resources, './app.mjs': 'export const version = "next";' };
  const next = worker({ version: 'next', cacheStorage, files });
  await next.dispatch('install');
  assert.match(await (await old.request('./app.mjs?v=anything')).text(), /"old"/);
  assert.equal((await old.status()).ready, true);
  assert.equal((await next.status()).ready, true);
  await next.dispatch('activate');
  assert.match(await (await next.request('./app.mjs?v=next')).text(), /"next"/);
  assert.deepEqual(await cacheStorage.keys(), [prefix + 'next']);
});

test('cached navigation and Safari audio ranges work without network', async () => {
  const cacheStorage = storage();
  await worker({ cacheStorage }).dispatch('install');
  const offline = worker({ cacheStorage, network: false });
  assert.match(await (await offline.request('./?from=homescreen', { navigate: true })).text(), /作业时钟/);
  const head = await offline.request('./assets/voice.mp3', { range: 'bytes=0-1' });
  assert.equal(head.status, 206);
  assert.equal(head.headers.get('content-range'), 'bytes 0-1/6');
  assert.deepEqual([...new Uint8Array(await head.arrayBuffer())], [10, 20]);
  const suffix = await offline.request('./assets/voice.mp3', { range: 'bytes=-2' });
  assert.deepEqual([...new Uint8Array(await suffix.arrayBuffer())], [50, 60]);
  assert.equal((await offline.request('./assets/voice.mp3', { range: 'bytes=9-' })).status, 416);
  assert.equal(await offline.request('https://other.example.test/resource'), undefined);
  assert.equal(offline.requests.length, 0);
});

test('activation retains the previous complete snapshot when waiting cache was evicted', async () => {
  const cacheStorage = storage();
  const old = worker({ cacheStorage });
  await old.dispatch('install');
  await worker({ version: 'next', cacheStorage }).dispatch('install');
  const nextCache = await cacheStorage.open(prefix + 'next');
  await nextCache.delete(new URL('./app.mjs', scope).href);
  const offlineNext = worker({ version: 'next', cacheStorage, network: false });
  await assert.rejects(offlineNext.dispatch('activate'), /network/);
  assert.ok((await cacheStorage.keys()).includes(prefix + 'old'));
  assert.equal((await old.status()).ready, true);
});

test('cache eviction is reported and repair refuses files from a newer build', async () => {
  const cacheStorage = storage();
  const initial = worker({ cacheStorage });
  await initial.dispatch('install');
  const cache = await cacheStorage.open(prefix + 'old');
  await cache.delete(new URL('./app.mjs', scope).href);
  const wrong = worker({ cacheStorage, overrides: { './app.mjs': 'new release' } });
  assert.equal((await wrong.status()).ready, false);
  assert.equal((await wrong.status('REPAIR_OFFLINE')).ready, false);
  assert.equal((await wrong.request('./app.mjs')).type, 'error');
  assert.equal(await cache.match(new URL('./app.mjs', scope).href), undefined);
  const matching = worker({ cacheStorage });
  assert.equal((await matching.status('REPAIR_OFFLINE')).ready, true);
  assert.match(await (await matching.request('./app.mjs')).text(), /"old"/);
});

test('network errors retry finitely and a later install resumes from verified partial entries', async () => {
  const cacheStorage = storage();
  const broken = worker({ cacheStorage, overrides: { './app.mjs': () => { throw new Error('network lost'); } } });
  await assert.rejects(broken.dispatch('install'), /network/);
  assert.equal(broken.requests.filter(request => request.url.endsWith('app.mjs')).length, 3);
  const progress = broken.messages.filter(message => message.type === 'PROGRESS' && message.path === './app.mjs');
  assert.deepEqual(progress.map(message => message.attempt), [1, 2, 3]);
  assert.deepEqual(progress.map(message => message.retrying), [false, true, true]);
  const resumed = worker({ cacheStorage });
  await resumed.dispatch('install');
  assert.equal((await resumed.status()).ready, true);
  assert.equal(resumed.requests.length, Object.keys(resources).length - 1);
  assert.ok(resumed.requests.every(request => !request.url.endsWith('index.html')));
});

test('a fetch that never resolves times out, aborts, and reports the stuck resource', async () => {
  const instance = worker({ fastTimers: true, overrides: { './app.mjs': () => new Promise(() => {}) } });
  await assert.rejects(instance.dispatch('install'), /timeout/);
  const requests = instance.requests.filter(request => request.url.endsWith('app.mjs'));
  assert.equal(requests.length, 3);
  assert.ok(requests.every(request => request.signal.aborted));
  const error = instance.messages.find(message => message.type === 'FAILED').error;
  assert.equal(error.reason, 'timeout');
  assert.equal(error.path, './app.mjs');
  assert.equal(error.status, null);
});

test('a stalled response body also times out rather than leaving install pending', async () => {
  const instance = worker({ fastTimers: true, overrides: { './app.mjs': () => new Response(new ReadableStream({ start() {} })) } });
  await assert.rejects(instance.dispatch('install'), /timeout/);
  assert.equal(instance.requests.filter(request => request.url.endsWith('app.mjs')).length, 3);
  assert.equal(instance.messages.find(message => message.type === 'FAILED').error.reason, 'timeout');
  const cache = await instance.cacheStorage.open(prefix + 'old');
  assert.equal(await cache.match(new URL('./app.mjs', scope).href), undefined);
});

test('HTTP 403 fails immediately with a useful path/status and repair returns the same detail', async () => {
  const instance = worker({ overrides: { './app.mjs': new Response('private access required', { status: 403 }) } });
  await assert.rejects(instance.dispatch('install'), /http/);
  assert.equal(instance.requests.filter(request => request.url.endsWith('app.mjs')).length, 1);
  const initialError = instance.messages.find(message => message.type === 'FAILED').error;
  assert.equal(initialError.reason, 'http');
  assert.equal(initialError.path, './app.mjs');
  assert.equal(initialError.status, 403);
  const result = await instance.status('REPAIR_OFFLINE');
  assert.equal(result.ready, false);
  assert.equal(result.error.reason, 'http');
  assert.equal(result.error.path, './app.mjs');
  assert.equal(result.error.status, 403);
  assert.equal(instance.requests.filter(request => request.url.endsWith('app.mjs')).length, 2);
});

test('cache quota errors are reported once and retain already saved entries', async () => {
  const cacheStorage = storage({ beforePut(key) { if (key.endsWith('app.mjs')) throw new DOMException('full', 'QuotaExceededError'); } });
  const instance = worker({ cacheStorage });
  await assert.rejects(instance.dispatch('install'), /storage/);
  assert.equal(instance.requests.filter(request => request.url.endsWith('app.mjs')).length, 1);
  const error = instance.messages.find(message => message.type === 'FAILED').error;
  assert.equal(error.reason, 'storage');
  assert.equal(error.path, './app.mjs');
  const cache = await cacheStorage.open(prefix + 'old');
  assert.ok(await cache.match(new URL('./index.html', scope).href));
  assert.equal(await cache.match(new URL('./app.mjs', scope).href), undefined);
});

test('a cache write that never resolves has a deadline and is not repeated concurrently', async () => {
  const cacheStorage = storage({ beforePut(key) { if (key.endsWith('app.mjs')) return new Promise(() => {}); } });
  const instance = worker({ cacheStorage, fastTimers: true });
  await assert.rejects(instance.dispatch('install'), /timeout/);
  assert.equal(instance.requests.filter(request => request.url.endsWith('app.mjs')).length, 1);
  assert.equal(instance.messages.find(message => message.type === 'FAILED').error.path, './app.mjs');
});

test('canonical inline HTML installs despite a rewritten or forbidden network homepage', async () => {
  for (const networkHTML of [new Response('not allowed', { status: 403 }), new Response(resources['./index.html'] + '<!-- hosting injection -->')]) {
    const cacheStorage = storage();
    const inline = { './index.html': resources['./index.html'] };
    const instance = worker({ cacheStorage, inline, overrides: { './index.html': networkHTML } });
    await instance.dispatch('install');
    assert.equal((await instance.status()).ready, true);
    assert.ok(instance.requests.every(request => !request.url.endsWith('index.html')));
    const offline = worker({ cacheStorage, inline, network: false });
    assert.equal(await (await offline.request('./?homescreen', { navigate: true })).text(), resources['./index.html']);
    const cache = await cacheStorage.open(prefix + 'old');
    await cache.delete(new URL('./index.html', scope).href);
    // Even an evicted homepage is recreated without touching the hosting route.
    assert.equal(await (await offline.request('./', { navigate: true })).text(), resources['./index.html']);
    assert.equal(offline.requests.length, 0);
  }
});

test('inline HTML still has to match the published build hash', async () => {
  const instance = worker({ inline: { './index.html': 'wrong canonical document' } });
  await assert.rejects(instance.dispatch('install'), /integrity/);
  assert.equal(instance.requests.length, 0);
  assert.equal(instance.messages.find(message => message.type === 'FAILED').error.path, './index.html');
  assert.equal((await instance.status()).ready, false);
});
