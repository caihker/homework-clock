import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoicePlayer} from '../dist/voice-pack.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function fakeAudio(results = []) {
  return {
    src: '',
    currentTime: 12,
    plays: [],
    pauseCount: 0,
    play() { this.plays.push(this.src); return results.shift() ?? Promise.resolve(); },
    pause() { this.pauseCount++; },
  };
}

test('play starts within the gesture and reuses the unlocked media element for later reminders', async () => {
  const clip = fakeAudio();
  let cancelCount = 0, makeCount = 0;
  const player = createVoicePlayer({
    makeAudio: src => { makeCount++; clip.src = src; return clip; },
    cancelSpeech: () => cancelCount++,
  });
  const firstResult = player.play('start.mp3');
  assert.deepEqual(clip.plays, ['start.mp3'], 'play is called before the caller yields');
  assert.equal(await firstResult, true);
  const secondResult = player.play('schedule-reminder.mp3');
  assert.equal(clip.pauseCount, 1);
  assert.equal(clip.currentTime, 0);
  assert.deepEqual(clip.plays, ['start.mp3', 'schedule-reminder.mp3']);
  assert.equal(cancelCount, 2);
  assert.equal(makeCount, 1);
  assert.equal(await secondResult, true);
});

test('an older rejected play promise cannot stop or report failure for its replacement', async () => {
  const pending = deferred(), clip = fakeAudio([pending.promise]);
  const errors = [];
  const player = createVoicePlayer({
    makeAudio: src => { clip.src = src; return clip; },
    cancelSpeech: () => {}, onBlocked: e => errors.push(e),
  });
  const oldResult = player.play('old.mp3');
  assert.equal(await player.play('new.mp3'), true);
  pending.reject(new Error('interrupted'));
  assert.equal(await oldResult, false);
  assert.equal(clip.pauseCount, 1, 'late failure does not pause the new source');
  assert.equal(clip.src, 'new.mp3');
  assert.deepEqual(errors, []);
});

test('repeated stop is harmless and silences a pending clip without a delayed error', async () => {
  const pending = deferred(), clip = fakeAudio([pending.promise]), errors = [];
  const player = createVoicePlayer({
    makeAudio: () => clip, cancelSpeech: () => {}, onBlocked: e => errors.push(e),
  });
  const result = player.play('pending.mp3');
  player.stop();
  player.stop();
  assert.equal(clip.pauseCount, 1);
  assert.equal(clip.currentTime, 0);
  pending.reject(new Error('aborted after stop'));
  assert.equal(await result, false);
  assert.deepEqual(errors, []);
});

test('blocked playback is released and a family recording can retry on the same element', async () => {
  const denied = new Error('NotAllowedError');
  const clip = fakeAudio([Promise.reject(denied)]), errors = [];
  let makeCount = 0;
  const player = createVoicePlayer({
    makeAudio: () => { makeCount++; return clip; },
    cancelSpeech: () => {}, onBlocked: e => errors.push(e),
  });
  assert.equal(await player.play('blocked.mp3'), false);
  assert.equal(clip.pauseCount, 1);
  assert.equal(clip.currentTime, 0);
  assert.deepEqual(errors, [denied]);
  assert.equal(await player.play('data:audio/webm;base64,family-recording'), true);
  assert.equal(clip.src, 'data:audio/webm;base64,family-recording');
  assert.equal(clip.pauseCount, 1, 'failed playback is no longer active');
  assert.equal(makeCount, 1);
});

test('synchronous media failure leaves the element stopped and does not block a later retry', async () => {
  const clip = fakeAudio(), errors = [];
  const player = createVoicePlayer({
    makeAudio: () => clip, cancelSpeech: () => {}, onBlocked: e => errors.push(e),
  });
  assert.equal(await player.play('first.mp3'), true);
  const failure = new Error('unavailable');
  const play = clip.play;
  clip.play = () => { throw failure; };
  assert.equal(await player.play('unavailable.mp3'), false);
  assert.equal(clip.pauseCount, 2, 'old playback and failed replacement are both stopped');
  assert.deepEqual(errors, [failure]);
  player.stop();
  assert.equal(clip.pauseCount, 2);
  clip.play = play;
  assert.equal(await player.play('recovered.mp3'), true);
});
