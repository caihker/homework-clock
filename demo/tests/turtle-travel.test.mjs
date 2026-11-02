import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceTurtle} from '../dist/turtle-travel.mjs';
test('turning keeps the turtle at the progress endpoint as time advances',()=>{
 const a=advanceTurtle({position:0,progress:null,direction:1},.4);
 const b=advanceTurtle({...a,direction:-1},.4);
 assert.equal(b.position,.4);assert.equal(b.progress,.4);
 assert.equal(advanceTurtle(b,.5).position,.5);
 assert.equal(advanceTurtle(b,.5).direction,-1);
 assert.equal(advanceTurtle(b,.4).position,.4);
});
test('clock jumps and both endpoints stay aligned with the filled track',()=>{
 const trip={position:.8,progress:.8,direction:-1};
 for(const progress of [0,.02,.5,.98,1,.1]) {
  const t=advanceTurtle(trip,progress);
  assert.equal(t.position,progress);assert.equal(t.progress,progress);
 }
 assert.equal(advanceTurtle(trip,-1).position,0);
 assert.equal(advanceTurtle(trip,2).position,1);
});
