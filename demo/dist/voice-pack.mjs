export const TURTLE_LINES = Object.freeze(Object.fromEntries(Object.entries({
  start: '小皮开工了！先做一道，进入状态就容易啦。',
  'break-start': '休息五分钟，伸个懒腰吧。',
  'break-end': '休息好啦，我们接着来。',
  complete: '搞定一项！耶，又向前一步！',
  end: '这段时间到啦，看看完成得怎么样。',
  'ending-soon': '还有五分钟，准备慢慢收尾啦。',
  'schedule-start': '计划的时间到啦，准备好就开始吧。',
}).map(([event, text]) => [event, Object.freeze({
  text,
  src: `./assets/voice-pack-v1/${event}.mp3`,
})])));

/** Keep recordings, character clips and browser speech from overlapping. */
export function createVoicePlayer({
  makeAudio = src => new Audio(src),
  cancelSpeech = () => globalThis.speechSynthesis?.cancel(),
  onBlocked = () => {},
} = {}) {
  let audio = null;
  let active = false;
  let generation = 0;

  function release() {
    if (!audio || !active) return;
    active = false;
    audio.pause();
    // Seeking an audio element before its metadata loads can throw in Safari.
    try { audio.currentTime = 0; } catch {}
  }

  function stop() {
    generation++;
    release();
    cancelSpeech();
  }

  async function play(src) {
    stop();
    const request = generation;
    try {
      // Keep one media element so iPad can reuse the element unlocked by a tap.
      if (!audio) audio = makeAudio(src);
      else audio.src = src;
      active = true;
      // Call play before yielding so a tap's iPad audio permission is retained.
      await audio.play();
      return request === generation && active;
    } catch (error) {
      // A paused/replaced element may reject later; it must not affect its successor.
      if (request !== generation) return false;
      release();
      onBlocked(error);
      return false;
    }
  }

  return { play, stop };
}
