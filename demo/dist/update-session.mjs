const UPDATE_SOURCE = 'homework-clock-update';
const OFFLINE_SOURCE = 'homework-clock-offline';
const token = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const replyMessage = result => ({ ready: result?.ok === true, protocol: 1, ...(result?.message ? { message: result.message } : {}) });
const refused = message => ({ ready: false, protocol: 1, message });

/** Keep one page quiescent while the waiting worker coordinates an update. */
export function createUpdateSession({
  serviceWorker = globalThis.navigator?.serviceWorker,
  guard,
  onLock = () => {},
  onUnlock = () => {},
  onReload = () => {},
  baseURL = globalThis.location?.href,
  timeoutMs = 45000,
} = {}) {
  if (!serviceWorker?.addEventListener || !serviceWorker?.removeEventListener || typeof guard?.check !== 'function' || typeof guard?.prepare !== 'function') {
    throw new TypeError('Update session needs a service worker container and guard.');
  }
  let scriptURL;
  try { scriptURL = new URL('./sw.js', baseURL).href; }
  catch { throw new TypeError('Update session needs an absolute base URL.'); }
  const delay = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 45000;
  let locked = null;
  let destroyed = false;

  const trusted = worker => worker?.scriptURL === scriptURL && typeof worker?.postMessage === 'function';
  const matches = (session, worker, data) => session && session.worker === worker && session.transactionId === data.transactionId && session.version === data.version;
  const respond = (event, value) => {
    try { event.ports?.[0]?.postMessage(value); } catch { /* A closed requester cannot receive a response. */ }
  };

  function clear(session) {
    clearTimeout(session.timer);
    session.worker.removeEventListener?.('statechange', session.onStateChange);
  }

  function unlock(reason, message = '') {
    const session = locked;
    if (!session) return;
    locked = null;
    clear(session);
    if (!session.reloaded) {
      try { onUnlock({ reason, message }); } catch { /* Do not strand protocol replies. */ }
    }
  }

  function reload(session) {
    if (destroyed || locked !== session || session.reloaded || session.commitResult?.ok === false) return;
    session.reloaded = true;
    clear(session);
    // Keep the page locked until navigation. Unfreezing before reload could
    // allow its old in-memory state to overwrite the saved update snapshot.
    try { onReload({ transactionId: session.transactionId, version: session.version }); }
    catch {
      session.reloaded = false;
      unlock('failed', '页面未能重新打开，已恢复当前页面，请重试更新。');
    }
  }

  function activated(session) {
    return session?.worker.state === 'activated';
  }

  function activationStarted(session) {
    return ['activating', 'activated'].includes(session?.worker.state);
  }

  function inspectActivation() {
    const session = locked;
    if (!session) return;
    if (session.worker.state === 'redundant') {
      unlock('failed', '新版未能启用，已恢复当前页面，请重试更新。');
      return;
    }
    // Once activation starts it cannot be cancelled. Keep the old page frozen,
    // but keep checking in case the browser drops a later statechange event.
    if (activationStarted(session)) {
      clearTimeout(session.timer);
      if (activated(session)) reload(session);
      if (locked === session && !session.reloaded) {
        session.timer = setTimeout(inspectActivation, Math.min(delay, 1000));
      }
    }
  }

  function prepare(event, data) {
    const worker = event.source;
    if (locked) {
      respond(event, matches(locked, worker, data)
        ? { ready: true, protocol: 1 }
        : refused('已有更新正在进行，请稍后再试。'));
      return;
    }
    let result;
    try { result = guard.check(); }
    catch { result = { ok: false, message: '暂时无法确认数据已保存，请稍后再更新。' }; }
    if (result?.ok !== true) { respond(event, replyMessage(result)); return; }
    const session = { worker, transactionId: data.transactionId, version: data.version, reloaded: false };
    locked = session;
    try { onLock({transactionId:data.transactionId,version:data.version,expiresAt:data.expiresAt}); }
    catch {
      unlock('failed', '当前页面暂时无法准备更新，请稍后重试。');
      respond(event, refused('当前页面暂时无法准备更新，请稍后重试。'));
      return;
    }
    if (destroyed || locked !== session) { respond(event, refused('更新已取消，请重试。')); return; }
    session.onStateChange = inspectActivation;
    worker.addEventListener?.('statechange', session.onStateChange);
    session.timer = setTimeout(() => {
      if (locked !== session || destroyed) return;
      // Browser events may be delayed. The exact prepared worker becoming
      // active is enough: navigation selects it even if its intent was evicted.
      inspectActivation();
      if (locked === session && !session.reloaded && !activationStarted(session)) {
        unlock('timeout', '更新等待超时，已恢复当前页面，请重试。');
      }
    }, delay);
    inspectActivation();
    respond(event, locked === session ? { ready: true, protocol: 1 } : refused('新版未能启用，请重新检查更新。'));
  }

  async function commit(event, data) {
    const session = locked;
    if (!matches(session, event.source, data) || session.reloaded) {
      respond(event, refused('更新请求已失效，请重新检查更新。'));
      return;
    }
    if (!session.commitPromise) {
      session.commitPromise = (async () => {
        try { return await guard.prepare(); }
        catch { return { ok: false, message: '本机数据尚未保存，已暂停更新，请重试。' }; }
      })();
    }
    const result = await session.commitPromise;
    if (destroyed || locked !== session) {
      respond(event, refused('更新已取消，当前页面不会切换版本。'));
      return;
    }
    session.commitResult = result?.ok === true ? { ok: true } : { ok: false, message: result?.message || '本机数据尚未保存，已暂停更新，请重试。' };
    respond(event, replyMessage(session.commitResult));
  }

  function onMessage(event) {
    if (destroyed || !trusted(event.source)) return;
    const data = event.data;
    if (data?.source === OFFLINE_SOURCE && data.type === 'ACTIVATED') {
      if (matches(locked, event.source, data)) {
        inspectActivation();
      }
      return;
    }
    if (data?.source !== UPDATE_SOURCE || !['PREPARE_UPDATE', 'COMMIT_UPDATE', 'CANCEL_UPDATE'].includes(data.type)) return;
    // Only preparation/commit need an acknowledgement. Cancellation is also
    // broadcast when one participant refuses, so it must work without a port.
    if (data.type !== 'CANCEL_UPDATE' && typeof event.ports?.[0]?.postMessage !== 'function') return;
    if (!token(data.transactionId) || !token(data.version)) { respond(event, refused('更新请求无效，请重新检查更新。')); return; }
    if (data.type === 'PREPARE_UPDATE') prepare(event, data);
    else if (data.type === 'COMMIT_UPDATE') void commit(event, data);
    else {
      if (!matches(locked, event.source, data)) { respond(event, refused('更新请求已失效。')); return; }
      if (locked.reloaded) { respond(event, refused('新版正在打开，请稍候。')); return; }
      if (activationStarted(locked)) {
        inspectActivation();
        respond(event, refused('新版正在启用，请稍候。'));
        return;
      }
      unlock('cancelled', data.message || '更新已取消，当前页面可继续使用。');
      respond(event, { ready: true, protocol: 1 });
    }
  }

  serviceWorker.addEventListener('message', onMessage);
  serviceWorker.addEventListener('controllerchange', inspectActivation);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    serviceWorker.removeEventListener('message', onMessage);
    serviceWorker.removeEventListener('controllerchange', inspectActivation);
    unlock('destroyed');
  }

  return { isLocked: () => !!locked, destroy };
}
