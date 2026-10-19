import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {checkArticle,writeArticle} from '../integrations/writer.mjs';
import {ResearchAgent} from '../integrations/agent.mjs';
import {resolveWritingOptions, countWords, PERSONAL_WRITING_PROMPT, WRITING_PROMPT_VERSION} from '../public/writing-options.js';
const sources=[{id:'S1',body:'这是一条原始资料，不能冒充本人的生活经历。',comments:[{id:'S1C1',content:'关系应该是自己的选择',likes:'2'}]}];
const topic={id:'t',title:'别替别人完成人生任务',angle:'面对催婚保留决定权',outline:['表达主张'],sourceIds:['S1'],commentIds:['S1C1']};
const article={title:'别拿结婚交作业',content:'被催促时，你可以先把自己的打算说清楚。'.repeat(14),sourceIds:['S1'],commentIds:['S1C1'],fictionalExperiences:[],editorNotes:[]};
test('Writing uses two bounded model passes with evidence and feedback; returns prose, not outline',async()=>{
 const calls=[];const model={config:{model:'test'},complete:async(messages)=>{calls.push(structuredClone(messages));return {content:JSON.stringify(calls.length===1?{...article,title:'过长标题'.repeat(8)}:article),usage:{totalTokens:10}};}};
 const result=await writeArticle({model,topic,sources,theme:'女性成长',feedback:'开头更直接',wordCount:250,allowFictionalExperience:false});
 assert.equal(calls.length,2);assert.match(calls[0][1].content,/开头更直接/);assert.equal(JSON.parse(calls[0][1].content).topic.outline,undefined);assert.equal(JSON.parse(calls[1].at(-1).content).userWritingRequest,'开头更直接');assert.match(calls[0][1].content,/关系应该是自己的选择/);assert.match(calls[1].at(-1).content,/标题必须/);assert.equal(result.content,article.content);assert.equal(result.usage.totalTokens,20);assert.notEqual(result.content,topic.outline.join('\n\n'));
 assert.ok(calls[0][0].content.includes(PERSONAL_WRITING_PROMPT));assert.equal(JSON.parse(calls[1].at(-1).content).authorVoice,PERSONAL_WRITING_PROMPT);
 assert.equal(JSON.parse(calls[0][1].content).audience,'20～35岁女性');assert.match(calls[0][0].content,/不装长辈训话/);assert.equal(JSON.parse(calls[0][1].content).writingOptions.wordCount,250);assert.equal(JSON.parse(calls[1].at(-1).content).writingOptions.allowFictionalExperience,false);
 assert.equal(result.wordCount,250);assert.equal(result.actualWordCount,266);assert.equal(result.promptVersion,WRITING_PROMPT_VERSION);
});
test('Word counts use visible Unicode characters, accept custom targets and reject invalid options before model calls',async()=>{
 assert.equal(countWords(' 你好，\n我🙂 '),5);
 assert.deepEqual(resolveWritingOptions({wordCount:900}),{wordCount:900,allowFictionalExperience:true});
 assert.equal(resolveWritingOptions({wordCount:420}).wordCount,420);assert.equal(resolveWritingOptions({wordCount:420}).minWords,undefined);
 let calls=0;const model={config:{},complete:async()=>{calls++;}};
 for(const wordCount of [1,20,50,99])assert.equal(resolveWritingOptions({wordCount}).wordCount,wordCount);
 for(const wordCount of [0,-1,901,250.5,'250',null,NaN])await assert.rejects(writeArticle({model,topic,sources,wordCount}),/整数/);
 await assert.rejects(writeArticle({model,topic,sources,allowFictionalExperience:'yes'}),/经历选项/);assert.equal(calls,0);
 const options=resolveWritingOptions({wordCount:250});
 assert.deepEqual(checkArticle(article,sources,[],options),[]);
 assert.deepEqual(checkArticle(article,sources,[],resolveWritingOptions({wordCount:700})),[]);
 assert.ok(checkArticle({...article,content:3},sources,[],options).length);
});
test('Target length is prompt guidance, never causes a third model call or rejects usable prose',async()=>{
 let calls=0;const model={config:{model:'mock'},complete:async()=>{calls++;return {content:JSON.stringify(article)};}};
 const result=await writeArticle({model,topic,sources,wordCount:700});assert.equal(calls,2);assert.equal(result.wordCount,700);assert.equal(result.actualWordCount,266);
 model.complete=async()=>{calls++;return {content:JSON.stringify({...article,content:article.content.repeat(5)})};};
 const long=await writeArticle({model,topic,sources,wordCount:100});assert.equal(long.actualWordCount,1330);assert.equal(calls,3);
});
test('Fictional everyday scenes must be identified, short and permitted by this request',()=>{
 const scene='前几天回消息，我打了半屏解释，想想又删掉了。';
 const value={...article,content:scene+article.content,fictionalExperiences:[scene]};
 const options=resolveWritingOptions({wordCount:300});
 assert.deepEqual(checkArticle(value,sources,[],options),[]);
 assert.ok(checkArticle(value,sources,[],{...options,allowFictionalExperience:false}).some(x=>x.includes('不允许编造')));
 assert.ok(checkArticle({...value,fictionalExperiences:['不是正文中的原句']},sources,[],options).some(x=>x.includes('完整')));
 assert.ok(checkArticle({...value,fictionalExperiences:[value.content]},sources,[],options).some(x=>x.includes('20%')));
 assert.ok(checkArticle({...value,fictionalExperiences:undefined},sources,[],options).some(x=>x.includes('fictionalExperiences')));
});
test('A length deviation is accepted and a custom target is persisted with the new version',async t=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'writer-length-'));t.after(()=>fs.rm(data,{recursive:true,force:true}));
 const model={config:{model:'mock'},public:()=>({verifiedAt:'yes'}),complete:async()=>({content:JSON.stringify(article)})};
 const agent=new ResearchAgent({data,model,skills:{},runScope:(_,fn)=>fn()});await agent.init();agent.jobs=[{id:'j',accountId:'a',status:'completed',sources,topics:[{...topic,article:{...article,id:'old'}}]}];
 const offTarget=await agent.write({id:'a'},{jobId:'j',topicId:'t',articleId:'old',wordCount:700});assert.equal(offTarget.actualWordCount,266);assert.equal(agent.writing,null);
 const result=await agent.write({id:'a'},{jobId:'j',topicId:'t',articleId:offTarget.id,wordCount:250,allowFictionalExperience:false});
 const saved=JSON.parse(await fs.readFile(agent.file,'utf8'))[0].topics[0].article;
 assert.equal(saved.id,result.id);assert.equal(saved.wordCount,250);assert.equal(saved.allowFictionalExperience,false);assert.equal(saved.actualWordCount,266);
});
test('Writing rejects fake citations, outline output, source copying and duplicate prose',()=>{
 assert.ok(checkArticle({...article,commentIds:['FAKE']},sources).some(x=>x.includes('真实评论')));
 assert.ok(checkArticle({...article,content:['讨论催婚的问题']},sources).some(x=>x.includes('正文不能为空')));
 assert.ok(checkArticle({...article,content:article.content+'回答的人顺势改写了这些答案。'},sources).some(x=>x.includes('研究旁白')));
 const copied='这一长串句子用于验证来源文本不能被整体挪到正文里充当原创文章';
 assert.ok(checkArticle({...article,content:article.content+copied},[{...sources[0],body:copied}]).some(x=>x.includes('复用')));
 assert.ok(checkArticle(article,sources,[article]).some(x=>x.includes('重复')));
});
test('Failed regeneration preserves old preview, scoped revisions prevent stale writes, concurrent tasks are blocked',async t=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'writer-test-'));t.after(()=>fs.rm(data,{recursive:true,force:true}));
 let release;let entered;const started=new Promise(r=>entered=r);let calls=0;
 const model={config:{model:'mock'},public:()=>({verifiedAt:'yes'}),complete:async()=>{calls++;if(calls===1){entered();await new Promise(r=>release=r);}return {content:JSON.stringify({...article,commentIds:['fake']})};}};
 const agent=new ResearchAgent({data,model,skills:{},runScope:(_,fn)=>fn()});await agent.init();agent.jobs=[{id:'j',accountId:'a',status:'completed',sources,topics:[{...topic,article:{...article,id:'old'}}]}];
 await assert.rejects(agent.write({id:'b'},{jobId:'j',topicId:'t'}),/找不到/);
 await assert.rejects(agent.write({id:'a'},{jobId:'j',topicId:'t',articleId:'stale'}),/版本/);
 const writing=agent.write({id:'a'},{jobId:'j',topicId:'t',articleId:'old'});await started;
 await assert.rejects(agent.write({id:'a'},{jobId:'j',topicId:'t',articleId:'old'}),/已有/);release();
 await assert.rejects(writing,/未通过/);assert.equal(calls,2);assert.equal(agent.jobs[0].topics[0].article.id,'old');assert.equal(agent.writing,null);
});
test('A wide-mode topic can produce original opinion prose without inventing comments or a read body',async()=>{
 const listSources=[{id:'S1',title:'别替别人做决定',comments:[]}];const listTopic={...topic,evidenceMode:'list',commentIds:[]};const output={...article,commentIds:[]};let request;
 const result=await writeArticle({model:{config:{},complete:async messages=>{request??=JSON.parse(messages[1].content);return {content:JSON.stringify(output)};}},topic:listTopic,sources:listSources,wordCount:700});
 assert.equal(result.actualWordCount,266);assert.match(request.evidenceScope,/未读正文或评论/);assert.deepEqual(result.commentIds,[]);
 const options={...resolveWritingOptions(),listOnly:true};assert.ok(checkArticle({...output,commentIds:['fake']},listSources,[],options).some(e=>e.includes('真实评论')));
});
test('A body-based topic can be written with empty comments but cannot use an unread body or fabricated comment',async()=>{
 const bodySources=[{id:'S1',body:'测试正文：习惯从足够小的行动开始，不用每次加量。',comments:[]}];
 const bodyTopic={...topic,evidenceMode:'body',commentIds:[]},output={...article,commentIds:[]};let calls=0,request;
 const model={config:{},complete:async messages=>{calls++;request??=JSON.parse(messages[1].content);return {content:JSON.stringify(output)};}};
 const result=await writeArticle({model,topic:bodyTopic,sources:bodySources,wordCount:250});
 assert.equal(calls,2);assert.deepEqual(result.commentIds,[]);assert.match(request.evidenceScope,/未采到评论/);assert.equal(request.writingOptions.bodyOnly,true);
 await assert.rejects(writeArticle({model,topic:bodyTopic,sources:[{...bodySources[0],body:''}]}),/缺少已读取正文/);assert.equal(calls,2);
 assert.ok(checkArticle({...output,commentIds:['FAKE']},bodySources,[],request.writingOptions).some(e=>e.includes('真实评论')));
});
test('Short copy drops the long outline and old body, uses one valid model pass, and keeps pointpoint as a secondary idea',async()=>{
 const output={...article,content:'别把目标定到让自己害怕。今天先做一点，明天再接着来。'};
 const calls=[];const model={config:{model:'test'},complete:async messages=>{calls.push(structuredClone(messages));return {content:JSON.stringify(output)};}};
 const diandian={kind:'platform_ai_summary',content:'把目标缩小；另外还有游戏、减肥方向。'};
 const result=await writeArticle({model,topic:{...topic,article},sources,diandian,wordCount:30});
 assert.equal(calls.length,1);assert.equal(result.usage.calls,1);assert.ok(result.actualWordCount<40);
 const request=JSON.parse(calls[0][1].content);assert.match(request.writingBrief,/约30字/);assert.match(request.writingBrief,/只写一个鲜明观点/);
 assert.equal(request.topic.outline,undefined);assert.equal(request.previousArticle.content,undefined);assert.equal(request.diandianReference.content,diandian.content);
 assert.match(calls[0][0].content,/不是你实际读过的笔记/);assert.equal(result.diandianReference.kind,'platform_ai_summary');
});
test('Short copy still corrects invalid citations with the same short brief, while retaining old text on failure',async()=>{
 const calls=[];const output={...article,content:'先做一件小事，别把开始变成考试。'};
 const model={config:{},complete:async messages=>{calls.push(structuredClone(messages));return {content:JSON.stringify(calls.length===1?{...output,commentIds:['FAKE']}:output)};}};
 const result=await writeArticle({model,topic,sources,wordCount:50});
 assert.equal(calls.length,2);assert.equal(result.actualWordCount,16);assert.match(JSON.parse(calls[1].at(-1).content).writingBrief,/约50字/);assert.match(calls[1].at(-1).content,/不能.*扩写短文/);
});
