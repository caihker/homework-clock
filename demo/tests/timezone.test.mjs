import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const coreURL = new URL('../dist/core.mjs', import.meta.url).href;
const sessionURL = new URL('../dist/session-timer.mjs', import.meta.url).href;
const script = `
import { TIME_ZONE, dateKey, dateAtTime, shiftDate, clockParts, remainingSeconds } from ${JSON.stringify(coreURL)};
import { createSession, pauseSession, sessionElapsedMs, sessionRemainingMs, sessionDeadlineMs } from ${JSON.stringify(sessionURL)};
const midnight = new Date('2026-10-31T16:05:00Z');
const task = {id:'study',date:'2026-11-01',start:'10:00',end:'12:00'};
const at = time => dateAtTime(task.date,time).getTime();
const paused = pauseSession(createSession(task,at('10:20')),task,at('10:40'));
process.stdout.write(JSON.stringify({
  day:dateKey(midnight),
  weekday:midnight.toLocaleDateString('zh-CN',{timeZone:TIME_ZONE,weekday:'long'}),
  clock:clockParts(midnight),
  previous:shiftDate('2026-11-01',-1),
  next:shiftDate('2026-10-31',1),
  leap:shiftDate('2024-03-01',-1),
  year:shiftDate('2026-01-01',-1),
  slot:dateAtTime(task.date,'12:00').toISOString(),
  remaining:remainingSeconds(task,new Date('2026-11-01T02:20:00Z')),
  focus:sessionElapsedMs(paused,task,at('10:47')),
  afterBreak:sessionRemainingMs(paused,task,at('10:47')),
  deadline:new Date(sessionDeadlineMs(paused,task,at('10:47'))).toISOString()
}));
`;

test('GMT+8 dates, weekday, bidirectional navigation and fixed deadlines ignore the host time zone', () => {
  const expected = {
    day:'2026-11-01', weekday:'星期日', clock:{hours:0,minutes:5,seconds:0},
    previous:'2026-10-31', next:'2026-11-01', leap:'2024-02-29', year:'2025-12-31',
    slot:'2026-11-01T04:00:00.000Z', remaining:6000, focus:22*60_000,
    afterBreak:73*60_000, deadline:'2026-11-01T04:00:00.000Z',
  };
  for (const TZ of ['UTC','America/Los_Angeles','Europe/Berlin','Asia/Shanghai']) {
    const result = execFileSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,TZ},encoding:'utf8'});
    assert.deepEqual(JSON.parse(result),expected,`calendar/timing must stay in GMT+8 when system TZ=${TZ}`);
  }
});
