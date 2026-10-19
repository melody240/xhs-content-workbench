import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {WebSocket} from 'ws';
import {PNG} from 'pngjs';
import {AccountStore} from '../accounts.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('素材 API 完整往返：隔离账号、图片导入下载、公开页面采集、旧扩展拦截评论、软删除',async t=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'materials-api-')),store=await AccountStore.open(data,'http://127.0.0.1:65534/mcp'),a=store.items[0],b=await store.add('另一个测试账号');await store.save();
 const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,WORKBENCH_ALLOW_LEGACY_MCP:'0',WORKBENCH_DATA_DIR:data,WORKBENCH_PORT:String(port)},stdio:'ignore'});let ext;
 t.after(async()=>{ext?.terminate();const end=once(child,'exit');child.kill('SIGTERM');await end;await fs.rm(data,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+port;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await delay(50);}
 const request=(route,body,owner=a.id)=>fetch(base+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Workbench-Request':'1','X-Workbench-Account':owner},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await request('/api/materials/check',{})).status,409);
 const bytes=PNG.sync.write({width:1,height:1,data:Buffer.from([10,90,190,255])});
 const uploaded=await fetch(base+'/api/assets?name=picture.png',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Workbench-Request':'1','X-Workbench-Account':a.id},body:bytes});assert.equal(uploaded.status,200);const asset=await uploaded.json();
 const added=await request('/api/materials/manual',{assetId:asset.id});assert.equal(added.status,200);const image=await added.json();
 assert.equal((await request('/api/materials/manual',{assetId:asset.id},b.id)).status,404);
 assert.equal((await request('/api/materials/pick',{ids:[image.id]},b.id)).status,404);
 const exported=await request('/api/materials/export',{ids:[image.id]});assert.equal(exported.status,200);assert.equal(exported.headers.get('Content-Type'),'application/zip');const zipped=Buffer.from(await exported.arrayBuffer());assert.equal(zipped.includes(bytes),true);assert.equal(zipped.includes(Buffer.from('.json')),false);
 assert.equal((await request('/api/materials/settings',{hours:24,enabled:true})).status,200);
 const source=await (await request('/api/materials/source',{name:'测试博主',url:'https://x.com/test',autoCapture:false})).json();
 const token=(await fs.readFile(path.join(data,'skills-bridge-token'),'utf8')).trim(),methods=[];
 ext=new WebSocket(`ws://127.0.0.1:${port}/skills-bridge`,{origin:'chrome-extension://'+'a'.repeat(32)});await once(ext,'open');ext.on('message',raw=>{const m=JSON.parse(raw);methods.push(m.method);ext.send(JSON.stringify({id:m.id,result:{items:[{url:'https://x.com/test/status/123',text:'真实 DOM 模拟帖子'}]}}));});ext.send(JSON.stringify({role:'extension',token,capabilities:['source-library-v1']}));await delay(40);
 assert.equal((await request('/api/materials/check',{sourceId:source.id})).status,202);
 let l;for(let i=0;i<40;i++){l=await(await request('/api/materials')).json();if(!l.active&&l.items.length)break;await delay(25);}assert.equal(l.items.length,1);assert.deepEqual(methods,['wb_source_scan']);assert.equal((await(await request('/api/materials',null,b.id)).json()).items.length,0);
 const noComments=await request('/api/skills/run',{command:'fill-publish',composer:{title:'测试',content:'正文',images:[asset.path]},confirmed:true,afterComments:['补充观点']});assert.equal(noComments.status,409);assert.equal(methods.length,1);
 await request('/api/materials/archive-source',{id:source.id});await request('/api/materials/archive-image',{id:image.id});l=await(await request('/api/materials')).json();assert.equal(l.images.length,0);assert.equal(l.sources.length,0);assert.equal((await fs.readFile(asset.path)).equals(bytes),true);
 assert.equal(l.deletedImages[0].id,image.id);assert.equal((await(await request('/api/materials',null,b.id)).json()).deletedImages.length,0);
 assert.equal((await request('/api/materials/restore-image',{id:image.id},b.id)).status,404);assert.equal((await request('/api/materials/pick',{ids:[image.id]})).status,404);
 assert.equal((await request('/api/materials/restore-image',{id:image.id})).status,200);l=await(await request('/api/materials')).json();assert.equal(l.images[0].id,image.id);assert.equal(l.deletedImages.length,0);assert.equal((await request('/api/materials/pick',{ids:[image.id]})).status,200);assert.equal((await fs.readFile(asset.path)).equals(bytes),true);
 const commentUpload=await fetch(base+'/api/assets?name=comment.png',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Workbench-Request':'1','X-Workbench-Account':a.id},body:bytes});const commentAsset=await commentUpload.json();
 const capture=await(await request('/api/comments/manual',{assetId:commentAsset.id,platform:'抖音',sourceURL:'https://www.douyin.com/video/123'})).json();
 l=await(await request('/api/materials')).json();assert.equal(l.assets.find(r=>r.id===commentAsset.id).category,'douyin-comments');
 assert.equal((await request('/api/materials/pick',{ids:[capture.id,commentAsset.id]})).status,200);assert.equal((await request('/api/materials/pick',{ids:[commentAsset.id]},b.id)).status,404);
 const bg=await request('/api/materials/background',{assetId:asset.id});assert.equal(bg.status,200);assert.equal((await(await request('/api/materials/background')).json()).background.id,asset.id);
 assert.equal((await request('/api/materials/background',{assetId:asset.id},b.id)).status,404);assert.equal((await(await request('/api/materials/background',null,b.id)).json()).background.id,'default');
 await request('/api/materials/background',{});assert.equal((await(await request('/api/materials/background')).json()).background.id,'default');
 const collageUpload=await fetch(base+'/api/assets?name=collage.png',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Workbench-Request':'1','X-Workbench-Account':a.id},body:PNG.sync.write({width:1200,height:1600,data:Buffer.alloc(1200*1600*4,255)})});const collage=await collageUpload.json();
 const composition={assetId:collage.id,sourceAssetIds:[asset.id,commentAsset.id],background:'default',columns:1};
 assert.equal((await request('/api/materials/collage',composition,b.id)).status,404);assert.equal((await request('/api/materials/collage',composition)).status,200);
 assert.deepEqual(await fs.readFile(asset.path),bytes);assert.deepEqual(await fs.readFile(commentAsset.path),bytes);
 const draft=await(await request('/api/drafts',{title:'保留引用',mode:'image',assets:[commentAsset,asset]})).json();
 assert.equal((await request('/api/materials/archive-image',{id:commentAsset.id})).status,200);l=await(await request('/api/materials')).json();assert.ok(l.assets.find(r=>r.id===commentAsset.id).archivedAt);
 assert.equal((await request('/api/materials/restore-image',{id:commentAsset.id})).status,200);
 const current=await(await request('/api/status')).json();assert.deepEqual(current.drafts.find(d=>d.id===draft.id).assets.map(r=>r.id),[commentAsset.id,asset.id]);assert.deepEqual(await fs.readFile(commentAsset.path),bytes);
});

test('X 自动采集先筛广告与无关帖，再按中文翻译筛除坏译文，语录和照片完整保存',async t=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'material-filter-api-'));
 const store=await AccountStore.open(data,'http://127.0.0.1:65534/mcp'),owner=store.items[0].id;await store.save();
 let invalidModel=false,changedSource=false;
 const fakeModel=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const input=JSON.parse(raw),posts=JSON.parse(input.messages[1].content).posts;
  const items=posts.map(p=>({id:p.id,category:p.text.includes('服务器')?'unrelated':p.text.includes('身体从不')?'unreadable':'useful',confidence:.98,reason:'测试编辑判断'}));
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:invalidModel?'invalid JSON':JSON.stringify({items})},finish_reason:'stop'}]}));
 });fakeModel.listen(0,'127.0.0.1');await once(fakeModel,'listening');
 const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,WORKBENCH_DATA_DIR:data,WORKBENCH_PORT:String(port)},stdio:'ignore'});let ext;
 t.after(async()=>{ext?.terminate();const end=once(child,'exit');child.kill('SIGTERM');await end;await new Promise(r=>fakeModel.close(r));await fs.rm(data,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+port;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await delay(50);}
 const request=(route,body)=>fetch(base+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Workbench-Request':'1','X-Workbench-Account':owner},...(body?{body:JSON.stringify(body)}:{})});
 await request('/api/model',{provider:'custom',baseURL:'http://127.0.0.1:'+fakeModel.address().port,model:'test',apiKey:'local-test'});
 const source=await(await request('/api/materials/source',{name:'测试作者',url:'https://x.com/author'})).json();
 const bytes=PNG.sync.write({width:80,height:120,data:Buffer.from(Array.from({length:80*120*4},(_,i)=>i%4===3?255:i%250))});
 const methods=[],token=(await fs.readFile(path.join(data,'skills-bridge-token'),'utf8')).trim();
 ext=new WebSocket(`ws://127.0.0.1:${port}/skills-bridge`,{origin:'chrome-extension://'+'a'.repeat(32)});await once(ext,'open');
 ext.on('message',raw=>{const m=JSON.parse(raw);methods.push(m.method);let result;
  if(m.method==='wb_source_scan')result={items:[{url:'https://x.com/author/status/1',text:'身后一无所有，前方应有尽有。',hasPhotos:true},{url:'https://x.com/author/status/2',text:'A meaningful original before native translation.'},{url:'https://x.com/author/status/3',text:'Pre-order my book',hasPhotos:true},{url:'https://x.com/author/status/4',text:'服务器维护完成'}]};
  else {const good=m.params.url.endsWith('/1');result={url:m.params.url,bodyText:good?'身后一无所有，前方应有尽有。':'身体从不明天因为爱情山。',hasPhotos:good,originalData:bytes.toString('base64'),captureMode:'post',documentClip:{x:200,y:100,width:80,height:120},clip:{x:0,y:0,width:80,height:120},viewport:{width:80,height:120},pageViewport:{width:1280,height:720}};}
  if(changedSource&&m.method==='wb_source_scan')result.items[0].text+=' 这是新观察到的正文。';
  ext.send(JSON.stringify({id:m.id,result}));
 });ext.send(JSON.stringify({role:'extension',token,capabilities:['source-library-v1']}));await delay(40);
 assert.equal((await request('/api/materials/check',{sourceId:source.id})).status,202);
 let l;for(let i=0;i<100;i++){l=await(await request('/api/materials')).json();if(!l.active&&l.lastRun)break;await delay(25);}
 assert.equal(l.lastRun.failed,0);assert.equal(l.lastRun.filtered,3);assert.equal(l.images.length,1);assert.equal(l.items.length,1);assert.equal(l.items[0].hasPhotos,true);assert.equal(l.images[0].asset.width,80);assert.equal(l.images[0].asset.height,120);
 assert.equal(methods.filter(m=>m==='wb_capture_material').length,2);
 const disk=await AccountStore.open(data,'http://127.0.0.1:65534/mcp'),all=disk.items[0].state.materialLibrary.items;
 const bad=all.find(i=>i.url.endsWith('/2'));assert.equal(bad.captureReview.category,'unreadable');assert.equal(all.length,4);
 const filtered=await(await request('/api/materials/capture',{itemId:bad.id})).json();assert.equal(filtered.filtered,true);assert.equal(methods.filter(m=>m==='wb_capture_material').length,2);
 assert.deepEqual(await fs.readFile(l.images[0].asset.path),bytes);
 // First fail during scan, leaving an unreviewed item. The next run fails
 // while screening that existing item, outside the per-source catch.
 invalidModel=true;changedSource=true;
 for(let run=0;run<2;run++){
  const previous=l.lastRun.at;assert.equal((await request('/api/materials/check',{sourceId:source.id})).status,202);
  for(let i=0;i<100;i++){l=await(await request('/api/materials')).json();if(!l.active&&l.lastRun.at!==previous)break;await delay(25);}
  assert.equal(l.active,null);assert.equal(l.lastRun.failed,1);assert.match(l.sources[0].error,/筛选结果/);
  assert.equal((await request('/api/health')).status,200);assert.equal(l.images.length,1);
 }
});
