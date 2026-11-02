import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineController } from '../dist/offline-client.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
class Worker extends EventTarget {
  constructor(state = 'activated', reply = () => ({ ready: true, version: 'v1', total: 73 })) { super(); this.state = state; this.reply = reply; }
  postMessage(message, ports) { this.reply(message, ports[0]); }
  change(state) { this.state = state; this.dispatchEvent(new Event('statechange')); }
}
class Registration extends EventTarget {
  constructor(active = null) { super(); this.active = active; this.installing = null; this.waiting = null; this.updates = 0; }
  async update() { this.updates++; }
}
class ServiceWorkers extends EventTarget {
  constructor(register) { super(); this.callback = register; this.calls = 0; }
  register(...args) { this.calls++; assert.deepEqual(args, ['./sw.js', { scope: './', updateViaCache: 'none' }]); return this.callback(this.calls); }
  message(worker, data) { this.dispatchEvent(Object.assign(new Event('message'), { source: worker, data: { source: 'homework-clock-offline', ...data } })); }
}
function channel() {
  const port1 = { onmessage: null, close() {} };
  const port2 = { postMessage(data) { queueMicrotask(() => port1.onmessage?.({ data })); }, close() {} };
  return { port1, port2 };
}
const readyWorker = version => new Worker('activated', (message, port) => port.postMessage({ ready: true, version, total: 73 }));

test('one-click update targets only a verified complete waiting version and deduplicates clicks', async()=>{
  const reg=new Registration(readyWorker('old'));let applies=0;let finish;
  reg.waiting=new Worker('installed',(message,port)=>{
    if(message.type==='OFFLINE_STATUS')port.postMessage({ready:true,version:'next',canApplyUpdate:true});
    else{applies++;assert.equal(message.type,'APPLY_UPDATE');assert.equal(message.version,'next');assert.ok(message.transactionId);finish=()=>port.postMessage({ready:true,version:'next',activating:true});}
  });
  const {controller}=setup(new ServiceWorkers(async()=>reg));
  const state=await controller.prepare();assert.equal(state.canApplyUpdate,true);assert.equal(state.updateVersion,'next');
  const pending=controller.applyUpdate();assert.equal(controller.applyUpdate(),pending);await tick();finish();
  assert.equal((await pending).ok,true);assert.equal(applies,1);controller.destroy();
});

test('missing, legacy and incomplete updates never receive APPLY_UPDATE', async()=>{
  for(const mode of ['missing','legacy','incomplete']){
    const reg=new Registration(readyWorker('old'));let applies=0;
    if(mode!=='missing')reg.waiting=new Worker('installed',(message,port)=>{if(message.type==='OFFLINE_STATUS')port.postMessage({ready:mode!=='incomplete',version:'next'});else applies++;});
    const {controller}=setup(new ServiceWorkers(async()=>reg));await controller.prepare();
    const result=await controller.applyUpdate();assert.equal(result.ok,false);assert.equal(result.error.reason,mode);assert.equal(applies,0);controller.destroy();
  }
});

test('another window refusing the update keeps its exact actionable message', async()=>{
  const reg=new Registration(readyWorker('old'));
  reg.waiting=new Worker('installed',(message,port)=>port.postMessage(message.type==='OFFLINE_STATUS'?{ready:true,version:'next',canApplyUpdate:true}:{ready:false,error:{reason:'client',message:'另一个窗口有未保存的录音。'}}));
  const {controller}=setup(new ServiceWorkers(async()=>reg));await controller.prepare();
  const result=await controller.applyUpdate();assert.equal(result.error.message,'另一个窗口有未保存的录音。');assert.equal(reg.active.state,'activated');controller.destroy();
});

test('an unanswered apply is bounded and may be retried without accepting its late reply', async()=>{
  const reg=new Registration(readyWorker('old'));let answer=false;let oldPort;
  reg.waiting=new Worker('installed',(message,port)=>{if(message.type==='OFFLINE_STATUS')port.postMessage({ready:true,version:'next',canApplyUpdate:true});else if(answer)port.postMessage({ready:true,version:'next',activating:true});else oldPort=port;});
  const {controller}=setup(new ServiceWorkers(async()=>reg),{updateTimeoutMs:15});await controller.prepare();
  assert.equal((await controller.applyUpdate()).error.reason,'timeout');answer=true;assert.equal((await controller.applyUpdate()).ok,true);
  oldPort.postMessage({ready:true,version:'old',activating:true});controller.destroy();
});
function setup(serviceWorker, options = {}) {
  const changes = [];
  const controller = createOfflineController({ serviceWorker, createMessageChannel: channel, timeoutMs: 100, operationTimeoutMs: 30, onChange: state => changes.push(state), ...options });
  return { controller, changes };
}

test('a failed first installation can register again and finish on retry', async () => {
  const failed = new Worker('installing');
  const reg1 = new Registration(); reg1.installing = failed;
  const reg2 = new Registration(readyWorker('v2'));
  const sw = new ServiceWorkers(async calls => calls === 1 ? reg1 : reg2);
  const { controller, changes } = setup(sw);
  const first = controller.prepare(); await tick();
  reg1.installing = null;
  sw.message(failed, { type: 'FAILED', error: { reason: 'http', path: './index.html', status: 403 } });
  assert.equal((await first).phase, 'error');
  const second = await controller.prepare();
  assert.equal(second.phase, 'ready'); assert.equal(second.version, 'v2'); assert.equal(sw.calls, 2);
  sw.message(failed, { type: 'FAILED', error: { reason: 'integrity' } });
  assert.equal(changes.at(-1).phase, 'ready');
  controller.destroy();
});

test('an empty failed registration is explicitly updated and a later retry re-registers', async () => {
  const empty = new Registration();
  const sw = new ServiceWorkers(async calls => calls === 1 ? empty : new Registration(readyWorker('v1')));
  const { controller } = setup(sw);
  assert.equal((await controller.prepare()).phase, 'error');
  assert.equal(empty.updates, 1);
  assert.equal((await controller.prepare()).phase, 'ready');
  assert.equal(sw.calls, 2); controller.destroy();
});

test('a hung registration times out, releases busy and ignores its late completion', async () => {
  let finishOld;
  const sw = new ServiceWorkers(calls => calls === 1 ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve(new Registration(readyWorker('current'))));
  const { controller, changes } = setup(sw, { operationTimeoutMs: 15 });
  const first = controller.prepare();
  assert.equal(controller.prepare(), first);
  assert.equal((await first).error.reason, 'timeout');
  assert.equal((await controller.prepare()).version, 'current');
  finishOld(new Registration(readyWorker('stale'))); await tick();
  assert.equal(changes.at(-1).version, 'current'); controller.destroy();
});

test('an unanswered worker status times out and can be retried without stale replies', async () => {
  let oldPort;
  let answers = false;
  const worker = new Worker('activated', (message, port) => { if (answers) port.postMessage({ ready: true, version: 'fresh', total: 73 }); else oldPort = port; });
  const sw = new ServiceWorkers(async () => new Registration(worker));
  const { controller, changes } = setup(sw, { operationTimeoutMs: 15 });
  assert.equal((await controller.prepare()).error.reason, 'timeout');
  answers = true;
  assert.equal((await controller.prepare()).phase, 'ready');
  oldPort.postMessage({ ready: false }); await tick();
  assert.equal(changes.at(-1).phase, 'ready'); controller.destroy();
});

test('an update installation failure preserves the complete active offline version', async () => {
  const active = readyWorker('old');
  const installing = new Worker('installing');
  const reg = new Registration(active);
  const sw = new ServiceWorkers(async () => reg);
  reg.update = async () => {
    reg.installing = installing; reg.dispatchEvent(new Event('updatefound'));
    setImmediate(() => { reg.installing = null; sw.message(installing, { type: 'FAILED', version: 'new', error: { reason: 'network', path: './font.woff2' } }); });
  };
  const { controller } = setup(sw);
  const result = await controller.prepare();
  assert.equal(result.phase, 'ready'); assert.equal(result.version, 'old');
  assert.deepEqual(result.updateError, { reason: 'network', path: './font.woff2' }); controller.destroy();
});

test('ordinary offline startup keeps a complete cache ready without a false update warning', async () => {
  const reg = new Registration(readyWorker('saved'));
  reg.update = async () => { throw new TypeError('offline update check'); };
  const { controller } = setup(new ServiceWorkers(async () => reg));
  const result = await controller.prepare();
  assert.equal(result.phase, 'ready');
  assert.equal(result.version, 'saved');
  assert.equal(result.updateError, undefined);
  controller.destroy();
});

test('a rejected registration update can still verify this app existing complete offline snapshot', async () => {
  const baseURL = 'https://clock.example.test/homework/';
  const active = readyWorker('installed'); active.scriptURL = baseURL + 'sw.js';
  const reg = new Registration(active); reg.scope = baseURL;
  const sw = new ServiceWorkers(async () => { throw new TypeError('private script update unavailable'); });
  sw.getRegistration = async path => { assert.equal(path, './'); return reg; };
  const { controller } = setup(sw, { baseURL });
  const result = await controller.prepare();
  assert.equal(result.phase, 'ready'); assert.equal(result.version, 'installed');
  assert.equal(result.updateError, undefined); assert.equal(reg.updates, 0);
  controller.destroy();
});

test('registration fallback does not claim readiness for an empty, foreign or incomplete snapshot', async () => {
  const baseURL = 'https://clock.example.test/homework/';
  for (const variant of ['empty', 'foreign', 'incomplete']) {
    const active = variant === 'empty' ? null : new Worker('activated', (message, port) => port.postMessage({
      ready: false, version: 'incomplete', error: { reason: 'network', path: './font.woff2' },
    }));
    if (active) active.scriptURL = variant === 'foreign' ? 'https://clock.example.test/sw.js' : baseURL + 'sw.js';
    const reg = new Registration(active); reg.scope = variant === 'foreign' ? 'https://clock.example.test/' : baseURL;
    const sw = new ServiceWorkers(async () => { throw new TypeError('offline script update'); });
    sw.getRegistration = async () => reg;
    const { controller } = setup(sw, { baseURL });
    const result = await controller.prepare();
    assert.equal(result.phase, 'error', variant);
    assert.equal(result.updateReady, false, variant);
    if (variant === 'incomplete') assert.equal(result.error.path, './font.woff2');
    controller.destroy();
  }
});

test('registration fallback can expose a prepared replacement when its own active snapshot is incomplete', async () => {
  const baseURL = 'https://clock.example.test/homework/';
  const active = new Worker('activated', (message, port) => port.postMessage({
    ready: false, version: 'old', error: { reason: 'integrity', path: './app.mjs' },
  }));
  active.scriptURL = baseURL + 'sw.js';
  const waiting = readyWorker('replacement'); waiting.state = 'installed';
  const reg = new Registration(active); reg.scope = baseURL; reg.waiting = waiting;
  const sw = new ServiceWorkers(async () => { throw new TypeError('script check unavailable'); });
  sw.getRegistration = async () => reg;
  const { controller } = setup(sw, { baseURL });
  const result = await controller.prepare();
  assert.equal(result.phase, 'error'); assert.equal(result.updateReady, true);
  assert.equal(result.error.reason, 'integrity');
  controller.destroy();
});

test('an incomplete old cache still exposes a complete waiting update without claiming active readiness', async () => {
  const active = new Worker('activated', (message, port) => port.postMessage({
    ready: false, version: 'old',
    ...(message.type === 'REPAIR_OFFLINE' ? { error: { reason: 'integrity', path: './app.mjs' } } : {}),
  }));
  const waiting = readyWorker('new'); waiting.state = 'installed';
  const reg = new Registration(active); reg.waiting = waiting;
  const { controller } = setup(new ServiceWorkers(async () => reg));
  const result = await controller.prepare();
  assert.equal(result.phase, 'error', 'the active snapshot is not complete');
  assert.equal(result.updateReady, true, 'the downloaded replacement can be activated by closing windows');
  assert.equal(result.error.reason, 'integrity');
  assert.equal(reg.active, active); assert.equal(reg.waiting, waiting);
  controller.destroy();
});

test('a repair failure does not prevent checking and preparing a newer worker', async () => {
  const active = new Worker('activated', (message, port) => port.postMessage({
    ready: false, version: 'old', error: { reason: 'integrity', path: './font.woff2' },
  }));
  const candidate = readyWorker('new'); candidate.state = 'installing';
  const reg = new Registration(active);
  reg.update = async () => {
    reg.updates++; reg.installing = candidate;
    reg.dispatchEvent(new Event('updatefound'));
    setImmediate(() => {
      reg.installing = null; reg.waiting = candidate; candidate.change('installed');
    });
  };
  const { controller } = setup(new ServiceWorkers(async () => reg));
  const result = await controller.prepare();
  assert.equal(reg.updates, 1);
  assert.equal(result.phase, 'error'); assert.equal(result.updateReady, true);
  assert.equal(result.error.path, './font.woff2');
  controller.destroy();
});

test('an incomplete old cache with no replacement remains an explicit recoverable error', async () => {
  const active = new Worker('activated', (message, port) => port.postMessage({
    ready: false, version: 'old', error: { reason: 'network', path: './font.woff2' },
  }));
  const reg = new Registration(active);
  const { controller } = setup(new ServiceWorkers(async () => reg));
  const result = await controller.prepare();
  assert.equal(result.phase, 'error'); assert.equal(result.updateReady, false);
  assert.equal(result.error.reason, 'network'); assert.equal(reg.updates, 1);
  controller.destroy();
});

test('first installation waits for activation and checks the completed cache', async () => {
  const installing = new Worker('installing', (message, port) => port.postMessage({ ready: true, version: 'first', total: 73 }));
  const reg = new Registration(); reg.installing = installing;
  const sw = new ServiceWorkers(async () => reg);
  const { controller } = setup(sw);
  const attempt = controller.prepare(); await tick();
  sw.message(installing, { type: 'PROGRESS', complete: 58, total: 73, path: './index.html' });
  reg.installing = null; reg.active = installing; installing.change('activating');
  installing.change('activated');
  assert.equal((await attempt).phase, 'ready'); controller.destroy();
});

test('repair progress can outlast the ordinary response timeout and a stalled repair can retry', async () => {
  let repaired = false;
  let stalled = false;
  let sw;
  const worker = new Worker('activated', (message, port) => {
    if (message.type === 'OFFLINE_STATUS') { port.postMessage({ ready: repaired, version: 'repair', total: 73 }); return; }
    if (stalled) return;
    let count = 0;
    const timer = setInterval(() => {
      count++; sw.message(worker, { type: 'PROGRESS', complete: count, total: 5, path: './font.woff2' });
      if (count === 5) { clearInterval(timer); repaired = true; port.postMessage({ ready: true, version: 'repair', total: 5 }); }
    }, 8);
  });
  sw = new ServiceWorkers(async () => new Registration(worker));
  const { controller } = setup(sw, { timeoutMs: 35, operationTimeoutMs: 12 });
  assert.equal((await controller.prepare()).phase, 'ready');
  repaired = false; stalled = true;
  assert.equal((await controller.prepare()).phase, 'error');
  stalled = false;
  assert.equal((await controller.prepare()).phase, 'ready'); controller.destroy();
});

test('a first installation with no further progress leaves loading and can start again', async () => {
  const reg = new Registration(); reg.installing = new Worker('installing');
  const sw = new ServiceWorkers(async calls => calls === 1 ? reg : new Registration(readyWorker('retried')));
  const { controller } = setup(sw, { timeoutMs: 25, operationTimeoutMs: 12 });
  assert.equal((await controller.prepare()).error.reason, 'timeout');
  assert.equal((await controller.prepare()).version, 'retried'); controller.destroy();
});
