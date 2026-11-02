import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENES, normalizeSceneVoices, selectSceneVoice, countSceneVoices } from '../dist/scene-voices.mjs';
import { TURTLE_LINES } from '../dist/voice-pack.mjs';

const audio = text => `data:audio/mp4;base64,${Buffer.from(text).toString('base64')}`;
const legacy = audio('old family recording');

test('Safari MP4 codec serialization survives scene selection and reopen', () => {
  const raw = 'data:audio/mp4; codecs="mp4a.40.2";base64,dm9pY2U=';
  const settings = { voices: { 'break-start': raw } };
  const normalized = normalizeSceneVoices(settings);
  const expected = 'data:audio/mp4;codecs=mp4a.40.2;base64,dm9pY2U=';
  assert.equal(normalized['break-start'], expected);
  assert.equal(selectSceneVoice('break-start', { voices: JSON.parse(JSON.stringify(normalized)) }), expected);
  assert.equal(countSceneVoices(settings), 1);
  assert.equal(settings.voices['break-start'], raw);
});

test('all seven states match the built-in events and default independently', () => {
  assert.equal(SCENES.length, 7);
  assert.deepEqual(SCENES.map(scene => scene.key).sort(), Object.keys(TURTLE_LINES).sort());
  const expected = Object.fromEntries(SCENES.map(scene => [scene.key, null]));
  for (const settings of [undefined, null, false, [], {}, { voice: null }, { voices: {} }]) {
    assert.deepEqual(normalizeSceneVoices(settings), expected);
    assert.equal(countSceneVoices(settings), 0);
  }
  assert.ok(SCENES.every(scene => scene.label && scene.hint));
});

test('an old single recording migrates to manual start only and does not change saved data', () => {
  const original = { sound: true, voice: legacy };
  const snapshot = structuredClone(original);
  const result = normalizeSceneVoices(original);
  assert.equal(result.start, legacy);
  for (const { key } of SCENES.filter(scene => scene.key !== 'start')) assert.equal(result[key], null);
  assert.equal(countSceneVoices(original), 1);
  result.start = null;
  assert.deepEqual(original, snapshot);
  assert.equal(selectSceneVoice('start', original), legacy);
});

test('explicit restore-default cannot revive a legacy recording', () => {
  assert.equal(normalizeSceneVoices({ voice: legacy, voices: { start: null } }).start, null);
  assert.equal(normalizeSceneVoices({ voice: legacy, voices: { start: undefined } }).start, legacy);
  assert.equal(normalizeSceneVoices({ voice: legacy, voices: { complete: audio('done') } }).start, legacy);
  const newStart = audio('new start');
  assert.equal(normalizeSceneVoices({ voice: legacy, voices: { start: newStart } }).start, newStart);
});

test('seven different recordings stay with their own events, including both start meanings', () => {
  const voices = Object.fromEntries(SCENES.map(scene => [scene.key, audio(scene.key)]));
  const settings = { voice: legacy, voices };
  const snapshot = structuredClone(settings);
  for (const { key } of SCENES) assert.equal(selectSceneVoice(key, settings), voices[key]);
  assert.notEqual(selectSceneVoice('start', settings), selectSceneVoice('schedule-start', settings));
  assert.equal(countSceneVoices(settings), 7);
  assert.deepEqual(settings, snapshot);
  settings.voices['break-end'] = null;
  assert.equal(selectSceneVoice('break-end', settings), null);
  assert.equal(selectSceneVoice('break-start', settings), voices['break-start']);
  assert.equal(countSceneVoices(settings), 6);
});

test('a missing scene never falls back to another family recording and unknown events stay silent', () => {
  const settings = { voice: legacy, voices: { complete: audio('celebrate') } };
  assert.equal(selectSceneVoice('start', settings), legacy);
  assert.equal(selectSceneVoice('end', settings), null);
  assert.equal(selectSceneVoice('break-start', settings), null);
  for (const key of ['unknown', 'toString', '__proto__', '', null, undefined]) assert.equal(selectSceneVoice(key, settings), null);
});

test('normalization accepts saved audio formats and ignores external or malformed sources', () => {
  for (const mime of ['webm;codecs=opus', 'mp4;codecs=mp4a.40.2', 'mp4', 'mpeg', 'ogg;codecs=opus']) {
    const clip = `data:audio/${mime};base64,YXVkaW8=`;
    assert.equal(selectSceneVoice('end', { voices: { end: clip } }), clip);
  }
  for (const value of ['https://example.test/audio.mp3', 'blob:https://example.test/recording', 'javascript:alert(1)', 'data:text/html;base64,YXVkaW8=', 'data:audio/mp4;base64,', 'data:audio/mp4;base64,AA=A', 'data:audio/mp4;base64,AAAA=']) {
    assert.equal(selectSceneVoice('start', { voice: legacy, voices: { start: value } }), null);
  }
  const inherited = Object.create({ start: legacy });
  assert.equal(selectSceneVoice('start', { voices: inherited }), null);
});
