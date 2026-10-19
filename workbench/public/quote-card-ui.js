import {drawQuoteCard,randomQuoteMetrics,normalizeQuoteMetrics} from './quote-card-layout.js';
import {accountHeaders} from './request.js';
const image=(url,label='头像')=>new Promise((resolve,reject)=>{
 const img=new Image();let done=false;
 const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);img.onload=img.onerror=null;error?reject(error):resolve(img);};
 const timer=setTimeout(()=>finish(Error(label+'加载超时，请重试。')),10000);
 img.onload=()=>img.naturalWidth?finish():finish(Error(label+'加载失败，请重试。'));
 img.onerror=()=>finish(Error(label+'加载失败，请重试。'));img.src=url;
});
let chromeImage;
const loadChrome=()=>chromeImage??=(image('/assets/quote-x-chrome.png','语录卡图标').catch(e=>{chromeImage=null;throw e;}));
const pick=(items,exclude)=>{const choices=items.filter(a=>a.id!==exclude);return (choices.length?choices:items)[Math.floor(Math.random()*(choices.length||items.length))];};
const timestamp=()=>{const d=new Date(),parts=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).formatToParts(d),p=k=>parts.find(v=>v.type===k)?.value||'';return `${p('dayPeriod')}${p('hour')}:${p('minute')} · ${p('year')}年${p('month')}月${p('day')}日`;};
export function createQuoteCardUI(ctx){
 let dialog,opening=false;
 async function open(trigger){
  if(dialog?.open||opening)return;opening=true;
  try{
   const account=ctx.accountId(),key=`xhs-quote-card:${account}`,pool=await ctx.api('/api/quote-cards');
   if(account!==ctx.accountId())throw Error('账号已变化，请重新打开语录卡。');
   let stored;try{stored=JSON.parse(localStorage.getItem(key));}catch{}
   const state={topic:'',text:'',format:'sentence',zoom:100,stamp:timestamp(),metrics:randomQuoteMetrics(),...stored,zoom:100};state.metrics=stored?.metricsVersion===2?normalizeQuoteMetrics(state.metrics):randomQuoteMetrics();state.metricsVersion=2;
   let authors=pool.authors,active=pool.active,loadedAvatar=null,loadedId=null,sequence=0,timer,busy=false,modelBusy=false,rendering=false,closed=false,saved=null;
   const stash=()=>{try{localStorage.setItem(key,JSON.stringify(state));}catch{}};
   const sameAccount=()=>{if(account!==ctx.accountId())throw Error('账号已变化，请关闭并在当前账号重新打开。');};
   const repair=()=>{if(!authors.some(a=>a.id===state.avatarId))state.avatarId=pick(authors)?.id;if(!authors.some(a=>a.id===state.nameId))state.nameId=pick(authors,state.avatarId)?.id;};repair();
   dialog=document.createElement('dialog');dialog.className='quote-card-dialog';dialog.setAttribute('aria-label','语录卡');
   dialog.innerHTML=`<header class="dialog-head"><h2>语录卡</h2><button type="button" class="btn" data-quote-close>关闭</button></header><div class="quote-card-body"><section class="quote-card-controls"><div class="field"><label for="quote-topic">主题</label><input type="text" id="quote-topic" maxlength="600" value="${ctx.esc(state.topic)}" placeholder="例如：边界感、自我价值"></div><div class="quote-generation"><select id="quote-format" aria-label="文案长度"><option value="sentence">金句</option><option value="paragraph">短段落</option></select><button class="btn primary" type="button" data-quote-generate>生成文案</button></div><div class="quote-variants" aria-label="选择文案"></div><div class="field"><label for="quote-text">文字</label><textarea id="quote-text" rows="6" maxlength="1200">${ctx.esc(state.text)}</textarea></div><div class="quote-author"><img src="${ctx.esc(authors.find(a=>a.id===state.avatarId)?.avatarURL||'/mark.svg')}" alt="作者头像"><div><strong></strong><span></span></div><button class="btn small" type="button" data-quote-author>换作者</button></div><fieldset class="quote-metrics"><legend>互动数据</legend><div class="quote-metrics-grid">${[['views','查看'],['likes','点赞'],['bookmarks','收藏'],['reposts','转发'],['comments','评论']].map(([key,label])=>`<div class="field"><label for="quote-metric-${key}">${label}</label><input type="number" id="quote-metric-${key}" data-quote-metric="${key}" min="0" max="1000000000" step="1" value="${state.metrics[key]}"></div>`).join('')}</div><button class="btn" type="button" data-quote-metrics>重新随机</button></fieldset><details class="quote-pool"><summary>作者素材 · <span data-quote-count></span></summary><div class="field"><label for="quote-urls">X主页或搜索页</label><textarea id="quote-urls" rows="2" placeholder="可留空，自动从X搜索页采集"></textarea></div><div class="actions"><button class="btn" type="button" data-quote-collect>补充300位作者</button><button class="btn" type="button" data-quote-stop hidden>停止采集</button></div><p data-quote-progress role="status"></p></details></section><section class="quote-card-preview"><p class="quote-card-status" role="status" aria-live="polite"></p><button class="btn" type="button" data-quote-retry hidden>重新加载预览</button><canvas aria-label="黑底X风格语录卡，原比例"></canvas><div class="quote-card-actions"><button class="btn" type="button" data-quote-download>导出图片</button><button class="btn primary" type="button" data-quote-use>加入笔记</button></div></section></div>`;
   const q=s=>dialog.querySelector(s),canvas=q('canvas'),status=q('.quote-card-status'),input=q('#quote-text'),format=q('#quote-format');format.value=state.format;
   const ready=()=>!!state.text.trim()&&Array.from(state.text).length<=600&&!!loadedAvatar&&!busy&&!modelBusy&&!rendering&&account===ctx.accountId();
   const controls=()=>{q('[data-quote-download]').disabled=!ready();q('[data-quote-use]').disabled=!ready();q('[data-quote-author]').disabled=!authors.length||busy;q('[data-quote-generate]').disabled=modelBusy||busy;q('[data-quote-metrics]').disabled=busy;q('[data-quote-author]').disabled=busy||!authors.length;dialog.querySelectorAll('[data-quote-metric]').forEach(e=>e.disabled=busy);q('#quote-topic').disabled=modelBusy||busy;format.disabled=modelBusy||busy;input.disabled=busy;};
   async function preview(){
    const seq=++sequence;rendering=true;saved=null;repair();stash();controls();
    const avatar=authors.find(a=>a.id===state.avatarId),name=authors.find(a=>a.id===state.nameId);
    q('[data-quote-count]').textContent=authors.length+'份';
    q('[data-quote-retry]').hidden=true;
    canvas.hidden=true;
    if(!avatar||!name){loadedAvatar=null;loadedId=null;q('.quote-author').hidden=true;status.textContent='作者素材为空，请补充作者后生成图片。';q('.quote-pool').open=true;q('[data-quote-retry]').hidden=false;rendering=false;controls();return;}
    q('.quote-author').hidden=false;q('.quote-author img').src=avatar.avatarURL;q('.quote-author strong').textContent=name.name;q('.quote-author span').textContent=name.handle;
    if(!modelBusy)status.textContent='正在生成预览…';
    try{
     const [chrome,nextAvatar]=await Promise.all([loadChrome(),loadedId===avatar.id&&loadedAvatar?Promise.resolve(loadedAvatar):image(avatar.avatarURL)]);
     if(closed||seq!==sequence)return;
     drawQuoteCard(canvas,{...state,avatar:nextAvatar,author:name,chrome});loadedAvatar=nextAvatar;loadedId=avatar.id;canvas.hidden=false;
     if(Array.from(state.text).length>600)status.textContent='正文超过600字，请精简后导出。';else if(!modelBusy)status.textContent='';
    }catch(e){if(closed||seq!==sequence)return;loadedAvatar=null;loadedId=null;status.textContent=e.message;q('[data-quote-retry]').hidden=false;}
    finally{if(!closed&&seq===sequence){rendering=false;controls();}}
   }
   q('[data-quote-retry]').onclick=()=>{loadedId=null;void preview();};
   const blob=()=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('图片导出失败。')),'image/png'));
   q('#quote-topic').oninput=e=>{state.topic=e.target.value;stash();};
   input.oninput=()=>{state.text=input.value;void preview();};format.onchange=()=>{state.format=format.value;stash();};
   q('[data-quote-author]').onclick=()=>{state.avatarId=pick(authors,state.avatarId)?.id;state.nameId=pick(authors,state.nameId)?.id;void preview();};
   const syncMetrics=()=>dialog.querySelectorAll('[data-quote-metric]').forEach(e=>{e.value=state.metrics[e.dataset.quoteMetric];});
   q('[data-quote-metrics]').onclick=()=>{state.metrics=randomQuoteMetrics();syncMetrics();void preview();};
   dialog.querySelectorAll('[data-quote-metric]').forEach(e=>e.onchange=()=>{state.metrics=normalizeQuoteMetrics({...state.metrics,[e.dataset.quoteMetric]:e.value});syncMetrics();void preview();});
   q('[data-quote-generate]').onclick=async()=>{try{sameAccount();modelBusy=true;const priorText=state.text;status.textContent='正在生成文案…';controls();const result=await ctx.api('/api/quote-cards/generate',{topic:state.topic,format:state.format});sameAccount();if(closed)return;q('.quote-variants').replaceChildren();result.variants.forEach((text,i)=>{const button=document.createElement('button');button.type='button';button.className='quote-variant';button.textContent=text;button.setAttribute('aria-label',`使用文案${i+1}：${text}`);button.onclick=()=>{state.text=text;input.value=text;void preview();};q('.quote-variants').append(button);});if(state.text===priorText){state.text=result.variants[0];input.value=state.text;}modelBusy=false;await preview();}catch(e){if(!closed)status.textContent=e.message;}finally{modelBusy=false;if(!closed)controls();}};
   const poolState=value=>{active=value.active;q('[data-quote-collect]').disabled=!!active;q('[data-quote-stop]').hidden=!active;q('[data-quote-progress]').textContent=active?`${active.phase} · ${active.count}/${active.target}`:value.result?.error||value.result?value.result?.error||`已保存 ${authors.length} 位作者${value.result?.errors?.length?' · 部分页面未完成，可继续补充':''}`:'';};
   async function poll(){if(closed)return;try{const value=await ctx.api('/api/quote-cards');if(closed)return;const changed=authors.length!==value.authors.length;authors=value.authors;poolState(value);q('[data-quote-count]').textContent=authors.length+'份';if(changed){repair();await preview();}}catch(e){if(!closed)q('[data-quote-progress]').textContent=e.message;}finally{if(!closed&&active)timer=setTimeout(poll,2000);}}
   q('[data-quote-collect]').onclick=async()=>{try{sameAccount();await ctx.api('/api/quote-cards/authors/collect',{target:300,urls:q('#quote-urls').value.split('\n').map(s=>s.trim()).filter(Boolean)});await poll();}catch(e){q('[data-quote-progress]').textContent=e.message;}};
   q('[data-quote-stop]').onclick=async()=>{await ctx.api('/api/quote-cards/authors/stop',{});await poll();};
   q('[data-quote-download]').onclick=async()=>{try{sameAccount();if(!ready())return;const url=URL.createObjectURL(await blob()),a=document.createElement('a');a.href=url;a.download='语录卡.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){status.textContent=e.message;}};
   q('[data-quote-use]').onclick=async()=>{try{sameAccount();if(!ready())return;busy=true;controls();status.textContent='正在保存…';if(!saved){const r=await fetch('/api/assets?name='+encodeURIComponent('语录卡.png'),{method:'POST',headers:accountHeaders(account,'application/octet-stream'),body:await blob()});const asset=await r.json();if(!r.ok)throw Error(asset.error);sameAccount();await ctx.api('/api/materials/quote-card',{assetId:asset.id,text:state.text,avatarId:state.avatarId,nameId:state.nameId,metrics:state.metrics,simulated:true});saved=asset;}if(closed)return;await ctx.refresh();sameAccount();ctx.useAsset(saved);dialog.close();ctx.toast('语录卡已加入笔记');}catch(e){status.textContent=e.message;}finally{busy=false;if(!closed)controls();}};
   q('[data-quote-close]').onclick=()=>dialog.close();
   dialog.addEventListener('click',e=>{const r=dialog.getBoundingClientRect();if(e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))dialog.close();});
   dialog.addEventListener('close',()=>{closed=true;clearTimeout(timer);sequence++;stash();dialog.remove();dialog=null;if(trigger?.isConnected)trigger.focus({preventScroll:true});},{once:true});
   document.body.append(dialog);poolState(pool);dialog.showModal();await preview();if(active)timer=setTimeout(poll,2000);
  }finally{opening=false;}
 }
 return {open};
}
