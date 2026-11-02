import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePickerMinutes, pickerMinutesForHour, isWithinSchedulingWindow, setupTimePicker, MAX_START_MINUTES } from '../dist/time-picker.mjs';

test('end picker clamps to 08:00–21:50 with ten-minute options throughout the last hour', () => {
  assert.equal(normalizePickerMinutes('07:50'), 480);
  assert.equal(normalizePickerMinutes('21:50'), 1310);
  assert.equal(normalizePickerMinutes('22:00'), 1310);
  assert.equal(normalizePickerMinutes('18:23'), 1100);
  assert.deepEqual(pickerMinutesForHour(8), [0, 10, 20, 30, 40, 50]);
  assert.deepEqual(pickerMinutesForHour(20), [0, 10, 20, 30, 40, 50]);
  assert.deepEqual(pickerMinutesForHour(21), [0, 10, 20, 30, 40, 50]);
  assert.deepEqual(pickerMinutesForHour(7), []);
  assert.deepEqual(pickerMinutesForHour(22), []);
});
test('start picker still ends at 21:00 and cannot suggest later start minutes', () => {
  const start = { maxMinutes: MAX_START_MINUTES };
  assert.equal(normalizePickerMinutes('21:50', start), 1260);
  assert.deepEqual(pickerMinutesForHour(21, start), [0]);
  assert.deepEqual(pickerMinutesForHour(20, start), [0, 10, 20, 30, 40, 50]);
  assert.equal(isWithinSchedulingWindow('21:00', start), true);
  assert.equal(isWithinSchedulingWindow('21:10', start), false);
});
test('end scheduling boundaries include 21:50 but reject 22:00', () => {
  assert.equal(isWithinSchedulingWindow('08:00'), true);
  assert.equal(isWithinSchedulingWindow('21:00'), true);
  assert.equal(isWithinSchedulingWindow('21:10'), true);
  assert.equal(isWithinSchedulingWindow('21:50'), true);
  assert.equal(isWithinSchedulingWindow('07:50'), false);
  assert.equal(isWithinSchedulingWindow('22:00'), false);
});

function pickerUI(t) {
  let focused;
  function element(dataset = {}) {
    const events = new Map();
    const attributes = new Map();
    return {
      dataset, disabled: false, value: '', textContent: '',
      addEventListener(type, handler) { if (!events.has(type)) events.set(type, []); events.get(type).push(handler); },
      emit(type, event = {}) { for (const handler of events.get(type) || []) handler(event); },
      dispatchEvent(event) { this.emit(event.type, event); },
      setAttribute(name, value) { attributes.set(name, value); },
      getAttribute(name) { return attributes.get(name); },
      closest(selector) { return selector === '[data-hour]' && 'hour' in dataset || selector === '[data-minute]' && 'minute' in dataset ? this : null; },
      focus() { focused = this; },
    };
  }
  const hours = Array.from({ length: 14 }, (_, i) => element({ hour: String(i + 8) }));
  const minutes = Array.from({ length: 6 }, (_, i) => element({ minute: String(i * 10) }));
  function grid(buttons) {
    const result = element();
    result.querySelector = () => buttons.find(button => button.getAttribute('aria-checked') === 'true');
    result.querySelectorAll = () => buttons.filter(button => !button.disabled);
    return result;
  }
  const hoursGrid = grid(hours), minutesGrid = grid(minutes);
  const fields = { 'task-start': element(), 'task-end': element() };
  const triggers = Object.entries(fields).map(([id]) => {
    const trigger = element({ timeField: id, timeLabel: id === 'task-start' ? '开始时间' : '结束时间' });
    trigger.valueLabel = element(); trigger.querySelector = () => trigger.valueLabel;
    return trigger;
  });
  const controls = { '#time-picker-value': element(), '#time-picker-title': element(), '#confirm-time': element(), '#cancel-time': element() };
  const dialog = element();
  dialog.querySelector = selector => selector === '.hours-grid' ? hoursGrid : selector === '.minutes-grid' ? minutesGrid : controls[selector];
  dialog.querySelectorAll = selector => selector === '[data-hour]' ? hours : minutes;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.emit('close'); };
  const previousDocument = globalThis.document, previousStyle = globalThis.getComputedStyle;
  globalThis.document = { querySelector: () => dialog, querySelectorAll: () => triggers, getElementById: id => fields[id] };
  globalThis.getComputedStyle = () => ({ gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 1fr' });
  t.after(() => { globalThis.document = previousDocument; globalThis.getComputedStyle = previousStyle; });
  const picker = setupTimePicker();
  return { fields, triggers, controls, hours, minutes, hoursGrid, minutesGrid, picker, focused: () => focused };
}

test('clicking and keyboard-selecting 21 keep end minutes at 50 but clamp start to 00', t => {
  const ui = pickerUI(t);
  ui.fields['task-end'].value = '20:50';
  ui.triggers[1].emit('click');
  ui.hoursGrid.emit('click', { target: ui.hours.at(-1) });
  assert.equal(ui.minutes.at(-1).disabled, false);
  ui.controls['#confirm-time'].emit('click');
  assert.equal(ui.fields['task-end'].value, '21:50');
  assert.equal(ui.focused(), ui.triggers[1]);
  ui.fields['task-end'].value = '20:50';
  ui.triggers[1].emit('click');
  ui.hoursGrid.emit('keydown', { key: 'End', preventDefault() {} });
  ui.controls['#confirm-time'].emit('click');
  assert.equal(ui.fields['task-end'].value, '21:50');
  ui.fields['task-start'].value = '20:50';
  ui.triggers[0].emit('click');
  ui.hoursGrid.emit('click', { target: ui.hours.at(-1) });
  assert.ok(ui.minutes.slice(1).every(button => button.disabled));
  ui.controls['#confirm-time'].emit('click');
  assert.equal(ui.fields['task-start'].value, '21:00');
});

test('opening or cancelling the picker does not rewrite legacy non-ten-minute times', t => {
  const ui = pickerUI(t);
  ui.fields['task-start'].value = '18:23';
  ui.fields['task-end'].value = '19:47';
  ui.picker.sync();
  ui.triggers[0].emit('click');
  ui.controls['#cancel-time'].emit('click');
  ui.triggers[1].emit('click');
  ui.controls['#cancel-time'].emit('click');
  assert.equal(ui.fields['task-start'].value, '18:23');
  assert.equal(ui.fields['task-end'].value, '19:47');
});
