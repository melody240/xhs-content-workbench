import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const files=await Promise.all(['browser-readiness.js','skills-extension-header.js','source-capture-extension.js'].map(f=>fs.readFile(new URL('../integrations/'+f,import.meta.url),'utf8')));
function fixture(){
 const tabs=new Map([[1,{id:1,url:'https://creator.xiaohongshu.com/publish/publish',active:true}],[2,{id:2,url:'https://x.com/userOwned/status/1',active:false}]]),created=[],removed=[],updated=[];
 let next=10,now=0,state={items:[{url:'https://x.com/a/status/1'}],empty:true};
 class Socket{static OPEN=1;static CONNECTING=0;constructor(){this.readyState=0;}}
 const chrome={alarms:{create(){},onAlarm:{addListener(){}}},permissions:{contains:async()=>true},tabs:{query:async()=>[...tabs.values()],get:async id=>{if(!tabs.has(id))throw Error('closed');return tabs.get(id);},create:async p=>{const t={...p,id:next++};created.push(t.id);tabs.set(t.id,t);return t;},update:async(id,p)=>{updated.push({id,...p});return Object.assign(tabs.get(id),p);},remove:async id=>{removed.push(id);tabs.delete(id);}},scripting:{executeScript:async({target,func})=>[{result:func.name==='wbPageState'?{url:tabs.get(target.tabId).url,status:'ready',redId:'12345'}:state}]}};
 class Clock extends Date{static now(){return now;}}
 const ctx=vm.createContext({URL,Date:Clock,setTimeout,clearTimeout,sleep:async()=>{now+=500;},importScripts(){},chrome,WebSocket:Socket,WB_CONFIG:{url:'ws://localhost'}});vm.runInContext(files.join('\n'),ctx);
 return {ctx,tabs,created,removed,updated,setState:v=>{state=v;}};
}
test('Repeated source opens reuse a viewing tab; scans close only owned read tabs even when the view is active',async()=>{
 const f=fixture();const view=await f.ctx.wbSourceTab('https://x.com/a',{openOnly:true});
 for(let i=0;i<3;i++){
  assert.equal((await f.ctx.wbSourceTab('https://x.com/b',{openOnly:true})).id,view.id);
  await f.ctx.wbSourceScan({url:'https://x.com/a'});
  assert.equal(f.tabs.size,3);assert.ok(f.tabs.has(view.id));
 }
 assert.equal(f.created.length,4);assert.equal(f.removed.length,3);
 assert.deepEqual(f.removed,f.created.slice(1));assert.equal(f.tabs.get(1).url,'https://creator.xiaohongshu.com/publish/publish');assert.ok(f.tabs.has(2));
});
test('Read timeout closes temporary tab; verification retains one page and retry reuses then closes it',async()=>{
 const f=fixture();f.setState({loading:true});await assert.rejects(f.ctx.wbSourceScan({url:'https://x.com/a'}),/尚未加载/);assert.equal(f.tabs.size,2);
 f.setState({error:'请本人在 Edge 完成平台验证，素材采集已暂停。'});
 for(let i=0;i<3;i++)await assert.rejects(f.ctx.wbSourceScan({url:'https://x.com/a'}),/平台验证/);
 assert.equal(f.tabs.size,3);assert.equal(f.created.length,2);
 f.setState({empty:true,items:[]});await f.ctx.wbSourceScan({url:'https://x.com/a'});assert.equal(f.tabs.size,2);assert.equal(f.created.length,2);
});
test('Creator verification retries reuse the retained check page, then close it without touching the filled form',async()=>{
 const f=fixture();let blocked=true;
 f.ctx.chrome.scripting.executeScript=async({target})=>[{result:{url:f.tabs.get(target.tabId).url,status:blocked?'verification_required':'ready',redId:'12345',message:'请本人处理验证'}}];
 for(let i=0;i<3;i++)assert.equal((await f.ctx.wbCreatorCheck({redId:'12345',identityOnly:true})).status,'verification_required');
 assert.equal(f.created.length,1);assert.equal(f.tabs.size,3);
 blocked=false;assert.equal((await f.ctx.wbCreatorCheck({redId:'12345',identityOnly:true})).status,'ready');assert.equal(f.tabs.size,2);assert.equal(f.tabs.get(1).url,'https://creator.xiaohongshu.com/publish/publish');
});
test('First navigation reuses an exact existing URL; subsequent calls keep that same tab',async()=>{
 const f=fixture(),url='https://www.xiaohongshu.com/explore';f.tabs.set(3,{id:3,url});
 await f.ctx.cmdNavigate({url});await f.ctx.cmdNavigate({url});assert.equal(f.created.length,0);assert.equal(f.tabs.size,3);assert.equal(f.updated.every(t=>t.id===3),true);
});
test('Unowned publishing tabs are never reused or navigated, while the owned publishing tab is reused',async()=>{
 const f=fixture(),url=f.tabs.get(1).url;
 await f.ctx.cmdNavigate({url});await f.ctx.cmdNavigate({url});assert.equal(f.created.length,1);assert.equal(f.tabs.size,3);assert.equal(f.updated.every(t=>t.id===f.created[0]),true);assert.equal(f.tabs.get(1).url,url);
});
test('Two immediate opens reuse an owned tab while its real URL is still empty or about:blank',async()=>{
 for(const pendingUrl of [undefined,'https://x.com/a']){
  const f=fixture(),create=f.ctx.chrome.tabs.create;
  f.ctx.chrome.tabs.create=async p=>{const t=await create(p);t.url='';t.pendingUrl=pendingUrl;return t;};
  const a=await f.ctx.wbSourceTab('https://x.com/a',{openOnly:true});
  f.tabs.get(a.id).url='about:blank';
  const b=await f.ctx.wbSourceTab('https://x.com/a',{openOnly:true});assert.equal(a.id,b.id);assert.equal(f.created.length,1);assert.equal(b.url,'https://x.com/a');
 }
});
