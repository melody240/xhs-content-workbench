import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {ResearchAgent} from '../integrations/agent.mjs';
import {ContentWorkflow,preparedDraft} from '../integrations/content-workflow.mjs';
import {normalizeContentPlan} from '../integrations/content-guidance.mjs';
async function fixture(t,{collect,complete,connected=true}={}){
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'content-flow-'));t.after(()=>fs.rm(data,{recursive:true,force:true}));const requests=[];
 const output={title:'别为合群勉强自己',content:'不想参加的聚会，可以直接说不。你可以照顾朋友的感受，也不用每次都答应。',sourceIds:['S1'],commentIds:[],fictionalExperiences:[],tags:['拒绝无效社交','关系边界','女性成长'],materialKeyword:'拒绝聚会'};
 const model={config:{model:'test'},public:()=>({verifiedAt:'yes'}),complete:async messages=>{requests.push(messages);return complete?complete(messages):{content:JSON.stringify(output)};}};
 const skills={status:()=>({connected})},a={id:'A',state:{drafts:[],commentCaptures:[{id:'unrelated',jobId:'j',platform:'抖音',asset:{id:'wrong'}}]},runtime:{}};
 const agent=new ResearchAgent({data,model,skills,runScope:(_,fn)=>fn(),collectComments:collect||(async(a,j,o)=>{assert.equal(o.selection.topicId,'T1');assert.equal(o.selection.keyword,'拒绝聚会');assert.equal(o.selection.title,output.title);assert.equal(o.selection.content,output.content);a.state.commentCaptures.push({id:'accepted',jobId:'j',asset:{id:'right'}});return {captureIds:['accepted'],errors:[]};})});await agent.init();
 const topic={id:'T1',title:'不想参加的聚会可以拒绝',angle:'不以勉强自己来换合群',sourceIds:['S1'],commentIds:[],evidenceMode:'body'};
 agent.jobs=[{id:'j',accountId:'A',kind:'topics',status:'completed',topic:'女性成长',audience:'20～35岁女性',events:[],sources:[{id:'S1',feedId:'1',title:'关系选择',body:'一次关系中的取舍与拒绝',comments:[],detail:true},{id:'S2',feedId:'2',title:'理财',body:'另一选题的笔记',comments:[],detail:true}],topics:[topic,{...topic,id:'T2',title:'存款',sourceIds:['S2']}]}];
 const flow=new ContentWorkflow({agent,model,skills,previousDrafts:()=>a.state.drafts,saveDraft:async(a,input)=>preparedDraft(a,input)});
 return {a,agent,flow,topic,requests,output};
}
test('A selected topic completes prose, tags, specific materials and an account-local draft without publishing',async t=>{
 const {a,agent,flow,topic,requests}=await fixture(t);const state=await flow.start(a,{jobId:'j',topicId:'T1'});await flow.running;
 assert.equal(state.status,'completed');assert.equal(state.stage,3);assert.equal(a.state.drafts.length,1);const draft=a.state.drafts[0];assert.equal(draft.title,topic.article.title);assert.match(draft.tags,/拒绝无效社交/);assert.deepEqual(draft.assets,[{id:'right'}]);assert.equal(draft.researchTopicId,'T1');assert.equal(draft.accountId,'A');assert.deepEqual(state.captureIds,['accepted']);assert.equal(agent.active,null);assert.equal(requests.length,1);assert.doesNotMatch(requests[0][1].content,/另一选题的笔记/);assert.equal(topic.article.allowFictionalExperience,false);
 const again=await flow.start(a,{jobId:'j',topicId:'T1'});assert.equal(again.draftId,draft.id);assert.equal(requests.length,1);assert.equal(a.state.drafts.length,1);
 await assert.rejects(flow.start({...a,id:'B'},{jobId:'j',topicId:'T1'}),/找不到/);
});
test('In-flight duplicate requests share one preparation, stop retains the topic and can resume generated prose',async t=>{
 let enter,release;const entered=new Promise(r=>enter=r);
 const f=await fixture(t,{collect:async(a,j,o)=>{enter();await new Promise(r=>release=r);o.signal.throwIfAborted();return {captureIds:[],errors:[]};}});
 const state=await f.flow.start(f.a,{jobId:'j',topicId:'T1'});await entered;
 assert.equal((await f.flow.start(f.a,{jobId:'j',topicId:'T1'})).id,state.id);await assert.rejects(f.flow.start(f.a,{jobId:'j',topicId:'T2'}),/当前任务/);
 await f.flow.stop(f.a,{jobId:'j',topicId:'T1'});release();await f.flow.running;assert.equal(state.status,'stopped');assert.ok(f.topic.article);assert.equal(f.a.state.drafts.length,0);assert.equal(f.agent.jobs[0].status,'completed');assert.equal(f.agent.active,null);
 f.agent.collectComments=async()=>({captureIds:[],errors:[{message:'页面需要验证'}]});const calls=f.requests.length;const resumed=await f.flow.start(f.a,{jobId:'j',topicId:'T1'});await f.flow.running;assert.equal(resumed.status,'partial');assert.equal(f.requests.length,calls);assert.ok(resumed.draftId);assert.deepEqual(f.a.state.drafts[0].assets,[]);assert.match(resumed.warnings.join(' '),/验证/);
});
test('Offline materials never block saving prose and tags, and retry cannot overwrite a manually edited draft',async t=>{
 const {a,flow,topic}=await fixture(t,{connected:false});await flow.start(a,{jobId:'j',topicId:'T1'});await flow.running;assert.equal(topic.preparation.status,'partial');assert.equal(a.state.drafts[0].assets.length,0);assert.match(a.state.drafts[0].tags,/关系边界/);
 const first=a.state.drafts[0];first.title='用户自己改的标题';first.updatedAt='manual-revision';
 await flow.start(a,{jobId:'j',topicId:'T1',retry:true});await flow.running;assert.equal(a.state.drafts.length,2);assert.equal(first.title,'用户自己改的标题');assert.notEqual(topic.preparation.draftId,first.id);
});
test('A restart marks an unfinished preparation interrupted without invalidating the completed research',async t=>{
 const f=await fixture(t);f.topic.preparation={status:'running',stage:2};await f.agent.save();const loaded=new ResearchAgent({data:path.dirname(f.agent.file),model:f.agent.model,skills:{}});await loaded.init();assert.equal(loaded.jobs[0].status,'completed');assert.equal(loaded.jobs[0].topics[0].preparation.status,'interrupted');assert.match(loaded.jobs[0].topics[0].preparation.error,/重启/);
});
test('Publishing plan removes duplicate, malformed or oversized topics',()=>{
 assert.deepEqual(normalizeContentPlan({tags:['#关系边界','关系边界','错误，标签','https://evil','太'.repeat(21),'拒绝聚会'],materialKeyword:'拒绝聚会'}),{tags:['关系边界','拒绝聚会'],materialKeyword:'拒绝聚会'});
});

test('A partial material retry retains accepted images and the completed plan when the browser later disconnects',async t=>{
 const f=await fixture(t);await f.flow.start(f.a,{jobId:'j',topicId:'T1'});await f.flow.running;const draftId=f.topic.preparation.draftId;
 f.flow.skills.status=()=>({connected:false});delete f.topic.article.tags;delete f.topic.article.materialKeyword;const calls=f.requests.length;
 await f.flow.start(f.a,{jobId:'j',topicId:'T1',retry:true});await f.flow.running;assert.equal(f.requests.length,calls);assert.equal(f.a.state.drafts[0].id,draftId);assert.deepEqual(f.a.state.drafts[0].assets,[{id:'right'}]);assert.equal(f.topic.preparation.status,'partial');
});

test('A matching failure saves the draft with a recovery warning instead of claiming no relevant comments',async t=>{
 const f=await fixture(t,{collect:async()=>({captureIds:[],errors:[{stage:'matching',message:'本篇评论匹配未完成，请重试本篇素材。'}]})});
 await f.flow.start(f.a,{jobId:'j',topicId:'T1'});await f.flow.running;
 assert.equal(f.topic.preparation.status,'partial');assert.ok(f.topic.preparation.draftId);
 assert.deepEqual(f.a.state.drafts[0].preparation.warnings,['本篇评论匹配未完成，请重试本篇素材。']);
});
