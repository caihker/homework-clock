import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { companionAsset, companionFraming, normalizeCompanion } from '../dist/companion.mjs';

test('older and unrecognized settings keep the original companion', () => {
  for (const value of [undefined, null, 'unknown', '../other']) assert.equal(normalizeCompanion(value), 'original');
  assert.equal(normalizeCompanion('solid'), 'solid');
});

test('visible 3D bounds match the original animation size and center without clipping',()=>{
  const bounds={
    ready:[[50,32,341,329],[69,95,313,334]],waiting:[[46,41,341,329],[66,102,313,334]],
    rest:[[65,39,341,344],[64,116,313,334]],'walking-left':[[50,61,345,344],[68,100,319,334]],
    'walking-right':[[31,61,334,345],[65,101,317,334]],'happy-jump':[[114,14,271,360],[84,49,303,307]],
  };
  for(const [asset,[target,source]] of Object.entries(bounds)){
    const f=companionFraming('solid',asset),span=b=>Math.max(b[2]-b[0],b[3]-b[1]);
    assert.ok(Math.abs(f.scale*span(source)-span(target))<.00001,asset);
    for(const axis of [0,1]){
      const shift=(axis?f.y:f.x)/100*384;
      const center=192+shift+f.scale*((source[axis]+source[axis+2])/2-192);
      assert.ok(Math.abs(center-(target[axis]+target[axis+2])/2)<.00001,asset);
      assert.ok(192+shift+f.scale*(source[axis]-192)>=0,asset);
      assert.ok(192+shift+f.scale*(source[axis+2]-192)<=384,asset);
    }
    assert.deepEqual(companionFraming('original',asset),{scale:1,x:0,y:0});
  }
});

test('choice previews and reduced-motion stills match the original still footprint',()=>{
  const preview=companionFraming('solid','ready',{preview:true});
  const still=companionFraming('solid','walking-left',{animated:false});
  const target=1216/1254;
  assert.ok(Math.abs(preview.scale*244/384-target)<.00001);
  assert.ok(Math.abs(still.scale*242/384-target)<.00001);
  assert.deepEqual(companionFraming('unknown'),{scale:1,x:0,y:0});
  assert.deepEqual(companionFraming('solid','unknown'),companionFraming('solid','ready'));
});
test('both companions have all task states and directional assets', async () => {
  for (const style of ['original', 'solid']) {
    for (const mood of ['ready', 'waiting', 'rest', 'happy-jump', 'walking-left', 'walking-right']) {
      const asset = companionAsset(style, mood);
      await access(new URL('../dist/' + asset, import.meta.url));
    }
    await access(new URL('../dist/' + companionAsset(style, 'walking-left', false), import.meta.url));
  }
  assert.match(companionAsset('solid', 'walking-right'), /motion-solid\/walking-right.webp$/);
  assert.match(companionAsset('solid', 'ready', false), /still.png$/);
});
