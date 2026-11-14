/** Short, low-pressure encouragement shown in the left card under notes. */
export const TURTLE_WORDS = Object.freeze([
  '慢慢来，比较快；今天先做一小步。',
  '写下一行，就已经比昨天多走了一点。',
  '不会的题不是敌人，是今天要认识的新朋友。',
  '累了就休息一下，休息也是计划的一部分。',
  '你的努力不用一次被看见，它会慢慢长出来。',
  '专注十分钟，也比担心一小时更有用。',
  '今天完成一点点，明天就轻一点点。',
  '错题是在提醒你：这里可以变得更厉害。',
  '先开始，再慢慢做好；开始最难。',
  '乌龟不着急，但它一直在向前。',
  '把大任务切成小块，一口一口就吃完了。',
  '你不是在赶路，你是在长本事。',
  '今天的认真，会变成以后的底气。',
  '遇到卡住的地方，先做个记号，回头再来。',
  '一次只做一件事，心就会安静下来。',
  '做完了可以开心，没做完也可以休息。',
  '进步不一定很明显，但一定在发生。',
  '先照顾好自己的身体，再去照顾成绩。',
  '你已经坚持到这里了，再往前一点点。',
  '不会就问，问会了就是自己的。',
  '今天也给自己留一点玩的时间。',
  '计划可以调整，方向不用慌。',
  '每天进步一小格，一年就是一大步。',
  '小皮在这里，陪你把这页写完。',
]);

/** Pick a random line, never repeating the one already on screen. */
export function pickTurtleWord(previous = '', random = Math.random) {
  if (!TURTLE_WORDS.length) return '';
  let index = Math.min(TURTLE_WORDS.length - 1, Math.floor(random() * TURTLE_WORDS.length));
  if (TURTLE_WORDS.length > 1 && TURTLE_WORDS[index] === previous) index = (index + 1) % TURTLE_WORDS.length;
  return TURTLE_WORDS[index];
}
