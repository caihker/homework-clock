import { createOfflineController } from './offline-client.mjs';

const panel = document.getElementById('offline-panel');
if (panel) setupOffline(panel);

function resourceLabel(path = '') {
  if (path.includes('/fonts/')) return '字体';
  if (path.includes('/voice-pack-')) return '语音';
  if (path.includes('/motion-')) return '小乌龟动画';
  if (path.includes('/category-')) return '分类图标';
  if (/\.(png|webp|svg)$/.test(path)) return '图片';
  return '界面';
}

function failureText(error = {}) {
  if (error.reason === 'http' && [401, 403].includes(error.status) || error.reason === 'auth') return '私有网址的登录可能已失效。请联网重新打开网址，完成登录后再试。';
  if (error.reason === 'integrity') return '检测到资源版本不一致。请关闭所有作业时钟窗口，联网重新打开后再试。';
  if (error.reason === 'storage') return '暂时无法写入离线资源，请检查设备可用空间后再试。';
  if (error.reason === 'timeout') return '下载等待过久，已停止等待。请检查网络后继续准备。';
  if (error.reason === 'network' || error.reason === 'http') return '下载连接中断，请检查网络后继续准备。';
  return '这次准备没有完成，请联网后继续准备。';
}

function setupOffline(panel) {
  panel.classList.add('offline-panel');
  panel.innerHTML = `<p class="offline-state" role="status" aria-live="polite"><span class="offline-dot" aria-hidden="true"></span><strong id="offline-state-label">正在准备离线资源…</strong></p><p class="offline-detail" id="offline-detail">第一次准备需要联网，请保持页面打开。</p><p class="offline-update" id="offline-update" hidden></p><button type="button" class="text-button" id="offline-retry" disabled>正在准备…</button><details class="offline-error-detail" hidden><summary>查看失败详情</summary><p id="offline-error-info"></p></details><details class="offline-install"><summary>放到 iPad 主屏</summary><p>用 Safari 打开作业时钟，轻点“共享”→“添加到主屏幕”。如有“作为网页 App 打开”，请打开它，再轻点“添加”。</p><p>添加后先保持联网，从主屏图标打开，在这里确认“离线准备完成”，再断网试用。首次使用请点一次语音试听，允许声音播放。</p><p>Safari 和主屏版的数据不一定共享。已有计划请先导出备份，再在主屏版恢复。</p></details>`;
  const label = panel.querySelector('#offline-state-label');
  const detail = panel.querySelector('#offline-detail');
  const update = panel.querySelector('#offline-update');
  const retry = panel.querySelector('#offline-retry');
  const apply = document.createElement('button');
  apply.type='button';apply.id='offline-apply';apply.className='button primary small';apply.hidden=true;apply.textContent='立即更新';
  retry.after(apply);
  const diagnostic = panel.querySelector('.offline-error-detail');
  const diagnosticInfo = panel.querySelector('#offline-error-info');
  let phase = 'loading';
  let checking = false;
  let applying = false;
  let updateFeedback = '';
  let lastState = { phase: 'loading' };
  let readyAnnounced = false;

  function announceReady(version) {
    if (readyAnnounced || !version) return;
    readyAnnounced = true;
    try {
      const key = 'homework-clock-offline-ready';
      if (localStorage.getItem(key) === version) return;
      localStorage.setItem(key, version);
    } catch { /* The offline indicator is independent of plan storage. */ }
    window.dispatchEvent(new CustomEvent('homework-offline-ready'));
  }

  function renderState(state) {
    lastState = state;
    phase = state.phase;
    const needsRestart = state.updateReady && phase !== 'ready';
    panel.dataset.state = needsRestart ? 'ready' : phase;
    const error = state.error || state.updateError;
    diagnostic.hidden = !error || needsRestart;
    diagnosticInfo.textContent = error ? [error.path, error.reason, error.status ? `HTTP ${error.status}` : ''].filter(Boolean).join(' · ') : '';
    const progress = Number.isFinite(state.complete) && state.total ? `已准备 ${state.complete} / ${state.total} 项。` : '';
    update.hidden = !(updateFeedback || state.updateReady || state.updateError);
    update.textContent = updateFeedback || (state.updateReady ? (state.canApplyUpdate?'新版已准备好。点“立即更新”即可保留计划和录音，自动切换。':'这个版本需要最后一次关闭作业时钟窗口重开，之后支持一键更新。') : state.updateError ? `更新暂未完成，仍可离线使用已保存的版本。${failureText(state.updateError)}` : '');
    apply.hidden=!state.updateReady||!state.canApplyUpdate;
    apply.disabled=applying||checking;
    apply.textContent=applying?'正在更新…':'立即更新';
    retry.hidden = needsRestart || phase === 'ready' && state.updateReady;
    retry.disabled = applying || checking || phase === 'loading';
    retry.textContent = checking ? '正在检查更新…' : phase === 'loading' ? '正在准备…' : state.updateError ? '重试更新' : phase === 'ready' ? '检查更新' : '继续准备';
    if (needsRestart) {
      label.textContent = '新版离线资源已准备好';
      detail.textContent = state.canApplyUpdate?'当前版本部分资源缺失，完整新版已准备好。可直接更新，计划和录音会保留。':'当前版本有部分资源缺失，请关闭作业时钟窗口后重新打开。计划和录音仍保存在本机。';
    } else if (phase === 'ready') {
      label.textContent = '离线准备完成';
      detail.textContent = '可以从主屏打开并离线使用。首次安装、更新或缓存被清理后，需要联网重新准备。';
      announceReady(state.version);
    } else if (phase === 'error') {
      label.textContent = '离线准备暂时中断';
      detail.textContent = `${progress}${failureText(error)} 已完成的资源会保留，计划和录音不会被清除。`;
    } else {
      label.textContent = '正在准备离线资源…';
      detail.textContent = progress ? `${progress}${state.path ? `正在下载${resourceLabel(state.path)}。` : ''}请保持页面打开。` : '第一次准备需要联网，请保持页面打开；中断后可以继续。';
    }
  }

  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    panel.dataset.state = 'error';
    label.textContent = '请用 Safari 打开安全网址';
    detail.textContent = '离线版本需要通过 HTTPS 首次打开。将文件直接放进“文件”App 无法完成离线安装。';
    retry.hidden = true;
    return;
  }

  const controller = createOfflineController({ serviceWorker: navigator.serviceWorker, onChange: renderState });
  retry.addEventListener('click', async () => {
    if (checking) return;
    checking = true;updateFeedback=''; renderState(lastState);
    try { await controller.prepare(); }
    finally { checking = false; renderState(lastState); }
  });
  apply.addEventListener('click',async()=>{
    if(applying)return;
    applying=true;updateFeedback='';renderState(lastState);
    const result=await controller.applyUpdate();
    if(!result.ok){applying=false;updateFeedback=result.error?.message||`暂时无法更新。${failureText(result.error)}`;renderState(lastState);}
  });
  window.addEventListener('homework-update-cancelled',event=>{applying=false;updateFeedback=event.detail?.message||'更新已暂停，当前页面可以继续使用。';renderState(lastState);});
  window.addEventListener('online', () => { if (phase === 'error') controller.prepare(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) controller.refresh(); });
  controller.prepare();
}
