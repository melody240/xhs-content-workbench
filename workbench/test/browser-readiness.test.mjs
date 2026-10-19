import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../integrations/browser-readiness.js',import.meta.url),'utf8');
const header=await fs.readFile(new URL('../integrations/skills-extension-header.js',import.meta.url),'utf8');
test('Edge task readiness accepts usable controls while tab is loading, rejects stale document, login and verification',async()=>{
 let now=0,state={url:'https://www.xiaohongshu.com/explore',status:'ready',surface:'explore'};
 const tab={url:state.url,status:'loading'};
 const ctx=vm.createContext({URL,setTimeout,clearTimeout,Date:{now:()=>now},sleep:async()=>{now+=500;},allowedHost:()=>true,chrome:{tabs:{get:async()=>tab},scripting:{executeScript:async()=>[{result:state}]}}});
 vm.runInContext(source,ctx);
 await vm.runInContext(`waitForTabComplete(1,'https://www.xiaohongshu.com/explore',1000)`,ctx);
 state={...state,url:'https://www.xiaohongshu.com/search_result'};now=0;
 await assert.rejects(vm.runInContext(`waitForTabComplete(1,'https://www.xiaohongshu.com/explore',1000)`,ctx),/控件未就绪/);
 for(const status of ['login_required','verification_required']){
  now=0;state={status,message:'请本人处理 '+status};
  await assert.rejects(vm.runInContext('waitForTabComplete(1,null,1000)',ctx),/请本人处理/);assert.equal(now,0);
 }
});
test('Visible creator controls and stable redId are separate requirements; generic header is not publishing readiness',()=>{
 const shown={getClientRects:()=>[{}]};let selectors=new Set(),text='';
 const ctx=vm.createContext({getComputedStyle:()=>({visibility:'visible'}),location:{href:'https://creator.xiaohongshu.com/new/home',hostname:'creator.xiaohongshu.com',pathname:'/new/home'},document:{readyState:'interactive',title:'创作后台',get body(){return {innerText:text};},querySelectorAll:s=>selectors.has(s)?[shown]:[],querySelector:()=>null}});
 vm.runInContext(source,ctx);
 assert.equal(vm.runInContext('wbPageState().status',ctx),'loading');text='小红书账号: 12345';
 assert.equal(vm.runInContext('wbPageState().redId',ctx),'12345');
 ctx.location.pathname='/publish/publish';assert.equal(vm.runInContext('wbPageState().status',ctx),'loading');
 selectors.add('.upload-content,.creator-tab,input[placeholder*="标题"],.tiptap,.ql-editor');
 assert.equal(vm.runInContext('wbPageState().status',ctx),'ready');text='请完成安全验证';
 assert.equal(vm.runInContext('wbPageState().status',ctx),'verification_required');
});

test('新标签页初始 about:blank 等待真实文档，路由刚变但内容仍旧时不判就绪',async()=>{
 let now=0;
 const ctx=vm.createContext({URL,setTimeout,clearTimeout,Date:{now:()=>now},sleep:async()=>{now+=250;},allowedHost:u=>String(u).startsWith('https://creator.xiaohongshu.com/'),chrome:{tabs:{get:async()=>now<250?{url:'about:blank',pendingUrl:'https://creator.xiaohongshu.com/publish/publish'}:{url:'https://creator.xiaohongshu.com/publish/publish'}},scripting:{executeScript:async()=>[{result:{url:now<500?'https://creator.xiaohongshu.com/new/home':'https://creator.xiaohongshu.com/publish/publish',status:'ready'}}]}}});vm.runInContext(source,ctx);
 const result=await vm.runInContext("waitForTabComplete(1,'https://creator.xiaohongshu.com/publish/publish',2000)",ctx);
 assert.equal(now,500);assert.match(result.url,/publish\/publish/);
});

test('导航时页面读取一直不返回也遵守截止时间，不无限等待注入结果',async()=>{
 const ctx=vm.createContext({URL,setTimeout,clearTimeout,Date,sleep:ms=>new Promise(r=>setTimeout(r,ms)),allowedHost:()=>true,chrome:{tabs:{get:async()=>({url:'https://creator.xiaohongshu.com/publish/publish'})},scripting:{executeScript:()=>new Promise(()=>{})}}});
 vm.runInContext(source,ctx);const start=Date.now();
 await assert.rejects(vm.runInContext("waitForTabComplete(1,'https://creator.xiaohongshu.com/publish/publish',1000)",ctx),/控件未就绪/);
 assert.ok(Date.now()-start<1800);
});

test('发布首次导航直接打开同一浏览器的创作后台，不先访问主页登录',async()=>{
 const created=[];let tab;
 const chrome={tabs:{create:async value=>{created.push(value.url);return tab={id:7,url:value.url};},get:async()=>tab,update:async(id,value)=>Object.assign(tab,value)},scripting:{executeScript:async()=>[{result:{url:tab.url,status:'ready',surface:'creator_publish'}}]},alarms:{create(){},onAlarm:{addListener(){}}}};
 class FakeSocket{static OPEN=1;static CONNECTING=0;constructor(){this.readyState=0;}}
 const ctx=vm.createContext({URL,Date,setTimeout,clearTimeout,sleep:async()=>{},importScripts(){},chrome,WebSocket:FakeSocket,WB_CONFIG:{url:'ws://127.0.0.1:1'}});
 vm.runInContext(source+'\n'+header,ctx);
 await vm.runInContext("cmdNavigate({url:'https://creator.xiaohongshu.com/publish/publish?source=official'})",ctx);
 assert.deepEqual(created,['https://creator.xiaohongshu.com/publish/publish?source=official']);
});

test('已填写表单的后续操作只重新核实创作后台身份，不另开空白发布页',async()=>{
 const urls=[];const ctx=vm.createContext({URL,Date,setTimeout,clearTimeout,allowedHost:()=>true,sleep:async()=>{},chrome:{tabs:{create:async({url})=>{urls.push(url);return {id:1};},get:async()=>({url:urls.at(-1)}),remove:async()=>{},update:async(_,value)=>urls.push(value.url)},scripting:{executeScript:async()=>[{result:{url:urls.at(-1),status:'ready',redId:'12345'}}]}}});
 vm.runInContext(source,ctx);const value=await vm.runInContext("wbCreatorCheck({redId:'12345',identityOnly:true})",ctx);
 assert.equal(value.status,'ready');assert.deepEqual(urls,['https://creator.xiaohongshu.com/new/home']);
});

test('创作后台超时提示含登录字样也不冒充登录失败，只有实际登录或验证码页留给本人',async()=>{
 for(const status of ['loading','unavailable','login_required','verification_required']){
  let now=0,removed=0,updated=0;
  const url='https://creator.xiaohongshu.com/new/home';
  const ctx=vm.createContext({URL,setTimeout,clearTimeout,Date:{now:()=>now},allowedHost:()=>true,sleep:async()=>{now+=1000;},chrome:{tabs:{create:async()=>({id:1}),get:async()=>({url}),remove:async()=>{removed++;},update:async()=>{updated++;}},scripting:{executeScript:async()=>[{result:{url,status,surface:'creator',message:'读取未完成；不会退出登录或要求安全验证'}}]}}});
  vm.runInContext(source,ctx);const r=await vm.runInContext("wbCreatorCheck({redId:'12345',identityOnly:true})",ctx);
  const actualHandoff=['login_required','verification_required'].includes(status);
  assert.equal(r.status,actualHandoff?status:'unavailable');assert.equal(removed,actualHandoff?0:1);assert.equal(updated,actualHandoff?1:0);
  assert.equal(r.errorCode,{loading:'BROWSER_PAGE_NOT_READY',unavailable:'BROWSER_PAGE_UNAVAILABLE',login_required:'BROWSER_LOGIN_REQUIRED',verification_required:'BROWSER_VERIFICATION_REQUIRED'}[status]);
 }
});
test('未读取到创作后台账号标识与已经读取到不同标识分开报告',async()=>{
 const ctx=vm.createContext({URL,Date,setTimeout,clearTimeout,allowedHost:()=>true,sleep:async()=>{},chrome:{tabs:{create:async()=>({id:1}),get:async()=>({url:'https://creator.xiaohongshu.com/new/home'}),remove:async()=>{}},scripting:{executeScript:async()=>[{result:{url:'https://creator.xiaohongshu.com/new/home',status:'ready',redId:ctx.redId}}]}}});
 vm.runInContext(source,ctx);ctx.redId='';assert.equal((await vm.runInContext("wbCreatorCheck({redId:'12345',identityOnly:true})",ctx)).status,'identity_unverified');
 ctx.redId='other';assert.equal((await vm.runInContext("wbCreatorCheck({redId:'12345',identityOnly:true})",ctx)).status,'identity_mismatch');
});
test('账号链接或主页资料读取挂起会停止并关闭本轮检查页，不改为要求扫码',async()=>{
 for(const hangProfile of [false,true]){
  let url='https://www.xiaohongshu.com/explore',removed=0;
  class FakeSocket{static OPEN=1;static CONNECTING=0;constructor(){this.readyState=0;}}
  const ctx=vm.createContext({URL,Date,setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,20)),clearTimeout,sleep:async()=>{},importScripts(){},WebSocket:FakeSocket,WB_CONFIG:{url:'ws://127.0.0.1:1'},chrome:{alarms:{create(){},onAlarm:{addListener(){}}},tabs:{create:async()=>({id:1}),get:async()=>({url}),update:async(_,v)=>{url=v.url;},remove:async()=>{removed++;}},scripting:{executeScript:async({func})=>func.name==='wbPageState'?[{result:{url,status:'ready'}}]:hangProfile&&url.endsWith('/explore')?[{result:'/user/profile/userA'}]:new Promise(()=>{})}}});
  vm.runInContext(source+'\n'+header,ctx);
  await assert.rejects(vm.runInContext('identity()',ctx),e=>e.code==='BROWSER_PAGE_READ_FAILED'&&!/扫码/.test(e.message));assert.equal(removed,1);
 }
});
test('主页核查实际遇到登录或验证码时保留原页面交给本人，普通超时才关闭检查页',async()=>{
 for(const status of ['login_required','verification_required','loading']){
  let now=0,removed=0,focused=0;
  class FakeSocket{static OPEN=1;static CONNECTING=0;constructor(){this.readyState=0;}}
  const url='https://www.xiaohongshu.com/explore';
  const ctx=vm.createContext({URL,setTimeout,clearTimeout,Date:{now:()=>now},sleep:async()=>{now+=1000;},importScripts(){},WebSocket:FakeSocket,WB_CONFIG:{url:'ws://127.0.0.1:1'},chrome:{alarms:{create(){},onAlarm:{addListener(){}}},tabs:{create:async()=>({id:1}),get:async()=>({url}),update:async()=>{focused++;},remove:async()=>{removed++;}},scripting:{executeScript:async()=>[{result:{url,status,message:'页面提示'}}]}}});
  vm.runInContext(source+'\n'+header,ctx);await assert.rejects(vm.runInContext('identity()',ctx));
  assert.equal(removed,status==='loading'?1:0);assert.equal(focused,status==='loading'?0:1);
 }
});
test('主页已显示账号入口但资源仍在加载时，核查直接读取 DOM，不排队等待 document_idle',async()=>{
 const url='https://www.xiaohongshu.com/explore';
 const ctx=vm.createContext({URL,Date,setTimeout,clearTimeout,sleep:async()=>{},allowedHost:()=>true,chrome:{tabs:{get:async()=>({url,status:'loading'})},scripting:{executeScript:async({injectImmediately})=>injectImmediately?[{result:{url,status:'ready',surface:'explore',self:'/user/profile/self'}}]:new Promise(()=>{})}}});
 vm.runInContext(source,ctx);const value=await vm.runInContext('waitForTabComplete(1,null,1000)',ctx);assert.equal(value.status,'ready');
});
test('新侧栏只接受唯一可见的我入口，不能把笔记作者或隐藏入口当作当前账号',()=>{
 const link=(label,href,shown=true)=>({innerText:label,getClientRects:()=>shown?[{}]:[],getAttribute:()=>href});
 const links=[link('其他作者','/user/profile/author'),link('我','/user/profile/self'),link('我','/user/profile/hidden',false)];
 const ctx=vm.createContext({getComputedStyle:()=>({visibility:'visible'}),location:{href:'https://www.xiaohongshu.com/explore',hostname:'www.xiaohongshu.com',pathname:'/explore'},document:{body:{innerText:''},readyState:'interactive',title:'小红书',querySelector:()=>null,querySelectorAll:s=>s==='a[href*="/user/profile/"]'?links:[]}});
 vm.runInContext(source,ctx);assert.equal(vm.runInContext('wbSelfLinkDOM()',ctx),'/user/profile/self');assert.equal(vm.runInContext('wbPageState().status',ctx),'ready');
 links.push(link('我','/user/profile/ambiguous'));assert.equal(vm.runInContext('wbSelfLinkDOM()',ctx),'');assert.equal(vm.runInContext('wbPageState().status',ctx),'loading');
});
