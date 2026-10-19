/* Read rendered Douyin pages in the same Edge profile. No signed endpoints,
   cookies, background login or simulated engagement. One owned tab is reused. */
const WB_DOUYIN_TAB='douyin:comments';
function wbDouyinURL(url){
 const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='www.douyin.com'||u.username||u.password||!/^\/(?:(?:(?:jingxuan|root)\/)?(?:search\/[^/]+|video\/\d+|note\/\d+)|jingxuan)?\/?$/.test(u.pathname))throw Error('抖音来源链接无效。');return u.href;
}
async function wbDouyinClose(){
 const entry=wbSourceTabs.get(WB_DOUYIN_TAB);if(!entry||entry.handoff)return;
 wbSourceTabs.delete(WB_DOUYIN_TAB);if(entry.owned!==false)await chrome.tabs.remove(entry.id).catch(()=>{});
}
async function wbDouyinPage(url){
 wbDouyinURL(url);
 if(!await chrome.permissions.contains({origins:WB_SOURCE_ORIGINS.douyin}))throw Error('请在 Edge 工作台扩展中启用抖音读取权限。');
 let entry=wbSourceTabs.get(WB_DOUYIN_TAB),tab=entry?await chrome.tabs.get(entry.id).catch(()=>null):null;
 if(entry?.owned===false&&tab&&(tab.pendingUrl||tab.url)!==url){tab=null;entry=null;}
 let owned=entry?.owned!==false;
 if(!tab&&chrome.tabs.query){const existing=(await chrome.tabs.query({})).find(t=>{try{const u=new URL(t.url||'');return u.hostname==='www.douyin.com'&&u.pathname===new URL(url).pathname;}catch{return false;}});if(existing){tab=existing;owned=false;}}
 if(!tab)tab=await chrome.tabs.create({url,active:true});
 else if((tab.pendingUrl||tab.url)!==url)tab=await chrome.tabs.update(tab.id,{url,active:true});
 else await chrome.tabs.update(tab.id,{active:true});
 wbSourceTabs.set(WB_DOUYIN_TAB,{id:tab.id,url,handoff:false,owned});return tab;
}
async function wbDouyinInspect(tab,params){
 let r;try{r=await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:wbDouyinDOM,args:[params]});}catch(e){if(/Frame with ID .* was removed|frame.*not found|document.*unloaded/i.test(e.message))return {loading:true};throw e;}
 const value=r?.[0]?.result;if(value?.error){if(/登录|验证/.test(value.error)){const entry=wbSourceTabs.get(WB_DOUYIN_TAB);if(entry)entry.handoff=true;}throw Error(value.error);}return value;
}
async function wbDouyinSearch({keyword}){
 if(typeof keyword!=='string'||!keyword.trim()||keyword.length>100)throw Error('请填写抖音评论关键词。');
 keyword=keyword.trim();
 const url='https://www.douyin.com/search/'+encodeURIComponent(keyword),items=new Map();
 // Enter through the rendered search control, as a human does. Direct search
 // document requests can return a gateway error while the home app still works.
 const existing=(await chrome.tabs.query({})).find(t=>{try{const u=new URL(t.url||'');return !/Bad Gateway|Unavailable|Time.?out/i.test(t.title||'')&&u.hostname==='www.douyin.com'&&decodeURIComponent(u.pathname.replace(/^\/(?:jingxuan|root)\//,'/'))==='/search/'+keyword;}catch{return false;}});
 let tab=await wbDouyinPage(existing?.url||'https://www.douyin.com/?recommend=1'),submitted=false,typed=false,observedURL=url;
 try{
  for(let i=0;i<36;i++){
   const state=await wbDouyinInspect(tab,{action:'submit-search',url,keyword});
   if(state?.submitted){submitted=true;break;}
   if(state?.input&&!typed){await wbDouyinTypeSearch(tab,state.input,keyword);typed=true;}
   await sleep(450);
  }
  if(!submitted)throw Error('抖音搜索框尚未就绪，请在当前 Edge 搜索后重试。');
  for(let i=0;i<36;i++){
   const state=await wbDouyinInspect(tab,{action:'search',url});
   if(state?.url)observedURL=state.url;
   for(const item of state?.items||[])items.set(item.url,item);
   if(items.size>=6||state?.empty)break;await sleep(450);
  }
  if(!items.size)throw Error('抖音未返回可读取的视频或图文，请在搜索页核查或换个关键词。');
  return {url:observedURL,items:[...items.values()].slice(0,12),observedAt:new Date().toISOString()};
 }catch(e){const entry=wbSourceTabs.get(WB_DOUYIN_TAB);if(entry)entry.handoff=true;throw e;}
}
async function wbDouyinTypeSearch(tab,point,keyword){
 const target={tabId:tab.id};await chrome.debugger.attach(target,'1.3');
 try{
  const send=(method,params)=>chrome.debugger.sendCommand(target,method,params);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,commands:['selectAll']});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2});
  await send('Input.insertText',{text:keyword});
  await sleep(500);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 }finally{await chrome.debugger.detach(target).catch(()=>{});}
}
async function wbDouyinReadComments({url}){
 const tab=await wbDouyinPage(wbDouyinURL(url)),comments=new Map();let title='',stagnant=0;
 for(let i=0;i<64;i++){
  const state=await wbDouyinInspect(tab,{action:'comments',url});title=state?.title||title;
  const before=comments.size;
  for(const c of state?.comments||[])comments.set(c.key,c);
  if(comments.size===before)stagnant++;else stagnant=0;
  if(comments.size>=80||(comments.size&&stagnant>=4)||state?.empty)break;
  await wbDouyinInspect(tab,{action:comments.size?'scroll':'open-comments',url});await sleep(450);
 }
 if(!comments.size)throw Error('抖音评论区未读到评论，请在来源页展开评论后重试。');
 return {url,title,comments:[...comments.values()].slice(0,80),observedAt:new Date().toISOString()};
}
async function wbDouyinCaptureComment({url,commentId,expectedText,expectedAuthor}){
 if(typeof expectedText!=='string'||!expectedText.trim())throw Error('缺少抖音原评论文字。');
 const tab=await wbDouyinPage(wbDouyinURL(url)),params={url,commentId,expectedText,expectedAuthor};
 let found=false;
 for(let i=0;i<36;i++){
  const state=await wbDouyinInspect(tab,{...params,action:'find'});if(state?.found){found=true;break;}
  await wbDouyinInspect(tab,{action:i?'scroll':'open-comments',url});await sleep(450);
 }
 if(!found)throw Error('抖音页面找不到这条原评论，可能排序变化或已删除，请在来源页核查。');
 const target={tabId:tab.id};await chrome.debugger.attach(target,'1.3');
 try{
  let before,ready=0,previous='';
  for(let i=0;i<32;i++){
   const state=await wbDouyinInspect(tab,{...params,action:'measure'});
   const signature=JSON.stringify(state);ready=state?.ready&&signature===previous?ready+1:0;previous=signature;before=state;
   if(ready>=2)break;await sleep(300);
  }
  if(ready<2)throw Error(before?.message||'评论头像或图片尚未加载，已停止截图。');
  const shot=await chrome.debugger.sendCommand(target,'Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
  const after=await wbDouyinInspect(tab,{...params,action:'measure'});
  if(!after.ready||JSON.stringify(before)!==JSON.stringify(after))throw Error('截图时抖音评论发生变化，请重新截图。');
  return {...before,originalData:shot.data,commentId,url,capturedAt:new Date().toISOString()};
 }finally{await wbDouyinInspect(tab,{...params,action:'restore'}).catch(()=>{});await chrome.debugger.detach(target).catch(()=>{});}
}
function wbDouyinDOM({action,url,keyword,commentId,expectedText,expectedAuthor}){
 if(action==='restore'){for(const [el,css] of globalThis.__wbDouyinCaptureLayout||[])el.style.cssText=css;delete globalThis.__wbDouyinCaptureLayout;return {restored:true};}
 const visible=e=>{const r=e?.getBoundingClientRect();return !!r&&r.width>0&&r.height>0&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden';};
 const text=document.body?.innerText||'';
 if(/^\s*(?:502 Bad Gateway|503 Service (?:Temporarily )?Unavailable|504 Gateway Time-?out)\b/i.test(text))return {error:'抖音返回网关错误（502/503/504），请在当前 Edge 打开首页后重试。'};
 if([...document.querySelectorAll('[id*="captcha"],[class*="captcha"],[data-e2e="verify-container"]')].some(visible)||/请完成.{0,12}(验证|校验)|拖动.{0,10}滑块/.test(text))return {error:'请本人在 Edge 完成抖音验证，再继续评论截图。'};
 if([...document.querySelectorAll('[data-e2e="login-modal"],[data-e2e="login-dialog"]')].some(visible)||/登录后即可搜索|登录后查看评论|扫码登录[\s\S]{0,300}验证码登录/.test(text))return {error:'请在当前 Edge 完成抖音扫码登录，不需要重新登录小红书。'};
 const requested=new URL(url),actual=new URL(location.href);
 if(actual.hostname!=='www.douyin.com')return {error:'抖音页面已离开原网站。'};
 if(action==='submit-search'){
  if(decodeURIComponent(actual.pathname.replace(/^\/(?:jingxuan|root)\//,'/'))===decodeURIComponent(requested.pathname))return {submitted:true};
  // The selected landing app may redirect '/' to jingxuan. Its own 推荐 link
  // enters the regular app without issuing the failing search-document request.
  if(/^\/jingxuan\/?$/.test(actual.pathname)){
   const recommend=[...document.querySelectorAll('a[href]')].find(e=>visible(e)&&e.innerText?.trim()==='推荐'&&new URL(e.href,location.href).pathname==='/');
   if(recommend){recommend.click();return {loading:true};}
  }
  const input=[...document.querySelectorAll('input')].find(e=>visible(e)&&!e.disabled&&(/搜索/.test(e.placeholder||'')||e.getAttribute('data-e2e')==='searchbar-input'));
  if(!input)return {loading:true};
  const labels=[...document.querySelectorAll('button,[role="button"],div,span')].filter(e=>visible(e)&&e.innerText?.trim()==='搜索'&&!e.querySelector?.('input'));
  const button=labels.find(e=>!labels.some(child=>child!==e&&e.contains?.(child)));
  const pending=globalThis.__wbDouyinSearchPending;
  if(!pending||pending.keyword!==keyword||pending.url!==url||input.value!==keyword){
   input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,keyword);
   input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
   globalThis.__wbDouyinSearchPending={keyword,url,waits:0};return {loading:true};
  }
  if(button&&!pending.clicked){button.click();pending.clicked=true;return {loading:true};}
  if(pending.waits++<3)return {loading:true};
  input.focus();const r=input.getBoundingClientRect();return {input:{x:r.left+r.width/2,y:r.top+r.height/2}};
 }
 const route=u=>decodeURIComponent(u.pathname.replace(/^\/(?:jingxuan|root)\//,'/')).replace(/\/$/,'');
 const match=route(requested).match(/^\/(video|note)\/(\d+)/);
 if(match){if(route(actual)!==route(requested)&&actual.searchParams.get('modal_id')!==match[2])return {loading:true};}
 else if(route(actual)!==route(requested))return {loading:true};
 if(action==='search'){
  // The new app's combined results are click-only cards. Its visible 视频 tab
  // exposes the video links used by the comment collector; enter it in-page.
  if(actual.searchParams.get('type')==='general'){
   const labels=[...document.querySelectorAll('button,[role="tab"],div,span')].filter(e=>visible(e)&&e.innerText?.trim()==='视频');
   const videos=labels.find(e=>!labels.some(child=>child!==e&&e.contains?.(child)));
   if(videos){videos.click();return {loading:true};}
  }
  const items=new Map();
  for(const a of document.querySelectorAll('a[href*="/video/"],a[href*="/note/"],a[href*="modal_id="]')){
   if(!visible(a))continue;const u=new URL(a.href,location.href),id=u.searchParams.get('modal_id');
   if(id&&/^\d+$/.test(id)){u.pathname='/video/'+id;u.search='';}
   if(u.hostname!=='www.douyin.com'||!/^\/(?:(?:jingxuan|root)\/)?(video|note)\/\d+$/.test(u.pathname))continue;
   const root=a.closest('[data-e2e="search-result-item"],[data-e2e="search-result"],li')||a;
   const title=root.querySelector('[data-e2e="video-desc"],[data-e2e="search-result-title"]')?.innerText||a.innerText||a.querySelector('img')?.alt||'';
   const canonical=u.origin+u.pathname;if(title.trim())items.set(canonical,{url:canonical,title:title.trim().slice(0,700)});
  }
  return {url:actual.href,items:[...items.values()],empty:/没有找到相关|暂无搜索结果/.test(text)};
 }
 for(const video of document.querySelectorAll('video'))if(!video.paused)video.pause();
 const area=document.querySelector('[data-e2e="comment-list"],[data-e2e="comment-container"],[data-e2e="comment-area"],[class*="commentList"]');
 const roots=[...document.querySelectorAll('[data-e2e="comment-item"],[data-e2e="comment-level-1"],[data-comment-id]')].filter(r=>!r.parentElement?.closest('[data-e2e="comment-item"]'));
 const contentOf=root=>root.querySelector('[data-e2e="comment-content"],[data-e2e="comment-item-content"],[class*="commentContent"],.comment-item-info-wrap + div > span:first-child');
 const authorOf=root=>(root.querySelector('.comment-item-info-wrap a[href*="/user/"]')||root.querySelector('[data-e2e="comment-user-name"],[data-e2e="comment-item-user-name"]'))?.innerText?.trim()||[...root.querySelectorAll('a[href*="/user/"]')].map(a=>a.innerText?.trim()).find(Boolean)||'';
 const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
 const values=roots.map(root=>{
  const content=contentOf(root)?.innerText?.trim(),author=authorOf(root);
  const like=root.querySelector('[data-e2e="comment-like-count"],[data-e2e="comment-item-digg"] span,[data-e2e="comment-item-digg"],[data-e2e="comment-like"],.comment-item-stats-container p:first-child span');
  const raw=like?.innerText?.trim()||like?.getAttribute('aria-label')?.match(/(?:点赞|赞)\s*([\d.,万亿千kKmM]+)|([\d.,万亿千kKmM]+)\s*(?:点赞|赞)/)?.slice(1).find(Boolean)||null;
  const likes=raw&&/^\d+(?:[.,]\d+)*(?:万|亿|千|[kKmMwW])?\+?$/.test(raw)?raw:null;
  const platformId=root.getAttribute('data-comment-id')||root.getAttribute('data-id')||root.querySelector('[data-e2e="video-comment-more"] [id^="tooltip_"]')?.id?.replace(/^tooltip_/, '')||null;
  return {root,content,author,likes,platformId,key:platformId||clean(author)+'\n'+clean(content)};
 }).filter(c=>c.content&&c.author);
 if(action==='comments')return {comments:values.map(({root,...c})=>c),title:document.querySelector('[data-e2e="video-desc"]')?.innerText||'',empty:/暂无评论|还没有评论/.test(text)};
 if(action==='open-comments'){
  if(!roots.length){const button=[...document.querySelectorAll('[data-e2e="video-comment"],[data-e2e="comment-icon"],[data-e2e="feed-comment-icon"],button,[role="button"]')].find(e=>visible(e)&&(/comment/.test(e.getAttribute('data-e2e')||'')||/^评论(?:\s*\d.*)?$/.test(e.innerText?.trim()||'')));button?.click();}return {ok:true};
 }
 if(action==='scroll'){
  let scroll=area||roots.at(-1)?.parentElement;
  while(scroll&&scroll!==document.body){if(scroll.scrollHeight>scroll.clientHeight+8&&/auto|scroll/.test(getComputedStyle(scroll).overflowY)){scroll.scrollBy({top:Math.max(250,scroll.clientHeight*.8),behavior:'instant'});return {ok:true};}scroll=scroll.parentElement;}
  roots.at(-1)?.scrollIntoView({block:'end',behavior:'instant'});return {ok:true};
 }
 const found=values.filter(c=>(!commentId||!c.platformId||c.platformId===commentId)&&clean(c.content)===clean(expectedText)&&(!expectedAuthor||clean(c.author)===clean(expectedAuthor)));
 if(action==='find')return {found:found.length===1};
 if(found.length!==1)return {error:'抖音评论文字或作者与采集记录不一致，无法确认截图对象。'};
 const c=found[0],card=c.root,content=contentOf(card);
 // Reflow the genuine page comment into a readable width, without replacing
 // text, author, likes or images. The capture's finally restores every style.
 if(card.style){
  const saved=globalThis.__wbDouyinCaptureLayout??=new Map();
  const remember=el=>{if(el?.style&&!saved.has(el))saved.set(el,el.style.cssText);};
  remember(card);const width=Math.min(480,Math.max(240,innerWidth-card.getBoundingClientRect().left-12));
  for(const [key,value] of [['width',width+'px'],['max-width',width+'px'],['min-width','0'],['flex','0 0 auto']])card.style.setProperty(key,value,'important');
  if(content?.style){remember(content);for(const [key,value] of [['white-space','normal'],['overflow-wrap','anywhere'],['max-width','100%']])content.style.setProperty(key,value,'important');}
 }
 const expand=[...card.querySelectorAll('button,span,[role="button"]')].find(e=>visible(e)&&/^(展开|展开全文)$/.test(e.innerText?.trim()||''));
 if(expand){expand.click();return {ready:false,message:'正在展开完整评论。'};}
 card.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
 if(content&&content.scrollHeight>content.clientHeight+3&&/hidden|clip/.test(getComputedStyle(content).overflowY))return {error:'抖音评论仍被折叠，请本人展开后重试。'};
 const bounds=card.getBoundingClientRect(),primary=card.querySelector('.comment-item-info-wrap')?.parentElement,bodyBounds=primary?.getBoundingClientRect();
 const r=bodyBounds?{left:bounds.left,top:bounds.top,right:bounds.right,bottom:bodyBounds.bottom,width:bounds.width,height:bodyBounds.bottom-bounds.top}:bounds,padding=4;
 if(r.top<0||r.left<0||r.right>innerWidth||r.bottom>innerHeight||r.width<40||r.height<20)return {error:'这条评论无法完整放入一屏，请手动截取长图后上传。'};
 for(let p=card.parentElement;p&&p!==document.body;p=p.parentElement){const style=getComputedStyle(p),b=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(style.overflowY)&&(r.top<b.top||r.bottom>b.bottom))return {error:'评论被内部滚动区域裁切，无法保存完整截图。'};}
 for(const [x,y]of [[r.left+4,r.top+4],[r.right-4,r.bottom-4],[r.left+r.width/2,r.top+r.height/2]]){const top=document.elementFromPoint(x,y);if(!top||(!card.contains(top)&&top!==card))return {error:'评论被弹窗遮挡，请关闭弹窗后重试。'};}
 const images=[...card.querySelectorAll('img')].filter(img=>visible(img)&&img.getBoundingClientRect().bottom<=r.bottom+1);
 if(!images.length||images.some(img=>!img.complete||img.naturalWidth<2||!img.currentSrc))return {ready:false,message:'评论头像或图片还未加载，请稍后重试。'};
 const x=Math.max(0,Math.floor(r.left)-padding),y=Math.max(0,Math.floor(r.top)-padding);
 return {ready:true,content:c.content,author:c.author,likes:c.likes,presentation:card.style?{kind:'native-reflow',width:480}:undefined,clip:{x,y,width:Math.min(innerWidth-x,Math.ceil(r.right)+padding-x),height:Math.min(innerHeight-y,Math.ceil(r.bottom)+padding-y)},viewport:{width:innerWidth,height:innerHeight}};
}
