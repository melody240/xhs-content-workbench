import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentUI} from '../public/agent-ui.js';
import {createMaterialsUI} from '../public/materials-ui.js';

const job = (name) => ({id:name, topic:name, kind:'topics', status:'completed', createdAt:'2026-10-10', counts:{model:1}, model:{model:'test'},usage:{reportedCalls:0},events:[],sources:[{id:'s',detail:true,url:'https://www.xiaohongshu.com/explore/test',title:'reference',metrics:{likes:2},comments:[{id:'c',content:'recorded comment',likes:3}]}],topics:[{id:'t',title:'topic '+name,angle:'angle',reason:'reason',outline:[],sourceIds:['s'],commentIds:['c'],article:{id:'article',title:'title '+name,content:'saved complete article '+name}}]});
const response = name => ({jobs:[job(name)],model:{verifiedAt:'2026-10-10',model:'test',presets:{}},browser:true,draftArticleIds:[]});
const comments = {captures:[],drafts:[],captureAvailable:true};
const context = (api, accountId) => ({api,accountId,esc:v=>String(v??''),icon:()=>'',render:()=>{},task:()=>{},go:()=>{},toast:()=>{},isVisible:()=>false});

test('素材页清楚展示来源失败并提供处理入口，不推荐未经核实的博主',async()=>{
 const data={sources:[{name:'失效来源',error:'X 显示这个主页不存在。',id:'s'}],images:[],items:[],settings:{hours:24,enabled:true},browser:{sourceLibrary:true},lastRun:{at:new Date().toISOString(),failed:1}};
 const ui=createMaterialsUI(context(async()=>data,()=> 'a'));await ui.refresh();
 assert.match(ui.page('updates'),/1 个来源需要处理/);assert.match(ui.page('updates'),/失效来源：X 显示这个主页不存在/);assert.match(ui.page('updates'),/管理素材博主/);
 data.sources=[];assert.doesNotMatch(ui.page('updates'),/个来源需要处理/);assert.doesNotMatch(ui.page('sources'),/三娘观市|Sanniang/);assert.match(ui.page('sources'),/每天一次/);
});

test('Content steps expose saved article in writing and actual comments in materials without duplicating both on the topic page', async () => {
  const ui=createAgentUI(context(async url=>url.startsWith('/api/agent')?response('a'):comments,()=> 'a'));
  await ui.refresh();
  assert.match(ui.page('write'),/saved complete article a/);
  assert.match(ui.page('write'),/正文目标字数/);assert.match(ui.page('write'),/自定义字数/);assert.doesNotMatch(ui.page('write'),/内置写作要求|15%|tokens/);assert.match(ui.page('logs'),/内置写作要求/);assert.match(ui.page('research'),/最热选题/);assert.match(ui.page('research'),/最新选题/);assert.doesNotMatch(ui.page('research'),/广撒网/);assert.doesNotMatch(ui.page('research'),/执行记录|tokens|最多搜索/);
  assert.doesNotMatch(ui.page('research'),/saved complete article a/);
  assert.doesNotMatch(ui.page('research'),/comment-materials/);
  assert.match(ui.collectionPage(),/抖音/);assert.match(ui.collectionPage(),/小红书/);assert.doesNotMatch(ui.page('research'),/comment-shot-grid/);assert.match(ui.page('research'),/data-prepare="t"/);assert.doesNotMatch(ui.page('research'),/本轮素材 · 0 张评论截图/);
  assert.doesNotMatch(ui.page('materials'),/saved complete article a/);
});

test('Writing controls send custom length and experience preference, retain edits across refresh and isolate accounts', async t => {
  const previous=globalThis.document;t.after(()=>{globalThis.document=previous;});
  let focused=false;
  const length={value:'custom'},custom={value:'50',reportValidity:()=>true,focus:()=>{focused=true;}},experience={checked:false},button={dataset:{write:'t'}};
  globalThis.document={querySelector:s=>({'#writing-length':length,'#writing-custom-length':custom,'#writing-experience':experience}[s]||null),querySelectorAll:s=>s==='[data-write]'?[button]:[]};
  let account='a',pending;const writes=[];
  const ctx=context(async(url,body)=>{if(url==='/api/agent/write'){writes.push({account,body});return {};}return url.startsWith('/api/agent')?response(account):comments;},()=>account);
  ctx.task=(_,fn)=>pending=fn();
  const ui=createAgentUI(ctx);await ui.refresh();ui.bind();length.onchange();custom.oninput();experience.onchange();
  assert.equal(focused,true);
  await ui.refresh();assert.match(ui.page('write'),/value="50"/);
  button.onclick();await pending;assert.equal(writes[0].body.wordCount,50);assert.equal(writes[0].body.allowFictionalExperience,false);
  custom.value='';custom.oninput();button.onclick();assert.equal(writes.length,1);
  account='b';await ui.refresh();assert.match(ui.page('write'),/value="100" selected/);assert.doesNotMatch(ui.page('write'),/value="50" selected|id="writing-custom-length"/);
  account='a';await ui.refresh();assert.match(ui.page('write'),/id="writing-custom-length"/);assert.match(ui.page('write'),/value="" placeholder="1–900"/);
});

test('Fictional experience disclosure appears before saving and is escaped as text',async()=>{
 const data=response('a');data.jobs[0].topics[0].article.fictionalExperiences=['<script>日常片段</script>'];
 const ctx=context(async url=>url.startsWith('/api/agent')?data:comments,()=> 'a');ctx.esc=v=>String(v??'').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const ui=createAgentUI(ctx);await ui.refresh();const html=ui.page('write');
 assert.match(html,/这段日常经历是虚构的/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.ok(html.indexOf('这段日常经历是虚构的')<html.indexOf('生成整篇笔记'));
});

test('An old account response arriving late never overwrites the current account workspace', async () => {
  let account='a',resolveA;
  const deferred=new Promise(resolve=>resolveA=resolve);
  const ui=createAgentUI(context(async url=>url.startsWith('/api/agent')?(account==='a'?deferred:response('b')):comments,()=>account));
  const first=ui.refresh();
  account='b';
  assert.doesNotMatch(ui.page('write'),/saved complete article a/);
  await ui.refresh();
  resolveA(response('a'));await first;
  assert.match(ui.page('write'),/saved complete article b/);
  assert.doesNotMatch(ui.page('write'),/saved complete article a/);
  assert.equal(ui.summary().browser,true);
});

test('内嵌相册翻页和切换视图保留选择，加入原图路径，切换账号清空选择',async t=>{
 const previous=globalThis.document;t.after(()=>globalThis.document=previous);
 let account='a',pending,renderCount=0,collected=0;const added=[],calls=[];
 const fixtures={a:{images:[{id:'i1',asset:{id:'asset1',url:'/first.png',path:'/first.png'}},{id:'i2',asset:{id:'asset2',url:'/second.png',path:'/second.png'}}]},b:{images:[{id:'j1',asset:{id:'asset3',url:'/other.png',path:'/other.png'}}]}};
 const mode={dataset:{materialView:'album'}},step={dataset:{materialStep:'1'}},pick={dataset:{materialPick:'i1'},checked:true,closest:()=>null},add={dataset:{material:'pick'}};
 globalThis.document={querySelector:()=>null,querySelectorAll:s=>({'[data-material-view]':[mode],'[data-material-step]':[step],'[data-material-pick]':[pick],'[data-material]':[add]}[s]||[])};
 const ctx=context(async(url,body)=>{calls.push({account,url,body});if(url==='/api/materials/pick')return {assets:fixtures[account].images.filter(i=>body.ids.includes(i.id)).map(i=>i.asset)};return fixtures[account];},()=>account);
 ctx.beforeRender=()=>collected++;ctx.render=()=>renderCount++;ctx.useAssets=assets=>added.push(...assets);ctx.task=(_,fn)=>pending=fn();
 const ui=createMaterialsUI(ctx);await ui.refresh();assert.match(ui.picker(),/1 \/ 2/);assert.doesNotMatch(ui.picker(),/\/second.png/);ui.bind();pick.onchange();step.onclick();assert.match(ui.picker(),/2 \/ 2/);mode.onclick();assert.match(ui.picker(),/\/first.png/);assert.match(ui.picker(),/\/second.png/);assert.match(ui.picker(),/data-material-pick="i1" checked/);assert.equal(collected,renderCount);
 add.onclick();await pending;assert.equal(added[0].path,'/first.png');assert.deepEqual(calls.find(c=>c.url==='/api/materials/pick').body.ids,['i1']);
 pick.onchange();account='b';await ui.refresh();assert.match(ui.picker(),/1 \/ 1/);assert.doesNotMatch(ui.picker(),/\/first.png/);assert.match(ui.picker(),/data-material="pick" disabled/);
});


test('Deleting a selected image advances the preview, supports undo and persistent recently deleted, and preserves the composer',async t=>{
 const previous=globalThis.document;t.after(()=>globalThis.document=previous);
 let account='a',pending,collected=0;const data={images:[{id:'i1',asset:{url:'/first.png'}},{id:'i2',asset:{url:'/second.png'}}],deletedImages:[]};
 const pick={dataset:{materialPick:'i1'},checked:true,closest:()=>null},remove={dataset:{materialHide:'i1'}},restore={dataset:{materialRestore:'i1'}},trash={dataset:{material:'deleted'}},mode={dataset:{materialView:'album'}};
 globalThis.document={querySelector:()=>null,querySelectorAll:s=>({'[data-material-pick]':[pick],'[data-material-hide]':[remove],'[data-material-restore]':[restore],'[data-material]':[trash],'[data-material-view]':[mode]}[s]||[])};
 const ctx=context(async(url,body)=>{if(url==='/api/materials/archive-image'){data.deletedImages.push(data.images.shift());return {ok:true};}if(url==='/api/materials/restore-image'){data.images.unshift(data.deletedImages.pop());return {ok:true};}return account==='a'?data:{images:[],deletedImages:[]};},()=>account);
 ctx.task=(_,fn)=>pending=fn();ctx.beforeRender=()=>collected++;
 const ui=createMaterialsUI(ctx);await ui.refresh();ui.bind();pick.onchange();remove.onclick();await pending;
 assert.match(ui.picker(),/data-material="pick" disabled/);assert.match(ui.picker(),/\/second.png/);assert.match(ui.picker(),/撤销删除/);assert.match(ui.picker(),/最近删除（1）/);
 ui.bind();trash.onclick();assert.equal(collected,1);assert.match(ui.picker(),/\/first.png/);assert.doesNotMatch(ui.picker(),/data-material-pick/);assert.match(ui.picker(),/data-material-restore="i1"/);
 restore.onclick();await pending;assert.match(ui.picker(),/最近删除为空/);trash.onclick();assert.match(ui.picker(),/\/first.png/);assert.doesNotMatch(ui.picker(),/撤销删除/);
 mode.onclick();assert.match(ui.picker(),/data-material-hide="i1"/);assert.match(ui.picker(),/data-material-hide="i2"/);
 account='b';await ui.refresh();assert.doesNotMatch(ui.picker(),/最近删除|\/first.png/);
});


test('A failed topic with enough saved evidence offers model-only recovery and passes the selected scoped job',async t=>{
 const previous=globalThis.document;t.after(()=>globalThis.document=previous);
 const data=response('a');const j=data.jobs[0];j.status='needs_attention';j.error='模型没有给出明确立意';j.canRetrySummary=true;j.topics=[];
 const action={dataset:{agent:'retry-summary'}};let pending;const calls=[];
 globalThis.document={querySelector:()=>null,querySelectorAll:s=>s==='[data-agent]'?[action]:[]};
 const ctx=context(async(url,body)=>{calls.push({url,body});if(url==='/api/agent/retry-summary'){j.status='completed';j.error=null;return {id:j.id};}return url.startsWith('/api/agent')?data:comments;},()=> 'a');ctx.task=(_,fn)=>pending=fn();
 const ui=createAgentUI(ctx);await ui.refresh();assert.match(ui.page('research'),/用已有资料重新生成/);assert.match(ui.page('research'),/已采集资料保留/);ui.bind();action.onclick();await pending;
 assert.deepEqual(calls.find(c=>c.url==='/api/agent/retry-summary').body,{id:'a'});assert.doesNotMatch(ui.page('research'),/用已有资料重新生成/);
});

test('博主更新关联真实截图并保持单条阅读，照片预览有明确边界，读取时不允许截图',async t=>{
 const previous=globalThis.document;t.after(()=>globalThis.document=previous);
 const data={sources:[{id:'s',name:'博主'}],images:[{id:'shot',itemId:'1',asset:{url:'/real-shot.png'}}],items:[{id:'1',sourceId:'s',sourceName:'博主',text:'一句观点',hasPhotos:true},{id:'2',sourceId:'s',sourceName:'博主',text:'带照片的原帖',photos:['https://pbs.twimg.com/media/photo.jpg'],captureError:'翻译尚未显示'}],browser:{sourceLibrary:true},active:null};
 let account='a',pending;const nav=[],used=[],focus={dataset:{updateFocus:'2'}};
 const ctx=context(async(url)=>url==='/api/materials/capture'?{id:'newshot'}:data,()=>account);ctx.go=v=>nav.push(v);ctx.task=(_,fn)=>pending=fn();ctx.useAssets=a=>used.push(a);
 globalThis.document={activeElement:null,querySelector:()=>null,querySelectorAll:s=>s==='[data-update-focus]'?[focus]:[]};
 const ui=createMaterialsUI(ctx);await ui.refresh();assert.match(ui.page('updates'),/class="update-screenshot".*\/real-shot.png/);assert.match(ui.page('updates'),/data-update-use="shot"/);
 ui.bind();focus.onclick();let html=ui.page('updates');assert.match(html,/class="update-photos"/);assert.match(html,/aria-label="原帖内容预览"/);assert.match(html,/待截图/);assert.match(html,/<details class="update-details"><summary>截图需要重试/);assert.doesNotMatch(html,/class="update-screenshot"/);
 data.active={sourceName:'博主'};assert.match(ui.page('updates'),/data-material-capture="2" disabled/);
 data.active=null;const capture={dataset:{materialCapture:'2'}};globalThis.document.querySelectorAll=s=>s==='[data-material-capture]'?[capture]:[];ui.bind();capture.onclick();await pending;assert.deepEqual(nav,[]);
 account='b';await ui.refresh();assert.match(ui.page('updates'),/class="update-screenshot"/);
});

test('默认按博主分类，获取按钮只传所选来源，切换后不混入其他博主的帖子',async t=>{
 const previous=globalThis.document;t.after(()=>globalThis.document=previous);let pending;const calls=[];
 const data={sources:[{id:'a1',name:'第一位'},{id:'b1',name:'第二位'}],images:[],items:[{id:'a-post',sourceId:'a1',sourceName:'第一位',text:'第一位的帖子'},{id:'b-post',sourceId:'b1',sourceName:'第二位',text:'第二位的帖子'}],browser:{sourceLibrary:true}};
 const action={dataset:{material:'check'}},filter={value:'b1'};
 globalThis.document={activeElement:null,querySelector:s=>s==='#update-source-filter'?filter:null,querySelectorAll:s=>s==='[data-material]'?[action]:[]};
 const ctx=context(async(url,body)=>{calls.push({url,body});return data;},()=> 'account');ctx.task=(_,fn)=>pending=fn();const ui=createMaterialsUI(ctx);await ui.refresh();
 assert.match(ui.page('updates'),/第一位的帖子/);assert.doesNotMatch(ui.page('updates'),/第二位的帖子/);ui.bind();filter.onchange();assert.match(ui.page('updates'),/第二位的帖子/);assert.doesNotMatch(ui.page('updates'),/第一位的帖子/);
 action.onclick();await pending;assert.deepEqual(calls.find(c=>c.url==='/api/materials/check').body,{sourceId:'b1'});
});

test('Unified picker keeps all saved comments visible regardless of current research and only scopes them when explicitly requested',async t=>{
 const previous=globalThis.document;t.after(()=>globalThis.document=previous);
 const data={assets:[{id:'dy',asset:{id:'dy',url:'/dy.png'},category:'douyin-comments',platform:'抖音',kind:'comment',likes:1809,jobIds:['standalone']},{id:'x',asset:{id:'x',url:'/x.png'},category:'x',jobIds:[]},{id:'xhs',asset:{id:'xhs',url:'/xhs.png'},category:'xhs-comments',jobIds:['research']}],images:[],deletedImages:[],sources:[],items:[]};
 const ctx=context(async()=>data,()=> 'a');ctx.researchJob=()=>({id:'research'});
 const ui=createMaterialsUI(ctx);await ui.refresh();assert.match(ui.picker(),/1 \/ 3/);assert.match(ui.picker(),/\/dy.png/);assert.match(ui.picker(),/点赞 1809/);assert.match(ui.picker(),/全部素材/);
 ui.setFilter({category:'douyin-comments'});assert.match(ui.picker(),/\/dy.png/);assert.match(ui.picker(),/1 \/ 1/);
 ui.setFilter({jobId:'research'});assert.match(ui.picker(),/\/xhs.png/);assert.doesNotMatch(ui.picker(),/\/dy.png/);
 ui.setFilter();assert.match(ui.picker(),/1 \/ 3/);assert.doesNotMatch(ui.picker(),/>放大查看</);assert.match(ui.picker(),/data-collection="collect"/);assert.doesNotMatch(ui.picker(),/>找新素材<|>评论截图</);assert.doesNotMatch(ui.picker(),/data-nav="comments"/);
});

test('XHS collection can choose an older research record without switching the current writing topic',async t=>{
 const previous=globalThis.document;t.after(()=>globalThis.document=previous);
 const data=response('a');data.jobs.push({id:'older',topic:'历史主题',kind:'topics',status:'completed',createdAt:'2026-10-09'});
 let pending,posted;const platform={dataset:{commentPlatform:'小红书'}},source={value:'older'},form={elements:{},oninput:null};
 globalThis.document={querySelector:s=>s==='#comment-research-source'?source:s==='#comments-collect-form'?form:null,querySelectorAll:s=>s==='[data-comment-platform]'?[platform]:[]};
 const ctx=context(async(url,body)=>{if(url==='/api/comments/collect'){posted=body;return {id:'older',kind:'topics'};}return url.startsWith('/api/agent')?data:comments;},()=> 'a');ctx.task=(_,fn)=>pending=fn();
 const ui=createAgentUI(ctx);await ui.refresh();ui.bindCollection();platform.onclick();assert.match(ui.collectionPage(),/历史主题/);source.onchange();form.onsubmit({preventDefault(){}});await pending;
 assert.deepEqual(posted,{platform:'小红书',jobId:'older'});assert.equal(ui.currentJob().id,'a');assert.match(ui.page('write'),/saved complete article a/);
});

test('研究记录默认只展开最近五条，查看全部后才展示更早记录', async()=>{
  const jobs=Array.from({length:7},(_,i)=>job(`record-${i}`));
  jobs.forEach((j,i)=>j.createdAt=`2026-10-${String(13-i).padStart(2,'0')}T10:00:00`);
  const data={jobs,model:{verifiedAt:'2026-10-13',model:'test',presets:{}},browser:true,draftArticleIds:[]};
  const ctx=context(async()=>data,()=> 'a');
  const ui=createAgentUI(ctx);await ui.refresh();
  const first=ui.page('research');
  assert.equal((first.match(/data-research-history=/g)||[]).length,0);
  // Native options retain every record; the shared dropdown limits visible items.
  assert.match(first,/data-dropdown-limit="5"/);
  assert.equal((first.match(/<option value="record-/g)||[]).length,7);
  assert.match(first,/研究记录/);
});

test('Unified X collection never shows or requests a Douyin blogger when getting all X sources',async t=>{
 const previous=globalThis.document;t.after(()=>globalThis.document=previous);let pending;const calls=[];
 const data={sources:[{id:'dy',name:'视频博主',platform:'douyin'},{id:'x',name:'X作者',platform:'x'}],items:[{id:'dypost',sourceId:'dy',platform:'douyin',text:'其他平台的帖子'},{id:'xpost',sourceId:'x',platform:'x',text:'X上的帖子'}],images:[],browser:{sourceLibrary:true}};
 const button={dataset:{material:'check'}};globalThis.document={activeElement:null,querySelector:()=>null,querySelectorAll:s=>s==='[data-material]'?[button]:[]};
 const ctx=context(async(url,body)=>{calls.push({url,body});return data;},()=> 'account');ctx.task=(_,fn)=>pending=fn();const ui=createMaterialsUI(ctx);await ui.refresh();
 const html=ui.page('updates',{platform:'x'});assert.match(html,/X上的帖子/);assert.doesNotMatch(html,/其他平台的帖子|视频博主/);ui.bind();button.onclick();await pending;
 assert.deepEqual(calls.find(c=>c.url==='/api/materials/check').body,{platform:'x'});
});

test('delete acts on the current unselected asset and overlay selection is a sibling of the preview button',async t=>{
 const previous=globalThis.document;t.after(()=>globalThis.document=previous);let pending;const calls=[];
 const data={assets:[{id:'i1',asset:{id:'i1',url:'/first.png'},category:'local'},{id:'i2',asset:{id:'i2',url:'/second.png'},category:'local'}]};
 const button={dataset:{materialHide:'i1'}};globalThis.document={activeElement:null,querySelector:()=>null,querySelectorAll:s=>s==='[data-material-hide]'?[button]:[]};
 const ctx=context(async(url,body)=>{calls.push({url,body});if(url==='/api/materials/archive-image')data.assets[0].archivedAt='deleted';return data;},()=> 'account');ctx.task=(_,fn)=>pending=fn();const ui=createMaterialsUI(ctx);await ui.refresh();assert.match(ui.picker(),/<\/button><label class="material-pick-overlay">/);assert.doesNotMatch(ui.picker(),/checked/);ui.bind();button.onclick();await pending;assert.deepEqual(calls.find(c=>c.url==='/api/materials/archive-image').body,{id:'i1'});assert.match(ui.picker(),/second.png/);
});

test('Selecting one topic starts preparation once and opens only its final draft after polling',async t=>{
 const previous=globalThis.document;t.after(()=>globalThis.document=previous);
 const data=response('A'),button={dataset:{prepare:'t'}};let pending,view='research',opened,reads=0;
 globalThis.document={querySelector:()=>null,querySelectorAll:s=>s==='[data-prepare]'?[button]:[]};
 const ctx=context(async(url,body)=>{
  if(url==='/api/agent/prepare'){assert.equal(body.jobId,'A');assert.equal(body.topicId,'t');assert.equal(body.wordCount,100);data.jobs[0].topics[0].preparation={status:'running',stage:0,label:'生成标题和正文'};return data.jobs[0].topics[0].preparation;}
  return url.startsWith('/api/agent')?data:comments;
 },()=> 'A');Object.assign(ctx,{task:(_,fn)=>pending=fn(),currentView:()=>view,go:v=>view=v,reload:async()=>reads++,openDraft:id=>opened=id});
 const ui=createAgentUI(ctx);await ui.refresh();ui.bind();button.onclick();await pending;assert.equal(view,'write');assert.match(ui.page('write'),/停止生成/);assert.equal(opened,undefined);
 data.jobs[0].topics[0].preparation={status:'completed',draftId:'prepared-draft'};await ui.poll();assert.equal(opened,'prepared-draft');assert.equal(reads,1);
 await ui.poll();assert.equal(reads,1);
});
