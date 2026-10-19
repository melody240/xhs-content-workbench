import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {AccountStore} from '../accounts.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('Creator dashboard monitor HTTP: MCP logged out, scoped snapshot, disconnect and identity mismatch never fall back',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'monitor-browser-test-'));let mcpCalls=0;
 const mock=http.createServer(async(req,res)=>{for await(const _ of req){}mcpCalls++;res.end(JSON.stringify({result:{tools:[]}}));});mock.listen(0,'127.0.0.1');await once(mock,'listening');
 const store=await AccountStore.open(dir,`http://127.0.0.1:${mock.address().port}/mcp`);const a=store.items[0];a.identity={userId:'userA',redId:'redA'};a.state.settings.monitorSource='skills';a.state.login={status:'logged_out',message:'MCP 模拟未登录'};await store.save();
 const reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,WORKBENCH_DATA_DIR:dir,WORKBENCH_PORT:String(port)},stdio:'ignore'});
 let ext;t.after(async()=>{ext?.terminate();const exit=once(child,'exit');child.kill('SIGTERM');await exit;await new Promise(r=>mock.close(r));await fs.rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}`;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await delay(50);}
 const request=(url,body)=>fetch(base+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Workbench-Request':'1','X-Workbench-Account':a.id},...(body?{body:JSON.stringify(body)}:{})});
 const token=(await fs.readFile(path.join(dir,'skills-bridge-token'),'utf8')).trim();ext=new WebSocket(`ws://127.0.0.1:${port}/skills-bridge`,{origin:'chrome-extension://'+'a'.repeat(32)});await once(ext,'open');const methods=[];let wrong=false,readFailure=false,errorCode,errorMessage='页面读取暂未返回';
 ext.on('message',raw=>{const m=JSON.parse(raw);methods.push(m.method);
  if(readFailure){ext.send(JSON.stringify({id:m.id,error:errorMessage,errorCode}));return;}
  ext.send(JSON.stringify({id:m.id,result:{profile:{redId:wrong?'redB':'redA',nickname:'模拟A'},period:m.params.period,range:m.params.period===30?'09-13 至 10-12':'10-06 至 10-12',metrics:[{key:'likes',display:'90'},{key:'views',display:'2,269'}]}}));
 });
 ext.send(JSON.stringify({role:'extension',token,capabilities:['creator-metrics-v1']}));await delay(40);
 let r=await request('/api/monitor/refresh',{});assert.equal(r.status,200,await r.clone().text());const snapshot=await r.json();assert.equal(snapshot.channel,'skills');assert.equal(snapshot.profile.redId,'redA');assert.equal(snapshot.notes.length,0);assert.equal(mcpCalls,0);
 let state=await(await request('/api/monitor/state')).json();assert.equal(state.legacyLogin.status,'logged_out');assert.equal(state.monitor.login.status,'logged_in');assert.equal(state.snapshot.profile.redId,'redA');
 const checkedAt=state.monitor.login.at;
 readFailure=true;r=await request('/api/monitor/refresh',{});assert.equal(r.status,502);
 state=await(await request('/api/monitor/state')).json();assert.equal(state.monitor.login.status,'logged_in');assert.equal(state.monitor.login.at,checkedAt);assert.equal(state.monitor.login.profile.redId,'redA');assert.equal(state.browser.connected,true);assert.equal(state.snapshots.length,1);assert.match(state.lastMonitorError.message,/页面读取/);assert.equal(mcpCalls,0);
 for(const detail of [{code:'BROWSER_PAGE_NOT_READY',message:'不会退出登录或重新扫码'},{code:'BROWSER_IDENTITY_UNVERIFIED',message:'尚未读取到账号标识'},{code:undefined,message:'尚未识别浏览器登录身份。请先在小红书页面登录并完成验证。'}]){
  errorCode=detail.code;errorMessage=detail.message;r=await request('/api/monitor/refresh',{});assert.equal(r.status,502);
  state=await(await request('/api/monitor/state')).json();assert.equal(state.monitor.login.status,'logged_in');assert.equal(state.monitor.login.at,checkedAt);assert.equal(state.snapshots.length,1);assert.equal(state.browser.connected,true);
 }
 errorCode='BROWSER_LOGIN_REQUIRED';errorMessage='当前页面明确要求登录';r=await request('/api/monitor/refresh',{});assert.equal(r.status,502);
 state=await(await request('/api/monitor/state')).json();assert.equal(state.monitor.login.status,'unknown');assert.equal(state.monitor.login.profile.redId,'redA');assert.equal(state.snapshots.length,1);
 readFailure=false;
 wrong=true;r=await request('/api/monitor/refresh',{});assert.equal(r.status,409);assert.match((await r.json()).error,/不一致/);state=await(await request('/api/monitor/state')).json();assert.equal(state.monitor.login.status,'error');assert.equal(state.monitor.login.profile.redId,'redA');assert.equal(state.snapshots.length,1);assert.equal(state.legacyLogin.status,'logged_out');assert.equal(mcpCalls,0);
 ext.close();await once(ext,'close');r=await request('/api/monitor/refresh',{});assert.equal(r.status,409);assert.equal(mcpCalls,0);state=await(await request('/api/monitor/state')).json();assert.equal(state.monitor.source,'skills');assert.equal(state.snapshots.length,1);
 wrong=false;ext=new WebSocket(`ws://127.0.0.1:${port}/skills-bridge`,{origin:'chrome-extension://'+'b'.repeat(32)});await once(ext,'open');
 ext.on('message',raw=>{const m=JSON.parse(raw);methods.push(m.method);ext.send(JSON.stringify({id:m.id,result:{profile:{redId:'redA'},period:m.params.period,range:'09-13 至 10-12',metrics:[{key:'views',display:'1.1万'}]}}));});ext.send(JSON.stringify({role:'extension',token,capabilities:['creator-metrics-v1']}));await delay(40);
 r=await request('/api/monitor/refresh',{period:30});assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).metrics.views.value,11000);
 assert.equal((await request('/api/monitor/refresh',{period:1})).status,400);assert.ok(methods.every(m=>m==='wb_creator_metrics'));assert.equal(mcpCalls,0);
 const csv=await(await request('/api/export?period=30')).text();assert.match(csv,/09-13 至 10-12/);assert.doesNotMatch(csv,/10-06 至 10-12/);
 assert.equal((await request('/api/monitor/settings' ,{source:'invalid'})).status,400);
});
