const token = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\u0000-\u001f\u007f]/.test(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** Never overwrite a saved snapshot that has changed since this page read it. */
export function commitLocalState({ storage, key, expectedRaw, value } = {}) {
  try {
    const currentRaw = storage.getItem(key);
    if (currentRaw !== expectedRaw) return { ok: false, reason: 'conflict', currentRaw };
    const raw = JSON.stringify(value);
    if (typeof raw !== 'string') return { ok: false, reason: 'storage' };
    storage.setItem(key, raw);
    return { ok: true, raw };
  } catch {
    return { ok: false, reason: 'storage' };
  }
}

/** A short-lived update barrier is data only; malformed or stale locks expire. */
export function readUpdateLock({ storage, key, now = Date.now() } = {}) {
  try {
    const value = JSON.parse(storage.getItem(key));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (!['transactionId', 'version', 'expiresAt'].every(name => own(value, name))) return null;
    if (!token(value.transactionId) || !token(value.version)) return null;
    if (!Number.isFinite(now) || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + 60000) return null;
    return { transactionId: value.transactionId, version: value.version, expiresAt: value.expiresAt };
  } catch {
    return null;
  }
}

/** Cancellation must never remove a newer update's barrier. */
export function releaseUpdateLock(storage, key, transactionId) {
  if (!token(transactionId)) return;
  try {
    const value = JSON.parse(storage.getItem(key));
    if (value && typeof value === 'object' && !Array.isArray(value) && own(value, 'transactionId') && value.transactionId === transactionId) storage.removeItem(key);
  } catch { /* A read/removal failure leaves the barrier to expire naturally. */ }
}
