/* BUILD is injected by build-offline.mjs. No external imports are needed. */
const PREFIX = `homework-clock:${self.registration.scope}:`;
const CACHE = PREFIX + BUILD.version;
const scope = new URL(self.registration.scope);
const assets = new Map(BUILD.assets.map(asset => [new URL(asset.url, scope).href, asset]));
const indexURL = new URL('./index.html', scope).href;
const updateIntentURL = new URL('./.homework-clock-update-intent', scope).href;
let repairPromise;
let applyUpdatePromise;
const RESOURCE_TIMEOUT_MS = 30000;
const MAX_DOWNLOAD_ATTEMPTS = 3;
const CLIENT_UPDATE_TIMEOUT_MS = 5000;
const UPDATE_TRANSACTION_MS = 20000;

function inScopeWindow(client) {
  if (client?.type !== 'window' || !client.id || !client.url) return false;
  try {
    const url = new URL(client.url);
    return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
  } catch { return false; }
}

async function scopeWindows() {
  return (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(inScopeWindow);
}

function updateError(reason, message) {
  const error = new Error(message);
  error.detail = { reason, message };
  return error;
}

function askWindow(client, type, transaction) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    let settled = false;
    const clean = () => {
      clearTimeout(timer);
      channel.port1.onmessage = null;
      channel.port1.close(); channel.port2.close();
    };
    const settle = (ok, value) => {
      if (settled) return;
      settled = true; clean(); ok ? resolve(value) : reject(value);
    };
    const timer = setTimeout(() => settle(false, updateError('client', '另一个作业时钟窗口没有响应，请稍后重试。')), CLIENT_UPDATE_TIMEOUT_MS);
    channel.port1.onmessage = event => settle(true, event.data);
    try { client.postMessage({ source: 'homework-clock-update', type, ...transaction }, [channel.port2]); }
    catch { settle(false, updateError('client', '无法联系另一个作业时钟窗口，请稍后重试。')); }
  });
}

async function cancelWindowUpdate(clients, transaction, message) {
  // Also release a window discovered after the initial snapshot. A closed
  // window may reject postMessage; it must not strand the other participants.
  const windows = new Map(clients.map(client => [client.id, client]));
  try { for (const client of await scopeWindows()) windows.set(client.id, client); } catch {}
  for (const client of windows.values()) {
    try { client.postMessage({ source: 'homework-clock-update', type: 'CANCEL_UPDATE', ...transaction, message }); } catch {}
  }
}

async function runApplyUpdate(event) {
  const transaction = { version: BUILD.version, transactionId: event.data.transactionId, expiresAt: Date.now() + UPDATE_TRANSACTION_MS };
  const ensureFresh = () => {
    if (Date.now() >= transaction.expiresAt) throw updateError('timeout', '更新等待过久，当前页面可继续使用，请重新点击更新。');
  };
  let participants = [];
  let intentWritten = false;
  try {
    if (event.data.version !== BUILD.version) throw updateError('version', '准备的版本已变化，请重新检查更新。');
    if (typeof transaction.transactionId !== 'string' || !transaction.transactionId || transaction.transactionId.length > 200 || /[\u0000-\u001f]/.test(transaction.transactionId)) {
      throw updateError('source', '更新请求无效，请重新检查更新。');
    }
    const initiator = event.source?.id && await self.clients.get(event.source.id);
    ensureFresh();
    if (!inScopeWindow(initiator)) throw updateError('source', '更新请求不属于当前作业时钟。');
    if (!(await cacheStatus()).ready) throw updateError('incomplete', '新版离线资源尚未准备完整，请继续准备后再更新。');
    ensureFresh();
    participants = await scopeWindows();
    ensureFresh();
    if (!participants.some(client => client.id === initiator.id)) throw updateError('client', '当前窗口已变化，请重新检查更新。');
    const prepared = await Promise.allSettled(participants.map(async client => {
      const reply = await askWindow(client, 'PREPARE_UPDATE', transaction);
      if (reply?.ready !== true || reply.protocol !== 1) throw updateError('client', typeof reply?.message === 'string' ? `${client.id===initiator.id?'':'另一个作业时钟窗口：'}${reply.message.slice(0, 300)}` : '另一个窗口尚未准备好，请先保存设置或结束录音后再试。');
    }));
    // Await every probe, including slow/rejected ones, before cancelling. This
    // keeps a late PREPARE response from refreezing a page after cancellation.
    const rejected = prepared.find(result => result.status === 'rejected');
    if (rejected) throw rejected.reason;
    ensureFresh();
    const known = new Set(participants.map(client => client.id));
    const noNewWindows = async () => {
      const windows = await scopeWindows();
      ensureFresh();
      if (!windows.some(client => client.id === initiator.id) || windows.some(client => !known.has(client.id))) {
        throw updateError('client', '更新期间打开了新窗口，请再次点击更新。');
      }
    };
    await noNewWindows();
    const committed = await askWindow(initiator, 'COMMIT_UPDATE', transaction);
    ensureFresh();
    if (committed?.ready !== true) throw updateError('client', typeof committed?.message === 'string' ? committed.message.slice(0, 300) : '本机数据尚未保存，已保留原版本，请重试。');
    // Storage can be evicted while the user data is being committed. Never
    // activate a partial build even after every page has safely frozen.
    if (!(await cacheStatus()).ready) throw updateError('incomplete', '新版资源已不完整，原版本和本机数据已保留，请重新准备。');
    ensureFresh();
    const cache = await caches.open(CACHE);
    ensureFresh();
    await cache.put(updateIntentURL, new Response(JSON.stringify(transaction), { headers: { 'Content-Type': 'application/json' } }));
    intentWritten = true;
    // A slow write can outlive the page's freeze or allow a new page to open.
    // Recheck both conditions after the final asynchronous storage operation.
    ensureFresh();
    await noNewWindows();
    ensureFresh();
    // Explicit page coordination is the only path that bypasses waiting.
    // The persisted intent survives a worker-process restart before activate.
    await self.skipWaiting();
    return { ready: true, version: BUILD.version, transactionId: transaction.transactionId, activating: true };
  } catch (error) {
    if (intentWritten) { try { await (await caches.open(CACHE)).delete(updateIntentURL); } catch {} }
    if (participants.length) await cancelWindowUpdate(participants, transaction, error?.detail?.message || '更新未完成，当前页面可继续使用，请重试。');
    return { ready: false, version: BUILD.version, error: error?.detail || { reason: 'storage', message: '更新未完成，原版本和本机数据已保留，请重试。' } };
  }
}

function applyUpdate(event) {
  if (applyUpdatePromise) return Promise.resolve({ ready: false, version: BUILD.version, error: { reason: 'client', message: '更新正在进行，请稍候。' } });
  applyUpdatePromise = runApplyUpdate(event).finally(() => { applyUpdatePromise = undefined; });
  return applyUpdatePromise;
}

async function broadcast(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage({ source: 'homework-clock-offline', ...message });
}

async function digest(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

function resourceError(reason, asset, status = null) {
  const error = new Error(`Offline resource ${reason}: ${asset.url}${status === null ? '' : ` (${status})`}`);
  error.detail = { reason, path: asset.url, status };
  return error;
}

function errorDetail(error) {
  return error?.detail || { reason: 'storage', path: '', status: null };
}

async function downloadAsset(cache, url, asset, progress = {}) {
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt++) {
    await broadcast({ type: 'PROGRESS', version: BUILD.version, ...progress, path: asset.url, attempt, retrying: attempt > 1 });
    const controller = new AbortController();
    let stage = 'network';
    let timedOut = false;
    let timeout;
    try {
      const operation = (async () => {
        // The canonical HTML is embedded at build time: private hosting can
        // rewrite network HTML, while the embedded document remains verifiable.
        const response = typeof asset.inline === 'string'
          ? new Response(asset.inline, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
          : await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin', redirect: 'error', signal: controller.signal }));
        if (!response.ok || response.type === 'opaque') throw resourceError('http', asset, response.status);
        const buffer = await response.arrayBuffer();
        stage = 'integrity';
        if (await digest(buffer) !== asset.sha256) throw resourceError('integrity', asset, response.status);
        // A fetch/body/digest that finishes after its deadline must not start a
        // new cache write. A late cache.put contains only verified build bytes.
        if (timedOut) throw resourceError('timeout', asset);
        stage = 'storage';
        const headers = new Headers(response.headers);
        headers.delete('Content-Encoding');
        headers.set('Content-Length', String(buffer.byteLength));
        await cache.put(url, new Response(buffer, { status: response.status, statusText: response.statusText, headers }));
      })();
      await Promise.race([operation, new Promise((_, reject) => {
        timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(resourceError('timeout', asset));
        }, RESOURCE_TIMEOUT_MS);
      })]);
      return;
    } catch (cause) {
      const error = cause?.detail ? cause : resourceError(timedOut ? 'timeout' : stage, asset);
      const retryable = ['network', 'timeout'].includes(error.detail.reason) && stage !== 'storage';
      if (!retryable || attempt === MAX_DOWNLOAD_ATTEMPTS) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function fillCache(cache) {
  let complete = 0;
  // Fetch sequentially: large animation/font files should not compete for iPad memory.
  for (const [url, asset] of assets) {
    if (!await cache.match(url)) {
      await downloadAsset(cache, url, asset, { complete, total: assets.size });
    }
    complete++;
    await broadcast({ type: 'PROGRESS', version: BUILD.version, complete, total: assets.size, path: asset.url, retrying: false });
  }
}

async function cacheStatus() {
  const cache = await caches.open(CACHE);
  for (const url of assets.keys()) {
    if (!await cache.match(url)) return { ready: false, version: BUILD.version, total: assets.size, canApplyUpdate: true };
  }
  return { ready: true, version: BUILD.version, total: assets.size, canApplyUpdate: true };
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      await fillCache(await caches.open(CACHE));
      await broadcast({ type: 'PREPARED', version: BUILD.version });
      // Ordinary updates wait for old windows; APPLY_UPDATE is the explicit,
      // coordinated alternative. Installation alone never interrupts a timer.
    } catch (error) {
      // Retain only verified entries for the next install/repair attempt.
      // The old complete version and local user data are never removed here.
      await broadcast({ type: 'FAILED', version: BUILD.version, error: errorDetail(error) });
      throw error;
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Storage may have been evicted while an update was waiting for old windows.
    // Keep the previous complete snapshot if this snapshot cannot be repaired.
    if (!(await cacheStatus()).ready) {
      try {
        await fillCache(await caches.open(CACHE));
      } catch (error) {
        await broadcast({ type: 'FAILED', version: BUILD.version, error: errorDetail(error) });
        throw error;
      }
    }
    const cache = await caches.open(CACHE);
    const intent = await cache.match(updateIntentURL);
    let transaction;
    try { transaction = intent && await intent.json(); } catch {}
    // A coordinated update can leave old pages open until they receive the
    // activation event and reload. Keep their original snapshot available.
    // Normal no-window activation still cleans this app's obsolete snapshots.
    if (!(await scopeWindows()).length) {
      const names = await caches.keys();
      await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE).map(name => caches.delete(name)));
    }
    if (transaction?.version === BUILD.version && transaction.transactionId) await self.clients.claim();
    await broadcast({ type: 'ACTIVATED', version: BUILD.version, ...(transaction?.version === BUILD.version ? { transactionId: transaction.transactionId } : {}) });
    if (intent) await cache.delete(updateIntentURL);
  })());
});

async function partialResponse(request, response) {
  const range = request.headers.get('range');
  if (!range) return response;
  // iPad Safari commonly asks for the first two bytes before playing local audio.
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!match || (!match[1] && !match[2])) return response;
  const buffer = await response.arrayBuffer();
  const size = buffer.byteLength;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  const headers = new Headers(response.headers);
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Accept-Ranges', 'bytes');
  headers.delete('Content-Encoding');
  return new Response(buffer.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin) return;
  url.search = '';
  url.hash = '';
  if (url.href === scope.href && request.mode === 'navigate') url.href = indexURL;
  if (!assets.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(url.href);
    if (cached) return partialResponse(request, cached);
    // An evicted resource can be repaired only with the exact installed build.
    // Do not silently serve a newer script into an older running application.
    try {
      await downloadAsset(cache, url.href, assets.get(url.href), { complete: 0, total: assets.size });
      const repaired = await cache.match(url.href);
      if (repaired) return partialResponse(request, repaired);
    } catch {}
    if (request.mode === 'navigate') {
      return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>作业时钟</title><body style="font:20px system-ui;padding:32px;background:#fffdf5;color:#293a35"><h1>需要重新准备离线资源</h1><p>请联网后重新打开作业时钟。你保存的计划不受这次加载失败影响。</p></body></html>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return Response.error();
  })());
});

self.addEventListener('message', event => {
  const respond = data => event.ports[0]?.postMessage(data);
  if (event.data?.type === 'OFFLINE_STATUS') {
    event.waitUntil(cacheStatus().then(respond).catch(error => respond({ ready: false, version: BUILD.version, error: errorDetail(error) })));
  }
  if (event.data?.type === 'REPAIR_OFFLINE') {
    if (!repairPromise) {
      repairPromise = fillCachePromise();
    }
    event.waitUntil(repairPromise.then(respond));
  }
  if (event.data?.type === 'APPLY_UPDATE') event.waitUntil(applyUpdate(event).then(respond));
});

async function fillCachePromise() {
  try {
    await fillCache(await caches.open(CACHE));
    return await cacheStatus();
  } catch (error) {
    const detail = errorDetail(error);
    await broadcast({ type: 'FAILED', version: BUILD.version, error: detail });
    return { ready: false, version: BUILD.version, error: detail };
  } finally {
    repairPromise = undefined;
  }
}
