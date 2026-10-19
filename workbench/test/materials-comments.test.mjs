import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {PNG} from 'pngjs';
import {materialURL,library,saveSource,archiveSource,mergeMaterials,storeMaterialCapture,pickMaterials,imageZip,saveLibrarySettings,publicLibrary} from '../integrations/material-library.mjs';
import {commentTexts,enqueueComments,matchingOwnNote,PostComments} from '../integrations/post-comments.mjs';
const account=()=>({id:'a',identity:{userId:'userA',redId:'redA'},state:{assets:{}}});
const recentId=()=>Math.floor(Date.now()/1000).toString(16).padStart(8,'0')+'0000000000000001';
const profile=(feeds=[])=>({userId:'userA',basicInfo:{redId:'redA'},feeds});
const jobFor=a=>{const j=enqueueComments(a,{key:'k',title:'具体观点',content:'真实正文',comments:['第一条补充观点','第二条补充观点']});j.nextCheckAt=0;return j;};

test('素材链接拒绝伪装域名和短链，主页与公开帖子去重，移除后可恢复，账号隔离',()=>{
 assert.deepEqual(materialURL('https://twitter.com/Example/status/123?tracking=1'),{url:'https://x.com/Example/status/123',platform:'x'});
 for(const u of ['https://x.com.evil.test/test','https://name:pass@x.com/author','http://x.com/author','https://x.com/i/flow/login','https://v.douyin.com/abc','https://www.douyin.com/../login'])assert.throws(()=>materialURL(u));
 const a=account(),s=saveSource(a,{url:'https://x.com/author',name:'来源'});assert.equal(s.autoCapture,true);
 assert.equal(saveSource(a,{url:s.url,name:'新名称'}).id,s.id);archiveSource(a,s.id);assert.equal(publicLibrary(a).sources.length,0);saveSource(a,{url:s.url});assert.equal(publicLibrary(a).sources.length,1);
 assert.throws(()=>saveLibrarySettings(a,{hours:1,enabled:true}));assert.deepEqual(saveLibrarySettings(a,{hours:24,enabled:true}),{hours:24,enabled:true});
 const items=[{url:'https://x.com/author/status/123',text:'帖子',html:'<script>bad</script>'},{url:'https://www.douyin.com/video/123',text:'跨平台'}];assert.equal(mergeMaterials(a,s,{items}),1);assert.equal(mergeMaterials(a,s,{items}),0);assert.equal(library(a).items[0].html,undefined);assert.equal(library(account()).items.length,0);
});

test('素材截图保留完整原图、像素与任意比例，拒绝空白、换页和越界，下载包只有图片',async t=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'material-test-'));t.after(()=>fs.rm(data,{recursive:true,force:true}));await fs.mkdir(path.join(data,'uploads'));
 const a=account(),item={id:'i',url:'https://x.com/author/status/123',platform:'x'};
 const image=new PNG({width:12,height:8});for(let i=0;i<image.data.length;i+=4){image.data[i]=(i*17)%256;image.data[i+1]=80;image.data[i+2]=210;image.data[i+3]=255;}
 const bytes=PNG.sync.write(image),result={url:item.url,originalData:bytes.toString('base64'),clip:{x:1,y:1,width:2,height:3},viewport:{width:6,height:4}};
 const saved=await storeMaterialCapture(data,a,item,result);assert.equal(saved.asset.width,4);assert.equal(saved.asset.height,6);assert.deepEqual(await fs.readFile(saved.originalAsset.path),bytes);
 assert.equal((await storeMaterialCapture(data,a,item,result)).id,saved.id);assert.throws(()=>pickMaterials(account(),[saved.id]),/当前账号/);assert.equal(pickMaterials(a,[saved.id,saved.id]).length,1);assert.equal(publicLibrary(a).images[0].originalAsset,undefined);
 await assert.rejects(storeMaterialCapture(data,a,item,{...result,url:'https://x.com/author/status/124'}),/变化/);
 await assert.rejects(storeMaterialCapture(data,a,item,{...result,clip:{x:5,y:2,width:2,height:3}}),/超出/);
 const blank=PNG.sync.write({width:12,height:8,data:Buffer.alloc(12*8*4,255)});await assert.rejects(storeMaterialCapture(data,a,item,{...result,originalData:blank.toString('base64')}),/空白/);
 const zip=imageZip([{bytes,name:'01.png'}]);assert.equal(zip.readUInt32LE(0),0x04034b50);const nameSize=zip.readUInt16LE(26);assert.equal(zip.subarray(30,30+nameSize).toString(),'01.png');assert.deepEqual(zip.subarray(30+nameSize,30+nameSize+bytes.length),bytes);assert.equal(zip.readUInt16LE(zip.length-14),1);assert.equal(zip.includes(Buffer.from(item.url)),false);
});

test('发布后评论只匹配当前账号本次新笔记，不冒用旧笔记、同名账号或时间不明的笔记',()=>{
 const a=account(),j=jobFor(a),id=recentId();assert.equal(enqueueComments(a,{key:'k',title:'另一个标题',comments:['另一条']}).id,j.id);
 assert.equal(matchingOwnNote(j,profile([{id,title:j.title,xsecToken:'t'}])).length,1);
 assert.equal(matchingOwnNote(j,profile([{id:'111111110000000000000000',title:j.title},{id,title:'不同标题'},{id:'unknown',title:j.title}])).length,0);
 j.beforeIds=[id];assert.equal(matchingOwnNote(j,profile([{id,title:j.title}])).length,0);
 assert.throws(()=>matchingOwnNote(j,{...profile(),userId:'userB'}),/账号/);assert.throws(()=>commentTexts(['重复','重 复']),/重复/);assert.throws(()=>commentTexts(['a','b','c','d']),/最多/);
});

test('评论发送意图先落盘，成功后逐条核实；重复执行和重启不会重发',async()=>{
 const a=account(),j=jobFor(a),calls=[],saved=[];
 const skills={operation:async(a,label,fn)=>fn('session'),call:async(method,params)=>{calls.push(method);if(method==='wb_own_recent_notes')return profile([{id:recentId(),title:j.title,xsecToken:'token'}]);assert.equal(saved.at(-1).comments.find(c=>c.text===params.text).status,'sending');return {status:'verified',sendClicked:true,url:params.url,visibleText:params.text};}};
 const processor=new PostComments({skills,persist:async()=>saved.push(structuredClone(j))});await processor.process(a,j);assert.equal(j.status,'completed');assert.equal(calls.filter(m=>m==='wb_post_own_comment').length,2);await processor.process(a,j);assert.equal(calls.length,3);
 const restarted=jobFor(account());restarted.comments[0].status='sending';await processor.process(a,restarted);assert.equal(restarted.status,'needs_attention');assert.equal(calls.length,3);
});

test('发布审核未完成时不发送；结果不明停止第二条，账号漂移与重复匹配也不会发送',async()=>{
 for(const scenario of ['waiting','ambiguous','uncertain','drift','blocked']){
  const a=account(),j=jobFor(a);let sends=0;const n={id:recentId(),title:j.title,xsecToken:'t'};
  if(scenario==='drift')a.identity.userId='userB';
  const skills={operation:async(a,label,fn)=>fn('s'),call:async method=>{if(method==='wb_own_recent_notes')return profile(scenario==='waiting'?[]:scenario==='ambiguous'?[n,n]:[n]);sends++;if(scenario==='blocked')return {status:'blocked',sendClicked:false,message:'验证码'};throw Error('发送响应断开');}};
  const processor=new PostComments({skills,persist:async()=>{}});await processor.process(a,j);
  assert.equal(sends,['uncertain','blocked'].includes(scenario)?1:0);assert.equal(j.status,['waiting','ambiguous'].includes(scenario)?'waiting_note':'needs_attention');
  j.nextCheckAt=0;await processor.process(a,j);assert.equal(sends,['uncertain','blocked'].includes(scenario)?1:0);
 }
});

const extension=await fs.readFile(new URL('../integrations/source-capture-extension.js',import.meta.url),'utf8');
test('素材页面区分失效来源与 X 登录，暂停后给出具体操作，不误报小红书登录失效',()=>{
 const document={body:{innerText:'唔...该页面不存在。'},querySelectorAll:()=>[],querySelector:()=>null};
 const context=vm.createContext({URL,document,location:{pathname:'/missing'}});vm.runInContext(extension,context);
 assert.match(context.wbSourceDOM({platform:'x',action:'scan'}).error,/不存在.*核对链接/);
 assert.equal(context.wbSourceDOM({platform:'x',action:'scan',url:'https://x.com/newSource'}).loading,true);
 document.body.innerText='登录或注册 X';assert.match(context.wbSourceDOM({platform:'x',action:'scan'}).error,/登录 X.*不需要重新登录小红书/);
 document.querySelector=()=>({});assert.equal(context.wbSourceDOM({platform:'x',action:'scan'}).error,undefined);
 document.body.innerText='登录 X 前，请先进行真人验证';context.location.pathname='/i/jf/onboarding/web';assert.match(context.wbSourceDOM({platform:'x',action:'scan'}).error,/本人.*平台验证.*暂停/);
});
test('新平台权限由用户开启；定期检查不激活标签页，不更改小红书发布页',async()=>{
 const created=[],updated=[],context=vm.createContext({URL,Map,Date,chrome:{permissions:{contains:async()=>false},tabs:{create:async p=>{created.push(p);return {id:3,url:p.url};},update:async(id,p)=>{updated.push(p);return {id,url:p.url};},get:async()=>null},scripting:{executeScript:async()=>[{result:{items:[{url:'https://x.com/test/status/1'}]}}]}},sleep:async()=>{}});vm.runInContext(extension,context);
 await assert.rejects(vm.runInContext('wbSourceScan({url:"https://x.com/test",scheduled:true})',context),/权限/);assert.equal(created.length,0);
 context.chrome.permissions.contains=async()=>true;await vm.runInContext('wbSourceScan({url:"https://x.com/test",scheduled:true})',context).catch(()=>{});assert.equal(created[0].active,false);assert.equal(updated.some(p=>p.active),false);
});

test('评论 DOM 必须核实本人账号、作者和正文；可见相同本人评论无需再发送',()=>{
 let author='userA',own='userA',body='真实正文',existing=false,clicks=0;
 const input={isContentEditable:true,textContent:'补充',innerText:'补充',getClientRects:()=>[{}]};const button={innerText:'发送',getClientRects:()=>[{}],click:()=>clicks++};
 const comment={querySelector:s=>s.includes('author')?{href:'https://www.xiaohongshu.com/user/profile/userA'}:{innerText:'补充'},closest:()=>({id:'comment-1'})};
 const note={querySelector:s=>s.startsWith('.author')?{href:'https://www.xiaohongshu.com/user/profile/'+author}:s.includes('detail-title')?{innerText:'具体观点'}:s.includes('detail-desc')?{innerText:body}:input,querySelectorAll:s=>s==='button'?[button]:existing?[comment]:[]};
 const ctx=vm.createContext({URL,document:{querySelector:()=>note},location:{pathname:'/explore/note1',href:'https://www.xiaohongshu.com/explore/note1'},getComputedStyle:()=>({visibility:'visible'}),wbPageState:()=>({status:'ready'}),wbSelfLinkDOM:()=>'/user/profile/'+own});vm.runInContext(extension,ctx);
 const inspect=()=>ctx.wbOwnCommentDOM({feedId:'note1',userId:'userA',title:'具体观点',body:'真实正文',text:'补充',action:'send',pageState:{status:'ready'},selfLink:'/user/profile/'+own});
 assert.equal(inspect().sendClicked,true);assert.equal(clicks,1);
 author='userB';assert.match(inspect().error,/本人|当前账号/);author='userA';own='userB';assert.match(inspect().error,/登录账号/);own='userA';body='另一篇正文';assert.match(inspect().error,/不一致/);body='真实正文';existing=true;assert.equal(inspect().status,'already_present');assert.equal(clicks,1);
});

 test('定时评论从预期发布开始等待，已经存在的近期笔记不误认为新提交',()=>{
 const a=account(),later=Date.now()+7*86400000,j=enqueueComments(a,{key:'scheduled',title:'定时笔记',comments:['补充'],scheduleAt:new Date(later).toISOString()});assert.ok(j.nextCheckAt>=later);assert.ok(j.expiresAt>=later+86400000);
 const oldId=Math.floor((Date.parse(j.createdAt)-5000)/1000).toString(16).padStart(8,'0')+'0000000000000001';assert.equal(matchingOwnNote(j,profile([{id:oldId,title:j.title}])).length,0);
 });

test('照片预览只保留公开平台图片，限制数量，拒绝外站、认证网址与脚本，旧扩展不擦掉预览',()=>{
 const a=account(),s=saveSource(a,{url:'https://x.com/author'}),url='https://x.com/author/status/123';
 const photo='https://pbs.twimg.com/media/photo.jpg?name=small';
 mergeMaterials(a,s,{items:[{url,text:'真实照片',photos:[photo,photo,'https://evil.test/pic','javascript:alert(1)','https://user:pass@pbs.twimg.com/media/a.jpg'],avatar:'https://pbs.twimg.com/profile_images/avatar.jpg'}]});
 assert.deepEqual(library(a).items[0].photos,[photo]);assert.match(library(a).items[0].avatar,/profile_images/);
 mergeMaterials(a,s,{items:[{url,text:'真实照片'}]});assert.deepEqual(library(a).items[0].photos,[photo]);
 mergeMaterials(a,s,{items:[{url,text:'真实照片',photos:[],avatar:null}]});assert.deepEqual(library(a).items[0].photos,[]);assert.equal(library(a).items[0].avatar,null);
});

test('手动获取博主让页面加载照片后恢复原标签页，用户切走时不抢回焦点',async()=>{
 for(const userMoves of [false,true]){
  let active=9,reads=0;const updates=[],removed=[];const url='https://x.com/test';
  const ctx=vm.createContext({URL,Map,Date,sleep:async()=>{},chrome:{permissions:{contains:async()=>true},tabs:{create:async()=>({id:3,url,windowId:1}),get:async()=>({id:3,url,windowId:1}),query:async()=>[{id:active}],update:async(id,p)=>{if(p.active){active=id;updates.push(id);}return {id,url,windowId:1};},remove:async id=>removed.push(id)},scripting:{executeScript:async()=>{reads++;if(userMoves&&reads===2)active=11;return [{result:{items:Array.from({length:20},(_,n)=>({url:url+'/status/'+n,photos:['https://pbs.twimg.com/media/real.jpg']}))}}];}}}});
  vm.runInContext(extension,ctx);const result=await ctx.wbSourceScan({url,scheduled:false});assert.equal(result.items.length,20);assert.deepEqual(updates,userMoves?[3]:[3,9]);assert.equal(active,userMoves?11:9);assert.deepEqual(removed,[3]);
 }
});
