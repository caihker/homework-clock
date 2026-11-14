import test from 'node:test';
import assert from 'node:assert/strict';
import { TURTLE_WORDS, pickTurtleWord } from '../dist/turtle-words.mjs';

test('there is a healthy, non-duplicated pool of turtle sayings', () => {
  assert.ok(TURTLE_WORDS.length >= 20);
  assert.equal(new Set(TURTLE_WORDS).size, TURTLE_WORDS.length);
  for (const line of TURTLE_WORDS) assert.ok(line.trim().length >= 8 && line.length <= 40, line);
});

test('pickTurtleWord maps random bounds and avoids repeating the visible line', () => {
  assert.equal(pickTurtleWord('', () => 0), TURTLE_WORDS[0]);
  assert.equal(pickTurtleWord('', () => 0.999999), TURTLE_WORDS[TURTLE_WORDS.length - 1]);
  assert.equal(pickTurtleWord('', () => 1), TURTLE_WORDS[TURTLE_WORDS.length - 1]);
  assert.equal(pickTurtleWord(TURTLE_WORDS[0], () => 0), TURTLE_WORDS[1]);
  assert.equal(pickTurtleWord(TURTLE_WORDS[TURTLE_WORDS.length - 1], () => 0.999999), TURTLE_WORDS[0]);
  assert.equal(pickTurtleWord('', () => 0.5), TURTLE_WORDS[Math.floor(0.5 * TURTLE_WORDS.length)]);
});
