import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {PNG} from 'pngjs';
import {storeMaterialCapture} from '../integrations/material-library.mjs';
const code=await fs.readFile(new URL('../integrations/source-capture-extension.js',import.meta.url),'utf8');
const url='https://x.com/author/status/123';
function fixture(){
 const model={height:1700,text:'第一行\n完整正文\n最后一行',blocked:false,folded:false,loaded:true,avatar:true,avatarLoaded:true,translated:true,canTranslate:true,translationClicks:0,playing:false},commands=[];
 let ctx;
 const rect=()=>({left:260,right:860,top:100-ctx.scrollY,bottom:100-ctx.scrollY+model.height,width:600,height:model.height});
 const link={href:url,querySelector:()=>({})},image={getBoundingClientRect:rect,get complete(){return model.loaded;},get naturalWidth(){return model.loaded?600:0;},naturalHeight:500,src:'https://pbs.twimg.com/media/example.jpg'},root={getBoundingClientRect:rect,contains:e=>e===root,get innerText(){return model.text;},querySelectorAll:s=>s==='a[href*="/status/"]'?[link]:s==='img'?[image]:s==='video'?[{get paused(){return !model.playing;}}]:s.includes('button')&&model.folded?[{innerText:'显示更多',getBoundingClientRect:rect}]:[]};
 const avatar={getBoundingClientRect:rect,get complete(){return model.avatarLoaded;},get naturalWidth(){return model.avatarLoaded?64:0;},naturalHeight:64,src:'https://pbs.twimg.com/profile_images/avatar.jpg',decode:async()=>commands.push('decode')};
 const nativeTranslate={getBoundingClientRect:rect,innerText:'显示翻译',click:()=>{model.translationClicks++;model.translated=true;},getAttribute:()=>''};
 root.querySelector=s=>s.includes('UserAvatar')?(model.avatar?avatar:null):s.includes('tweetText')?{get innerText(){return model.translated?model.text:'Some English text that must be translated before screenshot.';}}:null;
 const originalQuery=root.querySelectorAll;root.querySelectorAll=s=>s==='img'?[image,...(model.avatar?[avatar]:[])]:s.includes('button')&&!model.translated&&model.canTranslate?[nativeTranslate]:originalQuery(s);
 const document={body:{innerText:model.text},querySelectorAll:s=>s==='article[data-testid="tweet"]'?[root]:[],querySelector:()=>root,elementFromPoint:()=>model.blocked?{}:root};
 ctx=vm.createContext({URL,Date,Map,document,location:{pathname:'/author/status/123',href:url},innerWidth:1200,innerHeight:720,devicePixelRatio:2,scrollX:0,scrollY:0,getComputedStyle:()=>({visibility:'visible',display:'block',overflowY:'visible'}),window:{scrollTo:p=>{ctx.scrollY=p.top;}},sleep:async()=>{},chrome:{tabs:{getZoom:async()=>1},scripting:{executeScript:async({func,args})=>[{result:await func(...args)}]},debugger:{attach:async()=>commands.push('attach'),detach:async()=>commands.push('detach'),sendCommand:async(target,method,params)=>{commands.push({method,params});return {data:'png'};}}}});
 vm.runInContext(code,ctx);ctx.wbSourceTab=async()=>({id:1,url});
 return {ctx,model,commands,measure:()=>ctx.wbSourceDOM({platform:'x',action:'measure',url})};
}
test('长帖按整条真实帖子文档坐标截图，逐段查看，保持字号和宽度，释放调试连接',async()=>{
 const {ctx,commands}=fixture();const r=await ctx.wbMaterialCapture({url});
 assert.equal(r.captureMode,'long-post');assert.equal(r.documentClip.y,100);assert.equal(r.documentClip.height,1700);assert.equal(r.viewport.height,1700);assert.equal(r.pageViewport.height,720);assert.equal(r.clip.y,0);assert.equal(r.visibleText.split('\n').at(-1),'最后一行');
 const screenshot=commands.find(c=>c.method==='Page.captureScreenshot');assert.equal(screenshot.params.captureBeyondViewport,true);assert.equal(screenshot.params.clip.scale,1);assert.equal(screenshot.params.clip.width,600);assert.equal(screenshot.params.clip.height,1700);assert.equal(commands.filter(c=>typeof c==='object').length,1);assert.equal(commands.at(-1),'detach');assert.equal(ctx.scrollY,20);
});
test('长截图拒绝折叠、遮挡、未加载、播放视频和异常长度；不保存不完整素材',async()=>{
 for(const [key,value,message] of [['folded',true,/展开/],['blocked',true,/遮挡/],['loaded',false,/加载/],['avatar',false,/头像/],['avatarLoaded',false,/头像/],['playing',true,/暂停/],['height',11000,/过长/]]){
  const f=fixture();f.model[key]=value;await assert.rejects(f.ctx.wbMaterialCapture({url}),message);assert.equal(f.commands.at(-1),'detach');assert.equal(f.commands.some(c=>c.method==='Page.captureScreenshot'),false);
 }
});
test('截图引起的文字或边界变化不保存；截图命令失败仍释放调试连接',async()=>{
 for(const change of ['text','height','failure']){
  const f=fixture();f.ctx.chrome.debugger.sendCommand=async()=>{if(change==='failure')throw Error('截屏失败');if(change==='text')f.model.text+='新增行';else f.model.height++;return {data:'png'};};
  await assert.rejects(f.ctx.wbMaterialCapture({url}),change==='failure'?/截屏失败/:/发生变化/);assert.equal(f.commands.at(-1),'detach');
 }
});
test('短帖使用相同的完整区域截取，不附带页面侧栏或回复',async()=>{
 const f=fixture();f.model.height=300;const r=await f.ctx.wbMaterialCapture({url});assert.equal(r.captureMode,'post');assert.equal(r.clip.width,600);assert.equal(r.clip.height,300);
});
test('用户缩小或放大页面后仍保留完整边缘，截图途中改变缩放则停止',async()=>{
 for(const zoom of [.75,.9,1.25]){const f=fixture();f.ctx.chrome.tabs.getZoom=async()=>zoom;const r=await f.ctx.wbMaterialCapture({url}),c=f.commands.find(c=>c.method==='Page.captureScreenshot').params.clip;assert.equal(c.x,260*zoom);assert.equal(c.y,100*zoom);assert.equal(c.width,600*zoom);assert.equal(c.height,1700*zoom);assert.equal(c.scale,1);assert.equal(r.viewport.width,600);assert.equal(r.pageViewport.zoom,zoom);}
 const f=fixture();let n=0;f.ctx.chrome.tabs.getZoom=async()=>++n===1?.9:1;await assert.rejects(f.ctx.wbMaterialCapture({url}),/发生变化/);assert.equal(f.commands.at(-1),'detach');
});
test('长图保存全部像素与原比例，拒绝返回半截图，重试成功清除旧失败记录',async t=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'long-material-'));t.after(()=>fs.rm(data,{recursive:true,force:true}));await fs.mkdir(path.join(data,'uploads'));
 const a={id:'a',state:{assets:{}}},item={id:'i',url,platform:'x',captureError:'无法放入一屏'};
 const image=new PNG({width:300,height:1700});for(let y=0;y<1700;y++)for(let x=0;x<300;x++){const at=(y*300+x)*4;image.data[at]=y%256;image.data[at+1]=x%256;image.data[at+2]=180;image.data[at+3]=255;}
 const bytes=PNG.sync.write(image),result={url,captureMode:'long-post',originalData:bytes.toString('base64'),documentClip:{x:200,y:100,width:300,height:1700},clip:{x:0,y:0,width:300,height:1700},viewport:{width:300,height:1700},pageViewport:{width:1200,height:720}};
 const saved=await storeMaterialCapture(data,a,item,result);assert.deepEqual(await fs.readFile(saved.asset.path),bytes);assert.equal(saved.asset.height,1700);assert.equal(item.captureError,null);assert.equal(saved.captureMode,'long-post');
 item.captureError='旧失败';assert.equal((await storeMaterialCapture(data,a,item,result)).id,saved.id);assert.equal(item.captureError,null);
 const short=PNG.sync.write({width:300,height:720,data:Buffer.alloc(300*720*4,200)});await assert.rejects(storeMaterialCapture(data,a,item,{...result,originalData:short.toString('base64')}),/尺寸不一致/);assert.equal(a.state.materialLibrary.images.length,1);
});

test('作者头像延迟插入与图片解码完成后才截图；未翻译正文只点击原生翻译一次',async()=>{
 const f=fixture();f.model.avatar=false;f.model.translated=false;let waits=0;
 f.ctx.sleep=async()=>{if(++waits===4)f.model.avatar=true;};
 f.ctx.chrome.debugger.sendCommand=async()=>{assert.equal(f.model.avatar,true);assert.equal(f.model.translated,true);assert.ok(f.commands.includes('decode'));return {data:'png'};};
 await f.ctx.wbMaterialCapture({url});assert.equal(f.model.translationClicks,1);assert.equal(f.commands.at(-1),'detach');
});
test('长帖照片在下半屏延迟加载时先逐段滚入画面，再保存整条帖子与照片',async()=>{
 const f=fixture();f.model.loaded=false;let reachedPhoto=false;
 f.ctx.sleep=async()=>{if(f.ctx.scrollY>800){f.model.loaded=true;reachedPhoto=true;}};
 f.ctx.chrome.debugger.sendCommand=async(target,method,params)=>{assert.equal(reachedPhoto,true);assert.equal(f.model.loaded,true);assert.equal(params.clip.height,1700);return {data:'png'};};
 const result=await f.ctx.wbMaterialCapture({url});assert.equal(result.hasPhotos,true);assert.equal(result.bodyText,f.model.text);assert.equal(result.captureMode,'long-post');
});
test('图片帖没有正文也保留完整照片，不把头像当正文照片',async()=>{
 const f=fixture();f.model.text='';const result=await f.ctx.wbMaterialCapture({url});assert.equal(result.hasPhotos,true);assert.equal(result.bodyText,'');assert.equal(result.needsTranslation,undefined);
});
test('自动截图临时显示已有来源页以加载照片，完成后归还焦点；用户切走时不抢回',async()=>{
 for(const userMoved of [false,true]){
  const f=fixture();let active=93;const updates=[];
  f.ctx.wbSourceTab=async()=>({id:1,windowId:8,url});
  f.ctx.chrome.tabs.query=async()=>[{id:active,windowId:8}];
  f.ctx.chrome.tabs.update=async(id,change)=>{if(change.active)active=id;updates.push(id);};
  const original=f.ctx.chrome.debugger.sendCommand;
  f.ctx.chrome.debugger.sendCommand=async(...args)=>{assert.equal(active,1);const r=await original(...args);if(userMoved)active=94;return r;};
  await f.ctx.wbMaterialCapture({url,scheduled:true});
  assert.equal(active,userMoved?94:93);assert.deepEqual(updates,userMoved?[1]:[1,93]);
 }
});
test('没有原生中文翻译或翻译返回后仍是英文时不保存英文截图',async()=>{
 for(const canTranslate of [false,true]){const f=fixture();f.model.translated=false;f.model.canTranslate=canTranslate;
  // Simulate a translation click being accepted but no translated body arrives.
  if(canTranslate)f.ctx.sleep=async()=>{f.model.translated=false;};
  await assert.rejects(f.ctx.wbMaterialCapture({url}),/中文翻译/);assert.ok(f.model.translationClicks<=1);assert.equal(f.commands.some(c=>c.method==='Page.captureScreenshot'),false);assert.equal(f.commands.at(-1),'detach');
 }
});
