import test from 'node:test';
import assert from 'node:assert/strict';
import { mascotMood } from '../dist/mascot.mjs';
test('mascot follows task lifecycle including pause, deadline and completion', () => {
  const base = {task:{id:'a'}, start:100, end:200, at:150};
  assert.equal(mascotMood(base),'waiting');
  const running = {...base,session:{taskId:'a',paused:false}};
  assert.equal(mascotMood(running),'walking');
  assert.equal(mascotMood({...running,session:{taskId:'a',paused:true}}),'rest');
  assert.equal(mascotMood({...running,at:200}),'ready');
  assert.equal(mascotMood({...running,at:50}),'waiting');
  assert.equal(mascotMood({...running,session:{taskId:'b'}}),'waiting');
  assert.equal(mascotMood({...base,task:null}),'rest');
  assert.equal(mascotMood({...base,celebrating:true}),'happy');
  assert.equal(mascotMood({...base,task:{id:'a',completed:true}}),'happy');
});
