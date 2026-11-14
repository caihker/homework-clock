import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TASK_TYPES, TASK_TYPE_LABELS, DEFAULT_SETTINGS, STATE_VERSION, NOTE_MAX_LENGTH,
  MAX_RECORDING_BYTES, MAX_BACKUP_BYTES,
} from '../dist/schema.mjs';

test('schema is the single frozen source for shared state constants', () => {
  assert.deepEqual([...TASK_TYPES], ['study', 'life', 'play']);
  assert.deepEqual(TASK_TYPE_LABELS, { study: '学习', life: '生活', play: '娱乐' });
  assert.equal(Object.isFrozen(DEFAULT_SETTINGS), true);
  assert.equal(DEFAULT_SETTINGS.companion, 'original');
  assert.equal(STATE_VERSION, 1);
  assert.equal(NOTE_MAX_LENGTH, 300);
  assert.equal(MAX_RECORDING_BYTES, 1024 * 1024);
  assert.equal(MAX_BACKUP_BYTES, 16 * 1024 * 1024);
});
