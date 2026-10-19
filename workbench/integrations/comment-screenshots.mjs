import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {PNG} from 'pngjs';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function png(bytes){if(!Buffer.isBuffer(bytes)||bytes.length<33||bytes.length>32*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw fail('截图不是有效的 PNG 或超过 32 MB。',502);const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height||width>20000||height>20000)throw fail('截图尺寸异常，未保存。',502);return {width,height};}
function decode(value){if(typeof value!=='string'||value.length>45*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw fail('浏览器未返回有效的截图。',502);const bytes=Buffer.from(value,'base64');png(bytes);return bytes;}
export function cropScreenshot(bytes,clip,viewport){
 const size=png(bytes);if(size.width*size.height>32000000)throw fail('截图像素过多，未处理。',502);
 if(!clip||!viewport||![clip.x,clip.y,clip.width,clip.height,viewport.width,viewport.height].every(Number.isFinite)||clip.x<0||clip.y<0||clip.width<=0||clip.height<=0||viewport.width<=0||viewport.height<=0)throw fail('截图区域无效，未保存。',502);
 const sx=size.width/viewport.width,sy=size.height/viewport.height,x=Math.floor(clip.x*sx),y=Math.floor(clip.y*sy),right=Math.ceil((clip.x+clip.width)*sx),bottom=Math.ceil((clip.y+clip.height)*sy);
 if(right>size.width||bottom>size.height)throw fail('截图区域超出原图，未保存。',502);
 let source;try{source=PNG.sync.read(bytes);}catch{throw fail('原始 PNG 截图无法完整解码，未保存。',502);}
 if(x===0&&y===0&&right===size.width&&bottom===size.height)return bytes;
 const output=new PNG({width:right-x,height:bottom-y});PNG.bitblt(source,output,x,y,output.width,output.height,0,0);
 const cropped=PNG.sync.write(output),profiles=[];
 // Preserve the source color profile while copying pixels without resampling.
 for(let at=8;at+12<=bytes.length;){const length=bytes.readUInt32BE(at),end=at+length+12;if(end>bytes.length)throw fail('PNG 结构不完整，未保存。',502);if(['iCCP','sRGB','gAMA','cHRM'].includes(bytes.toString('ascii',at+4,at+8)))profiles.push(bytes.subarray(at,end));at=end;}
 return Buffer.concat([cropped.subarray(0,33),...profiles,cropped.subarray(33)]);
}
export function commentTarget(agent,accountId,input){
 const job=agent.jobs.find(j=>j.id===input.jobId&&j.accountId===accountId);
 if(!job)throw fail('研究记录不属于当前账号或已不存在。',404);
 const source=[...job.sources,...(job.commentSources||[])].find(s=>s.detail&&s.id===input.sourceId),comment=source?.comments.find(c=>c.id===input.commentId);
 if(!comment)throw fail('找不到这条已采集的评论。',404);
 return {job,source,comment};
}
export function sourceURL(value,platform='小红书'){
 let u;try{u=new URL(value);}catch{throw fail('请填写完整的原笔记或视频来源链接。');}
 const domains={'小红书':['xiaohongshu.com','xhslink.com'],'抖音':['douyin.com'],'快手':['kuaishou.com','gifshow.com']};
 if(!domains[platform]||u.protocol!=='https:'||u.username||u.password||!domains[platform].some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))throw fail('来源链接与所选平台不一致，请使用平台的 HTTPS 分享链接。');
 return u.href;
}
export function sourceEvidence(target){const {job,source,comment}=target;const platform=source.platform||'小红书';return {jobId:job.id,sourceId:source.id,commentId:comment.id,platformCommentId:comment.platformId||null,platform,sourceTitle:source.title,sourceURL:sourceURL(platform==='抖音'?source.url:`https://www.xiaohongshu.com/explore/${encodeURIComponent(source.feedId)}?xsec_token=${encodeURIComponent(source.xsecToken)}&xsec_source=pc_search`,platform),collectedAt:source.collectedAt||source.foundAt,recordedComment:comment.content,recordedLikes:comment.likes,...(target.selection?{selection:target.selection}:{})};}
export function publicCaptures(a,jobId){return (a.state.commentCaptures||[]).filter(r=>!jobId||r.jobId===jobId).map(r=>({...r,evidenceDownload:`/api/comments/evidence?id=${r.id}&account=${a.id}`}));}
export function recordFor(a,id){const r=(a.state.commentCaptures||[]).find(r=>r.id===id);if(!r)throw fail('截图不属于当前账号或已不存在。',404);return r;}
async function writeAsset(data,a,bytes,name){const id=randomUUID(),file=id+'.png';const dest=path.join(data,'uploads',file);await fs.writeFile(dest,bytes,{flag:'wx',mode:0o600});return {id,name,path:dest,url:`/media/${file}?account=${a.id}`,mime:'image/png',size:bytes.length,accountId:a.id,sha256:hash(bytes),...png(bytes)};}
async function evidenceFile(data,r){await fs.mkdir(path.join(data,'comment-evidence'),{recursive:true,mode:0o700});await fs.writeFile(path.join(data,'comment-evidence',r.id+'.json'),JSON.stringify(r,null,2),{mode:0o600});}
export async function saveCapture(data,a,target,result){
 const original=decode(result.originalData),cropped=cropScreenshot(original,result.clip,result.viewport);
 const asset=await writeAsset(data,a,cropped,'评论截图.png');let originalAsset;
 try{originalAsset=await writeAsset(data,a,original,'评论所在页面原图.png');const r={id:randomUUID(),accountId:a.id,...sourceEvidence(target),kind:'browser',capturedAt:result.capturedAt,asset,originalAsset,observedComment:result.content,observedAuthor:result.author,observedLikes:result.likes,clip:result.clip,viewport:result.viewport,presentation:result.presentation||null,reviewedAt:null};await evidenceFile(data,r);a.state.assets[asset.id]=asset;a.state.assets[originalAsset.id]=originalAsset;(a.state.commentCaptures||= []).unshift(r);return r;}catch(e){await fs.unlink(asset.path).catch(()=>{});if(originalAsset)await fs.unlink(originalAsset.path).catch(()=>{});throw e;}
}
export async function saveManual(data,a,input,target=null){
 const asset=a.state.assets[input.assetId];
 if(!asset?.mime?.startsWith('image/'))throw fail('请先上传当前账号的图片截图。',404);
 const bytes=await fs.readFile(asset.path);asset.sha256=hash(bytes);
 const evidence=target?sourceEvidence(target):{jobId:input.jobId||null,platform:input.platform,sourceURL:sourceURL(input.sourceURL,input.platform),recordedComment:String(input.commentText||'').trim().slice(0,4000),recordedLikes:null};
 const same=(a.state.commentCaptures||[]).find(r=>r.asset.id===asset.id&&r.sourceURL===evidence.sourceURL);if(same)return same;
 const r={id:randomUUID(),accountId:a.id,...evidence,kind:'manual',uploadedAt:new Date().toISOString(),asset,originalAsset:asset,reviewedAt:null};await evidenceFile(data,r);(a.state.commentCaptures||=[]).unshift(r);return r;
}
export async function reviewCapture(data,a,id){const r=recordFor(a,id);const previous=r.reviewedAt;r.reviewedAt=new Date().toISOString();try{await evidenceFile(data,r);}catch(e){r.reviewedAt=previous;throw e;}return r;}
export function addToDraft(a,{captureIds,draftId,updatedAt}){
 if(!Array.isArray(captureIds)||!captureIds.length||captureIds.length>18)throw fail('请选择 1–18 张已核对的截图。');
 const captures=[...new Set(captureIds)].map(id=>recordFor(a,id));if(captures.some(r=>!r.reviewedAt))throw fail('请先预览截图并确认评论完整，再加入草稿。',409);
 let draft=a.state.drafts.find(d=>d.id===draftId);if(draftId&&!draft)throw fail('草稿不属于当前账号或已不存在。',404);
 if(draft&&draft.updatedAt!==updatedAt)throw fail('草稿已在其他页面修改，请刷新后再加入截图。',409);
 if(draft&&draft.mode!=='image')throw fail('评论截图只能加入图文草稿。');
 const assets=[...(draft?.assets||[])];for(const r of captures){if(!a.state.assets[r.asset.id])throw fail('截图文件已不在当前账号的素材中。',409);if(!assets.some(s=>s.id===r.asset.id))assets.push(r.asset);}
 if(assets.length>18)throw fail('加入后超过 18 张图片，请先在草稿中整理素材。');
 if(!draft){draft={id:randomUUID(),accountId:a.id,mode:'image',title:'',content:'',tags:'',video:null,assets:[],visibility:'公开可见',scheduleMode:'now'};a.state.drafts.unshift(draft);}
 const previousTime=Date.parse(draft.updatedAt);draft.assets=assets;draft.commentCaptureIds=[...new Set([...(draft.commentCaptureIds||[]),...captures.map(r=>r.id)])];draft.updatedAt=new Date(Math.max(Date.now(),Number.isFinite(previousTime)?previousTime+1:0)).toISOString();return draft;
}
