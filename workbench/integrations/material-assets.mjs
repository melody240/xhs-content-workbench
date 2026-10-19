const fail=(message,status=404)=>Object.assign(new Error(message),{status});

// A compatibility view over existing records. Asset IDs own selection; source
// records and original page screenshots remain intact for evidence and drafts.
export function materialAssets(a){
 const state=a.state,images=state.materialLibrary?.images||[],captures=state.commentCaptures||[];
 const evidence=new Set([...images,...captures].filter(r=>r.originalAsset?.id!==r.asset?.id).map(r=>r.originalAsset?.id));
 for(const entry of Object.values(state.submissions||{}))for(const url of Array.isArray(entry.evidence)?entry.evidence:entry.evidence?.screenshots||[])if(typeof url==='string')for(const asset of Object.values(state.assets||{}))if(asset.url===url)evidence.add(asset.id);
 const records=new Map();
 const add=(asset,meta)=>{
  if(!asset?.id||!state.assets?.[asset.id]||!asset.mime?.startsWith('image/')||evidence.has(asset.id))return;
  const old=records.get(asset.id),jobIds=[...new Set([...(old?.jobIds||[]),...(meta.jobIds||[])].filter(Boolean))];
  const hidden=state.materialVisibility?.[asset.id];
  const next={id:asset.id,asset:state.assets[asset.id],...meta,jobIds,aliases:[...new Set([...(old?.aliases||[]),...(meta.aliases||[])])],archivedAt:hidden===undefined?(meta.archivedAt||old?.archivedAt||null):hidden};
  if(old){next.capturedAt=old.capturedAt||next.capturedAt;next.category=old.category;next.platform=old.platform;next.kind=old.kind;next.likes=old.likes??next.likes;}
  records.set(asset.id,next);
 };
 for(const r of captures)add(r.asset,{category:r.platform==='抖音'?'douyin-comments':'xhs-comments',platform:r.platform,kind:'comment',likes:r.observedLikes??r.recordedLikes??null,sourceURL:r.sourceURL,sourceTitle:r.sourceTitle,comment:r.observedComment||r.recordedComment,capturedAt:r.capturedAt||r.uploadedAt,jobIds:[r.jobId],captureId:r.id,canRecapture:r.kind==='browser',aliases:[r.id],archivedAt:r.archivedAt});
 for(const r of images)add(r.asset,{category:r.platform==='x'?'x':r.platform==='douyin'?'douyin-posts':'local',platform:r.platform==='x'?'X':r.platform==='douyin'?'抖音':'本地',kind:r.platform?'post':'local',likes:state.materialLibrary?.items?.find(item=>item.id===r.itemId)?.metrics?.likes??null,sourceURL:r.sourceURL,capturedAt:r.capturedAt,itemId:r.itemId,aliases:[r.id],archivedAt:r.archivedAt});
 // Previously imported files were registered before the library existed.
 // Exclude diagnostic evidence; new uploads carry an explicit origin.
 for(const asset of Object.values(state.assets||{}))if(!records.has(asset.id)&&!evidence.has(asset.id)&&!['evidence','background'].includes(asset.origin)&&!/页面原图|所在页面|^(?:screenshot|evidence(?:Before|After)?|qr|publishScreenshot|profileScreenshot)\.png$/i.test(asset.name||''))add(asset,{category:'local',platform:'本地',kind:asset.origin==='quote-card'?'quote-card':asset.origin==='collage'?'collage':'local',capturedAt:asset.createdAt||null,jobIds:[],aliases:[]});
 return [...records.values()].sort((a,b)=>String(b.capturedAt||'').localeCompare(String(a.capturedAt||''))||a.id.localeCompare(b.id));
}
export function pickMaterialAssets(a,ids){
 if(!Array.isArray(ids)||!ids.length||ids.length>18)throw fail('请选择 1–18 张图片。',400);
 const all=materialAssets(a),seen=new Set(),assets=[];
 for(const id of ids){const r=all.find(r=>(r.id===id||r.aliases.includes(id))&&!r.archivedAt);if(!r)throw fail('图片不属于当前账号或已删除。');if(!seen.has(r.id)){assets.push(r.asset);seen.add(r.id);}}
 return assets;
}
export function setMaterialArchived(a,id,archived=true){
 const r=materialAssets(a).find(r=>r.id===id||r.aliases.includes(id));if(!r)throw fail('素材不属于当前账号。');
 const at=archived?new Date().toISOString():null;(a.state.materialVisibility||={})[r.id]=at;
 for(const source of [...(a.state.materialLibrary?.images||[]),...(a.state.commentCaptures||[])])if(source.asset.id===r.id)source.archivedAt=at;
 return {ok:true,id:r.id,archivedAt:at};
}
