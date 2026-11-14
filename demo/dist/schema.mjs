/** Single source for state shape constants shared by app, store and backup. */
import { TASK_TYPES } from './core.mjs';

export { TASK_TYPES };
export const TASK_TYPE_LABELS = Object.freeze({ study: '学习', life: '生活', play: '娱乐' });
export const STATE_VERSION = 1;
export const STATE_KEY = 'homework-clock-demo-v1';
export const RECOVERY_KEY = 'homework-clock-demo-v1-recovery';
export const NOTE_MAX_LENGTH = 300;
export const TEMPLATE_MIN_MINUTES = 10;
export const TEMPLATE_MAX_MINUTES = 600;
export const MAX_RECORDING_BYTES = 1024 * 1024;
export const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
export const DEFAULT_SETTINGS = Object.freeze({
  sound: true,
  pet: true,
  companion: 'original',
  code: '小皮开工了',
  message: '先做一道，进入状态就容易啦。',
  voice: null,
});
