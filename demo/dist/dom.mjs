/** Shared DOM, icon and escaping helpers used by the app shell. */
export const $ = selector => document.querySelector(selector);
export const $$ = selector => [...document.querySelectorAll(selector)];

export const ICON_PATHS = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-9 9 9 5 9-5M3 17l9 5 9-5"/>',
  leaf: '<path d="M20 3C8 2 2 8 5 16c6 7 16 0 15-13ZM4 21 15 10"/>',
  settings: '<path d="m9 4 1-2h4l1 2 3 2 3 1v4l-2 1-1 3 1 3-3 3-3-1-3 1-3 1-3-3 1-3-1-3-2-1V7l3-1 3-2Z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-left': '<path d="m15 5-7 7 7 7"/>',
  'chevron-right': '<path d="m9 5 7 7-7 7"/>',
  'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  'arrow-left': '<path d="M20 12H4m6-6-6 6 6 6"/>',
  sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4"/>',
  play: '<path d="m8 4 12 8-12 8V4Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
  volume: '<path d="m11 4-6 5H2v6h3l6 5V4Zm4 4c3 2 3 6 0 8m3-11c5 4 5 10 0 14"/>',
  'volume-off': '<path d="m11 4-6 5H2v6h3l6 5V4Z"/><path d="m16 9 5 6m0-6-5 6"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="3"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  book: '<path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1Zm0 0v15"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  game: '<path d="M7 7h10c4 0 6 12 3 13-2 1-4-3-6-3h-4c-2 0-4 4-6 3C1 19 3 7 7 7Z"/><path d="M7 10v6m-3-3h6m6-1h.1m3 3h.1M10 7V4h4V2"/>',
  mic: '<rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.7M20 4v7h-7"/>',
};

export const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.clock}</svg>`;

export const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export const CATEGORY_ICONS = { study: 'learning', life: 'life', play: 'play' };
export const categoryIcon = type => `<img class="category-icon" src="./assets/category-flat-byg/${CATEGORY_ICONS[type] || CATEGORY_ICONS.study}.png" width="64" height="64" alt="" aria-hidden="true" decoding="async" draggable="false">`;

export const setIcons = () => $$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
export const setCategoryIcons = () => $$('[data-category]').forEach(el => { el.innerHTML = categoryIcon(el.dataset.category); });
