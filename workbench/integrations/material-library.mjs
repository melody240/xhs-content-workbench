import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {cropScreenshot,png} from './comment-screenshots.mjs';
import {PNG} from 'pngjs';
import {materialExcluded,filterFingerprint} from './material-filter.mjs';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export function materialURL(value){
 let u;try{u=new URL(String(value).trim());}catch{throw fail('请填写博主主页或帖子的完整链接。');}
 if(u.protocol!=='https:'||u.username||u.password)throw fail('请使用平台的 HTTPS 链接。');
 let platform;
 if(['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname)){
  platform='x';u.hostname='x.com';
  if(!/^\/[A-Za-z0-9_]{1,30}(?:\/status\/\d+)?\/?$/.test(u.pathname)||/^\/(home|login|settings|messages|i|intent|search)(\/|$)/.test(u.pathname))throw fail('X 请填写博主主页或单条帖子的链接。');
 }else if(['www.douyin.com','douyin.com'].includes(u.hostname)){
  platform='douyin';u.hostname='www.douyin.com';
  if(!/^\/(user\/[A-Za-z0-9_-]+|video\/\d+|note\/\d+)\/?$/.test(u.pathname))throw fail('抖音请填写电脑端博主主页、视频或图文链接，短分享链接请先在浏览器打开。');
 }else throw fail('素材来源目前支持 X 和抖音。');
 u.hash='';u.search='';u.pathname=u.pathname.replace(/\/$/,'');return {url:u.href,platform};
}
export const library=a=>a.state.materialLibrary||={sources:[],items:[],images:[],settings:{hours:24,enabled:false},lastRun:null};
export function saveSource(a,b){
 const l=library(a),ref=materialURL(b.url),name=String(b.name||'').trim().slice(0,60)||new URL(ref.url).pathname.split('/')[1];
 const existing=l.sources.find(x=>x.id===b.id||x.url===ref.url);
 if(!existing&&l.sources.filter(s=>!s.archivedAt).length>=20)throw fail('每个账号最多保留 20 个素材来源。');
 const source=existing||{id:randomUUID(),createdAt:new Date().toISOString()};
 Object.assign(source,ref,{name,enabled:b.enabled!==false,autoCapture:ref.platform==='x'&&b.autoCapture!==false,archivedAt:null});if(!existing)l.sources.unshift(source);return source;
}
export function archiveSource(a,id){const s=library(a).sources.find(x=>x.id===id);if(!s)throw fail('素材来源不存在。',404);s.archivedAt=new Date().toISOString();s.enabled=false;return s;}
export function saveLibrarySettings(a,b){if(![6,24,0].includes(b.hours))throw fail('请选择每日、每六小时或手动检查。');const l=library(a);l.settings={hours:b.hours,enabled:b.hours>0&&b.enabled===true};return l.settings;}
export function publicMaterialMedia(value,kind='photo'){
 try{const u=new URL(value);if(u.protocol==='https:'&&!u.username&&!u.password&&u.hostname==='pbs.twimg.com'&&(kind==='photo'?u.pathname.startsWith('/media/'): /^\/(profile_images|default_profile_images)\//.test(u.pathname)))return u.href;}catch{}
 return null;
}
export function mergeMaterials(a,source,result){
 if(!result||!Array.isArray(result.items))throw fail('页面没有返回可读取的素材。',502);
 const l=library(a);let count=0;
 for(const input of result.items.slice(0,40)){
  let ref;try{ref=materialURL(input.url);}catch{continue;}
  if(ref.platform!==source.platform||!(/\/status\/\d+$/.test(new URL(ref.url).pathname)||/\/(video|note)\/\d+$/.test(new URL(ref.url).pathname)))continue;
  const old=l.items.find(i=>i.url===ref.url);
  const item={...input,id:old?.id||randomUUID(),sourceId:source.id,sourceName:source.name,platform:ref.platform,url:ref.url,title:String(input.title||input.text||'未提供标题').slice(0,500),text:String(input.text||'').slice(0,10000),foundAt:old?.foundAt||new Date().toISOString(),observedAt:new Date().toISOString()};
  // Browser-returned markup is data, never a tool plan or executable code.
  delete item.html;delete item.script;delete item.originalData;
  item.photos=[...new Set((Array.isArray(input.photos)?input.photos:[]).map(v=>publicMaterialMedia(v)).filter(Boolean))].slice(0,4);
  item.avatar=publicMaterialMedia(input.avatar,'avatar');
  // Older extensions omit these fields; keep previously read previews.
  if((!('photos' in input)||input.hasPhotos===true&&!item.photos.length)&&old?.photos)item.photos=old.photos;
  if(!('avatar' in input)&&old?.avatar)item.avatar=old.avatar;
  if(old&&filterFingerprint(old,'scan')!==filterFingerprint(item,'scan')){delete old.contentReview;delete old.captureReview;}
  if(old)Object.assign(old,item);else {l.items.unshift(item);count++;}
 }
 l.items=l.items.slice(0,1000);source.checkedAt=new Date().toISOString();source.error=null;return count;
}
export function publicLibrary(a,browser={}){const l=library(a);return {...l,items:l.items.filter(i=>!materialExcluded(i)),sources:l.sources.filter(s=>!s.archivedAt),images:l.images.filter(i=>!i.archivedAt).map(({originalAsset,...i})=>i),deletedImages:l.images.filter(i=>i.archivedAt).map(({originalAsset,...i})=>i),browser};}
export async function storeMaterialCapture(data,a,item,result){
 if(typeof result.originalData!=='string'||result.originalData.length>45*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(result.originalData))throw fail('没有收到有效截图。',502);
 if(materialURL(result.url).url!==item.url)throw fail('截图页面已经变化，请重新查看素材。',409);
 const original=Buffer.from(result.originalData,'base64'),size=png(original);
 if(['post','long-post'].includes(result.captureMode)){
  const c=result.documentClip;if(!c||![c.x,c.y,c.width,c.height].every(Number.isFinite)||c.x<0||c.y<0||c.width<80||c.height<40||!result.pageViewport||result.clip?.x!==0||result.clip?.y!==0||result.clip?.width!==c.width||result.clip?.height!==c.height||result.viewport?.width!==c.width||result.viewport?.height!==c.height||Math.abs(size.height-size.width*c.height/c.width)>3)throw fail('完整帖子截图尺寸不一致，请重新截图。',502);
 }
 const bytes=cropScreenshot(original,result.clip,result.viewport);
 const pixels=PNG.sync.read(bytes).data;let min=255,max=0;
 for(let at=0;at<pixels.length;at+=4){const luminance=Math.round((pixels[at]+pixels[at+1]+pixels[at+2])/3);min=Math.min(min,luminance);max=Math.max(max,luminance);}
 if(max-min<12)throw fail('截图画面为空白或尚未渲染，请在浏览器查看后重试。',502);
 const hash=createHash('sha256').update(bytes).digest('hex'),l=library(a),old=l.images.find(i=>i.hash===hash&&!i.archivedAt);if(old){item.captureError=null;return old;}
 const assetFor=async(b,name)=>{const id=randomUUID(),file=id+'.png',dest=path.join(data,'uploads',file);await fs.writeFile(dest,b,{flag:'wx',mode:0o600});return {id,name,path:dest,url:`/media/${file}?account=${a.id}`,accountId:a.id,mime:'image/png',size:b.length,...png(b)};};
 const asset=await assetFor(bytes,'素材截图.png');let originalAsset;
 try{originalAsset=await assetFor(original,'素材页面原图.png');const image={id:randomUUID(),itemId:item.id,asset,originalAsset,hash,capturedAt:new Date().toISOString(),sourceURL:item.url,platform:item.platform,kind:result.kind||'page',captureMode:result.captureMode||'viewport',...(result.documentClip?{documentClip:result.documentClip,pageViewport:result.pageViewport}: {})};
  a.state.assets[asset.id]=asset;a.state.assets[originalAsset.id]=originalAsset;l.images.unshift(image);item.captureError=null;return image;
 }catch(e){await fs.unlink(asset.path).catch(()=>{});if(originalAsset)await fs.unlink(originalAsset.path).catch(()=>{});throw e;}
}
export function pickMaterials(a,ids){if(!Array.isArray(ids)||!ids.length||ids.length>18)throw fail('请选择 1–18 张图片。');return [...new Set(ids)].map(id=>{const i=library(a).images.find(x=>x.id===id&&!x.archivedAt);if(!i||!a.state.assets[i.asset.id])throw fail('图片不属于当前账号。',404);return i.asset;});}

// A portable ZIP of images only. No sidecar JSON, captions or source URLs.
export function imageZip(entries){
 const crc=b=>{let n=0xffffffff;for(const v of b){n^=v;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;};
 const local=[],central=[];let offset=0;
 entries.forEach(({bytes,name})=>{const filename=Buffer.from(name),checksum=crc(bytes),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt32LE(checksum,14);header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(filename.length,26);local.push(header,filename,bytes);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt32LE(checksum,16);c.writeUInt32LE(bytes.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(filename.length,28);c.writeUInt32LE(offset,42);central.push(c,filename);offset+=header.length+filename.length+bytes.length;});
 const size=central.reduce((n,b)=>n+b.length,0),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(size,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,...central,end]);
}
