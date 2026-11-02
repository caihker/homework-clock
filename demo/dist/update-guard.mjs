import { normalizeCompanion } from './companion.mjs';
import { normalizeSceneVoices } from './scene-voices.mjs';

const blocks = Object.freeze({
  recordingBusy: { reason: 'recording', message: '请先结束录音并保存设置，再更新。' },
  composing: { reason: 'composing', message: '请先完成正在输入的文字，再更新。' },
  importing: { reason: 'importing', message: '请先完成备份恢复，再更新。' },
  settingsDirty: { reason: 'settings-draft', message: '有尚未保存的设置或录音，请先点击“保存设置”，再更新。' },
  taskEditing: { reason: 'task-editing', message: '请先保存或取消正在编辑的安排，再更新。' },
  pendingAction: { reason: 'pending-action', message: '请先完成或取消当前操作，再更新。' },
  stateConflict: { reason: 'state-conflict', message: '其他窗口的数据已变化，请先核对当前数据，再更新。' },
});
const blocked = detail => ({ ok: false, ...detail });
const unknown = () => blocked({ reason: 'unavailable', message: '暂时无法确认数据已保存，请稍后再更新。' });
const storageFailure = () => blocked({ reason: 'storage', message: '本机数据尚未保存，已暂停更新。请先导出备份或检查可用空间。' });

/** Compare only the settings that Save commits; legacy voices/styles normalize. */
export function hasSettingsDraft(saved, draft) {
  if (draft === null || draft === undefined) return false;
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return true;
  const previous = saved && typeof saved === 'object' ? saved : {};
  for (const key of ['sound', 'pet', 'code', 'message']) {
    if (previous[key] !== draft[key]) return true;
  }
  if (normalizeCompanion(previous.companion) !== normalizeCompanion(draft.companion)) return true;
  const oldVoices = normalizeSceneVoices(previous);
  const newVoices = normalizeSceneVoices(draft);
  return Object.keys(oldVoices).some(key => oldVoices[key] !== newVoices[key]);
}

/**
 * A page must explicitly report its edit state and confirm its persisted data
 * before an update may reload it. Persist saves existing state only: this guard
 * never accepts, discards, records or stops an unsaved form/recording/session.
 */
export function createUpdateGuard({ getStatus, persist } = {}) {
  if (typeof getStatus !== 'function' || typeof persist !== 'function') {
    throw new TypeError('Update guard needs getStatus and persist callbacks.');
  }
  let pending;

  function check() {
    let status;
    try { status = getStatus(); } catch { return unknown(); }
    if (!status || typeof status !== 'object' || Array.isArray(status) || typeof status.then === 'function') return unknown();
    for (const [key, detail] of Object.entries(blocks)) {
      if (status[key]) return blocked(detail);
    }
    return { ok: true };
  }

  function prepare() {
    if (pending) return pending;
    pending = (async () => {
      const before = check();
      if (!before.ok) return before;
      try {
        // An explicit true is required; a silent/partial save must not reload.
        if (await persist() !== true) return storageFailure();
      } catch { return storageFailure(); }
      // Save may be asynchronous; an edit begun meanwhile still blocks reload.
      return check();
    })().finally(() => { pending = undefined; });
    return pending;
  }

  return { check, prepare };
}
