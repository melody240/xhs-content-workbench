import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {WebSocket} from 'ws';
import vm from 'node:vm';
import {SkillsIntegration,matchSkillsIdentity} from '../integrations/skills.mjs';
import {cliArguments} from '../integrations/skills-catalog.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const origin='chrome-extension://'+'a'.repeat(32);
async function setup(t,runner,capture=false){
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'xhs-skills-test-'));const server=http.createServer();
 server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;
 const s=new SkillsIntegration({root,data,port,runner});await s.init(server);
 t.after(async()=>{s.close();await new Promise(r=>server.close(r));await fs.rm(data,{recursive:true,force:true});});
 let smartResult={source:'creator',applied:true,title:'别再把自己藏起来',candidates:['别再把自己藏起来','你也值得被看见']};
 let identity={userId:'user-A',redId:'red-A',nickname:'模拟账号A'},creatorIdentity=null,creatorState=null,publicError='',assetsReady=true,assetsResult=null;
 const ext=new WebSocket(`ws://127.0.0.1:${port}/skills-bridge`,{origin});await once(ext,'open');
 ext.send(JSON.stringify({role:'extension',token:s.token,capabilities:['creator-smart-titles-v1','task-readiness-v1','creator-metrics-v1',...(capture?['comment-capture-v1']:[])]}));
 const methods=[];
 ext.on('message',raw=>{const m=JSON.parse(raw);methods.push(m.method);let result=null;
  if(m.method==='wb_smart_titles')result=smartResult;
  if(m.method==='wb_identity'&&publicError){ext.send(JSON.stringify({id:m.id,error:publicError}));return;}
  if(m.method==='wb_identity')result=identity;
  if(m.method==='wb_save_draft')result={savedClicked:true,status:'needs_verification'};
  if(m.method==='wb_publish_assets')result=assetsResult||{status:assetsReady?'ready':'not_ready',message:assetsReady?'图片已加载':'平台图片未加载'};
  if(m.method==='wb_creator_check')result=creatorState||{status:'ready',redId:(creatorIdentity||identity).redId,message:'隔离测试创作后台已就绪'};
  if(m.method==='evaluate')result=JSON.stringify([{id:'fake-note',noteCard:{displayTitle:'隔离测试笔记',type:'normal'}}]);
  if(m.method==='wb_capture_comment')result={commentId:m.params.commentId,url:m.params.url,content:m.params.expectedText};
  ext.send(JSON.stringify({id:m.id,result}));
 });
 for(let i=0;i<30&&!s.session;i++)await delay(10);
 const a={id:'workspace-A',identity:{userId:'user-A',redId:'red-A'},state:{assets:{}}};
 return {s,a,port,ext,methods,setSmartResult:x=>smartResult=x,setIdentity:x=>identity=x,setCreatorIdentity:x=>creatorIdentity=x,setCreatorState:x=>creatorState=x,setPublicError:x=>publicError=x,setAssetsResult:x=>assetsResult=x,setAssetsReady:x=>assetsReady=x,data};
}
test('Skills 参数限制：命令白名单、未知字段、选项与非字符串，保留参数中的标点',()=>{
 assert.throws(()=>cliArguments('click-publish',{}),/未开放/);
 assert.throws(()=>cliArguments('search-feeds',{keyword:'hi',shell:'evil'}),/不支持/);
 assert.throws(()=>cliArguments('search-feeds',{keyword:[],sortBy:'evil'}),/格式/);
 assert.throws(()=>cliArguments('search-feeds',{keyword:'hi',sortBy:'evil'}),/选项/);
 assert.deepEqual(cliArguments('search-feeds',{keyword:'--help; $(abc)'}).args,['search-feeds','--keyword=--help; $(abc)']);
 assert.equal(matchSkillsIdentity({redId:'same'},{redId:'same',userId:'x'}),true);
 assert.equal(matchSkillsIdentity({userId:'u',redId:'r'},{userId:'u',redId:'wrong'}),false);
 assert.equal(matchSkillsIdentity({userId:'u'},{redId:'r'}),false);
});

test('评论截图在同一会话前后核实账号，旧扩展与未完成表单不会启动截图',async t=>{
 const {s,a,methods,setIdentity}=await setup(t,null,true);
 const source={feedId:'note1',xsecToken:'test-token'},comment={platformId:'comment1',content:'评论原文'};
 assert.equal(s.status(a.id).commentCapture,true);
 const r=await s.captureComment(a,source,comment);assert.equal(r.commentId,'comment1');
 assert.deepEqual(methods.slice(-3),['wb_identity','wb_capture_comment','wb_identity']);
 s.form={accountId:a.id};await assert.rejects(s.captureComment(a,source,comment),/表单|流程/);s.form=null;
 s.capabilities=[];await assert.rejects(s.captureComment(a,source,comment),/重新加载/);
 s.capabilities=['comment-capture-v1'];setIdentity({userId:'another',redId:'other'});
 await assert.rejects(s.captureComment(a,source,comment),/不一致/);assert.equal(methods.filter(x=>x==='wb_capture_comment').length,1);
 assert.equal(s.active,null);
});
test('Skills 已配对扩展与真实 Python CLI 往返；无效凭据、重复连接与 Cookie 命令被拒绝',async t=>{
 const {s,a,port,methods}=await setup(t);
 assert.equal(s.available,true);
 await s.bind(a);
 const result=await s.execute(a,{command:'list-feeds'});
 assert.equal(result.result.feeds[0].id,'fake-note');
 assert.ok(methods.includes('evaluate'));
 await assert.rejects(s.call('get_cookies'),/未开放/);
 const bad=new WebSocket(`ws://127.0.0.1:${port}/skills-bridge`,{origin});await once(bad,'open');const close=once(bad,'close');bad.send(JSON.stringify({role:'extension',token:'wrong'}));assert.equal((await close)[0],1008);
 const second=new WebSocket(`ws://127.0.0.1:${port}/skills-bridge`,{origin});await once(second,'open');const closed=once(second,'close');second.send(JSON.stringify({role:'extension',token:s.token}));assert.equal((await closed)[0],1008);
 const code=await fs.readFile(path.join(s.directory,'background.js'),'utf8');const manifest=JSON.parse(await fs.readFile(path.join(s.directory,'manifest.json'),'utf8'));
 assert.ok(!manifest.permissions.includes('cookies'));assert.ok(!manifest.permissions.includes('webRequest'));
 assert.doesNotMatch(code,/document\.cookie|chrome\.cookies|netlog/i);
 const avatarReader=code.slice(code.indexOf('async function wbQuoteAvatarBytes('),code.indexOf('function wbSourceDOM('));
 assert.doesNotMatch(code.replace(avatarReader,''),/fetch\(/i);
 assert.match(avatarReader,/credentials:'omit'/);
 assert.match(avatarReader,/u\.hostname!=='pbs\.twimg\.com'/);
 assert.equal(s.status(a.id).ready,true);
});
test('Skills 身份漂移与账号切换阻止执行；写操作要求确认',async t=>{
 let calls=0;const {s,a,setIdentity}=await setup(t,async()=>{calls++;return {success:true};});
 await s.bind(a);
 await assert.rejects(s.execute(a,{command:'like-feed',input:{feedId:'x',xsecToken:'y'}}),/确认/);
 await assert.rejects(s.execute({...a,id:'workspace-B'},{command:'list-feeds'}),/核实/);
 setIdentity({userId:'different',redId:'other',nickname:'B'});
 await assert.rejects(s.execute(a,{command:'list-feeds'}),/不一致/);
 assert.equal(calls,0);assert.equal(s.binding,null);
});
test('Skills 表单预留、素材隔离、草稿暂存与全局串行；不会暴露最终发布入口',async t=>{
 let failRun=false;const calls=[];const {s,a,data}=await setup(t,async args=>{calls.push(args);if(failRun)throw new Error('模拟表单错误');return {success:true};});
 await s.bind(a);
 const file=path.join(data,'image.png');await fs.writeFile(file,'fake');
 const composer={title:'测试标题',content:'模拟正文',images:[file],tags:[],visibility:'公开可见'};
 await assert.rejects(s.execute(a,{command:'fill-publish',confirmed:true,composer}),/不属于/);
 a.state.assets[file]={path:file};
 await s.execute(a,{command:'fill-publish',confirmed:true,composer});assert.equal(s.form.phase,'ready');
 await assert.rejects(s.execute(a,{command:'list-feeds'}),/未完成/);
 await assert.rejects(s.execute(a,{command:'save-draft'}),/确认/);
 const saved=await s.execute(a,{command:'save-draft',confirmed:true});assert.match(saved.result.status,/核查/);assert.equal(s.form,null);
 failRun=true;await assert.rejects(s.execute(a,{command:'fill-publish',confirmed:true,composer}),/模拟/);assert.equal(s.form.phase,'uncertain');
 await assert.rejects(s.execute(a,{command:'save-draft',confirmed:true}),/本轮/);s.finish(a);assert.equal(s.form,null);
 s.active={label:'busy'};await assert.rejects(s.bind(a),/其他/);s.active=null;
 assert.ok(calls.every(args=>!args.includes('click-publish')&&!args.includes('publish')));
});

test('填表返回不代表图片有效，破图保留待核查表单且不开放保存',async t=>{
 const {s,a,data,methods,setAssetsReady}=await setup(t,async()=>({success:true}));
 const file=path.join(data,'image.png');await fs.writeFile(file,'fake');a.state.assets[file]={path:file};setAssetsReady(false);
 await assert.rejects(s.execute(a,{command:'fill-publish',confirmed:true,composer:{title:'用户原稿',content:'保留全文',images:[file],tags:[],visibility:'公开可见'}}),/图片/);
 assert.equal(s.form.phase,'uncertain');await assert.rejects(s.execute(a,{command:'save-draft',confirmed:true}),/本轮/);assert.ok(!methods.includes('wb_save_draft'));
});
test('主页登录受限时仅用创作后台身份填写；研究仍需主页登录，错账号不上传',async t=>{
 const calls=[];const {s,a,data,methods,setCreatorIdentity,setPublicError}=await setup(t,async args=>{calls.push(args);return {success:true};});
 a.label='模拟账号A';setPublicError('电脑设备登录超限');
 const file=path.join(data,'image.png');await fs.writeFile(file,'fake');a.state.assets[file]={path:file};
 const composer={title:'已有草稿',content:'保留用户原文',images:[file],tags:[],visibility:'公开可见'};
 await s.preparePublish(a);
 assert.equal(s.status(a.id).creatorReady,true);assert.equal(s.status(a.id).ready,false);
 await s.execute(a,{command:'fill-publish',confirmed:true,composer});
 assert.equal(s.form.phase,'ready');assert.equal(calls.length,1);assert.ok(!methods.includes('wb_identity'));
 s.finish(a);await assert.rejects(s.execute(a,{command:'list-feeds'}),/电脑设备登录超限/);
 assert.equal(calls.length,1);setCreatorIdentity({redId:'other-account'});
 await assert.rejects(s.execute(a,{command:'fill-publish',confirmed:true,composer}),/不一致/);
 assert.equal(calls.length,1);assert.equal(s.form,null);
});

test('Creator monitor uses one bridge command, scopes identity, and rejects old extensions and occupied forms',async t=>{
 const {s,a,methods,ext}=await setup(t,async()=>{throw Error('Monitoring must never use Python or MCP');});
 ext.removeAllListeners('message');let wrong=false,readFailure=false;
 ext.on('message',raw=>{const m=JSON.parse(raw);methods.push(m.method);
  if(readFailure){ext.send(JSON.stringify({id:m.id,error:'页面需要人工处理：扫码验证'}));return;}
  ext.send(JSON.stringify({id:m.id,result:{profile:{redId:wrong?'other':'red-A'},period:m.params.period,range:m.params.period===30?'09-13 至 10-12':'10-06 至 10-12',metrics:[{key:'likes',display:'3'},{key:'comments',display:'5'}]}}));
 });
 const r=await s.monitor(a);assert.equal(r.channel,'skills');assert.equal(r.source,'creator');assert.equal(r.notes.length,0);assert.equal(r.metrics.likes.value,3);assert.equal(r.metrics.comments.value,5);assert.equal(r.metrics.favorites.value,null);
 const month=await s.monitor(a,{period:30});assert.equal(month.period,30);assert.equal(month.range,'09-13 至 10-12');
 wrong=true;await assert.rejects(s.monitor(a),/不一致/);wrong=false;
 readFailure=true;await assert.rejects(s.monitor(a),/扫码验证/);readFailure=false;
 const before=methods.length;s.capabilities=[];await assert.rejects(s.monitor(a),/扩展更新/);assert.equal(methods.length,before);s.capabilities=['creator-metrics-v1'];
 s.form={accountId:a.id};await assert.rejects(s.monitor(a),/发布|流程/);assert.equal(methods.length,before);
 assert.ok(methods.every(m=>m==='wb_creator_metrics'));
});

test('浏览器超时保留连接和绑定，迟到的真实桥接响应解除暂停而不重试',async t=>{
 const {s,a,ext}=await setup(t);await s.bind(a);s.commandTimeout=20;
 ext.removeAllListeners('message');let request;
 ext.on('message',raw=>{request=JSON.parse(raw);});
 await assert.rejects(s.call('wb_identity'),/登录保留/);
 assert.ok(s.extension);assert.equal(s.binding.accountId,a.id);assert.ok(s.stalled);assert.equal(s.pending.size,0,'超时立即释放回调，只留下暂停标识');
 await assert.rejects(s.call('wb_identity'),/尚未结束/);
 ext.send(JSON.stringify({id:request.id,result:{userId:'late-response'}}));
 for(let i=0;i<30&&s.stalled;i++)await delay(10);
 assert.equal(s.stalled,null);assert.equal(s.pending.size,0);
 assert.equal(s.binding.accountId,a.id);
});
test('扩展断开保留未完成发布表单为待核查，不把重连当作已结束',async t=>{
 const {s,a,ext}=await setup(t);s.form={accountId:a.id,session:s.session,phase:'ready',title:'待核查草稿'};
 ext.close();await once(ext,'close');for(let i=0;i<30&&s.extension;i++)await delay(10);
 assert.equal(s.extension,null);assert.equal(s.form.phase,'uncertain');assert.equal(s.form.title,'待核查草稿');
});
test('创作后台读取失败或验证码保留原核实记录，确实未登录或身份不匹配才清除绑定',async t=>{
 const {s,a,setCreatorState}=await setup(t);await s.preparePublish(a);const binding=s.binding;
 for(const value of [{status:'unavailable',errorCode:'BROWSER_PAGE_NOT_READY',message:'不会退出登录或重新扫码'},{status:'identity_unverified',message:'标识未读取完整'},{status:'verification_required',message:'请本人完成安全验证'}]){
  setCreatorState(value);await assert.rejects(s.preparePublish(a));assert.equal(s.binding,binding);
 }
 setCreatorState({status:'login_required',message:'真实页面要求登录'});await assert.rejects(s.preparePublish(a),e=>e.code==='BROWSER_LOGIN_REQUIRED');assert.equal(s.binding,null);
 setCreatorState(null);await s.preparePublish(a);setCreatorState({status:'identity_mismatch',message:'实际账号不一致'});await assert.rejects(s.preparePublish(a),e=>e.code==='BROWSER_IDENTITY_MISMATCH');assert.equal(s.binding,null);
});
test('生成的 Skills DOM 适配器在资源未加载完时也执行已就绪的读取，保持上游命令结果',async t=>{
 const {s}=await setup(t);const url='https://www.xiaohongshu.com/explore';
 const [code,readiness]=await Promise.all(['background.js','browser-readiness.js'].map(file=>fs.readFile(path.join(s.directory,file),'utf8')));
 const requests=[];class FakeSocket{static OPEN=1;static CONNECTING=0;constructor(){this.readyState=0;}}
 const ctx=vm.createContext({URL,Date,setTimeout,clearTimeout,WebSocket:FakeSocket,WB_CONFIG:{url:'ws://127.0.0.1:1'},importScripts(){},chrome:{alarms:{create(){},onAlarm:{addListener(){}}},tabs:{get:async()=>({id:7,url,status:'loading'}),query:async()=>[{id:7,url}]},scripting:{executeScript:async input=>{requests.push(input);return input.injectImmediately?[{result:input.func.name==='wbPageState'?{url,status:'ready',surface:'explore'}:url}]:new Promise(()=>{});}}}});
 vm.runInContext(readiness+'\n'+code,ctx);const value=await vm.runInContext('wbBoundRead(cmdEvaluateInMainWorld("get_url",{}),1000)',ctx);
 assert.equal(value,url);assert.ok(requests.length>=2);assert.ok(requests.every(r=>r.injectImmediately));
 const before=requests.length;await vm.runInContext('handleCommand({method:"wait_dom_stable",params:{}})',ctx);assert.ok(requests.length>before);assert.equal(requests.at(-1).func.name,"wbPageState");
});
test('Manual publish releases only local flow occupancy, preserves uncertain results and protects another account',async()=>{
 const s=new SkillsIntegration({});s.session='session';s.capabilities=['form-state-v1'];s.form={accountId:'A',session:'session',title:'原稿',phase:'uncertain'};s.available=true;
 let state={status:'open'},calls=0;s.call=async method=>{assert.equal(method,'wb_form_state');calls++;return state;};
 await assert.rejects(s.ensureNoForm({id:'A'}),/结束本轮/);assert.ok(s.form);
 state={status:'unknown'};await assert.rejects(s.ensureNoForm({id:'A'}));assert.ok(s.form);
 state={status:'ended',reason:'left_form'};await s.ensureNoForm({id:'A'});assert.equal(s.form,null);assert.equal(s.lastForm.title,'原稿');
 s.form={accountId:'B',session:'session'};const before=calls;await assert.rejects(s.ensureNoForm({id:'A'}));assert.equal(calls,before);assert.throws(()=>s.finish({id:'A'}),/所属账号/);
 assert.ok(s.form);s.finish({id:'B'});assert.equal(s.form,null);
});

test('official smart titles select the first actual candidate, bind this draft, and reuse its prepared form without reupload',async t=>{
 let fills=0;const {s,a,methods}=await setup(t,async()=>{fills++;return {filled:true};});
 const file=path.join(s.data,'one.png');await fs.writeFile(file,'test');a.state.assets.one={path:file};
 const draft={title:'原来的标题',content:'少把自己藏起来。',images:[file],tags:[],visibility:'公开可见'};
 const r=await s.smartTitles(a,draft);assert.equal(r.title,'别再把自己藏起来');assert.equal(r.title,r.candidates[0]);assert.equal(s.form.phase,'title-preview');assert.equal(fills,1);assert.ok(!methods.includes('wb_submit_publish'));
 await s.execute(a,{command:'fill-publish',confirmed:true,composer:{...draft,title:r.title}});assert.equal(fills,1);assert.equal(s.form.phase,'ready');
});
test('editing a prepared title draft refills only its owned preview; failed or foreign suggestions cannot change local title',async t=>{
 let fills=0;const {s,a,setSmartResult}=await setup(t,async()=>{fills++;return {};});
 const file=path.join(s.data,'one.png');await fs.writeFile(file,'test');a.state.assets.one={path:file};
 const draft={title:'原来的标题',content:'少把自己藏起来。',images:[file]};await s.smartTitles(a,draft);
 await s.execute(a,{command:'fill-publish',confirmed:true,composer:{...draft,content:'已修改正文。'}});assert.equal(fills,2);
 s.form=null;setSmartResult({source:'creator',applied:false,candidates:[]});await assert.rejects(s.smartTitles(a,draft),/未确认/);assert.equal(draft.title,'原来的标题');assert.equal(s.form.phase,'ready');
 s.form={accountId:'other',session:s.session,phase:'title-preview'};await assert.rejects(s.smartTitles(a,draft),/未完成/);assert.equal(fills,3);
});
test('old extension stops smart title preparation before upload',async t=>{
 let fills=0;const {s,a}=await setup(t,async()=>{fills++;});s.capabilities=s.capabilities.filter(c=>c!=='creator-smart-titles-v1');
 await assert.rejects(s.smartTitles(a,{title:'原题'}),/应用扩展更新/);assert.equal(fills,0);
});

test('local image previews may obtain titles but never weaken final publishing asset verification',async t=>{
 let fills=0;const {s,a,setAssetsResult}=await setup(t,async()=>{fills++;return {};});
 const file=path.join(s.data,'one.png');await fs.writeFile(file,'test');a.state.assets.one={path:file};
 const draft={title:'原题',content:'正文',images:[file]};setAssetsResult({status:'not_ready',imageCount:1,loadedCount:1,temporaryCount:1});
 const result=await s.smartTitles(a,draft);assert.equal(s.form.assetsVerified,false);
 await assert.rejects(s.execute(a,{command:'fill-publish',confirmed:true,composer:{...draft,title:result.title}}),/尚未完成上传/);assert.equal(fills,2);assert.equal(s.form.phase,'uncertain');
});


test('CRLF vendor input still removes Cookie helper and generates the same constrained extension',async t=>{
 const {buildExtension}=await import('../integrations/skills-extension.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'xhs-crlf-extension-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const vendor=path.join(dir,'vendor'),directory=path.join(dir,'generated');await fs.mkdir(path.join(vendor,'extension'),{recursive:true});
 const upstream=await fs.readFile(path.join(root,'vendor/xiaohongshu-skills/extension/background.js'),'utf8');
 await fs.writeFile(path.join(vendor,'extension/background.js'),upstream.replace(/\r\n?/g,'\n').replaceAll('\n','\r\n'));
 await fs.copyFile(path.join(root,'vendor/xiaohongshu-skills/LICENSE'),path.join(vendor,'LICENSE'));
 await buildExtension({vendor,directory,port:18180,token:'synthetic-test-token'});
 const generated=await fs.readFile(path.join(directory,'background.js'),'utf8');
 assert.doesNotMatch(generated,/document\.cookie|chrome\.cookies|netlog/i);
 assert.match(generated,/function domExecutor/);
});
