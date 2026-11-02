import { toMinutes, toTime } from './core.mjs';

export const MIN_PICKER_MINUTES = 8 * 60;
export const MAX_START_MINUTES = 21 * 60;
export const MAX_PICKER_MINUTES = 21 * 60 + 50;
export function normalizePickerMinutes(value, { maxMinutes = MAX_PICKER_MINUTES } = {}) {
  const minutes = typeof value === 'number' ? value : toMinutes(value);
  return Math.max(MIN_PICKER_MINUTES, Math.min(maxMinutes, Math.round((Number.isFinite(minutes) ? minutes : MIN_PICKER_MINUTES) / 10) * 10));
}
export function pickerMinutesForHour(hour, { maxMinutes = MAX_PICKER_MINUTES } = {}) {
  if (!Number.isInteger(hour) || hour < 8 || hour > 21) return [];
  return [0, 10, 20, 30, 40, 50].filter(minute => hour * 60 + minute <= maxMinutes);
}
export function isWithinSchedulingWindow(value, { maxMinutes = MAX_PICKER_MINUTES } = {}) {
  const minutes = toMinutes(value);
  return Number.isFinite(minutes) && minutes >= MIN_PICKER_MINUTES && minutes <= maxMinutes;
}

/** Shared time dialog. Selecting options does not commit until confirmation. */
export function setupTimePicker() {
  const dialog = document.querySelector('#time-picker-dialog');
  const triggers = [...document.querySelectorAll('[data-time-field]')];
  const hoursGrid = dialog.querySelector('.hours-grid');
  const minutesGrid = dialog.querySelector('.minutes-grid');
  let opener = null;
  let input = null;
  let hour = 8;
  let minute = 0;
  let maxMinutes = MAX_PICKER_MINUTES;
  const option = (value, unit) => `<button type="button" class="time-option" role="radio" aria-checked="false" tabindex="-1" aria-label="${value} ${unit === 'hour' ? '时' : '分'}" data-${unit}="${value}">${String(value).padStart(2, '0')}</button>`;
  hoursGrid.innerHTML = Array.from({ length: 14 }, (_, i) => option(i + 8, 'hour')).join('');
  minutesGrid.innerHTML = Array.from({ length: 6 }, (_, i) => option(i * 10, 'minute')).join('');

  function sync() {
    for (const trigger of triggers) {
      const field = document.getElementById(trigger.dataset.timeField);
      const value = field.value || '选择时间';
      trigger.querySelector('[data-time-value]').textContent = value;
      trigger.setAttribute('aria-label', `${trigger.dataset.timeLabel}，${value}`);
    }
  }
  function render() {
    dialog.querySelector('#time-picker-value').textContent = toTime(hour * 60 + minute);
    dialog.querySelectorAll('[data-hour]').forEach(button => {
      const checked = Number(button.dataset.hour) === hour;
      button.setAttribute('aria-checked', String(checked));
      button.tabIndex = checked ? 0 : -1;
    });
    dialog.querySelectorAll('[data-minute]').forEach(button => {
      const checked = Number(button.dataset.minute) === minute;
      button.disabled = !pickerMinutesForHour(hour, { maxMinutes }).includes(Number(button.dataset.minute));
      button.setAttribute('aria-checked', String(checked));
      button.tabIndex = checked ? 0 : -1;
    });
  }
  function open(trigger) {
    opener = trigger;
    input = document.getElementById(trigger.dataset.timeField);
    maxMinutes = trigger.dataset.timeField === 'task-start' ? MAX_START_MINUTES : MAX_PICKER_MINUTES;
    const rounded = normalizePickerMinutes(input.value, { maxMinutes });
    hour = Math.floor(rounded / 60);
    minute = rounded % 60;
    dialog.querySelector('#time-picker-title').textContent = trigger.dataset.timeLabel;
    triggers.forEach(button => button.setAttribute('aria-expanded', String(button === trigger)));
    render();
    dialog.showModal();
    hoursGrid.querySelector('[aria-checked="true"]').focus({ preventScroll: true });
  }
  function constrainMinute() {
    const available = pickerMinutesForHour(hour, { maxMinutes });
    if (!available.includes(minute)) minute = available.at(-1) ?? 0;
  }
  function bindGrid(grid, unit) {
    grid.addEventListener('click', event => {
      const button = event.target.closest(`[data-${unit}]`);
      if (!button || button.disabled) return;
      if (unit === 'hour') hour = Number(button.dataset.hour);
      else minute = Number(button.dataset.minute);
      constrainMinute();
      render();
    });
    grid.addEventListener('keydown', event => {
      const columns = getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length || 6;
      const shifts = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
      if (!(event.key in shifts) && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      const available = [...grid.querySelectorAll('.time-option:not(:disabled)')];
      const current = available.findIndex(button => button.getAttribute('aria-checked') === 'true');
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 : (current + shifts[event.key] + available.length) % available.length;
      if (unit === 'hour') hour = Number(available[next].dataset.hour);
      else minute = Number(available[next].dataset.minute);
      constrainMinute();
      render();
      grid.querySelector('[aria-checked="true"]').focus({ preventScroll: true });
    });
  }
  bindGrid(hoursGrid, 'hour');
  bindGrid(minutesGrid, 'minute');
  triggers.forEach(trigger => trigger.addEventListener('click', () => open(trigger)));
  dialog.querySelector('#confirm-time').addEventListener('click', () => {
    input.value = toTime(hour * 60 + minute);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    sync();
    dialog.close();
  });
  dialog.querySelector('#cancel-time').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    triggers.forEach(trigger => trigger.setAttribute('aria-expanded', 'false'));
    opener?.focus({ preventScroll: true });
  });
  sync();
  return { sync };
}
