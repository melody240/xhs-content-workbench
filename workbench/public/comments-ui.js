import {accountHeaders} from './request.js';
import {renderProgress} from './progress-ui.js';

// Collection produces assets. The shared picker owns viewing and selection.
export function createCommentUI(ctx){
 const {esc,api,task,render}=ctx;
 let data=null,account='',researchJob=null,researchJobs=[],commentJobs=[],taskId=null,sourceJobId=null,keyword='',platform='抖音',manualOpen=false,manualDraft={platform:'抖音',sourceURL:''},sequence=0;
 const activeJob=()=>[researchJob,...commentJobs].find(j=>j?.id===(data?.active?.id||taskId))||null;
 const sourceJob=()=>[researchJob,...researchJobs,...commentJobs].find(j=>j?.id===(sourceJobId||researchJob?.id));
 async function refresh(j,jobs=[],history=[]){
  const a=ctx.accountId(),n=++sequence;
  if(account!==a){data=null;taskId=null;sourceJobId=null;keyword='';platform='抖音';manualOpen=false;manualDraft={platform:'抖音',sourceURL:''};account=a;}
  researchJob=j;researchJobs=history.length?history:j?[j]:[];commentJobs=jobs;if(!keyword)keyword=j?.topic||'';
  const next=await api('/api/comments');if(n!==sequence||a!==ctx.accountId())return;data=next;
 }
 function summary(j){
  if(!j?.topics?.length||!data)return '';
  const shots=(data.captures||[]).filter(r=>r.jobId===j.id&&!r.archivedAt);
  return `<div class="research-material-link"><strong>本轮素材 · ${ctx.materialCount?.(j.id)??shots.length} 张评论截图</strong><button type="button" class="btn small" data-research-materials="${esc(j.id)}">查看素材</button></div>`;
 }
 function taskStatus(){
  const j=activeJob(),s=j?.commentAutomation;if(!j)return '';
  const running=data?.active?.id===j.id;
  return `${running?renderProgress({title:j.events?.at(-1)?.label||'正在整理高赞评论',detail:`${j.topic} · 已保存 ${s?.saved||0} 张`,tone:'cyan',action:`<button type="button" class="btn small" data-comments="stop">停止整理</button>`},esc):`<div class="collection-result" role="status">${esc(j.topic)} · 已保存 ${s?.saved||0} 张${s?.status==='stopped'?' · 已停止':''}</div>`}${(s?.errors||[]).length?`<div class="notice warning" role="status">${s.errors.map(e=>`<p>${esc(e.platform||'')}：${esc(e.message)}</p>`).join('')}</div>`:j.error?`<div class="notice warning" role="status">${esc(j.error)}</div>`:''}`;
 }
 function page({showPlatforms=true}={}){
  if(!data)return '<p role="status">正在读取评论采集状态…</p>';
  const available=researchJobs,source=sourceJob(),blocked=data.active;
  return `<div class="comment-collector">${showPlatforms?`<div class="segmented collection-platforms" aria-label="评论平台">${['抖音','小红书'].map(p=>`<button type="button" data-comment-platform="${p}" class="${platform===p?'active':''}" aria-pressed="${platform===p}">${p}</button>`).join('')}</div>`:''}<form id="comments-collect-form">${platform==='抖音'?`<div class="field"><label for="comment-keyword">话题或关键词</label><input type="text" id="comment-keyword" name="keyword" required maxlength="100" value="${esc(keyword)}"></div>`:`${available.length?`<div class="field"><label for="comment-research-source">研究记录</label><select id="comment-research-source">${available.map(j=>`<option value="${esc(j.id)}" ${j.id===source?.id?'selected':''}>${esc(j.topic)} · ${esc(new Date(j.createdAt).toLocaleString('zh-CN'))}</option>`).join('')}</select></div>`:'<div class="notice warning">暂无已读小红书评论。先完成选题，或上传人工截图。</div>'}`}<button type="submit" class="btn primary" ${blocked||platform==='小红书'&&!available.length?'disabled':''}>${blocked?'正在整理…':'找高赞评论并截图'}</button></form>${taskStatus()}${blocked&&blocked.accountId!==ctx.accountId()?'<div class="notice warning">其他账号正在使用浏览器，完成后可采集。</div>':''}<div class="collection-actions"><button type="button" class="btn" data-comments="manual">上传截图</button><button type="button" class="btn" data-comments="library">查看已保存素材</button></div>${manualOpen?`<form id="comment-manual-form"><div class="field"><label for="comment-manual-platform">平台</label><select id="comment-manual-platform" name="platform">${['抖音','小红书','快手'].map(p=>`<option ${manualDraft.platform===p?'selected':''}>${p}</option>`).join('')}</select></div><div class="field"><label for="comment-source-url">来源链接</label><input id="comment-source-url" name="sourceURL" type="url" required value="${esc(manualDraft.sourceURL)}"></div><div class="field"><label for="comment-manual-file">完整截图</label><input id="comment-manual-file" name="file" type="file" required accept="image/png,image/jpeg,image/webp"></div><button class="btn" type="submit">保存截图</button></form>`:''}</div>`;
 }
 async function collect(){
  const a=ctx.accountId(),source=sourceJob();
  const j=await api('/api/comments/collect',{platform,...(platform==='小红书'?{jobId:source?.id}:{keyword})});
  if(a!==ctx.accountId())return;taskId=j.id;await ctx.refreshResearch?.();ctx.toast('正在整理高赞评论');
 }
 function bind(){
  document.querySelectorAll('[data-research-materials]').forEach(b=>b.onclick=()=>ctx.openMaterials?.({jobId:b.dataset.researchMaterials}));
  document.querySelectorAll('[data-comment-platform]').forEach(b=>b.onclick=()=>{platform=b.dataset.commentPlatform;render();});
  const source=document.querySelector('#comment-research-source');if(source){sourceJobId=source.value;source.onchange=()=>{sourceJobId=source.value;};}
  const form=document.querySelector('#comments-collect-form');if(form){form.oninput=()=>{if(form.elements.keyword)keyword=form.elements.keyword.value;};form.onsubmit=e=>{e.preventDefault();form.oninput();task('启动评论采集',collect);};}
  document.querySelectorAll('[data-comments]').forEach(b=>b.onclick=()=>{
   if(b.dataset.comments==='stop')task('停止评论整理',async()=>{await api('/api/agent/stop',{id:data.active.id});await ctx.refreshResearch?.();});
   else if(b.dataset.comments==='manual'){manualOpen=!manualOpen;render();}
   else if(b.dataset.comments==='library')ctx.openMaterials?.({category:platform==='抖音'?'douyin-comments':'xhs-comments'});
  });
  const manual=document.querySelector('#comment-manual-form');
  if(manual){manual.oninput=()=>{manualDraft={platform:manual.elements.platform.value,sourceURL:manual.elements.sourceURL.value};};manual.onsubmit=e=>{e.preventDefault();manual.oninput();const values=new FormData(manual),a=ctx.accountId(),input={...manualDraft};task('保存评论截图',async()=>{
   const upload=new FormData();upload.append('file',values.get('file'));const response=await fetch('/api/assets',{method:'POST',headers:accountHeaders(a),body:upload}),asset=await response.json();if(!response.ok)throw Error(asset.error||'上传失败');if(a!==ctx.accountId())throw Error('账号已变化，图片已保留在原账号。');
   await api('/api/comments/manual',{assetId:asset.id,...input});manualOpen=false;await ctx.refreshResearch?.();await ctx.refreshMaterials?.();ctx.toast('评论截图已进入素材库');
  });};}
 }
 return {refresh,page,summary,bind,setPlatform:value=>{if(['抖音','小红书'].includes(value))platform=value;},signature:()=>JSON.stringify(data),editing:()=>manualOpen,active:()=>{const j=activeJob();return j&&(j.kind==='comments'||j.commentAutomation?.status==='running')?data?.active:null;}};
}
