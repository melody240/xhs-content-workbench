export const WORD_COUNT_PRESETS = [30, 50, 80, 100, 200, 350, 500, 700, 900];
export const DEFAULT_WORD_COUNT = 350;
export const MIN_WORD_COUNT = 1;
export const MAX_WORD_COUNT = 900;
export const WRITING_PROMPT_VERSION = '2026-10-15-v5';
// Normalized punctuation and typos from the user's supplied writing instructions.
export const PERSONAL_WRITING_PROMPT = `请在保证事实准确的前提下重写全文：
1. 加入适量情绪，例如轻微的犹豫、自我修正、吐槽、有趣的梗以及感叹。
2. 允许出现适度鲜明的个人语气，表达自然流畅。用带感的评价词和略偏主观的判断，取代过于中立、机械的说明，但需避免攻击性、极端或失真的表达。`;
export const countWords = value => Array.from(String(value ?? '').replace(/\s/gu, '')).length;
export function resolveWritingOptions({wordCount = DEFAULT_WORD_COUNT, allowFictionalExperience = true} = {}) {
  if (!Number.isInteger(wordCount) || wordCount < MIN_WORD_COUNT || wordCount > MAX_WORD_COUNT)
    throw Object.assign(new Error(`正文目标字数请填写 ${MIN_WORD_COUNT}–${MAX_WORD_COUNT} 之间的整数。`), {status:422});
  if (typeof allowFictionalExperience !== 'boolean')
    throw Object.assign(new Error('生活化经历选项无效，请重新选择。'), {status:422});
  return {wordCount, allowFictionalExperience};
}
