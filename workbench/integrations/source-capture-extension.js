/* Local DOM adapters. MIT source references and pinned revisions are in
   docs/INTEGRATIONS.md. No cookies or private APIs. */
const WB_SOURCE_ORIGINS={x:['https://x.com/*','https://twitter.com/*'],douyin:['https://www.douyin.com/*']};
const wbSourceTabs=new Map();
function wbSourcePlatform(url){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error('素材链接无效。');if(['x.com','twitter.com'].includes(u.hostname))return 'x';if(u.hostname==='www.douyin.com')return 'douyin';throw Error('素材平台未开放。');}
async function wbSourceStatus(){const platforms={};for(const [platform,origins] of Object.entries(WB_SOURCE_ORIGINS))platforms[platform]=await chrome.permissions.contains({origins});return {platforms};}
const wbSourceTabKey=(platform,background)=>platform+(background?':read':':view');
async function wbCloseSourceReadTab(url){
 const key=wbSourceTabKey(wbSourcePlatform(url),true),entry=wbSourceTabs.get(key);
 if(!entry||entry.handoff)return;
 wbSourceTabs.delete(key);await chrome.tabs.remove(entry.id).catch(()=>{});
}
async function wbSourceTab(url,{openOnly=false,background=false,foregroundLoad=false,authorPool=false}={}){
 const platform=wbSourcePlatform(url);
 if(!await chrome.permissions.contains({origins:WB_SOURCE_ORIGINS[platform]}))throw Error('请点击 Edge 的工作台扩展，在弹窗中启用 '+(platform==='x'?'X':'抖音')+' 素材读取权限。');
 const key=wbSourceTabKey(platform,background),entry=wbSourceTabs.get(key);let tab=entry?await chrome.tabs.get(entry.id).catch(()=>null):null;
 // Chrome can return an empty URL while a newly created tab is navigating.
 // Keep that owned tab instead of creating another on a quick second click.
 let currentURL=tab?.pendingUrl||tab?.url;
 if((!currentURL||currentURL==='about:blank')&&entry&&Date.now()-entry.openedAt<30000)currentURL=entry.url;
 if(!tab||!currentURL||!WB_SOURCE_ORIGINS[platform].some(origin=>new URL(origin).hostname===new URL(currentURL).hostname))tab=await chrome.tabs.create({url,active:!background||foregroundLoad});
 else if(new URL(currentURL).href!==new URL(url).href)tab=await chrome.tabs.update(tab.id,{url,...(!background||foregroundLoad?{active:true}:{})});else if(!background||foregroundLoad)tab=await chrome.tabs.update(tab.id,{active:true});
 wbSourceTabs.set(key,{id:tab.id,url,openedAt:entry?.id===tab.id?entry.openedAt:Date.now(),handoff:false});if(openOnly)return {...tab,url:tab.url&&tab.url!=='about:blank'?tab.url:tab.pendingUrl||url};
 const deadline=Date.now()+22000;
 while(Date.now()<deadline){
  const current=await chrome.tabs.get(tab.id);if(!current.url||current.url==='about:blank'){await sleep(250);continue;}if(wbSourcePlatform(current.url)!==platform)throw Error('素材页面跳到了其他网站，请在浏览器处理。');
  const state=(await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:wbSourceDOM,args:[{platform,action:'scan',url,authorPool}]}))?.[0]?.result;
  if(state?.error){if(/本人.*验证|先.*登录/.test(state.error))wbSourceTabs.get(key).handoff=true;throw Error(state.error);}
  if(state?.items?.length||state?.detailReady||state?.empty)return tab;
  await sleep(350);
 }
 throw Error('素材页面尚未加载，已保留 Edge 登录。请在浏览器打开来源检查，不需要反复扫码。');
}
async function wbSourceScan({url,scheduled=false,authorPool=false}){
 let readTab,restoreTab;
 try{
 const platform=wbSourcePlatform(url);
 if(platform==='x'&&!scheduled)restoreTab=(await chrome.tabs.query({active:true,currentWindow:true}))[0];
 const tab=await wbSourceTab(url,{background:true,foregroundLoad:authorPool,authorPool}),items=new Map();
 // Explicitly fetching one source should read its actual rendered photos.
 // X defers media in inactive tabs; only manual reads briefly show the owned tab.
 if(platform==='x'&&!scheduled){
  readTab=tab;
  await chrome.tabs.update(tab.id,{active:true});await sleep(350);
 }
 let quiet=0;const scanDeadline=Date.now()+60000;
 for(let i=0;i<(authorPool?40:4)&&Date.now()<scanDeadline;i++){
  const before=items.size;
  const state=(await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:wbSourceDOM,args:[{platform,action:'scan',url,authorPool}]}))?.[0]?.result;if(state?.error){if(/本人.*验证|先.*登录/.test(state.error))wbSourceTabs.get(wbSourceTabKey(platform,true)).handoff=true;throw Error(state.error);}
  if(authorPool){
   const fresh=(state?.items||[]).filter(item=>item.avatar&&!items.has(item.author?.match(/@[a-zA-Z0-9_]+/)?.[0]||item.url));
   const captured=(await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:wbQuoteAvatarBytes,args:[fresh]}))?.[0]?.result||[];
   for(const item of captured)items.set(item.author?.match(/@[a-zA-Z0-9_]+/)?.[0]||item.url,item);
  }else for(const item of state?.items||[])items.set(item.url,item);
  quiet=items.size===before?quiet+1:0;
  if(items.size>=(authorPool?320:20)||state?.empty||authorPool&&quiet>=5)break;
  await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:()=>window.scrollBy({top:innerHeight*.8,behavior:'instant'})});await sleep(600);
 }
 return {url:(await chrome.tabs.get(tab.id)).url,items:[...items.values()].slice(0,authorPool?320:40),authorPool,observedAt:new Date().toISOString()};
 }finally{
 if(readTab&&restoreTab?.id&&restoreTab.id!==readTab.id){const current=(await chrome.tabs.query({active:true,windowId:readTab.windowId}).catch(()=>[]))[0];if(current?.id===readTab.id)await chrome.tabs.update(restoreTab.id,{active:true}).catch(()=>{});}
 await wbCloseSourceReadTab(url);
 }
}
async function wbMaterialCapture({url,scheduled=false}){
 const platform=wbSourcePlatform(url);let target,attached=false,restoreTab,captureTab;
 try{
  const tab=await wbSourceTab(url,{background:scheduled});target={tabId:tab.id};
  if(platform==='x'&&scheduled){
   // X defers some avatar/photo rendering in inactive tabs. Briefly show this
   // owned reading tab, then restore focus only if the user has not moved on.
   restoreTab=(await chrome.tabs.query({active:true,windowId:tab.windowId}))[0];
   captureTab=tab;await chrome.tabs.update(tab.id,{active:true});
  }
  await chrome.debugger.attach(target,'1.3');attached=true;
  const inspect=async(action,extra={})=>{
   const state=(await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:wbSourceDOM,args:[{platform,action,url,...extra}]}))?.[0]?.result;
   if(!state||state.loading)throw Error('素材页面已切换或尚未加载，请重新打开素材后截图。');
   if(state.error){if(scheduled&&/本人.*验证|先.*登录/.test(state.error))wbSourceTabs.get(wbSourceTabKey(platform,true)).handoff=true;throw Error(state.error);}return state;
  };
  if(platform==='x'){
   // Scroll the real post into view in sections so lazy media is painted. The
   // final capture uses document coordinates, without zooming or redrawing.
   await inspect('position',{offset:0});
   // Prime all sections before waiting for images: a photo below the first
   // viewport may remain lazy until it actually enters the screen.
   let initial=await inspect('position',{offset:0}),primeOffset=0;
   for(let step=0;step<24&&primeOffset+initial.viewport.height-160<initial.documentClip.height;step++){
    primeOffset+=Math.max(200,initial.viewport.height-160);
    initial=await inspect('position',{offset:primeOffset});await sleep(250);
   }
   await inspect('position',{offset:0});
   // Readiness is about the author image and the native post translation, not
   // only whatever image elements happen to exist during the first render.
   let translationRequested=false,stable='',readyCount=0,prepared;
   for(let wait=0;wait<64;wait++){
    prepared=await inspect('prepare',{requestTranslation:!translationRequested});
    if(prepared.translationClicked)translationRequested=true;
    const signature=JSON.stringify(prepared);
    readyCount=prepared.ready&&signature===stable?readyCount+1:0;stable=signature;
    if(readyCount>=2)break;
    await sleep(350);
   }
   if(readyCount<2)throw Error(prepared?.message||'帖子还没准备好，请在浏览器查看后重试。');
   let state=await inspect('position',{offset:0}),offset=0;
   for(let step=0;step<24;step++){
    await sleep(250);state=await inspect('probe');
    if(offset+state.viewport.height-160>=state.documentClip.height)break;
    offset+=Math.max(200,state.viewport.height-160);
    if(step===23)throw Error('这条帖子过长，请分段手动截图后导入。');
    await inspect('position',{offset});
   }
   await inspect('position',{offset:0});await sleep(300);
   for(let wait=0;wait<40&&(await inspect('probe')).pendingMedia;wait++)await sleep(250);
   const before=await inspect('measure');
   // CDP's clip uses device-independent pixels, while DOM rectangles are CSS
   // pixels. Browser zoom changes their ratio; keep the user's zoom unchanged.
   const zoom=await chrome.tabs.getZoom(tab.id);
   if(!Number.isFinite(zoom)||zoom<=0)throw Error('无法读取页面缩放，请重新打开素材后截图。');
   const clip=Object.fromEntries(Object.entries(before.documentClip).map(([k,v])=>[k,v*zoom]));
   const screenshot=await chrome.debugger.sendCommand(target,'Page.captureScreenshot',{format:'png',clip:{...clip,scale:1},captureBeyondViewport:true,fromSurface:true});
   const after=await inspect('measure');
   if(JSON.stringify(before)!==JSON.stringify(after)||zoom!==await chrome.tabs.getZoom(tab.id))throw Error('截图时页面发生变化，请重新查看后截图。');
   const {width,height}=before.documentClip;
   return {...before,pageViewport:{...before.viewport,zoom},viewport:{width,height},clip:{x:0,y:0,width,height},captureMode:height>before.viewport.height?'long-post':'post',originalData:screenshot.data,capturedAt:new Date().toISOString()};
  }
  const revealed=await inspect('reveal');if(revealed?.error)throw Error(revealed.error);await sleep(250);
  const before=await inspect('measure');if(before?.error)throw Error(before.error);
  const screenshot=await chrome.debugger.sendCommand(target,'Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
  const after=await inspect('measure');if(after?.error||JSON.stringify(before)!==JSON.stringify(after))throw Error('截图时页面发生变化，请重新查看后截图。');
  return {...before,originalData:screenshot.data,capturedAt:new Date().toISOString()};
 }finally{
  if(attached)await chrome.debugger.detach(target).catch(()=>{});
  const handoff=wbSourceTabs.get(wbSourceTabKey(platform,true))?.handoff;
  if(restoreTab&&captureTab&&!handoff){
   const active=(await chrome.tabs.query({active:true,windowId:captureTab.windowId}).catch(()=>[]))[0];
   if(active?.id===captureTab.id&&restoreTab.id!==captureTab.id)await chrome.tabs.update(restoreTab.id,{active:true}).catch(()=>{});
  }
  if(scheduled)await wbCloseSourceReadTab(url);
 }
}
// Read publicly displayed avatars through the same browser network path, never cookies.
async function wbQuoteAvatarBytes(items){
 return Promise.all(items.map(async item=>{
  try{
   const u=new URL(item.avatar);if(u.protocol!=='https:'||u.hostname!=='pbs.twimg.com'||!u.pathname.startsWith('/profile_images/'))return item;
   const r=await fetch(u.href,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(3500)});
   if(!r.ok)return item;const type=(r.headers.get('content-type')||'').split(';')[0];if(!['image/png','image/jpeg','image/webp'].includes(type))return item;
   const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length>2*1024*1024)return item;
   let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   return {...item,avatarData:'data:'+type+';base64,'+btoa(binary)};
  }catch{return item;}
 }));
}
function wbSourceDOM({platform,action,url,offset=0,requestTranslation=false,authorPool=false}){
 const visible=e=>{const r=e?.getBoundingClientRect();return !!r&&r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';};
 // A navigation may report a new tab URL while its previous document is still
 // visible. Never interpret that old page as the requested source.
 if(url&&!/^\/i\/(jf|flow)\//.test(location.pathname)&&!/^\/login/.test(location.pathname)&&new URL(url).pathname.toLowerCase()!==location.pathname.toLowerCase())return {loading:true};
 const text=document.body?.innerText||'';
 if([...document.querySelectorAll('[id*="captcha"],[class*="captcha"],[data-e2e="verify-container"]')].some(visible)||/请完成.{0,10}(验证|校验)|拖动.{0,10}滑块|Verify you are human/.test(text)||(platform==='x'&&/^\/i\/(jf|flow)\//.test(location.pathname)&&/真人验证|人脸验证/.test(text)))return {error:'请本人在 Edge 完成平台验证，素材采集已暂停。'};
 if(platform==='x'&&/该页面不存在|此账号不存在|This account doesn.t exist|This page doesn.t exist/i.test(text))return {error:'X 显示这个主页或帖子不存在。请打开来源核对链接，或移除后添加有效来源。'};
 if(platform==='x'&&!document.querySelector('article[data-testid="tweet"]')&&/登录或注册 X|Sign in or create an account/.test(text))return {error:'请先在当前 Edge 登录 X，再检查素材更新；不需要重新登录小红书。'};
 if(/\/(login|i\/flow\/login|i\/flow\/signup|i\/jf\/onboarding)/.test(location.pathname)||[...document.querySelectorAll('[data-e2e="login-modal"]')].some(visible))return {error:'请先在 Edge 登录当前素材平台，完成后再检查更新。'};
 if(action==='scan'){
  const items=[];
  if(platform==='x'&&authorPool)for(const cell of document.querySelectorAll('[data-testid="UserCell"]')){
   if(!visible(cell))continue;
   const link=[...cell.querySelectorAll('a[href]')].find(a=>/^\/[a-zA-Z0-9_]{1,15}$/.test(new URL(a.href,location.href).pathname));
   if(!link)continue;const handle='@'+new URL(link.href,location.href).pathname.slice(1);
   const name=cell.querySelector('[data-testid="User-Name"]')?.innerText?.split('\n')[0]||cell.innerText.split('\n').map(s=>s.trim()).find(s=>s&&!s.startsWith('@')&&!/^(关注|Following|Follow|已关注)$/.test(s));
   const avatar=[...cell.querySelectorAll('img')].map(e=>e.currentSrc||e.src||'').find(src=>/^https:\/\/pbs\.twimg\.com\/profile_images\//.test(src));
   if(name&&avatar)items.push({url:new URL(link.href,location.href).href,author:name+'\n'+handle,avatar,kind:'author'});
  }
  if(platform==='x')for(const article of document.querySelectorAll('article[data-testid="tweet"]')){
   const link=[...article.querySelectorAll('a[href*="/status/"]')].find(a=>a.querySelector('time'))||article.querySelector('a[href*="/status/"]');
   if(!link||!visible(article))continue;const title=article.querySelector('[data-testid="tweetText"]')?.innerText||'';
   const postText=article.querySelector('[data-testid="tweetText"]');
   const promoted=!!article.querySelector('[data-testid="promotedIndicator"]')||[...article.querySelectorAll('span')].some(e=>!postText?.contains(e)&&/^(Promoted|Sponsored|广告|推广)$/i.test(e.innerText?.trim()||''));
   const images=[...article.querySelectorAll('img')];
   const photoFound=!!article.querySelector('[data-testid="tweetPhoto"]')||images.some(e=>/\/media\//.test(e.currentSrc||e.src||''))||!!article.querySelector('a[href*="/photo/"]');
   const hasPhotos=photoFound?true:images.some(e=>/\/profile_images\/|\/default_profile_images\//.test(e.currentSrc||e.src||''))?false:undefined;
   const photos=[...new Set(images.map(e=>e.currentSrc||e.src||'').filter(src=>/^https:\/\/pbs\.twimg\.com\/media\//.test(src)))].slice(0,4);
   const avatar=images.map(e=>e.currentSrc||e.src||'').find(src=>/^https:\/\/pbs\.twimg\.com\/(profile_images|default_profile_images)\//.test(src))||null;
   items.push({photos,avatar,url:new URL(link.href,location.href).href.split('?')[0],title,text:title,hasPhotos,promoted,author:article.querySelector('[data-testid="User-Name"]')?.innerText||'',publishedAt:article.querySelector('time')?.dateTime||null,metrics:{likes:article.querySelector('[data-testid="like"],[data-testid="unlike"]')?.getAttribute('aria-label')||null},kind:'post'});
  }else for(const link of document.querySelectorAll('a[href*="/video/"],a[href*="/note/"],a[href*="modal_id="]')){
   if(!visible(link))continue;let href=new URL(link.href,location.href);const modal=href.searchParams.get('modal_id');if(modal)href=new URL('https://www.douyin.com/video/'+modal);
   if(!/^\/(video|note)\/\d+/.test(href.pathname))continue;
   const root=link.closest('[data-e2e="search-result-item"],[data-e2e="search-result"],div[data-aweme-id],li,[data-e2e="user-post-list"] > div')||link;
   const title=root.querySelector('[data-e2e="video-desc"],[data-e2e="search-result-title"]')?.innerText||root.innerText||link.querySelector('img')?.alt||'';
   items.push({url:href.origin+href.pathname,title,text:title,kind:/\/note\//.test(href.pathname)?'image':'video'});
  }
  return {items,detailReady:platform==='douyin'&&!!document.querySelector('video,[data-e2e="detail-video"]'),empty:/暂无作品|No posts yet|没有找到相关内容/.test(text)};
 }
 let root;
 if(platform==='x')root=[...document.querySelectorAll('article[data-testid="tweet"]')].find(e=>{const links=[...e.querySelectorAll('a[href*="/status/"]')],main=links.find(a=>a.querySelector('time'));return (main?[main]:links).some(a=>new URL(a.href).pathname.toLowerCase()===new URL(url).pathname.toLowerCase());});
 else root=document.querySelector('[data-e2e="detail-video"]')||document.querySelector('video')?.parentElement||document.querySelector('[data-e2e="note-detail"],[data-e2e="detail-container"]');
 if(!root||!visible(root))return {error:'没有定位到完整帖子或视频画面，请在来源页打开素材后再截图；也可上传手动截图。'};
 if(platform==='x'&&[...root.querySelectorAll('button,[role="button"],a')].some(e=>visible(e)&&/^(Show more|展开|显示更多)$/i.test(e.innerText?.trim()||'')))return {error:'帖子正文尚未完整展开，请在浏览器展开后截图。'};
 if(platform==='x'){
  let r=root.getBoundingClientRect();
  const bounds=()=>({x:Math.floor(r.left+scrollX),y:Math.floor(r.top+scrollY),width:Math.ceil(r.right+scrollX)-Math.floor(r.left+scrollX),height:Math.ceil(r.bottom+scrollY)-Math.floor(r.top+scrollY)});
  if(r.width<80||r.height<40||r.left<0||r.right>innerWidth)return {error:'帖子左右边缘未完整显示，请把浏览器窗口加宽后截图。'};
  if(r.height>10000||r.width*r.height*devicePixelRatio**2>30000000||r.height*devicePixelRatio>19000)return {error:'这条帖子过长，请分段手动截图后导入。'};
  for(let p=root.parentElement;p&&p!==document.body&&p!==document.documentElement;p=p.parentElement){const st=getComputedStyle(p),b=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(st.overflowY)&&r.height>b.height)return {error:'帖子被内部滚动区域裁切，请手动截取长图后导入。'};}
  const images=[...root.querySelectorAll('img')].filter(visible);
  const avatar=root.querySelector('[data-testid^="UserAvatar-Container"] img')||images.find(e=>/\/profile_images\/|\/default_profile_images\//.test(e.currentSrc||e.src||''));
  const pendingAvatar=!avatar||!visible(avatar)||!avatar.complete||!avatar.naturalWidth;
  const pendingMedia=pendingAvatar||images.some(e=>!e.complete||!e.naturalWidth);
  const postText=root.querySelector('[data-testid="tweetText"]');
  const articleText=root.querySelector('[data-testid="twitterArticleReadView"]');
  const bodyText=(articleText||postText)?.innerText?.trim()||'';
  const letters=bodyText.match(/\p{L}/gu)||[],han=bodyText.match(/\p{Script=Han}/gu)||[];
  const chinese=han.length>=2&&han.length/Math.max(1,letters.length)>=.25&&!/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(bodyText);
  // Image-only posts need no translation. Do not mistake Chinese page chrome
  // or an unrelated reply for translated text in the requested post.
  const needsTranslation=letters.length>=6&&!chinese;
  const controls=[...root.querySelectorAll('button,[role="button"],a')].filter(visible);
  const translationButton=controls.find(e=>/^(显示翻译|翻译(帖子|推文|此帖)?|Show translation|Translate( post| Tweet| this post)?|用 Grok 翻译|Translate with Grok)$/i.test((e.innerText||e.getAttribute('aria-label')||'').trim()));
  if(action==='prepare'){
   let translationClicked=false;
   if(needsTranslation&&translationButton&&requestTranslation){translationButton.click();translationClicked=true;}
   const state={ready:!pendingMedia&&!needsTranslation,translationClicked,pendingAvatar,pendingMedia,needsTranslation,bodyText,media:images.map(e=>({src:e.currentSrc||e.src,width:e.naturalWidth})),message:pendingAvatar?'作者头像还没加载出来，已停止截图。请在来源页确认头像后重试。':pendingMedia?'素材图片尚未加载完整，请在浏览器查看后重试。':needsTranslation?'X 的中文翻译尚未显示，已停止截图。请在来源页点击翻译后重试。':''};
   return pendingMedia?state:Promise.all(images.map(e=>e.decode?e.decode().catch(()=>{}):Promise.resolve())).then(()=>state);
  }
  if(action==='position'){
   window.scrollTo({left:scrollX,top:Math.max(0,r.top+scrollY+offset-80),behavior:'instant'});
   r=root.getBoundingClientRect();return {ok:true,documentClip:bounds(),viewport:{width:innerWidth,height:innerHeight}};
  }
  // Test the portion currently in view; unseen sections are checked while
  // scrolling above. Do not hide headers, popups, or alter the source DOM.
  const top=Math.max(r.top+3,80),bottom=Math.min(r.bottom-3,innerHeight-4);
  if(bottom<=top)return {error:'帖子未在当前画面中显示，请重新打开素材后截图。'};
  for(const y of [top,(top+bottom)/2,bottom])for(const x of [r.left+3,r.left+r.width/2,r.right-3]){
   const front=document.elementFromPoint(x,y);if(!front||!root.contains(front))return {error:'素材画面被弹窗或其他内容遮挡，请在浏览器处理后重试。'};
  }
  if(action==='probe')return {documentClip:bounds(),viewport:{width:innerWidth,height:innerHeight},pendingMedia};
  if(pendingAvatar)return {error:'作者头像还没加载出来，已停止截图。请在来源页确认头像后重试。'};
  if(pendingMedia)return {error:'素材图片尚未加载完整，请在浏览器查看后重试。'};
  if(needsTranslation)return {error:'X 的中文翻译尚未显示，已停止截图。请在来源页点击翻译后重试。'};
  if([...root.querySelectorAll('video')].some(e=>!e.paused))return {error:'请在 X 暂停视频到想要的画面，再返回截图。'};
  const hasPhotos=!!root.querySelector('[data-testid="tweetPhoto"]')||images.some(e=>/\/media\//.test(e.currentSrc||e.src||''));
  const promoted=!!root.querySelector('[data-testid="promotedIndicator"]')||[...root.querySelectorAll('span')].some(e=>!postText?.contains(e)&&/^(Promoted|Sponsored|广告|推广)$/i.test(e.innerText?.trim()||''));
  return {url:location.href,documentClip:bounds(),viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},bodyText,hasPhotos,promoted,visibleText:root.innerText||'',media:[...root.querySelectorAll('img')].filter(visible).map(e=>({src:e.currentSrc||e.src,width:e.naturalWidth,height:e.naturalHeight})),kind:'post'};
 }
 if([...root.querySelectorAll('img[src*="/media/"],[data-e2e="note-detail"] img')].some(e=>visible(e)&&(!e.complete||!e.naturalWidth)))return {error:'素材图片尚未加载完整，请在浏览器查看后重试。'};
 if(action==='reveal'){root.scrollIntoView({block:'center',behavior:'instant'});return {ok:true};}
 const r=root.getBoundingClientRect();
 if(r.width<80||r.height<40||r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight)return {error:'这条素材无法完整放入一屏。请本人截取长图后上传，系统不会裁掉正文。'};
 for(const [x,y] of [[r.left+3,r.top+3],[r.right-3,r.bottom-3],[r.left+r.width/2,r.top+r.height/2]]){const top=document.elementFromPoint(x,y);if(!top||!root.contains(top))return {error:'素材画面被弹窗或其他内容遮挡，请在浏览器处理后重试。'};}
 if(platform==='douyin'){const video=root.querySelector('video')||(root.matches('video')?root:null);if(video&&!video.paused)return {error:'请在抖音暂停到想要的画面，再返回截图。'};if(video&&!video.videoWidth)return {error:'视频画面尚未加载，请在抖音打开后再截图。'};}
 return {url:location.href,clip:{x:Math.floor(r.left),y:Math.floor(r.top),width:Math.ceil(r.width),height:Math.ceil(r.height)},viewport:{width:innerWidth,height:innerHeight},visibleText:root.innerText||'',kind:platform==='douyin'?'frame':'post'};
}

async function wbPostOwnComment(params){
 if(!allowedHost(params.url)||!/^\/explore\/[a-zA-Z0-9]+$/.test(new URL(params.url).pathname)||new URL(params.url).pathname.split('/').at(-1)!==params.feedId)throw Error('评论笔记地址无效。');
 if(typeof params.text!=='string'||!params.text.trim()||[...params.text].length>200)throw Error('评论文字无效。');
 const tab=await chrome.tabs.create({url:params.url,active:false});
 let keep=false;
 try{
 await waitForTabComplete(tab.id,params.url,22000);
 const inspect=async action=>{
 const pageState=(await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:wbPageState}))?.[0]?.result;
 const selfLink=(await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:wbSelfLinkDOM}))?.[0]?.result;
 return (await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:wbOwnCommentDOM,args:[{...params,action,pageState,selfLink}]}))?.[0]?.result;
 };
 let state=await inspect('check');if(state?.status==='already_present')return state;if(state?.error)return {sendClicked:false,status:'blocked',message:state.error};
 state=await inspect('fill');if(state?.error)return {sendClicked:false,status:'blocked',message:state.error};
 state=await inspect('send');if(state?.sendClicked!==true)return {...state,sendClicked:false,status:'blocked'};
 for(let i=0;i<20;i++){await sleep(350);const result=await inspect('verify');if(result?.status==='already_present')return {...result,status:'verified',sendClicked:true};if(result?.error)break;}
 keep=true;return {sendClicked:true,status:'uncertain',url:(await chrome.tabs.get(tab.id)).url,message:'发送已点击，页面未明确显示本人评论，请人工核查。'};
 }catch(e){keep=true;throw e;}finally{if(!keep)await chrome.tabs.remove(tab.id).catch(()=>{});}
}
async function wbOwnRecentNotes({userId,redId}){
 if(!/^[a-zA-Z0-9]+$/.test(userId))throw Error('账号标识无效。');
 const url='https://www.xiaohongshu.com/user/profile/'+userId,tab=await chrome.tabs.create({url,active:false});
 try{await waitForTabComplete(tab.id,url,20000);const selfLink=(await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:wbSelfLinkDOM}))?.[0]?.result;const r=(await chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:wbOwnRecentDOM,args:[{userId,redId,selfLink}]}))?.[0]?.result;if(r?.error)throw Error(r.error);return r;}
 finally{await chrome.tabs.remove(tab.id).catch(()=>{});}
}
function wbOwnRecentDOM({userId,redId,selfLink}){
 const own=selfLink;if(!own||new URL(own,location.href).pathname!=='/user/profile/'+userId||location.pathname!=='/user/profile/'+userId)return {error:'本人主页尚未确认。'};
 const actualRedId=(document.querySelector('.user-redId,.user-redid')?.textContent||'').match(/小红书号[：:]?\s*([a-zA-Z0-9_-]+)/)?.[1];
 if(!actualRedId||actualRedId!==redId)return {error:'当前账号已变化。'};
 const feeds=[];for(const card of document.querySelectorAll('.note-item')){const link=[...card.querySelectorAll('a[href*="/explore/"]')].find(a=>new URL(a.href,location.href).searchParams.get('xsec_token'));if(!link)continue;const u=new URL(link.href,location.href),id=u.pathname.split('/').at(-1);feeds.push({id,xsecToken:u.searchParams.get('xsec_token'),title:card.querySelector('.title,.footer .title')?.innerText||''});}
 return {userId,basicInfo:{redId:actualRedId},feeds:feeds.slice(0,30)};
}
function wbOwnCommentDOM({feedId,userId,title,body,text,action,pageState,selfLink}){
 const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
 const state=pageState||{};if(state.status!=='ready')return {error:state.message||'页面未就绪。'};
 if(location.pathname!=='/explore/'+feedId)return {error:'评论页面已切换。'};
 const own=selfLink;if(!own||new URL(own,location.href).pathname!=='/user/profile/'+userId)return {error:'当前登录账号未核实，评论未发送。'};
 const note=document.querySelector('.note-detail-mask,.note-container');
 const author=note?.querySelector('.author a[href*="/user/profile/"],.author-wrapper a[href*="/user/profile/"]');
 if(!author||new URL(author.href).pathname!=='/user/profile/'+userId)return {error:'这不是当前账号的笔记，评论未发送。'};
 const normalize=s=>String(s||'').normalize('NFKC').replace(/\s/g,'');
 const actualTitle=note.querySelector('#detail-title,.title')?.innerText||'',actualBody=note.querySelector('#detail-desc,.desc')?.innerText||'';
 if(normalize(actualTitle)!==normalize(title)||!normalize(actualBody).includes(normalize(body)))return {error:'笔记标题或正文与本次发布不一致，评论未发送。'};
 const comment=[...note.querySelectorAll('.comments-container .comment-item')].find(c=>{const author=c.querySelector('.author a,.author-wrapper a,a.name');return author&&new URL(author.href).pathname==='/user/profile/'+userId&&normalize(c.querySelector('.content .note-text,.content')?.innerText)===normalize(text);});
 if(comment)return {status:'already_present',url:location.href,visibleText:comment.querySelector('.content')?.innerText,commentId:comment.closest('[id^="comment-"]')?.id||null};
 if(action==='verify')return {status:'waiting'};
 if(action==='check')return {status:'ready'};
 const input=note.querySelector('#content-textarea,[contenteditable="true"],textarea');
 if(!input||!visible(input))return {error:'没有找到可用评论输入框。'};
 if(action==='fill'){input.focus();if(input.isContentEditable)input.textContent=text;else {const setter=Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')?.set;setter?.call(input,text);}input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));input.dispatchEvent(new Event('change',{bubbles:true}));return {status:'filled'};}
 if(normalize(input.isContentEditable?input.innerText:input.value)!==normalize(text))return {sendClicked:false,message:'评论输入内容尚未保留。'};
 const button=[...note.querySelectorAll('button')].find(b=>visible(b)&&/^发送$/.test(b.innerText.trim())&&!b.disabled);
 if(!button)return {sendClicked:false,message:'发送按钮不可用。'};button.click();return {sendClicked:true};
}
