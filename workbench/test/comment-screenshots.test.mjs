import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {PNG} from 'pngjs';
import {commentTarget,saveCapture,saveManual,reviewCapture,addToDraft,png,sourceURL,recordFor,cropScreenshot} from '../integrations/comment-screenshots.mjs';
const bytes=PNG.sync.write({width:1,height:1,data:Buffer.from([255,255,255,255])});
test('Lossless crop retains pixel samples, source gamma and retina geometry without resizing',()=>{
 const source=new PNG({width:6,height:4});source.gamma=.45455;for(let i=0;i<source.data.length;i+=4){source.data[i]=i%256;source.data[i+1]=80;source.data[i+2]=210;source.data[i+3]=255;}
 const original=PNG.sync.write(source),cropped=PNG.sync.read(cropScreenshot(original,{x:1,y:1,width:2,height:1},{width:3,height:2}));
 assert.equal(cropped.width,4);assert.equal(cropped.height,2);assert.equal(cropped.gamma,source.gamma);
 assert.deepEqual(cropped.data,Buffer.concat([source.data.subarray((2*6+2)*4,3*6*4),source.data.subarray((3*6+2)*4,4*6*4)]));
 assert.throws(()=>cropScreenshot(original,{x:1,y:1,width:3,height:2},{width:3,height:2}),/超出/);
 const damaged=Buffer.from(bytes);damaged[damaged.length-1]^=1;assert.throws(()=>cropScreenshot(damaged,{x:0,y:0,width:1,height:1},{width:1,height:1}),/解码/);
});
const target={job:{id:'j'},source:{id:'S1',feedId:'note',xsecToken:'token',title:'模拟来源',collectedAt:'2026-10-01'},comment:{id:'S1C1',platformId:'p1',content:'模拟评论',likes:'7'}};
async function setup(t){const data=await fs.mkdtemp(path.join(os.tmpdir(),'comments-test-'));t.after(()=>fs.rm(data,{recursive:true,force:true}));await fs.mkdir(path.join(data,'uploads'));return {data,a:{id:'a',state:{assets:{},drafts:[]}}};}
test('Screenshots retain exact raw bytes, source evidence and scoped assets; review is required; draft append is idempotent and preserves text',async t=>{
 const {data,a}=await setup(t);const r=await saveCapture(data,a,target,{data:bytes.toString('base64'),originalData:bytes.toString('base64'),capturedAt:'2026-10-01',content:'模拟评论',likes:'8',author:'模拟作者',clip:{x:0,y:0,width:1,height:1},viewport:{width:1,height:1}});
 assert.deepEqual(await fs.readFile(r.asset.path),bytes);assert.deepEqual(await fs.readFile(r.originalAsset.path),bytes);assert.equal(r.asset.width,1);assert.equal(r.recordedLikes,'7');assert.equal(r.observedLikes,'8');assert.ok(r.asset.sha256);if(process.platform!=='win32')assert.equal((await fs.stat(r.asset.path)).mode&0o777,0o600);
 assert.throws(()=>addToDraft(a,{captureIds:[r.id]}),/确认评论完整/);assert.throws(()=>recordFor({id:'b',state:{}},r.id),/不属于/);
 await reviewCapture(data,a,r.id);a.state.drafts.push({id:'d',mode:'image',title:'用户标题',content:'用户正文',assets:[{id:'cover'}],updatedAt:'old'});
 assert.throws(()=>addToDraft(a,{captureIds:[r.id],draftId:'d',updatedAt:'stale'}),/修改/);
 const d=addToDraft(a,{captureIds:[r.id],draftId:'d',updatedAt:'old'});assert.equal(d.content,'用户正文');assert.equal(d.title,'用户标题');assert.equal(d.assets[0].id,'cover');assert.equal(d.assets[1].id,r.asset.id);
 addToDraft(a,{captureIds:[r.id],draftId:'d',updatedAt:d.updatedAt});assert.equal(d.assets.length,2);const saved=JSON.parse(await fs.readFile(path.join(data,'comment-evidence',r.id+'.json')));assert.ok(saved.reviewedAt);
});
test('Manual upload keeps original, rejects cross-account assets/invalid platform URLs, binds real comment records, and blocks overflow',async t=>{
 const {data,a}=await setup(t);const dest=path.join(data,'uploads','manual.png');await fs.writeFile(dest,bytes);a.state.assets.asset={id:'asset',path:dest,mime:'image/png'};
 await assert.rejects(saveManual(data,a,{assetId:'foreign',platform:'抖音',sourceURL:'https://douyin.com/x'}),/上传/);
 assert.throws(()=>sourceURL('https://douyin.com.evil.test/x','抖音'),/不一致/);assert.throws(()=>sourceURL('https://xiaohongshu.com/x','快手'),/不一致/);
 const r=await saveManual(data,a,{assetId:'asset'},target);assert.equal(r.asset.id,r.originalAsset.id);assert.equal(r.commentId,'S1C1');assert.equal(r.kind,'manual');assert.equal(r.reviewedAt,null);assert.equal((await saveManual(data,a,{assetId:'asset'},target)).id,r.id);
 await reviewCapture(data,a,r.id);a.state.drafts=[{id:'full',mode:'image',updatedAt:'old',assets:Array.from({length:18},(_,i)=>({id:String(i)}))}];assert.throws(()=>addToDraft(a,{draftId:'full',updatedAt:'old',captureIds:[r.id]}),/18/);assert.equal(a.state.drafts[0].assets.length,18);
 assert.throws(()=>png(Buffer.from('not an image')),/PNG/);await assert.rejects(saveCapture(data,a,target,{data:'bad',originalData:'bad'}),/PNG/);
 assert.throws(()=>commentTarget({jobs:[{id:'j',accountId:'b'}]},'a',{jobId:'j'}),/不属于/);
});
test('Actual extension DOM guard detects mismatching text, clipping, overlays and verification before screenshot',async()=>{
 const code=await fs.readFile(new URL('../integrations/comment-capture-extension.js',import.meta.url),'utf8');let height=100,content='模拟完整评论',covered=false,blocked=false;
 const contentEl={innerText:content,scrollHeight:40,clientHeight:40};const body={};const card={parentElement:body,querySelectorAll:()=>[],querySelector:s=>s.includes('.content')?contentEl:s.includes('.name')?{innerText:'模拟用户'}:{innerText:'8'},getBoundingClientRect:()=>({left:30,top:30,right:330,bottom:30+height,width:300,height}),contains:x=>x===card};
 const doc={body,getElementById:()=>card,querySelector:()=>null,querySelectorAll:s=>s.includes('access-wrapper')&&blocked?[{innerText:'验证码',getBoundingClientRect:()=>({width:200,height:100})}]:[],elementFromPoint:()=>covered?{}:card};
 const sandbox={document:doc,innerWidth:800,innerHeight:600,devicePixelRatio:2,scrollX:0,scrollY:0,getComputedStyle:()=>({visibility:'visible',overflow:'visible',overflowY:'visible'})};vm.createContext(sandbox);vm.runInContext(code,sandbox);const inspect=()=>sandbox.wbCommentDOM({commentId:'p1',expectedText:'模拟完整评论',action:'measure'});
 // querySelector(':scope > .comment-item') should resolve to no nested card.
 const original=card.querySelector;card.querySelector=s=>s.startsWith(':scope')?null:original(s);
 assert.ok(inspect().clip);contentEl.innerText='错误的评论';assert.match(inspect().error,/不一致/);contentEl.innerText=content;
 height=700;assert.match(inspect().error,/一屏/);height=100;covered=true;assert.match(inspect().error,/遮挡/);covered=false;blocked=true;assert.match(inspect().error,/人工处理/);
});

test('Capture measures after debugger viewport changes and always detaches on completion',async()=>{
 const code=await fs.readFile(new URL('../integrations/comment-capture-extension.js',import.meta.url),'utf8');let attached=false;const events=[];
 const sandbox={URL,allowedHost:()=>true,cmdNavigate:async()=>{},getOrOpenXhsTab:async()=>({id:1}),sleep:async()=>{},chrome:{tabs:{get:async()=>({url:'https://www.xiaohongshu.com/explore/note'})},scripting:{executeScript:async({args})=>{const action=args[0].action;events.push(action);return [{result:action==='find'?{found:true}:action==='reveal'?{}:{content:'评论原文',clip:{x:1,y:attached?20:50,width:200,height:80},viewport:{scrollX:0,scrollY:0},author:'作者',likes:'7'}}];}},debugger:{attach:async()=>{attached=true;events.push('attach');},sendCommand:async()=>({data:'png'}),detach:async()=>{attached=false;events.push('detach');}}}};
 vm.createContext(sandbox);vm.runInContext(code,sandbox);
 const r=await sandbox.wbCaptureComment({url:'https://www.xiaohongshu.com/explore/note',commentId:'p1',expectedText:'评论原文'});
 assert.equal(r.clip.y,20);assert.equal(attached,false);assert.ok(events.indexOf('attach')<events.indexOf('measure'));assert.equal(events.at(-1),'detach');
});
