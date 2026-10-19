import {screenCommentAudience} from './comment-audience.mjs';
import {resolveAudience} from '../public/audience-options.js';
import {saveCapture} from './comment-screenshots.mjs';
import {collectDetail} from './agent.mjs';

// Rank comments themselves. Missing counts remain unknown, never inferred from
// the video's/note's engagement. All comparisons are within the collected sample.
export function commentLikes(value){
 const v=String(value??'').replaceAll(',','').trim().toLowerCase();
 if(!/^(?:\d+(?:\.\d+)?)(?:万|亿|千|w|k|m)?\+?$/.test(v))return null;
 const n=Number.parseFloat(v);return n*(v.includes('亿')?1e8:/万|w/.test(v)?1e4:/千|k/.test(v)?1e3:v.includes('m')?1e6:1);
}
export function rankedComments(sources,{limit=3,sourceIds}={}){
 const seen=new Set();
 return sources.filter(s=>s.detail&&(!sourceIds||sourceIds.includes(s.id))).flatMap(source=>(source.comments||[]).map(comment=>({source,comment,likes:commentLikes(comment.likes)})))
 .sort((a,b)=>(b.likes??-1)-(a.likes??-1)).filter(({comment,likes})=>{
  const text=comment.content?.trim(),key=text?.normalize('NFKC').replace(/\s/g,'');
  if(likes===null||likes<=0||!text||[...text.replace(/[\p{P}\p{S}\s]/gu,'')].length<4||seen.has(key))return false;
  seen.add(key);return true;
 }).sort((a,b)=>b.likes-a.likes||a.source.id.localeCompare(b.source.id)).slice(0,limit);
}
function stableComments(source,comments){
 const old=source?.comments||[];let next=Math.max(0,...old.map(c=>Number(c.id?.match(/C(\d+)$/)?.[1])||0));
 return comments.map(c=>{const same=old.find(p=>c.platformId&&p.platformId===c.platformId||p.author===c.author&&p.content===c.content);return {...c,id:same?.id||source.id+'C'+(++next),platformId:c.platformId||null};});
}
export async function collectComments({data,a,job,skills,model,persist,event,signal,platforms=['小红书','抖音'],selection}){
 const chosen=selection?job.topics?.find(t=>t.id===selection.topicId):null;
 if(selection&&!chosen)throw Error('选题已经变化，请重新选择本篇选题。');
 const keyword=selection?.keyword||job.topic;
 const state=job.commentAutomation={status:'running',startedAt:new Date().toISOString(),saved:0,captureIds:[],topicId:selection?.topicId||null,errors:[],platforms,audience:resolveAudience(job.audience),audienceReviews:[]};
 const select=async (sources,platform)=>{
  await event('筛选适合受众的评论',state.audience);
  const result=await screenCommentAudience(sources,{model,topic:selection?.title||job.topic,audience:state.audience,signal,context:selection});
  state.audienceReviews.push(result.review);
  if(selection&&sources.length&&result.review.mode==='rules'&&(result.review.error||result.review.notice)){
   state.errors.push({platform,stage:'matching',message:'本篇评论匹配未完成，请重试本篇素材。',detail:result.review.error||result.review.notice});
  }
  if(result.review.usage?.totalTokens){job.usage||={totalTokens:0};job.usage.totalTokens+=result.review.usage.totalTokens;}
  await persist();return result.candidates.slice(0,3);
 };
 const capture=async candidates=>{
  for(const [rank,{source,comment,likes,audienceReview}] of candidates.entries()){
   signal?.throwIfAborted();
   const existing=(a.state.commentCaptures||[]).find(r=>!r.archivedAt&&sameCommentCapture(r,job,source,comment));
   if(existing){state.saved++;state.captureIds.push(existing.id);continue;}
   await event('保存高赞评论截图',`${source.platform||'小红书'} · 评论赞 ${comment.likes}`);
   try{
    const result=await skills.captureComment(a,source,comment);signal?.throwIfAborted();
    const saved=await saveCapture(data,a,{job,source,comment,selection:{method:'comment_likes',rank:rank+1,likes,audience:state.audience,topicId:selection?.topicId||null,articleTitle:selection?.title||null,audienceReview:audienceReview||null,scope:'本轮实际读取且保留的评论'}},result);
    state.saved++;state.captureIds.push(saved.id);await persist();
   }catch(e){
    if(signal?.aborted)throw e;
    const key=job.id+':'+source.id+':'+comment.id;
    (a.state.commentCaptureErrors||={})[key]={at:new Date().toISOString(),message:e.message};
    state.errors.push({platform:source.platform||'小红书',sourceId:source.id,commentId:comment.id,message:e.message});await persist();
    if(/验证码|验证|登录|断开|超时|权限/.test(e.message))break;
   }
  }
 };
 try{
  if(platforms.includes('小红书')){
   const selected=[...new Set((chosen?[chosen]:job.topics||[]).flatMap(t=>t.sourceIds||[]))];
   const sourceIds=selected.length?selected:undefined;
   // List-only topic research deliberately did not read comments. Capture must
   // fetch them now, rather than treating an empty snapshot as a platform error.
   let ranked=rankedComments(job.sources,{sourceIds,limit:30});
   if(!ranked.length&&skills.execute){
    // A service/extension restart clears the transient binding. Re-check the
    // existing browser identity automatically; never switch or replace login.
    let ready=true;try{await skills.bind?.(a);}catch(e){ready=false;state.errors.push({platform:'小红书',message:e.message});}
    for(const source of (ready?job.sources:[]).filter(s=>(!sourceIds||sourceIds.includes(s.id))&&s.feedId&&s.xsecToken).slice(0,3)){
     signal?.throwIfAborted();await event('读取小红书高赞评论',source.title||job.topic);
     try{const read=await skills.execute(a,{command:'get-feed-detail',input:{feedId:source.feedId,xsecToken:source.xsecToken,loadAllComments:false}});collectDetail(source,read.result);if(!rankedComments([source],{limit:1}).length&&skills.readXhsComments){const dom=await skills.readXhsComments(a,source);collectDetail(source,{...read.result,comments:dom.comments});}await persist();}
     catch(e){if(signal?.aborted)throw e;state.errors.push({platform:'小红书',sourceId:source.id,message:e.message});if(/验证|登录|权限|断开|超时/.test(e.message))break;}
    }
    ranked=rankedComments(job.sources,{sourceIds,limit:30});
   }
   const candidates=await select(ranked,'小红书');
   if(candidates.length)await capture(candidates);
   else if(!state.errors.some(e=>e.platform==='小红书'))state.errors.push({platform:'小红书',message:ranked.length?'本轮评论已筛选，没有与本篇直接相关、能独立看懂的评论。':'本轮未读到带点赞数的可用评论。'});
  }
  if(platforms.includes('抖音')){
   signal?.throwIfAborted();await event('在抖音寻找相关视频与图文',job.topic);
   try{
    const result=await skills.searchDouyin(a,{keyword});signal?.throwIfAborted();
    const collected=[];job.commentSources||=[];state.douyinSearch={keyword,url:result.url,collectedAt:result.observedAt,sourceCount:result.items.length};
    for(const [i,item]of result.items.slice(0,3).entries()){
     signal?.throwIfAborted();await event('读取抖音评论',item.title||item.url);
     try{
      const read=await skills.readDouyinComments(a,{url:item.url});signal?.throwIfAborted();
      const previous=job.commentSources.find(s=>s.url===item.url),id=previous?.id||'D'+(job.commentSources.length+1);
      const source={id,platform:'抖音',url:item.url,title:item.title||read.title,detail:true,collectedAt:read.observedAt,comments:stableComments(previous||{id},read.comments)};
      if(previous)job.commentSources.splice(job.commentSources.indexOf(previous),1,source);else job.commentSources.push(source);collected.push(source);await persist();
     }catch(e){if(signal?.aborted)throw e;state.errors.push({platform:'抖音',message:e.message,sourceURL:item.url});if(/验证|登录|权限|断开|超时/.test(e.message))break;}
    }
    const ranked=rankedComments(collected,{limit:30}),candidates=await select(ranked,'抖音');
    if(candidates.length)await capture(candidates);
    else if(!state.errors.some(e=>e.platform==='抖音'))state.errors.push({platform:'抖音',message:ranked.length?'本轮评论已筛选，没有与本篇直接相关、能独立看懂的评论。':'已读评论里没有带可见点赞数的可用评论。'});
   }catch(e){if(signal?.aborted)throw e;state.errors.push({platform:'抖音',message:e.message});}
  }
  state.status=state.errors.length?'partial':'completed';
 }catch(e){state.status=signal?.aborted?'stopped':'partial';state.errors.push({message:e.message});}
 finally{await skills.closeDouyin?.();state.endedAt=new Date().toISOString();await persist();}
 return state;
}
export function sameCommentCapture(r,job,source,comment){
 if(r.jobId!==job.id||r.kind!=='browser'||r.platform!==(source.platform||'小红书')||r.recordedComment!==comment.content)return false;
 if(source.platform==='抖音')return r.sourceURL===source.url&&r.observedAuthor===comment.author;
 return r.sourceId===source.id&&(r.platformCommentId? r.platformCommentId===comment.platformId:r.commentId===comment.id);
}
