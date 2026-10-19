/* A screenshot is captured from the real page; no redraw or layout changes. */
async function wbCaptureComment({url,commentId,expectedText}) {
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(commentId)||typeof expectedText!=='string'||!expectedText.trim())throw new Error('缺少有效的评论标识或原文，请手动上传截图。');
  const link=new URL(url);
  if(!allowedHost(url)||!/^\/explore\/[a-zA-Z0-9_-]+$/.test(link.pathname))throw new Error('笔记地址无效。');
  await cmdNavigate({url});
  const tab=await getOrOpenXhsTab();
  const inspect=async action=>{
    const r=await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:wbCommentDOM,args:[{commentId,expectedText,action}]});
    const value=r?.[0]?.result;if(value?.error)throw new Error(value.error);return value;
  };
  let found=false,stagnant=0,lastCount=-1;
  for(let n=0;n<30;n++){
    const r=await inspect('find');if(r?.found){found=true;break;}
    if(r?.count===lastCount)stagnant++;else stagnant=0;lastCount=r?.count;
    if(n>=4&&(r?.atEnd||(r?.count>0&&stagnant>=5)))break;
    await inspect('load');await sleep(600);
  }
  if(!found)throw new Error('已加载的评论中找不到这条原评论；可能已删除、排序变化或未加载。请打开来源核查，或手动上传截图。');
  const target={tabId:tab.id};
  await chrome.debugger.attach(target,'1.3');
  try{
    // Edge's debugger notice can resize the viewport. Measure only after it opens.
    await inspect('reveal');
    let before,previous='',stable=0;
    for(let i=0;i<24;i++){before=await inspect('measure');const current=JSON.stringify({content:before.content,clip:before.clip});stable=before.imagesReady!==false&&current===previous?stable+1:0;previous=current;if(stable>=2)break;await sleep(200);}
    if(stable<2)throw Error('评论头像或位置还未稳定，请稍后重试。');
    const full=await chrome.debugger.sendCommand(target,'Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
    const after=await inspect('measure');
    if(after.imagesReady===false||before.content!==after.content)throw new Error('截图期间评论文字或图片发生变化，本次未保存。');
    if(JSON.stringify(before.clip)!==JSON.stringify(after.clip))throw new Error('截图期间评论位置发生变化，本次未保存，请重新核查。');
    const current=await chrome.tabs.get(tab.id);
    if(new URL(current.url).pathname!==link.pathname)throw new Error('截图期间页面已切换，本次结果未保存。');
    return {originalData:full.data,commentId,content:before.content,author:before.author,likes:before.likes,url:current.url,clip:before.clip,viewport:before.viewport,capturedAt:new Date().toISOString()};
  }finally{await chrome.debugger.detach(target).catch(()=>{});}
}
function wbCommentDOM({commentId,expectedText,action}) {
  const visible=e=>{const r=e?.getBoundingClientRect();return r&&r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
  const blocked=[...document.querySelectorAll('.access-wrapper,.error-wrapper,.not-found-wrapper,.blocked-wrapper,.captcha-container,.verify-container')].find(visible);
  if(blocked)return {error:'页面需要人工处理：'+String(blocked.innerText||'验证码或页面不可访问').slice(0,180)};
  const area=document.querySelector('.comments-container');
  const root=document.getElementById('comment-'+commentId);
  const count=document.querySelectorAll('.comments-container .parent-comment,.comments-container [id^="comment-"]').length;
  if(action==='find')return {found:!!root,count,atEnd:visible(area?.querySelector('.end-container'))};
  if(action==='load'){
    const last=area?.querySelectorAll('.parent-comment');last?.[last.length-1]?.scrollIntoView({block:'end',behavior:'instant'});
    let scroller=area;while(scroller&&scroller!==document.body){if(scroller.scrollHeight>scroller.clientHeight+8&&/auto|scroll/.test(getComputedStyle(scroller).overflowY)){scroller.scrollBy(0,Math.max(200,scroller.clientHeight*.7));return {ok:true};}scroller=scroller.parentElement;}
    window.scrollBy(0,innerHeight*.7);return {ok:true};
  }
  if(!root)return {error:'原评论已经离开页面，请重新核查。'};
  const card=root.querySelector(':scope > .comment-item')||root;
  if(action==='reveal'){
    const expand=[...card.querySelectorAll('.content button,.content .show-more,.content .expand,.content span')].find(e=>visible(e)&&/^(展开|展开全文)$/.test(e.innerText?.trim()));expand?.click();card.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});return {ok:true};
  }
  const contentEl=card.querySelector('.content .note-text,.content');
  const content=contentEl?.innerText?.trim();
  const normalize=s=>String(s||'').normalize('NFKC').replace(/\[[^\]]{1,30}\]/g,'').replace(/[\p{P}\p{S}\s]/gu,'');
  if(!content||!normalize(expectedText)||!normalize(content).includes(normalize(expectedText)))return {error:'页面评论文字与采集记录不一致，无法确认截图对象。请打开来源核查或手动上传。'};
  if(contentEl.scrollHeight>contentEl.clientHeight+3&&getComputedStyle(contentEl).overflow!=='visible')return {error:'评论正文仍被折叠或截断，请手动展开并上传完整截图。'};
  const r=card.getBoundingClientRect();const padding=6;
  const clip={x:Math.max(0,Math.floor(r.left)-padding),y:Math.max(0,Math.floor(r.top)-padding),width:Math.ceil(r.width)+padding*2,height:Math.ceil(r.height)+padding*2};
  if(r.width<30||r.height<20||r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight||clip.x+clip.width>innerWidth||clip.y+clip.height>innerHeight)return {error:'整条评论无法完整放入当前一屏，已停止截图。请手动截取完整评论后上传。'};
  for(let p=card.parentElement;p&&p!==document.body;p=p.parentElement){const st=getComputedStyle(p),b=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(st.overflowY)&&((r.top<b.top)||(r.bottom>b.bottom)))return {error:'评论被滚动容器裁切，请手动截图。'};}
  for(const [x,y] of [[r.left+3,r.top+3],[r.right-3,r.top+3],[r.left+3,r.bottom-3],[r.right-3,r.bottom-3],[r.left+r.width/2,r.top+r.height/2]]){const top=document.elementFromPoint(x,y);if(!top||(!card.contains(top)&&top!==card))return {error:'评论被弹层或其他内容遮挡，请在浏览器处理后再截图。'};}
  return {clip,content,imagesReady:[...card.querySelectorAll('img')].filter(visible).every(i=>i.complete&&i.naturalWidth>1),author:card.querySelector('.name,.user-name,.author')?.innerText?.trim()||'',likes:card.querySelector('.like-wrapper .count,.like .count,.interactions .like span,.interactions .like-wrapper')?.innerText?.trim()||null,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,scrollX,scrollY}};
}

// Read rendered comments when the upstream state snapshot omits the DOM list.
async function wbReadXhsComments({url}){
 const link=new URL(url);if(!allowedHost(url)||!/^\/explore\/[a-zA-Z0-9_-]+$/.test(link.pathname))throw Error('笔记地址无效。');
 await cmdNavigate({url});const tab=await getOrOpenXhsTab();let result={comments:[]};
 for(let i=0;i<20;i++){
  const r=await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:wbXhsReadCommentsDOM,args:[link.pathname]});result=r?.[0]?.result||result;if(result.error)throw Error(result.error);
  if(result.comments?.length||result.empty)break;await sleep(400);
 }
 return {...result,url:link.href,observedAt:new Date().toISOString()};
}
function wbXhsReadCommentsDOM(pathname){
 if(location.pathname!==pathname)return {comments:[]};
 const visible=e=>{const r=e?.getBoundingClientRect();return r&&r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
 if([...document.querySelectorAll('.captcha-container,.verify-container,.login-container')].some(visible))return {error:'请本人在 Edge 完成小红书登录或验证。'};
 const area=document.querySelector('.comments-container');if(!area)return {comments:[]};
 const roots=[...area.querySelectorAll('.parent-comment,[id^="comment-"]')],comments=[],seen=new Set();
 for(const root of roots){
  const id=(root.id||root.querySelector('[id^="comment-"]')?.id||'').replace(/^comment-/,'');if(!id||seen.has(id))continue;
  const card=root.querySelector(':scope > .comment-item')||root,content=card.querySelector('.content .note-text,.content')?.innerText?.trim();if(!content)continue;
  const like=card.querySelector('.like-wrapper .count,.like .count,.interactions .like span,.interactions .like-wrapper,.like-wrapper');
  const raw=like?.innerText?.trim(),likeCount=raw==='赞'?'0':raw&&/^[\d.,]+(?:万|亿|千|[kKmM])?\+?$/.test(raw)?raw:null;
  seen.add(id);comments.push({id,content,likeCount,author:card.querySelector('.name,.user-name,.author')?.innerText?.trim()||''});
 }
 area.scrollIntoView({block:'nearest',behavior:'instant'});return {comments:comments.slice(0,60),empty:visible(area.querySelector('.no-comments-text'))};
}
