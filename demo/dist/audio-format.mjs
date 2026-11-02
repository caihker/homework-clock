// Browsers may serialize the same recording MIME with whitespace or quoted
// codecs. Keep a single bounded audio-only parser for recording and backups.
export function normalizeRecordingMime(value) {
  if (typeof value !== 'string' || value.length > 128 || /[\u0000-\u0008\u000a-\u001f\u007f]/.test(value)) return null;
  const match = /^\s*(audio\/(?:webm|mp4|mpeg|ogg|wav|x-wav|aac|x-m4a|x-matroska))\s*(?:;\s*codecs\s*=\s*(?:"([^"\r\n]+)"|([^";\r\n]+))\s*)?$/i.exec(value);
  if (!match) return null;
  const codecs = match[2] ?? match[3];
  if (codecs === undefined) return match[1].toLowerCase();
  const tokens = codecs.split(',').map(token => token.trim());
  if (tokens.some(token => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(token))) return null;
  return `${match[1].toLowerCase()};codecs=${tokens.join(',')}`;
}

export function readEmbeddedAudio(value) {
  if (typeof value !== 'string') return null;
  const match = /^data:([^\r\n]{1,256});base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match || match[2].length % 4 !== 0) return null;
  let metadata;
  try { metadata = decodeURIComponent(match[1]); } catch { return null; }
  const mime = normalizeRecordingMime(metadata);
  if (!mime) return null;
  const payload = match[2];
  const bytes = payload.length / 4 * 3 - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0);
  return { source: `data:${mime};base64,${payload}`, bytes };
}
