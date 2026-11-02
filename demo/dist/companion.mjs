/** Resolve only trusted built-in assets; older settings retain the original turtle. */
export const normalizeCompanion = value => value === 'solid' ? 'solid' : 'original';
export function companionAsset(style, asset, animated = true) {
  const solid = normalizeCompanion(style) === 'solid';
  if (!animated) return solid ? './assets/motion-solid/still.png' : './assets/turtle-mascot.png';
  const allowed = ['ready', 'waiting', 'rest', 'happy-jump', 'walking-left', 'walking-right'];
  return `./assets/${solid ? 'motion-solid' : 'motion-original-v2'}/${allowed.includes(asset) ? asset : 'ready'}.webp`;
}

// Alpha bounds cover every animation frame. Align the visible figure rather
// than the transparent canvas; keep the original artwork's size unchanged.
const originalFrames = {
  ready:[50,32,341,329],waiting:[46,41,341,329],rest:[65,39,341,344],
  'walking-left':[50,61,345,344],'walking-right':[31,61,334,345],'happy-jump':[114,14,271,360],
};
const solidFrames = {
  ready:[69,95,313,334],waiting:[66,102,313,334],rest:[64,116,313,334],
  'walking-left':[68,100,319,334],'walking-right':[65,101,317,334],'happy-jump':[84,49,303,307],
};
const originalStill=[27/1254,52/1254,1243/1254,1];
const unit=bounds=>bounds.map(value=>value/384);

export function companionFraming(style,asset='ready',{animated=true,preview=false}={}) {
  if(normalizeCompanion(style)!=='solid')return {scale:1,x:0,y:0};
  const key=Object.hasOwn(originalFrames,asset)?asset:'ready';
  const target=preview||!animated?originalStill:unit(originalFrames[key]);
  const source=unit(animated?solidFrames[key]:[71,104,313,334]);
  const span=b=>Math.max(b[2]-b[0],b[3]-b[1]);
  const scale=span(target)/span(source);
  return {
    scale,
    x:((target[0]+target[2])/2-.5-scale*((source[0]+source[2])/2-.5))*100,
    y:((target[1]+target[3])/2-.5-scale*((source[1]+source[3])/2-.5))*100,
  };
}
