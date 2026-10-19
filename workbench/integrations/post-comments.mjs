import {randomUUID} from 'node:crypto';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const normalize=s=>String(s||'').normalize('NFKC').replace(/\s/g,'');
export function commentTexts(input){
 if(input==null)return [];
 if(!Array.isArray(input)||input.length>3)throw fail('发布后评论最多 3 条。');
 const texts=input.map(s=>{if(typeof s!=='string'||![...s.trim()].length||[...s.trim()].length>200)throw fail('每条评论填写 1–200 字。');return s.trim();});
 if(new Set(texts.map(normalize)).size!==texts.length)throw fail('评论内容重复，请合并或修改。');return texts;
}
export function enqueueComments(a,{key,title,content,comments,beforeIds=[],scheduleAt}){
 const texts=commentTexts(comments);if(!texts.length)return null;
 if(!a.identity?.userId||!a.identity?.redId)throw fail('发布后评论需要先在账号管理核实同一 Edge 的小红书主页。',409);
 const jobs=a.state.postCommentJobs||=[];const old=jobs.find(j=>j.key===key&&j.status!=='cancelled');if(old)return old;
 const expectedAt=Math.max(Date.now(),Date.parse(scheduleAt)||0),now=new Date().toISOString(),job={id:randomUUID(),key,accountId:a.id,userId:a.identity.userId,redId:a.identity.redId,title,content,createdAt:now,expiresAt:expectedAt+86400000,status:'waiting_note',nextCheckAt:expectedAt+60000,beforeIds,comments:texts.map(text=>({id:randomUUID(),text,status:'pending'}))};jobs.unshift(job);return job;
}
export function matchingOwnNote(job,profile){
 if(profile?.userId!==job.userId||String(profile?.basicInfo?.redId)!==String(job.redId))throw fail('账号已经变化，发布后评论已暂停。',409);
 return (profile.feeds||[]).filter(n=>{
  const id=String(n.id||n.noteId||''),title=n.noteCard?.displayTitle||n.noteCard?.title||n.displayTitle||n.title;
  const timestamp= /^[a-f\d]{24}$/i.test(id)?parseInt(id.slice(0,8),16)*1000:0;
  return id&&!job.beforeIds.includes(id)&&normalize(title)===normalize(job.title)&&timestamp>=Math.floor(Date.parse(job.createdAt)/1000)*1000;
 });
}
export function publicCommentJobs(a){return (a.state.postCommentJobs||[]).slice(0,30).map(({content,beforeIds,userId,redId,...j})=>j);}
export class PostComments{
 constructor({skills,persist}){this.skills=skills;this.persist=persist;}
 async process(a,job){
  if(!['waiting_note','sending'].includes(job.status)||job.nextCheckAt>Date.now())return;
  if(a.archivedAt||a.id!==job.accountId||a.identity?.userId!==job.userId||String(a.identity?.redId)!==String(job.redId)){job.status='needs_attention';job.message='账号发生变化，评论已暂停。';await this.persist();return;}
  // A transport failure after sending is never automatically retried.
  if(job.comments.some(c=>['sending','uncertain'].includes(c.status))){job.status='needs_attention';job.message='上一条评论结果待核查，未重复发送。';await this.persist();return;}
  if(Date.now()>(job.expiresAt||Date.parse(job.createdAt)+86400000)){job.status='needs_attention';job.message='预期发布时间后一天内没有确认到这篇新笔记，请在平台核查。';await this.persist();return;}
  try{
   await this.skills.operation(a,'确认新笔记并补充评论',async session=>{
    // This uses a dedicated read tab and never touches an unfinished form.
    // Both dedicated readers and the comment composer verify the visible owner.
    // Avoid opening an extra identity tab on every background check.
    if(!job.note){const profile=await this.skills.call('wb_own_recent_notes',{userId:job.userId,redId:job.redId},session),matches=matchingOwnNote(job,profile);
     if(matches.length!==1){job.nextCheckAt=Date.now()+5*60000;job.message=matches.length?'发现同标题笔记，请在平台核查。':'等待笔记审核完成并出现在本人主页。';return;}
     const n=matches[0],id=n.id||n.noteId,token=n.xsecToken||n.xsec_token;
     if(!token){job.nextCheckAt=Date.now()+5*60000;job.message='笔记链接尚未完整，请稍后核查。';return;}
     job.note={id,url:`https://www.xiaohongshu.com/explore/${encodeURIComponent(id)}?xsec_token=${encodeURIComponent(token)}&xsec_source=pc_user`};
    }
    job.status='sending';await this.persist();
    for(const c of job.comments.filter(c=>c.status==='pending')){
     // Persist intent before any external mutation, so restarts cannot double-send.
     c.status='sending';c.attemptedAt=new Date().toISOString();await this.persist();
     const result=await this.skills.call('wb_post_own_comment',{url:job.note.url,feedId:job.note.id,userId:job.userId,redId:job.redId,title:job.title,body:job.content,text:c.text},session);
     if(result?.sendClicked===false&&result?.status!=='already_present'){c.status='blocked';c.message=result?.message||'发送未执行';job.status='needs_attention';job.message=c.message;break;}
     if(!['verified','already_present'].includes(result?.status)){c.status='uncertain';job.status='needs_attention';job.message='评论发送结果未确认，已停止后续评论。';break;}
     c.status='verified';c.verifiedAt=new Date().toISOString();c.evidence={url:result.url,commentId:result.commentId,visibleText:result.visibleText};await this.persist();
    }
    if(job.comments.every(c=>c.status==='verified')){job.status='completed';job.completedAt=new Date().toISOString();job.message='评论已在本人笔记页面核实。';}
   });
  }catch(e){const sending=job.comments.find(c=>c.status==='sending');if(sending){sending.status='uncertain';job.status='needs_attention';}else if(/账号|验证码|登录/.test(e.message))job.status='needs_attention';else job.nextCheckAt=Date.now()+5*60000;job.message=e.message;}
  await this.persist();
 }
}

export function commentNoteLink(input){
 if(!input)return null;
 let url;try{url=new URL(input);}catch{throw fail('请粘贴完整的电脑端小红书笔记链接。');}
 if(url.protocol!=='https:'||url.hostname!=='www.xiaohongshu.com'||url.username||url.password||url.port)throw fail('请使用小红书电脑端笔记链接。');
 const match=url.pathname.match(/^\/(?:explore|discovery\/item)\/([a-f\d]{24})\/?$/i);
 if(!match)throw fail('链接需要指向一篇具体笔记，不能是主页或短链。');
 url.pathname='/explore/'+match[1];url.hash='';return {id:match[1],url:url.href};
}
export function resumeComments(a,{id,url,confirmed}){
 if(confirmed!==true)throw fail('请先核对要补充的评论。',409);
 const jobs=a.state.postCommentJobs||[],job=jobs.find(j=>j.id===id);
 if(!job||job.accountId!==a.id)throw fail('评论任务不属于当前账号。',404);
 if(a.identity?.userId!==job.userId||String(a.identity?.redId)!==String(job.redId))throw fail('请先核实本篇笔记所属账号。',409);
 if(job.status==='completed')return job;
 if(job.status==='sending'||job.comments.some(c=>['sending','uncertain'].includes(c.status)))throw fail('有一条评论发送结果不明，请在平台核对；不会重复发送。',409);
 const siblings=jobs.filter(j=>j.id!==job.id&&j.key===job.key);
 if(siblings.some(j=>j.comments.some(c=>['sending','uncertain'].includes(c.status))))throw fail('同篇笔记有评论结果不明，请先核对平台，避免重发。',409);
 const note=commentNoteLink(url);if(note)job.note=note;
 for(const c of job.comments){const sent=siblings.flatMap(j=>j.comments).find(other=>normalize(other.text)===normalize(c.text)&&other.status==='verified');if(sent){c.status='verified';c.evidence=sent.evidence;c.verifiedAt=sent.verifiedAt;}else if(c.status==='blocked')c.status='pending';}
 for(const sibling of siblings.filter(j=>['waiting_note','needs_attention'].includes(j.status))){sibling.status='cancelled';sibling.message='同篇评论任务已合并，避免重复发送。';}
 job.status='waiting_note';job.nextCheckAt=0;job.expiresAt=Date.now()+86400000;job.message=note?'核实指定笔记的账号与正文后，继续尚未发送的评论。':'正在本人主页核实本篇笔记。';job.resumedAt=new Date().toISOString();return job;
}
