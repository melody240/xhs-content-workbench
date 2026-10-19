// One editorial contract shared by research, prose and material selection.
export const CONTENT_VOICE_VERSION='2026-10-15-plain-v1';
export const PLAIN_CONTENT_BRIEF=`面向20～35岁普通读者，第一遍就能明白。标题直接点明一件生活里的事或一个具体选择，正文只回答标题说的这件事。深刻来自准确说中处境，不来自晦涩术语、抽象名词、翻译腔或玄乎比喻。少用“主体性、叙事、重构、能量、闭环、认知框架”等词堆砌道理；确需使用就用具体做法解释。不要编造热度，不用“几百万人看过”装点标题。
优先写“别为了不扫兴，答应自己不想做的事”这类能看出对象、选择和代价的句子，而不是“重构边界的主体性叙事”。例句仅说明表达方式，禁止照抄。标题、正文、话题和素材只服务于这一个明确意思；不能仅因为都属于女性成长就把别的内容混进来。短句可以有力量，但不是把普通话说成谜语。不教训读者、不装哲学家、不故意攻击人；不把来源翻译里的别扭措辞带入原创正文。`;
export function normalizeContentPlan(value){
 const tags=Array.isArray(value?.tags)?[...new Set(value.tags.filter(v=>typeof v==='string').map(v=>v.trim().replace(/^#+/,'')).filter(v=>v&&[...v].length<=20&&!/[\s,#，]|https?:/i.test(v)))].slice(0,5):[];
 const materialKeyword=typeof value?.materialKeyword==='string'?value.materialKeyword.trim():'';
 return {tags,materialKeyword:materialKeyword.length<=32&&!/[\r\n]/.test(materialKeyword)?materialKeyword:''};
}
