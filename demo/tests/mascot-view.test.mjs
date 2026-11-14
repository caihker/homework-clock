import test from 'node:test';
import assert from 'node:assert/strict';
import { dateAtTime } from '../dist/core.mjs';
import { createSession } from '../dist/session-timer.mjs';
import { moodLabels } from '../dist/mascot.mjs';
import { createMascotView } from '../dist/mascot-view.mjs';

const day = '2026-11-01';
const at = time => dateAtTime(day, time).getTime();
const taskStart = task => dateAtTime(task.date, task.start).getTime();
const taskEnd = task => dateAtTime(task.date, task.end).getTime();

/**
 * Minimal element good enough for the view's writes: dataset, style custom
 * properties, classList, hidden/alt, attributes and the two lookups it makes.
 */
function fakeElement(extra = {}, ImageClass = null) {
  const el = {
    dataset: {},
    attrs: {},
    classes: new Set(),
    hidden: false,
    alt: '',
    style: {
      props: {},
      setProperty(name, value) { this.props[name] = String(value); },
    },
    classList: {
      add(...names) { names.forEach(name => el.classes.add(name)); },
      contains(name) { return el.classes.has(name); },
      toggle(name, force) {
        const on = force === undefined ? !el.classes.has(name) : Boolean(force);
        if (on) el.classes.add(name); else el.classes.delete(name);
        return on;
      },
    },
    getAttribute(name) { return Object.hasOwn(el.attrs, name) ? el.attrs[name] : null; },
    setAttribute(name, value) { el.attrs[name] = String(value); },
    closest() { return null; },
    querySelector() { return null; },
    ...extra,
  };
  if (ImageClass) Object.setPrototypeOf(el, ImageClass.prototype);
  return el;
}

function restoreGlobal(name, value) {
  if (value === undefined) delete globalThis[name];
  else globalThis[name] = value;
}

function installBrowser(t) {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    HTMLImageElement: globalThis.HTMLImageElement,
  };
  class FakeImageElement {}
  const documentListeners = new Map();
  const windowListeners = new Map();
  const register = map => (type, listener) => {
    if (!map.has(type)) map.set(type, []);
    map.get(type).push(listener);
  };
  const document = {
    hidden: false,
    listeners: documentListeners,
    addEventListener: register(documentListeners),
    dispatch(type, event) {
      for (const listener of documentListeners.get(type) || []) listener(event);
    },
  };
  const window = {
    listeners: windowListeners,
    addEventListener: register(windowListeners),
    dispatch(type, event) {
      for (const listener of windowListeners.get(type) || []) listener(event);
    },
  };
  globalThis.document = document;
  globalThis.window = window;
  globalThis.HTMLImageElement = FakeImageElement;
  t.after(() => {
    restoreGlobal('document', previous.document);
    restoreGlobal('window', previous.window);
    restoreGlobal('HTMLImageElement', previous.HTMLImageElement);
  });
  return { document, window, FakeImageElement };
}

function setup(t, {
  tasks = [], session = null, now = '11:00', pet = true, companion = 'original',
  reduced = false, locked = false, current = null, focus = null, finish = null,
  previews = null,
} = {}) {
  const browser = installBrowser(t);
  const clock = { now: at(now) };
  const realDateNow = Date.now;
  Date.now = () => clock.now;
  t.after(() => { Date.now = realDateNow; });

  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, fakeElement());
    return elements.get(selector);
  };
  const emptyMascots = [fakeElement(), fakeElement()];
  const $$ = selector => {
    if (previews && selector === '[data-companion-preview]') return previews;
    if (selector === '.empty-mascot') return emptyMascots;
    return [];
  };
  const state = {
    tasks,
    selectedDate: day,
    session,
    settings: { pet, companion, sound: true },
    history: [],
  };
  const getTask = id => state.tasks.find(task => task.id === id);
  const reducedMotion = { matches: reduced, addEventListener() {} };
  const view = createMascotView({
    $, $$, taskStart, taskEnd,
    getState: () => state,
    getTask,
    getCurrentId: () => current?.id ?? null,
    getFocusTaskId: () => focus?.id ?? null,
    getFinishTaskId: () => finish?.id ?? null,
    getNow: () => new Date(clock.now),
    isUpdateLocked: () => locked,
    reducedMotion,
  });
  return { view, elements, emptyMascots, state, clock, browser, advance: ms => { clock.now += ms; } };
}

const study = { id: 'study', date: day, title: '语文预习', start: '10:00', end: '12:00', type: 'study', completed: false };

function journeyHarness() {
  const journey = fakeElement();
  const track = fakeElement();
  const button = fakeElement();
  journey.querySelector = selector => selector === '[role="progressbar"]' ? track : button;
  return { journey, track, button };
}

test('turn flips the turtle direction and keeps the journey progress', t => {
  const { view } = setup(t, { tasks: [study], current: study });
  const { journey, track, button } = journeyHarness();

  view.syncTurtleJourney(journey, study, 0.42);
  assert.equal(journey.style.props['--task-progress'], '42%');
  assert.equal(track.getAttribute('aria-valuenow'), '42');
  assert.equal(button.getAttribute('aria-label'), '小乌龟向右，点击调头');
  assert.equal(button.hidden, false);

  view.turn(study);
  view.syncTurtleJourney(journey, study, 0.42);
  assert.equal(button.getAttribute('aria-label'), '小乌龟向左，点击调头');
  assert.equal(journey.style.props['--task-progress'], '42%', 'turning never changes progress');

  view.turn(study);
  view.syncTurtleJourney(journey, study, 0.42);
  assert.equal(button.getAttribute('aria-label'), '小乌龟向右，点击调头');

  view.reset();
  view.turn(study);
  view.syncTurtleJourney(journey, study, 0.42);
  assert.equal(button.getAttribute('aria-label'), '小乌龟向左，点击调头', 'reset clears the trip direction');
});

test('journey progress is clamped and the idle trip is separate from a task', t => {
  const { view } = setup(t, { tasks: [study], current: study, pet: false });
  const { journey, track, button } = journeyHarness();

  view.syncTurtleJourney(journey, study, 1.7);
  assert.equal(journey.style.props['--task-progress'], '100%');
  assert.equal(track.getAttribute('aria-valuenow'), '100');
  view.syncTurtleJourney(journey, study, -0.4);
  assert.equal(journey.style.props['--task-progress'], '0%');
  assert.equal(track.getAttribute('aria-valuenow'), '0');
  assert.equal(button.hidden, true, 'pet off hides the turn button');

  view.turn(null);
  view.syncTurtleJourney(journey, null, 0.5);
  assert.equal(button.getAttribute('aria-label'), '小乌龟向左，点击调头');
  view.syncTurtleJourney(journey, study, 0.5);
  assert.equal(button.getAttribute('aria-label'), '小乌龟向右，点击调头', 'each task keeps its own trip direction');
});

test('updateMascots paints walking frames, alt text and pet visibility', t => {
  const session = createSession(study, at('10:30'));
  const { view, elements, emptyMascots } = setup(t, {
    tasks: [study], session, current: study, now: '11:00',
  });
  view.updateMascots(at('11:00'));

  const pet = elements.get('.pet-illustration');
  const turtle = elements.get('.progress-turtle');
  const focusPet = elements.get('.focus-pet img');
  const finish = elements.get('.finish-mascot');

  assert.equal(turtle.getAttribute('src'), './assets/motion-original-v2/walking-right.webp');
  assert.equal(turtle.dataset.mood, 'walking');
  assert.equal(turtle.alt, moodLabels.walking);
  assert.equal(turtle.dataset.companionStyle, 'original');
  assert.equal(turtle.style.props['--companion-scale'], '1');
  assert.equal(turtle.style.props['--companion-x'], '0%');
  assert.equal(turtle.style.props['--companion-y'], '0%');
  assert.ok(turtle.classList.contains('companion-art'));

  assert.equal(pet.hidden, true, 'the home pet only shows while celebrating');
  assert.equal(pet.dataset.mood, 'walking');
  assert.equal(focusPet.dataset.mood, 'rest');
  assert.equal(focusPet.getAttribute('src'), './assets/motion-original-v2/rest.webp');
  assert.equal(focusPet.alt, moodLabels.rest);
  assert.equal(finish.dataset.mood, 'rest');
  assert.equal(emptyMascots.length, 2);
  emptyMascots.forEach(el => assert.equal(el.dataset.mood, 'rest'));
});

test('a completed plan celebrates while a still pet uses the cached frame', t => {
  const done = { ...study, completed: true };
  const motion = setup(t, { tasks: [done], current: done, now: '11:30' });
  motion.view.updateMascots(at('11:30'));
  const turtle = motion.elements.get('.progress-turtle');
  assert.equal(turtle.dataset.mood, 'happy');
  assert.equal(turtle.alt, moodLabels.happy);
  assert.equal(turtle.getAttribute('src'), './assets/motion-original-v2/happy-jump.webp');

  const still = setup(t, { tasks: [study], current: study, now: '11:00', pet: false });
  still.view.updateMascots(at('11:00'));
  assert.equal(still.elements.get('.progress-turtle').getAttribute('src'), './assets/turtle-mascot.png');
});

test('celebrate marks the pet happy for five seconds using the injected clock', t => {
  const session = createSession(study, at('10:30'));
  const { view, elements, clock, advance } = setup(t, {
    tasks: [study], session, current: study, now: '11:00',
  });
  view.updateMascots(at('11:00'));
  const pet = elements.get('.pet-illustration');
  assert.equal(pet.hidden, true);

  view.celebrate(study);
  assert.equal(pet.hidden, false);
  assert.equal(pet.dataset.mood, 'happy');
  assert.equal(pet.alt, moodLabels.happy);
  assert.match(pet.getAttribute('src'), /happy-jump\.webp$/);
  assert.equal(elements.get('.progress-turtle').dataset.mood, 'walking', 'only the home pet celebrates');

  view.updateMascots(at('11:00') + 4000);
  assert.equal(pet.hidden, false, 'still celebrating just before five seconds');

  advance(5001);
  view.updateMascots(clock.now);
  assert.equal(pet.hidden, true);
  assert.equal(pet.dataset.mood, 'walking', 'back to the session mood after the celebration');
});

test('a failed companion frame falls back to the cached still image', t => {
  const { browser } = setup(t, { tasks: [study], current: study });
  const image = fakeElement({ dataset: { companionStyle: 'solid' } }, browser.FakeImageElement);
  image.classList.add('companion-art');
  assert.ok(image instanceof browser.FakeImageElement);

  browser.document.dispatch('error', { target: image });
  assert.equal(image.dataset.companionFallback, 'solid');
  assert.equal(image.getAttribute('src'), './assets/motion-solid/still.png');
});

test('renderCompanionPreviews uses static frames and skips redundant src writes', t => {
  const original = fakeElement({ dataset: { companionPreview: 'original' } });
  const solid = fakeElement({ dataset: { companionPreview: 'solid' } });
  const { view } = setup(t, { tasks: [study], current: study, previews: [original, solid] });
  view.renderCompanionPreviews();

  assert.equal(original.getAttribute('src'), './assets/turtle-mascot.png');
  assert.equal(original.dataset.companionStyle, 'original');
  assert.ok(original.classList.contains('companion-art'));
  assert.equal(solid.getAttribute('src'), './assets/motion-solid/still.png');
  assert.equal(solid.dataset.companionStyle, 'solid');
  assert.notEqual(solid.style.props['--companion-scale'], '1');

  view.renderCompanionPreviews();
  assert.equal(original.getAttribute('src'), './assets/turtle-mascot.png');
});
