import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
const source=await fs.readFile(new URL('../integrations/browser-publish.js',import.meta.url),'utf8');
function fixture(){
 const image={complete:true,naturalWidth:100,currentSrc:'https://cdn.example.test/image.png'};
 const shown={getClientRects:()=>[{}],querySelector:()=>image};
 const title={...shown,value:'测试标题'},body={...shown,innerText:'测试正文#女性成长'};
 const permission={...shown,innerText:'公开可见'},schedule={...shown,className:'d-switch',getAttribute:()=>null,querySelector:()=>null};
 const button={...shown,innerText:'发布',tagName:'BUTTON',disabled:false,hasAttribute:()=>false,getAttribute:()=>null,scrollIntoView:()=>{},getBoundingClientRect:()=>({x:10,y:10,width:100,height:40}),contains:()=>false};
 const elements=s=>s.includes('d-input')?[title]:s.includes('textbox')?[body]:s.includes('img-preview')?[shown]:s.includes('permission-card')?[permission]:s.includes('post-time')?[schedule]:s==='button,xhs-publish-btn'?[button]:[];
 const ctx=vm.createContext({location:{hostname:'creator.xiaohongshu.com',pathname:'/publish/publish'},document:{body:{innerText:''},querySelectorAll:elements,elementFromPoint:()=>button},getComputedStyle:()=>({visibility:'visible'})});vm.runInContext(source,ctx);
 ctx.args={title:'测试标题',content:'测试正文',tags:['女性成长'],imageCount:1,mode:'image'};
 return {ctx,body,title,permission,schedule,button,image,inspect:()=>vm.runInContext('wbPublishDOM(args)',ctx)};
}
test('缩略图占位不等于上传成功，破图与临时预览不能暂存或提交',()=>{
 const f=fixture(),assets=()=>vm.runInContext('wbPublishAssetsDOM(1)',f.ctx);
 assert.equal(assets().status,'ready');f.image.naturalWidth=0;
 assert.equal(assets().status,'waiting');assert.match(f.inspect().error,/图片/);assert.match(vm.runInContext('wbDraftButtonDOM()',f.ctx).error,/图片/);
 f.image.naturalWidth=100;f.image.currentSrc='blob:https://creator.xiaohongshu.com/temporary';
 assert.equal(assets().status,'waiting');assert.equal(assets().loadedCount,1);assert.equal(assets().temporaryCount,1);assert.equal(assets().persistentCount,0);assert.match(f.inspect().error,/临时/);
 f.image.currentSrc='https://cdn.example.test/image.png';f.image.complete=false;assert.equal(assets().status,'waiting');
});
test('图片核查只读取已存在的发布表单，没有表单不新建主页或要求扫码',async()=>{
 let reads=0;const ctx=vm.createContext({workTabId:7,wbBoundRead:async p=>p,chrome:{tabs:{query:async()=>ctx.tabs},scripting:{executeScript:async()=>{reads++;if(ctx.readFailed)throw new Error('页面读取未返回');return [{result:{status:'waiting',imageCount:1,loadedCount:0}}];}}}});
 vm.runInContext(source,ctx);ctx.tabs=[];assert.equal((await vm.runInContext('wbCheckPublishAssets({imageCount:1,waitMs:0})',ctx)).status,'blocked');assert.equal(reads,0);
 ctx.tabs=[{id:7}];const result=await vm.runInContext('wbCheckPublishAssets({imageCount:1,waitMs:0})',ctx);assert.equal(result.status,'not_ready');assert.equal(result.loadedCount,0);assert.equal(reads,1);
 ctx.readFailed=true;const unknown=await vm.runInContext('wbCheckPublishAssets({imageCount:1,waitMs:0})',ctx);assert.equal(unknown.status,'unverified');assert.equal(unknown.loadedCount,undefined);
});
test('多个发布页的手动诊断不能冒用旧固定页，填写后的检查只读取本轮目标',async()=>{
 const readTabs=[];const ctx=vm.createContext({workTabId:7,wbBoundRead:async p=>p,chrome:{tabs:{query:async()=>ctx.tabs},scripting:{executeScript:async({target})=>{readTabs.push(target.tabId);return [{result:{status:'waiting',imageCount:1,loadedCount:1,persistentCount:0,temporaryCount:1}}];}}}});
 vm.runInContext(source,ctx);ctx.tabs=[{id:7},{id:8}];
 const ambiguous=await vm.runInContext('wbCheckPublishAssets({imageCount:1,waitMs:0})',ctx);
 assert.equal(ambiguous.status,'blocked');assert.match(ambiguous.message,/多个发布/);assert.deepEqual(readTabs,[]);
 const owned=await vm.runInContext('wbCheckPublishAssets({imageCount:1,waitMs:0,useWorkTab:true})',ctx);
 assert.equal(owned.tabId,7);assert.equal(owned.loadedCount,1);assert.equal(owned.status,'not_ready');assert.match(owned.message,/本机预览可用/);assert.deepEqual(readTabs,[7]);
 ctx.tabs=[{id:8}];const missing=await vm.runInContext('wbCheckPublishAssets({imageCount:1,waitMs:0,useWorkTab:true})',ctx);
 assert.equal(missing.status,'blocked');assert.match(missing.message,/本轮发布标签页/);assert.deepEqual(readTabs,[7]);
});
test('保存或提交时本轮发布页消失，不新建主页也不改用另一个草稿',async()=>{
 let opened=0,actions=0;const ctx=vm.createContext({workTabId:7,wbBoundRead:async p=>p,getOrOpenXhsTab:async()=>{opened++;return {id:8};},chrome:{tabs:{query:async()=>[{id:8}]},scripting:{executeScript:async()=>{actions++;}},debugger:{attach:async()=>{actions++;}}}});
 vm.runInContext(source,ctx);
 assert.equal((await vm.runInContext('wbSaveDraft()',ctx)).savedClicked,false);
 const submit=await vm.runInContext('wbSubmitPublish({title:"测试",content:"测试",imageCount:1})',ctx);
 assert.equal(submit.publishClicked,false);assert.equal(submit.status,'not_submitted');assert.equal(opened,0);assert.equal(actions,0);
});
test('图片读取备用方式仅核查当前图片元素，破图不会被改判就绪',async()=>{
 const calls=[];let loaded=false,detached=0;
 const ctx=vm.createContext({wbBoundRead:async p=>p,chrome:{debugger:{attach:async()=>{},detach:async()=>{detached++;},sendCommand:async(_,method,params)=>{
  calls.push(method);if(method==='Accessibility.getFullAXTree')return {nodes:[]};if(method==='DOM.getDocument')return {root:{nodeId:1}};
  if(method==='DOM.querySelectorAll')return {nodeIds:[params.selector.endsWith('img.preview')?11:10]};
  if(method==='DOM.resolveNode')return {object:{objectId:'rendered-image'}};
  if(method==='Runtime.callFunctionOn'){const fn=vm.runInNewContext('('+params.functionDeclaration+')');return {result:{value:fn.call({complete:true,naturalWidth:loaded?100:0,src:'https://cdn.example.test/image.png'})}};}
  return {};
 }}}});vm.runInContext(source,ctx);
 const read=()=>vm.runInContext('wbReadAssetsViaDebugger(7,1)',ctx);
 assert.equal((await read()).status,'waiting');loaded=true;assert.equal((await read()).status,'ready');assert.equal(detached,2);
 assert.ok(calls.every(m=>!m.startsWith('Network.')&&!/Cookie|Storage|dispatch/.test(m)));
});
test('发布核对拒绝正文多余内容、标题差异、图片缺失、非公开与定时状态',()=>{
 const f=fixture();assert.ok(f.inspect().button);
 f.body.innerText='测试正文附加的不应发布段落#女性成长';assert.match(f.inspect().error,/正文/);
 f.body.innerText='测试正文#女性成长';f.title.value='另一篇';assert.match(f.inspect().error,/标题/);f.title.value='测试标题';
 f.ctx.args.imageCount=2;assert.match(f.inspect().error,/图片/);f.ctx.args.imageCount=1;
 f.permission.innerText='仅自己可见';assert.match(f.inspect().error,/可见范围/);f.permission.innerText='公开可见';
 f.schedule.className='d-switch is-checked';assert.match(f.inspect().error,/定时状态/);f.schedule.className='d-switch';
 f.button.getAttribute=k=>k==='submit-disabled'?'true':null;assert.match(f.inspect().error,/不可用/);
});
test('最终提交只执行正常鼠标点击；明确结果才记 submitted，未确认结果不得重试',async()=>{
 for(const visibleText of ['发布成功','审核中','未能确定']){
  let clock=0;const calls=[];const ctx=vm.createContext({workTabId:1,wbBoundRead:async p=>p,Date:{now:()=>clock},sleep:async ms=>{clock+=ms;},chrome:{tabs:{query:async()=>[{id:1}],update:async()=>{}},scripting:{executeScript:async({func})=>[{result:func.name==='wbPublishDOM'?{button:{x:60,y:30}}:{url:'https://creator.xiaohongshu.com/publish/publish',text:visibleText}}]},debugger:{attach:async()=>{},detach:async()=>{},sendCommand:async(_,method,params)=>{calls.push({method,params});return {data:'fixture'};}}}});vm.runInContext(source,ctx);
  const result=await vm.runInContext('wbSubmitPublish({title:"测试",content:"测试",imageCount:1})',ctx);
  assert.equal(result.publishClicked,true);assert.equal(result.status,visibleText==='发布成功'?'submitted':'uncertain');
  assert.deepEqual(calls.filter(x=>x.method==='Input.dispatchMouseEvent').map(x=>x.params.type),['mouseMoved','mousePressed','mouseReleased']);assert.equal(calls.filter(x=>x.method==='Page.captureScreenshot').length,2);
 }
});
test('平台材料不一致时不附加调试器也不点击',async()=>{
 let actions=0;const ctx=vm.createContext({workTabId:1,wbBoundRead:async p=>p,chrome:{tabs:{query:async()=>[{id:1}]},scripting:{executeScript:async()=>[{result:{error:'正文不一致'}}]},debugger:{attach:async()=>{actions++;}}}});vm.runInContext(source,ctx);
 const result=await vm.runInContext('wbSubmitPublish({title:"测试",content:"测试",imageCount:1})',ctx);assert.equal(result.publishClicked,false);assert.equal(actions,0);
});

test('暂存识别同一封闭组件内的暂存能力，拒绝歧义、禁用和遮挡',()=>{
 const f=fixture();f.button.tagName='XHS-PUBLISH-BTN';f.button.innerText='';
 let canSave=true,disabled=false,duplicate=false,top=f.button;
 f.button.getAttribute=k=>({'is-publish':'true','is-save-draft':String(canSave),'save-text':'暂存离开','save-disabled':String(disabled)})[k]||null;
 const query=f.ctx.document.querySelectorAll;
 f.ctx.document.querySelectorAll=s=>s==='button,xhs-publish-btn'?(duplicate?[f.button,{...f.button}]:[f.button]):query(s);
 f.ctx.document.elementFromPoint=()=>top;
 const inspect=()=>vm.runInContext('wbDraftButtonDOM()',f.ctx);
 assert.equal(inspect().control.name,'暂存离开');canSave=false;assert.ok(inspect().error);canSave=true;
 duplicate=true;assert.match(inspect().error,/唯一/);duplicate=false;
 disabled=true;assert.match(inspect().error,/不可用/);disabled=false;
 top={};assert.match(inspect().error,/遮挡/);
});
test('封闭组件按真实按钮名称与位置定位，不会点击同时容纳发布和暂存的容器中点',async()=>{
 const ctx=vm.createContext({wbBoundRead:async p=>p,chrome:{debugger:{sendCommand:async(_,method)=>method==='Accessibility.getFullAXTree'?{nodes:ctx.nodes}:{quads:[ctx.border]}},scripting:{executeScript:async()=>[{result:ctx.hit}]}}});
 vm.runInContext(source,ctx);ctx.state={control:{name:'暂存离开',host:{x:0,y:0,width:300,height:50}}};
 const save={role:{value:'button'},name:{value:'暂存离开'},backendDOMNodeId:101};
 ctx.nodes=[save,{role:{value:'button'},name:{value:'发布'},backendDOMNodeId:102}];ctx.border=[10,5,110,5,110,45,10,45];ctx.hit=true;
 const resolve=()=>vm.runInContext('wbResolveControl({tabId:1},state)',ctx);
 assert.equal((await resolve()).x,60);assert.equal((await resolve()).y,25);
 ctx.nodes.push({...save});await assert.rejects(resolve(),/唯一/);ctx.nodes.pop();
 save.properties=[{name:'disabled',value:{value:true}}];await assert.rejects(resolve(),/不可用/);save.properties=[];
 ctx.state.control.host={x:0,y:0,width:0,height:0};assert.equal((await resolve()).x,60);
 ctx.hit=false;await assert.rejects(resolve(),/遮挡/);
});
test('发布控件只返回真实按钮名，封闭组件的中心不能作为提交坐标',()=>{
 const f=fixture();f.button.tagName='XHS-PUBLISH-BTN';f.button.innerText='';f.button.getAttribute=k=>k==='is-publish'?'true':null;
 const state=f.inspect();assert.equal(state.control.name,'发布');assert.equal(state.button,undefined);
});
test('暂存只点正常鼠标按钮，点击返回仍要求平台草稿核查',async()=>{
 const calls=[];const ctx=vm.createContext({workTabId:1,wbBoundRead:async p=>p,chrome:{tabs:{query:async()=>[{id:1}],update:async()=>{}},scripting:{executeScript:async()=>[{result:{button:{x:30,y:40}}}]},debugger:{attach:async()=>{},detach:async()=>{},sendCommand:async(_,method,params)=>calls.push({method,params})}}});
 vm.runInContext(source,ctx);const result=await vm.runInContext('wbSaveDraft()',ctx);
 assert.equal(result.savedClicked,true);assert.equal(result.status,'needs_verification');
 assert.deepEqual(calls.map(x=>x.params.type),['mouseMoved','mousePressed','mouseReleased']);
});

test('发布读取挂起时及时返回；点击前可恢复表单，点击后仍是待核查且只点一次',async()=>{
 const readiness=await fs.readFile(new URL('../integrations/browser-readiness.js',import.meta.url),'utf8');
 for(const hangAfterClick of [false,true]){
  const calls=[];let attached=0,detached=0;
  const ctx=vm.createContext({workTabId:1,setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,20)),clearTimeout,chrome:{tabs:{query:async()=>[{id:1}],update:async()=>{}},scripting:{executeScript:async({func})=>func.name==='wbPublishDOM'&&hangAfterClick?[{result:{button:{x:10,y:10}}}]:new Promise(()=>{})},debugger:{attach:async()=>{attached++;},detach:async()=>{detached++;},sendCommand:async(_,method,params)=>{calls.push({method,params});return {data:'fixture'};}}}});
  vm.runInContext(readiness+'\n'+source,ctx);
  const result=await vm.runInContext('wbSubmitPublish({title:"测试",content:"测试",imageCount:1})',ctx);
  assert.equal(result.publishClicked,hangAfterClick);assert.equal(result.status,hangAfterClick?'uncertain':'not_submitted');
  assert.match(result.message,/页面读取暂未返回/);assert.equal(attached,hangAfterClick?1:0);assert.equal(detached,attached);
  assert.equal(result.evidenceBefore,hangAfterClick?'fixture':undefined);
  assert.equal(calls.filter(x=>x.method==='Input.dispatchMouseEvent'&&x.params.type==='mousePressed').length,hangAfterClick?1:0);
 }
});
test('Manual completion checks only the owned tab and never mistakes a failed read for a closed form',async()=>{
 let page={id:9,url:'https://creator.xiaohongshu.com/publish/publish'},failure=null,result={status:'open'},reads=0;
 const ctx=vm.createContext({workTabId:9,URL,allowedHost:u=>new URL(u).hostname==='creator.xiaohongshu.com',wbBoundRead:async p=>p,chrome:{tabs:{get:async()=>{if(failure)throw Error(failure);return page;}},scripting:{executeScript:async()=>{reads++;return [{result}];}}}});vm.runInContext(source,ctx);
 const inspect=()=>vm.runInContext('wbFormState()',ctx);
 assert.equal((await inspect()).status,'open');result={status:'ended',reason:'submission_acknowledged'};assert.equal((await inspect()).reason,'submission_acknowledged');
 failure='页面读取暂未返回';assert.equal((await inspect()).status,'unknown');failure='No tab with id: 9';assert.equal((await inspect()).reason,'tab_closed');failure=null;
 page.url='https://creator.xiaohongshu.com/new/home';assert.equal((await inspect()).reason,'left_form');assert.equal(reads,2);
});
test('Text saying publish succeeded inside an editable draft never releases its form',async()=>{
 let editing=true;const ctx=vm.createContext({workTabId:9,URL,allowedHost:()=>true,wbBoundRead:async p=>p,document:{body:{innerText:'发布成功'},querySelectorAll:()=>editing?[{getClientRects:()=>[{}]}]:[]},chrome:{tabs:{get:async()=>({id:9,url:'https://creator.xiaohongshu.com/publish/publish'})},scripting:{executeScript:async input=>[{result:vm.runInContext('('+input.func.toString()+')()',ctx)}]}}});vm.runInContext(source,ctx);
 assert.equal((await vm.runInContext('wbFormState()',ctx)).status,'open');editing=false;assert.equal((await vm.runInContext('wbFormState()',ctx)).reason,'submission_acknowledged');
});
test('Reset to the visible blank uploader releases occupancy without declaring a publication',async()=>{
 let editing=false,uploader=true;const element={getClientRects:()=>[{}]};
 const ctx=vm.createContext({workTabId:9,URL,allowedHost:()=>true,wbBoundRead:async p=>p,document:{body:{innerText:'上传图文 点击上传'},querySelectorAll:s=>s.includes('placeholder')?(editing?[element]:[]):s==='.upload-content'?(uploader?[element]:[]):s==='input[type="file"]'?[element]:[]},chrome:{tabs:{get:async()=>({id:9,url:'https://creator.xiaohongshu.com/publish/publish'})},scripting:{executeScript:async input=>[{result:vm.runInContext('('+input.func.toString()+')()',ctx)}]}}});vm.runInContext(source,ctx);
 assert.equal((await vm.runInContext('wbFormState()',ctx)).reason,'form_reset');
 editing=true;assert.equal((await vm.runInContext('wbFormState()',ctx)).status,'open');
 editing=false;uploader=false;assert.equal((await vm.runInContext('wbFormState()',ctx)).status,'open');
});
