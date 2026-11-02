/** Offline preparation state, independent of the settings UI. */
export function createOfflineController({ serviceWorker, onChange, timeoutMs = 45000, operationTimeoutMs = Math.min(12000, timeoutMs), updateTimeoutMs=30000, createMessageChannel = () => new MessageChannel(), baseURL = globalThis.location?.href }) {
  const expectedScope = baseURL ? new URL('./', baseURL).href : null;
  const expectedScript = baseURL ? new URL('./sw.js', baseURL).href : null;
  let generation = 0;
  let registration;
  let busy;
  let applying;
  let destroyed = false;
  let ready;
  let state = { phase: 'loading' };
  let detach = [];

  const notify = patch => {
    state = { ...state, ...patch };
    try { onChange({ ...state }); } catch { /* UI errors must not strand a request. */ }
  };
  const errorInfo = error => ({
    reason: error?.reason || (error?.name === 'QuotaExceededError' ? 'storage' : error?.name === 'TypeError' ? 'network' : 'unknown'),
    ...(error?.path ? { path: error.path } : {}),
    ...(Number.isFinite(error?.status) ? { status: error.status } : {}),
  });
  const current = op => !destroyed && generation === op.id;
  const running = op => current(op) && !op.settled;
  const listen = (target, type, handler) => {
    target?.addEventListener?.(type, handler);
    detach.push(() => target?.removeEventListener?.(type, handler));
  };
  const clearListeners = () => { for (const off of detach) off(); detach = []; };

  function finish(op, error) {
    if (!running(op)) return;
    op.settled = true;
    clearTimeout(op.deadline);
    for (const cancel of [...op.pending]) cancel();
    op.wake?.();
    if (busy === op) busy = undefined;
    if (error) {
      if (ready) notify({ phase: 'ready', version: ready.version, error: undefined, updateError: errorInfo(error), updateReady: op.updateReady });
      else notify({ phase: 'error', error: errorInfo(error), updateError: undefined, updateReady: op.updateReady });
    } else {
      notify({ phase: 'ready', version: ready.version, error: undefined, updateError: undefined, updateReady: op.updateReady });
    }
    op.resolve({ ...state });
  }

  function progress(op) {
    if (!running(op)) return;
    clearTimeout(op.deadline);
    op.deadline = setTimeout(() => finish(op, { reason: 'timeout', path: state.path }), timeoutMs);
  }

  function bounded(op, promise, milliseconds = operationTimeoutMs) {
    return new Promise((resolve, reject) => {
      let timer;
      const cancel = () => settle(false, { reason: 'cancelled' });
      const settle = (ok, value) => {
        clearTimeout(timer); op.pending.delete(cancel);
        ok ? resolve(value) : reject(value);
      };
      op.pending.add(cancel);
      timer = setTimeout(() => settle(false, { reason: 'timeout', path: state.path }), milliseconds);
      Promise.resolve(promise).then(value => settle(true, value), error => settle(false, error));
    });
  }

  function ask(op, worker, type) {
    return new Promise((resolve, reject) => {
      let channel;
      try { channel = createMessageChannel(); } catch (error) { reject(error); return; }
      let timer;
      let settled = false;
      const clean = () => {
        clearTimeout(timer); op.pending.delete(cancel); op.requests.delete(request);
        channel.port1.onmessage = null; channel.port1.close(); channel.port2.close();
      };
      const settle = (ok, value) => {
        if (settled) return;
        settled = true; clean(); ok ? resolve(value) : reject(value);
      };
      const cancel = () => settle(false, { reason: 'cancelled' });
      const reset = () => { clearTimeout(timer); timer = setTimeout(() => settle(false, { reason: 'timeout', path: state.path }), type === 'REPAIR_OFFLINE' ? timeoutMs : operationTimeoutMs); };
      const request = { worker, type, reset };
      op.pending.add(cancel); op.requests.add(request);
      channel.port1.onmessage = event => settle(true, event.data);
      reset();
      try { worker.postMessage({ type, requestId: `offline-${op.id}` }, [channel.port2]); }
      catch (error) { settle(false, error); }
    });
  }

  function attach(op, reg) {
    op.reg = reg;
    const workers = new Set();
    op.installWorkers = new Set();
    const watch = (worker, install = false) => {
      if (!worker) return;
      if (install) op.installWorkers.add(worker);
      if (workers.has(worker)) return;
      workers.add(worker);
      listen(worker, 'statechange', () => {
        if (!current(op)) return;
        if (running(op)) { progress(op); op.wake?.(); }
        else void refresh();
      });
    };
    const discover = () => {
      watch(reg.active);
      watch(reg.installing, true);
      watch(reg.waiting, true);
    };
    discover();
    listen(reg, 'updatefound', () => {
      if (!current(op)) return;
      discover();
      if (running(op)) { progress(op); op.wake?.(); }
      else void refresh();
    });
    listen(serviceWorker, 'message', event => {
      const message = event.data;
      if (!current(op) || message?.source !== 'homework-clock-offline' || !workers.has(event.source)) return;
      if (!running(op)) {
        if (['ACTIVATED', 'PREPARED'].includes(message.type)) void refresh();
        return;
      }
      const repair = [...op.requests].some(request => request.worker === event.source && request.type === 'REPAIR_OFFLINE');
      const installing = op.installWorkers.has(event.source);
      if (message.type === 'PROGRESS' && (installing || repair)) {
        progress(op);
        for (const request of op.requests) if (request.worker === event.source && request.type === 'REPAIR_OFFLINE') request.reset();
        const count = Number.isFinite(message.complete) ? message.complete : undefined;
        const total = Number.isFinite(message.total) ? message.total : undefined;
        notify({ complete: count, total, path: message.path || message.currentPath, ...(ready ? {} : { version: message.version }) });
      }
      if (message.type === 'FAILED' && installing) {
        op.installError = errorInfo(message.error || message);
        // Check an existing active cache before deciding an update failure means
        // the app itself cannot work offline.
        if (ready || !reg.active) finish(op, op.installError);
      }
      if (['ACTIVATED', 'PREPARED', 'FAILED'].includes(message.type)) op.wake?.();
    });
  }

  async function inspectActive(op, worker, repair) {
    let status = await ask(op, worker, 'OFFLINE_STATUS');
    if (!running(op)) return false;
    if (!status?.ready) {
      // A previously complete snapshot may have been evicted. Do not preserve a
      // stale ready badge while its repair is unanswered or fails.
      ready = undefined;
      notify({ phase: 'loading' });
      if (repair) status = await ask(op, worker, 'REPAIR_OFFLINE');
    }
    if (!running(op)) return false;
    if (!status?.ready) {
      ready = undefined;
      throw status?.error || { reason: 'unknown', path: state.path };
    }
    ready = { worker, version: status.version };
    notify({ phase: 'ready', version: status.version, complete: status.total, total: status.total, path: undefined, error: undefined, updateError: undefined });
    return true;
  }

  async function drive(op, kind) {
    // register() must run for every explicit attempt. A failed first install can
    // leave a registration with no active/installing/waiting worker at all.
    let reg = registration;
    if (kind === 'prepare') {
      try { reg = await bounded(op, serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })); }
      catch (error) {
        if (!running(op)) return;
        // Offline or expired private-site access may reject the script update
        // request while the installed snapshot remains intact. Only use our own
        // already active registration, then verify its cache below as usual.
        let existing = registration;
        if (serviceWorker.getRegistration) {
          try { existing = await bounded(op, serviceWorker.getRegistration('./')); }
          catch { /* Keep a previously known registration, if there is one. */ }
        }
        if (!running(op)) return;
        const ownScope = !expectedScope || existing?.scope === expectedScope;
        const ownScript = !expectedScript || existing?.active?.scriptURL === expectedScript;
        if (!ownScope || !ownScript || existing?.active?.state !== 'activated') throw error;
        reg = existing; op.registrationError = errorInfo(error);
      }
    }
    if (!running(op)) return;
    registration = reg;
    if (!reg) throw { reason: 'unknown' };
    attach(op, reg);
    if (ready && ready.worker !== reg.active) ready = undefined;
    const checked = new Set();
    let updated = kind !== 'prepare' || !!op.registrationError;
    while (running(op)) {
      const active = reg.active;
      if (active?.state === 'activated' && !checked.has(active)) {
        try { await inspectActive(op, active, kind === 'prepare'); }
        catch (error) {
          // A missing old asset may no longer exist on the server after a
          // deployment. Still inspect a complete new candidate before giving
          // up: closing the old windows can activate that candidate safely.
          op.activeError = errorInfo(error);
        }
        if (!running(op)) return;
        checked.add(active);
      }
      if (op.installError) throw op.installError;
      if (!updated && !reg.installing && !reg.waiting && typeof reg.update === 'function') {
        updated = true;
        try { await bounded(op, reg.update()); }
        catch (error) {
          // An offline update *check* is optional when this build is complete.
          // Report actual candidate download failures, not ordinary offline use.
          if (!ready || reg.installing || reg.waiting || op.installError) throw op.activeError || error;
          finish(op); return;
        }
        if (!running(op)) return;
        // A new worker can appear while update() is awaiting the network.
        if (reg.installing) op.installWorkers.add(reg.installing);
        continue;
      }
      if (reg.waiting?.state === 'installed') {
        const status = await ask(op, reg.waiting, 'OFFLINE_STATUS');
        if (!running(op)) return;
        if (!status?.ready) throw status?.error || { reason: 'unknown' };
        notify({updateVersion:status.version,canApplyUpdate:status.canApplyUpdate===true});
        if (ready) { op.updateReady = true; finish(op); return; }
        if (op.activeError) {
          op.updateReady = true;
          finish(op, op.activeError); return;
        }
      }
      if (reg.active !== active || (reg.active?.state === 'activated' && !checked.has(reg.active))) continue;
      const candidate = reg.installing || reg.waiting;
      if (candidate?.state === 'redundant') throw op.installError || { reason: 'unknown', path: state.path };
      if (ready && !candidate) { finish(op); return; }
      if (!candidate && op.activeError) throw op.activeError;
      if (!active && !candidate) throw { reason: 'unknown', path: state.path };
      await new Promise(resolve => { op.wake = resolve; });
      op.wake = undefined;
    }
  }

  function launch(kind) {
    if (destroyed) return Promise.resolve({ ...state });
    if (busy) return busy.promise;
    clearListeners();
    const op = { id: ++generation, pending: new Set(), requests: new Set(), settled: false, updateReady: false };
    op.promise = new Promise(resolve => { op.resolve = resolve; });
    busy = op;
    notify({ phase: ready ? 'ready' : 'loading', complete: undefined, total: undefined, path: undefined, error: undefined, updateError: undefined, updateReady: false, updateVersion:undefined,canApplyUpdate:false });
    progress(op);
    void drive(op, kind).catch(error => finish(op, error));
    return op.promise;
  }

  function prepare() { return launch('prepare'); }
  function refresh() { return registration ? launch('refresh') : prepare(); }
  function updateRequest(worker,message) {
    return new Promise((resolve,reject)=>{
      const channel=createMessageChannel();
      const timer=setTimeout(()=>{clean();reject({reason:'timeout'});},updateTimeoutMs);
      function clean(){clearTimeout(timer);channel.port1.onmessage=null;channel.port1.close();channel.port2.close();}
      channel.port1.onmessage=event=>{clean();resolve(event.data);};
      try{worker.postMessage(message,[channel.port2]);}catch(error){clean();reject(error);}
    });
  }
  function applyUpdate() {
    if(applying)return applying;
    applying=(async()=>{
      if(busy)await busy.promise;
      if(destroyed)return {ok:false,error:{reason:'cancelled'}};
      const target=registration?.waiting;
      if(target?.state!=='installed')return {ok:false,error:{reason:'missing',message:'新版还没有准备好，请先检查更新。'}};
      const status=await updateRequest(target,{type:'OFFLINE_STATUS'});
      if(!status?.ready)return {ok:false,error:{reason:'incomplete',message:'新版资源还不完整，请重新准备后再更新。'}};
      if(!status.canApplyUpdate)return {ok:false,error:{reason:'legacy',message:'这个等待中的版本使用旧更新方式，请关闭作业时钟窗口重开一次。'}};
      const transactionId=globalThis.crypto?.randomUUID?.()||`update-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result=await updateRequest(target,{type:'APPLY_UPDATE',version:status.version,transactionId});
      return result?.ready&&result.version===status.version&&result.activating ? {ok:true,version:result.version} : {ok:false,error:result?.error||{reason:'unknown'}};
    })().catch(error=>({ok:false,error:{...errorInfo(error),message:error?.message}})).finally(()=>{applying=undefined;});
    return applying;
  }
  function destroy() {
    if (destroyed) return;
    if (busy) finish(busy, { reason: 'cancelled' });
    destroyed = true; generation++; clearListeners();
  }
  return { prepare, refresh, applyUpdate, destroy };
}
