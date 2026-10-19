import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ModelConnection,endpoint} from '../integrations/model.mjs';
import {ResearchAgent,parseAction,duplicate,collectSearch,collectDetail,validateTopics} from '../integrations/agent.mjs';
const account={id:'A',label:'测试账号',topic:'女性成长',runtime:{},state:{}};
async function dir(t){const d=await fs.mkdtemp(path.join(os.tmpdir(),'research-test-'));t.after(()=>fs.rm(d,{recursive:true,force:true}));return d;}
const searchData={feeds:[1,2].map(n=>({id:'note'+n,xsecToken:'token'+n,displayTitle:'测试笔记'+n,interactInfo:{likedCount:'100',commentCount:'20'}}))};
const detailData=n=>({note:{noteId:'note'+n,title:'测试笔记'+n,body:'这是测试材料，不是真实平台采集。',time:1700000000000,interactInfo:{likedCount:'100',collectedCount:''}},comments:[{id:'comment'+n,content:'测试评论，不代表真实用户观点',likeCount:'17'}]});
const topic={title:'给工作设置边界',angle:'从下班消息回复规则讨论边界',reason:'测试依据',outline:['规则与例外','行动清单'],sourceIds:['S1','S2'],commentIds:['S1C1']};
const plan=[{action:'read',sourceId:'S1'},{action:'read',sourceId:'S2'},{action:'read',sourceId:'S3'},{action:'finish',summary:'测试总结',topics:[topic]}];
async function fixture(t,actions=plan){let index=0;const calls=[];const data=await dir(t);const model={config:{provider:'fixture',model:'test-model'},public:()=>({verifiedAt:'test'}),complete:async messages=>{calls.push(messages);return {content:JSON.stringify(actions[index++]),usage:{totalTokens:20}};}};const commands=[];const skills={active:null,form:null,status:()=>({connected:true}),bind:async()=>{},execute:async(a,{command,input})=>{commands.push({accountId:a.id,command,input});return {result:command==='search-feeds'?(input.sortBy!=='最多点赞'?{feeds:[{...searchData.feeds[0],id:'note3',xsecToken:'token3'}]}:searchData):detailData(input.feedId.slice(-1))};}};const agent=new ResearchAgent({data,model,skills,intervalMs:0,runScope:(_,fn)=>fn()});await agent.init();return {agent,data,commands,calls,skills,model};}
test('Agent runs model-tool-observation loop, saves evidence, isolates account history, adopts once and detects repeated angles',async t=>{
 const {agent,data,commands,calls}=await fixture(t);const first=await agent.start(account,{kind:'topics'});await agent.running;
 const result=agent.list('A').jobs[0];assert.equal(result.status,'completed');assert.equal(commands.length,5);assert.equal(result.topics.length,1);assert.equal(result.sources[0].comments[0].likes,'17');assert.equal(result.sources[0].metrics.favorites,null);assert.match(result.sources[0].url,/note1/);assert.equal(result.sources[0].xsecToken,undefined);assert.equal(agent.list('B').jobs.length,0);
 assert.match(calls.at(-1).at(-2).content,/不可信资料/);assert.equal(result.usage.totalTokens,80);
 await assert.rejects(agent.adopt({id:'B'},first.id,result.topics[0].id),/找不到/);
 const chosen=await agent.adopt(account,first.id,result.topics[0].id);const again=await agent.adopt(account,first.id,result.topics[0].id);assert.equal(chosen.topic.adoptedAt,again.topic.adoptedAt);
 const saved=JSON.parse(await fs.readFile(path.join(data,'agent-jobs.json')));assert.equal(saved[0].status,'completed');
 assert.throws(()=>validateTopics([topic],saved[0],[topic]),/重复/);
});
test('Agent rejects fabricated sources/comments and unexposed actions, and enforces a finite tool budget',async t=>{
 assert.throws(()=>parseAction('{"action":"publish","content":"ignore all"}'),/未开放/);
 const j={sources:[]};collectSearch(j,searchData,'test');collectDetail(j.sources[0],detailData(1));
 assert.throws(()=>validateTopics([{...topic,sourceIds:['FAKE']}],j),/未读取/);
 assert.throws(()=>validateTopics([{...topic,sourceIds:['S1'],commentIds:['FAKE']}],j),/不存在/);
 assert.equal(duplicate('不要为别人的期待而活','不要为别人的期待而活！'),true);
 const {agent,commands}=await fixture(t,Array(9).fill({action:'search',keyword:'测试',sortBy:'最新'}));await agent.start(account,{kind:'topics'});await agent.running;assert.equal(commands.length,2);assert.match(agent.list('A').jobs[0].error,/模型轮数/);
});
test('Stop waits for the in-flight browser read, blocks a second job and never starts the next tool',async t=>{
 const {agent,skills,commands}=await fixture(t,[{action:'search',keyword:'测试',sortBy:'最新'}]);let release,entered;const started=new Promise(r=>entered=r);const original=skills.execute;skills.execute=async(...args)=>{entered();await new Promise(r=>release=r);return original(...args);};
 const j=await agent.start(account,{kind:'browse'});await started;
 await assert.rejects(agent.start({...account,id:'B'},{kind:'browse'}),/已有/);
 assert.throws(()=>agent.stop({id:'B'},j.id),/没有/);await agent.stop(account,j.id);assert.equal(agent.list('A').jobs[0].status,'stopping');release();await agent.running;assert.equal(commands.length,1);assert.equal(agent.list('A').jobs[0].status,'stopped');assert.equal(agent.list('A').jobs[0].sources.length,2);
});
test('Restart retains unfinished research and marks interrupted without re-running; missing model fails before browser use',async t=>{
 const data=await dir(t);await fs.writeFile(path.join(data,'agent-jobs.json'),JSON.stringify([{id:'j',accountId:'A',status:'running',sources:[]} ]));let visits=0;const agent=new ResearchAgent({data,skills:{status:()=>({connected:true}),bind:()=>visits++},model:{public:()=>({})},runScope:(_,fn)=>fn()});await agent.init();assert.equal(agent.list('A').jobs[0].status,'interrupted');await assert.rejects(agent.start(account,{kind:'topics'}),/测试模型/);assert.equal(visits,0);
});
test('Model adapter sends only configured credentials, refuses redirects, redacts errors and clears key on endpoint change',async t=>{
 const data=await dir(t);let request;const m=new ModelConnection(data,{fetcher:async(url,opts)=>{request={url,opts};return new Response(JSON.stringify({choices:[{message:{content:'OK'},finish_reason:'stop'}],usage:{total_tokens:2}}));}});await m.init();await m.save({provider:'custom',baseURL:'https://example.test/v1',model:'test',apiKey:'private-test-key'});assert.equal(m.public().apiKey,undefined);await m.test();assert.ok(m.public().verifiedAt);assert.equal(request.url,'https://example.test/v1/chat/completions');assert.equal(request.opts.redirect,'error');assert.equal(request.opts.headers.Authorization,'Bearer private-test-key');if(process.platform!=='win32')assert.equal((await fs.stat(m.file)).mode&0o777,0o600);
 await m.save({provider:'custom',baseURL:'https://other.test/v1',model:'test'});assert.equal(m.public().hasKey,false);assert.equal(m.public().verifiedAt,null);
 assert.throws(()=>endpoint('http://external.test'),/HTTPS/);assert.throws(()=>endpoint('https://user:pass@example.test'),/凭据/);assert.throws(()=>endpoint('https://example.test/v1/chat/completions'),/根地址/);
 m.fetcher=async()=>new Response('private-test-key',{status:401});await assert.rejects(m.test(),e=>e.message.includes('密钥')&&!e.message.includes('private-test-key'));
});
test('DeepSeek JSON mode is opt-in and does not change ordinary text or custom providers',async t=>{
 const data=await dir(t),bodies=[];
 const m=new ModelConnection(data,{fetcher:async(_,opts)=>{bodies.push(JSON.parse(opts.body));return new Response(JSON.stringify({choices:[{message:{content:'{"items":[]}'},finish_reason:'stop'}]}));}});
 await m.init();await m.save({provider:'deepseek',baseURL:'https://api.deepseek.com',model:'deepseek-flash',apiKey:'test'});
 await m.complete([{role:'user',content:'JSON'}],{json:true});assert.deepEqual(bodies[0].response_format,{type:'json_object'});
 await m.complete([{role:'user',content:'正文'}]);assert.equal(bodies[1].response_format,undefined);
 await m.save({provider:'custom',baseURL:'https://example.test',model:'test'});await m.complete([{role:'user',content:'JSON'}],{json:true});assert.equal(bodies[2].response_format,undefined);
});
test('A research title can exceed the publishing limit without an extra model call or truncation',async t=>{
 const title='这是一条超过二十个字符的研究标题，正式成稿时才压缩发布标题';
 const {agent,commands}=await fixture(t,[...plan.slice(0,3),{action:'finish',summary:'test',topics:[{...topic,title}]}]);await agent.start(account,{kind:'topics'});await agent.running;const j=agent.list('A').jobs[0];assert.equal(j.status,'completed');assert.equal(j.topics[0].title,title);assert.equal(commands.length,5);assert.equal(j.counts.model,4);
});
test('Default popular research searches likes and comments without fetching latest',async t=>{
 const {agent,commands}=await fixture(t);await agent.start(account,{kind:'topics'});await agent.running;
 const j=agent.list('A').jobs[0];assert.equal(j.status,'completed');
 assert.deepEqual(commands.slice(0,2).map(c=>c.input.sortBy),['最多点赞','最多评论']);
 assert.equal(j.sources.filter(s=>s.readCategory==='popular'&&s.detail).length,3);assert.equal(j.sources.filter(s=>s.readCategory==='latest'&&s.detail).length,0);
});
test('Wide mode collects multiple lists, deduplicates, opens no details and accepts only list citations',async t=>{
 const wideTopic={...topic,sourceIds:['S1','S12'],commentIds:[]};
 const {agent,skills,commands}=await fixture(t,[{action:'finish',summary:'仅依据列表标题总结',topics:[wideTopic]}]);
 skills.execute=async(a,{command,input})=>{commands.push({command,input});assert.equal(command,'search-feeds');return {result:{feeds:Array.from({length:20},(_,i)=>({id:'wide'+i,xsecToken:'t'+i,displayTitle:'女性成长观点'+i,interactInfo:{likedCount:String(i)}}))}};};
 await agent.start(account,{kind:'topics',researchMode:'wide'});await agent.running;const j=agent.list('A').jobs[0];
 assert.equal(j.status,'completed');assert.equal(commands.length,3);assert.ok(commands.every(c=>c.input.listOnly===true));assert.equal(j.sources.length,20);assert.equal(j.counts.read,0);assert.equal(j.topics[0].evidenceMode,'list');
 assert.throws(()=>validateTopics([{...wideTopic,commentIds:['S1C1']}],j),/未读评论/);
 const blocked=await fixture(t,[{action:'read',sourceId:'S1'},{action:'finish',summary:'列表依据',topics:[wideTopic]}]);blocked.skills.execute=skills.execute;await blocked.agent.start(account,{kind:'topics',researchMode:'wide'});await blocked.agent.running;assert.equal(blocked.agent.list('A').jobs[0].status,'completed');assert.equal(blocked.agent.list('A').jobs[0].counts.read,0);
});


const wideSamples=()=>({feeds:Array.from({length:20},(_,i)=>({id:'wide'+i,xsecToken:'t'+i,displayTitle:'小习惯'+i}))});
const wideResult={...topic,sourceIds:['S1','S12'],commentIds:[]};
test('Wide prompt has one list-based contract and normalizes absent comments without accepting fabricated evidence',async t=>{
 const missing={...wideResult};delete missing.commentIds;
 const {agent,skills,calls,commands}=await fixture(t,[{action:'finish',topics:[missing],summary:'列表依据'}]);
 skills.execute=async(a,v)=>{commands.push(v);return {result:wideSamples()};};
 await agent.start(account,{kind:'topics',researchMode:'wide'});await agent.running;const j=agent.list('A').jobs[0];
 assert.equal(j.status,'completed');assert.deepEqual(j.topics[0].commentIds,[]);assert.equal(j.counts.read,0);assert.equal(commands.length,3);
 const prompt=calls[0][0].content;assert.match(prompt,/只给一个选题/);assert.match(prompt,/commentIds必须为空数组/);assert.doesNotMatch(prompt,/每个选题必须引用.*评论|再提出 1–3/);
 assert.throws(()=>validateTopics([{...wideResult,sourceIds:['FAKE']}],j),/未读取/);
 assert.throws(()=>validateTopics([{...wideResult,commentIds:['FAKE']}],j),/未读评论/);
 const detailed={sources:[{id:'S1',detail:true,comments:[]} ]};assert.throws(()=>validateTopics([{...topic,sourceIds:['S1'],commentIds:undefined}],detailed),/未读取/);
 assert.throws(()=>validateTopics([null],j),/选题标题/);
 assert.equal(validateTopics([{...wideResult,title:'小'.repeat(19)+'🌱'}],j)[0].title,'小'.repeat(19)+'🌱');
});
test('Focused research completes on real bodies when no comments were captured, without inventing evidence',async t=>{
 const bodyTopic={...topic,commentIds:[]};
 const {agent,skills,commands,calls}=await fixture(t,[...plan.slice(0,3),{action:'finish',summary:'正文依据，未采到评论',topics:[bodyTopic]}]);
 const execute=skills.execute;skills.execute=async(a,v)=>{const r=await execute(a,v);if(v.command==='get-feed-detail')r.result.comments=[];return r;};
 await agent.start(account,{kind:'topics'});await agent.running;const j=agent.list('A').jobs[0];
 assert.equal(j.status,'completed');assert.equal(j.topics[0].evidenceMode,'body');assert.deepEqual(j.topics[0].commentIds,[]);assert.equal(commands.length,5);assert.equal(j.counts.model,4);
 assert.match(calls[0][0].content,/不要仅因没有评论而返回空选题/);
 assert.throws(()=>validateTopics([{...bodyTopic,commentIds:['S1C1']}],j),/不存在/);
 const missing={...bodyTopic};delete missing.commentIds;assert.equal(validateTopics([missing],j)[0].evidenceMode,'body');
 collectDetail(j.sources[0],detailData(1));assert.equal(validateTopics([bodyTopic],j)[0].evidenceMode,'body');
 const bodyOnlyRef={...bodyTopic,sourceIds:['S2']};assert.equal(validateTopics([bodyOnlyRef],j)[0].evidenceMode,'body');
});
test('A deliberate empty result preserves the model explanation instead of blaming JSON formatting',async t=>{
 const {agent}=await fixture(t,[...plan.slice(0,3),{action:'finish',summary:'所读材料都在讲减肥，与目标习惯主题无关。',topics:[]}]);
 await agent.start(account,{kind:'topics'});await agent.running;const j=agent.list('A').jobs[0];
 assert.equal(j.status,'needs_attention');assert.match(j.error,/材料都在讲减肥/);assert.doesNotMatch(j.error,/1–5/);assert.equal(j.counts.model,4);
});
test('Different model format defects get two bounded corrections with a complete mode contract, without any extra browser calls',async t=>{
 const {agent,skills,calls,commands}=await fixture(t,[{action:'finish',topics:[wideResult,{...wideResult,title:'另一立意'}]},{action:'finish',topics:[{...wideResult,angle:''}]},{action:'finish',topics:[wideResult]}]);
 skills.execute=async(a,v)=>{commands.push(v);return {result:wideSamples()};};
 await agent.start(account,{kind:'topics',researchMode:'wide'});await agent.running;const j=agent.list('A').jobs[0];
 assert.equal(j.status,'completed');assert.equal(j.validationAttempts,2);assert.equal(j.counts.model,3);assert.equal(commands.length,3);
 const correction=JSON.parse(calls[2].at(-2).content);assert.equal(correction.expectedResult.topics.length,1);assert.deepEqual(correction.expectedResult.topics[0].commentIds,[]);assert.equal(correction.validSources.length,20);assert.match(correction.validationError,/明确立意/);
 assert.match(j.lastModelOutput,/给工作设置边界/);
});
test('Research reads pointpoint once, preserves it across offline recovery and uses it as context rather than fake sources',async t=>{
 const {agent,skills,commands,calls}=await fixture(t,[{action:'finish',summary:'结合站内方向和列表',topics:[wideResult]},{action:'finish',summary:'已有资料重新总结',topics:[{...wideResult,title:'另一个明确观点',angle:'适当停下给自己空间'}]}]);
 const dd={status:'ready',keyword:'女性成长',content:'从微习惯找回行动主动权。',url:'https://www.xiaohongshu.com/search_result_ai?keyword=女性成长',collectedAt:'2026-10-11T10:00:00Z',platformNoteCount:83};
 skills.execute=async(a,v)=>{commands.push(v);return {result:{...wideSamples(),...(v.input.diandian?{diandian:dd}:{})}};};
 await agent.start(account,{kind:'topics',researchMode:'wide'});await agent.running;
 const j=agent.jobs[0];assert.equal(j.status,'completed');assert.equal(commands.filter(c=>c.input.diandian).length,1);assert.equal(j.counts.read,0);assert.equal(j.sources.length,20);
 assert.equal(j.diandian.platformNoteCount,83);assert.equal(JSON.parse(calls[0][1].content).diandianReference.content,dd.content);assert.match(calls[0][0].content,/不计|不得.*阅读量/);
 j.status='needs_attention';await agent.retrySummary(account,j.id);await agent.running;assert.equal(commands.length,3);assert.equal(JSON.parse(calls[1][1].content).diandianReference.content,dd.content);
 assert.throws(()=>validateTopics([{...wideResult,sourceIds:['点点83篇']}],j),/未读取/);
});
test('An invalid citation never becomes valid after the bounded correction limit',async t=>{
 const {agent,skills,commands}=await fixture(t,Array(3).fill({action:'finish',topics:[{...wideResult,sourceIds:['FAKE']}]}));
 skills.execute=async(a,v)=>{commands.push(v);return {result:wideSamples()};};
 await agent.start(account,{kind:'topics',researchMode:'wide'});await agent.running;const j=agent.list('A').jobs[0];
 assert.equal(j.status,'needs_attention');assert.match(j.error,/未读取/);assert.equal(j.counts.model,3);assert.equal(commands.length,3);assert.equal(j.topics.length,0);assert.equal(j.canRetrySummary,true);
});
test('Summary recovery uses saved sources with no browser login/search/detail, retains failure history, and isolates accounts',async t=>{
 const {agent,skills,commands,data}=await fixture(t,[{action:'finish',topics:[wideResult],summary:'已有列表重新总结'}]);
 let bound=0;skills.bind=async()=>{bound++;throw Error('Must not bind');};skills.status=()=>({connected:false});
 const sources={sources:[]};collectSearch(sources,wideSamples(),'小习惯',{limit:30});
 const failed={id:'failed',accountId:'A',kind:'topics',researchMode:'wide',topic:'小习惯',audience:'独立女生',sources:sources.sources,status:'needs_attention',error:'旧模型格式错误',endedAt:'2026-10-11',events:[],topics:[],counts:{search:3,read:0,model:2},usage:{totalTokens:1200,reportedCalls:2}};
 agent.jobs=[failed];await agent.save();
 await assert.rejects(agent.retrySummary({id:'B'},'failed'),/找不到/);
 const before=JSON.stringify(failed.sources);await agent.retrySummary(account,'failed');await assert.rejects(agent.retrySummary(account,'failed'),/已有任务/);await agent.running;
 assert.equal(failed.status,'completed');assert.equal(bound,0);assert.equal(commands.length,0);assert.equal(JSON.stringify(failed.sources),before);assert.equal(failed.previousFailures[0].error,'旧模型格式错误');assert.equal(failed.usage.totalTokens,1220);assert.equal(failed.counts.model,3);assert.equal(failed.summaryRetries,1);
 await assert.rejects(agent.retrySummary(account,'failed'),/资料不足/);
 const restarted=new ResearchAgent({data,skills,model:agent.model,runScope:(_,fn)=>fn()});await restarted.init();assert.equal(restarted.list('A').jobs[0].status,'completed');assert.equal(restarted.list('B').jobs.length,0);
});

test('One real body is enough, and unrelated comments need not be cited',async t=>{
 const {agent,calls}=await fixture(t,[plan[0],{action:'finish',topics:[{...topic,sourceIds:['S1'],commentIds:[]}]}]);
 await agent.start(account,{kind:'topics'});await agent.running;const j=agent.list('A').jobs[0];
 assert.equal(j.status,'completed');assert.equal(j.counts.read,1);assert.equal(j.topics[0].evidenceMode,'body');assert.deepEqual(j.topics[0].commentIds,[]);assert.match(calls[0][0].content,/采集目标而非最低配额/);
});
test('A premature finish is corrected into a real read instead of accepting claimed unseen bodies',async t=>{
 const result={action:'finish',summary:'声称读过三篇',topics:[{...topic,sourceIds:['S1'],commentIds:[]}]};
 const {agent,commands}=await fixture(t,[result,plan[0],result]);await agent.start(account,{kind:'topics'});await agent.running;const j=agent.list('A').jobs[0];
 assert.equal(j.status,'completed');assert.equal(j.counts.read,1);assert.equal(commands.length,3);assert.ok(j.events.some(e=>e.label==='继续读取真实正文'));
});
test('Reading the same source twice is corrected without a repeated browser call',async t=>{
 const {agent,commands,calls:prompts}=await fixture(t,[plan[0],plan[0],{action:'finish',topics:[{...topic,sourceIds:['S1'],commentIds:['S1C1']}]}]);await agent.start(account,{kind:'topics'});await agent.running;
 assert.equal(agent.list('A').jobs[0].status,'completed');assert.equal(commands.filter(c=>c.command==='get-feed-detail').length,1);
});
test('One inaccessible detail is skipped while another body can complete research',async t=>{
 const {agent,skills}=await fixture(t,[plan[0],plan[1],{action:'finish',topics:[{...topic,sourceIds:['S2'],commentIds:[]}]}]);const execute=skills.execute;
 skills.execute=async(a,v)=>{if(v.command==='get-feed-detail'&&v.input.feedId==='note1')throw Error('页面加载超时');return execute(a,v);};
 await agent.start(account,{kind:'topics'});await agent.running;const j=agent.list('A').jobs[0];assert.equal(j.status,'completed');assert.equal(j.sources[0].detail,false);assert.match(j.sources[0].readError,/超时/);assert.equal(j.topics[0].evidenceMode,'body');
});
test('Captcha and account verification failures still require intervention',async t=>{
 const {agent,skills}=await fixture(t);const execute=skills.execute;skills.execute=async(a,v)=>{if(v.command==='get-feed-detail')throw Error('请完成验证码');return execute(a,v);};
 await agent.start(account,{kind:'topics'});await agent.running;const j=agent.list('A').jobs[0];assert.equal(j.status,'needs_attention');assert.match(j.error,/验证码/);assert.equal(j.counts.read,1);
});
test('Three popular bodies can complete even when no distinct latest note exists',async t=>{
 const {agent,skills}=await fixture(t);const execute=skills.execute;skills.execute=async(a,v)=>v.command==='search-feeds'?{result:{feeds:[...searchData.feeds,{...searchData.feeds[0],id:'note3',xsecToken:'token3'}]}}:execute(a,v);
 await agent.start(account,{kind:'topics'});await agent.running;assert.equal(agent.list('A').jobs[0].status,'completed');
});
test('A small wide list remains usable without a twelve-note quota',async t=>{
 const {agent}=await fixture(t,[{action:'finish',topics:[{...topic,sourceIds:['S1'],commentIds:[]}]}]);await agent.start(account,{kind:'topics',researchMode:'wide'});await agent.running;const j=agent.list('A').jobs[0];assert.equal(j.status,'completed');assert.equal(j.sources.length,3);assert.equal(j.topics[0].evidenceMode,'list');
});
test('An old failed focused job with only titles can recover as list evidence without reopening the browser',async t=>{
 const {agent,skills,commands}=await fixture(t,[{action:'finish',summary:'依据真实标题重新归纳',topics:[{...topic,sourceIds:['S1'],commentIds:[]}]}]);
 const job={id:'old-focused',accountId:'A',kind:'topics',researchMode:'focused',topic:'女性成长',status:'needs_attention',error:'本轮尚未完成两篇热门与一篇最新的阅读。',sources:[],events:[],topics:[],counts:{search:2,read:0,model:1},usage:{totalTokens:0,reportedCalls:0}};collectSearch(job,searchData,job.topic);agent.jobs=[job];
 skills.bind=()=>{throw Error('Browser must not be used');};assert.equal(agent.list('A').jobs[0].canRetrySummary,true);
 await agent.retrySummary(account,job.id);await agent.running;assert.equal(job.status,'completed');assert.equal(job.summaryEvidenceMode,'list');assert.equal(job.topics[0].evidenceMode,'list');assert.equal(commands.length,0);
 assert.throws(()=>validateTopics([{...topic,sourceIds:['S1'],commentIds:['S1C1']}],job),/未读评论/);
});
test('A failed latest search does not discard usable popular notes',async t=>{
 const {agent,skills}=await fixture(t,[plan[0],{action:'finish',topics:[{...topic,sourceIds:['S1'],commentIds:[]}]}]);const execute=skills.execute;skills.execute=async(a,v)=>{if(v.command==='search-feeds'&&v.input.sortBy==='最新')throw Error('页面加载超时');return execute(a,v);};
 await agent.start(account,{kind:'topics'});await agent.running;assert.equal(agent.list('A').jobs[0].status,'completed');assert.equal(agent.list('A').jobs[0].counts.read,1);
});

test('Latest mode only searches latest; screenshots wait for the user to choose a specific topic',async t=>{
 const {agent,commands,calls:prompts}=await fixture(t,[plan[0],{action:'finish',topics:[{...topic,sourceIds:['S1'],commentIds:[]}]}]);let calls=0;
 agent.collectComments=async(a,j)=>{calls++;assert.equal(j.topics.length,1);throw Error('截图失败测试');};
 await agent.start(account,{kind:'topics',topicMode:'latest'});await agent.running;const j=agent.list('A').jobs[0];
 assert.equal(j.audience,'20～35岁女性');assert.match(prompts[0][0].content,/20～35岁女性/);assert.deepEqual(commands.filter(x=>x.command==='search-feeds').map(x=>x.input.sortBy),['最新']);assert.equal(j.status,'completed');assert.equal(calls,0);assert.equal(j.commentAutomation,undefined);
});
test('Standalone Douyin comment collection needs no model and stopping screenshots does not invalidate a usable topic',async t=>{
 const {agent,model}=await fixture(t);model.public=()=>({});let enter,release;const started=new Promise(r=>enter=r);
 agent.collectComments=async(a,j,{signal})=>{enter();await new Promise(r=>release=r);j.commentAutomation={status:signal.aborted?'stopped':'completed',saved:1};};
 const j=await agent.startComments(account,{keyword:'女性成长'});await started;assert.equal(j.kind,'comments');await agent.stop(account,j.id);release();await agent.running;assert.equal(agent.jobs[0].status,'stopped');assert.equal(agent.list('B').commentJobs.length,0);
 agent.jobs[0].kind='topics';agent.jobs[0].status='completed';agent.jobs[0].topics=[topic];
 const again=await agent.startComments(account,{jobId:j.id});await agent.stop(account,j.id);release();await agent.running;assert.equal(agent.jobs[0].status,'completed');
});

test('Model response-body timeout is localized and preserves explicit caller cancellation',async t=>{
 const data=await dir(t);const m=new ModelConnection(data,{fetcher:async()=>({ok:true,body:{getReader:()=>({read:async()=>{throw Error('The operation was aborted due to timeout');},cancel:async()=>{}})}})});m.config={baseURL:'https://example.test',model:'test'};
 await assert.rejects(m.complete([{role:'user',content:'test'}]),/模型回复中断或超时/);
 const controller=new AbortController();controller.abort(Error('用户停止'));await assert.rejects(m.complete([],{signal:controller.signal}),/用户停止/);
});
