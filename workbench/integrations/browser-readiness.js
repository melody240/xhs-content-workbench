/* Task readiness depends on visible controls, never tabs.status or network idle. */
// Only these newly created inspection tabs belong to the workbench. A retained
// login/verification tab is reused on retry; never close a user or publish tab.
const wbInspectionTabs=new Map();
async function wbInspectionTab(slot,url){
  const id=wbInspectionTabs.get(slot);let tab;
  if(id)try{tab=await chrome.tabs.get(id);}catch{}
  const currentURL=tab?.pendingUrl||tab?.url;
  if(tab&&allowedHost(currentURL)&&new URL(currentURL).hostname===new URL(url).hostname){
    if(currentURL!==url)tab=await chrome.tabs.update(id,{url});
    return tab;
  }
  tab=await chrome.tabs.create({url,active:false});wbInspectionTabs.set(slot,tab.id);return tab;
}
async function wbCloseInspection(slot,id){
  if(wbInspectionTabs.get(slot)!==id)return;
  wbInspectionTabs.delete(slot);await chrome.tabs.remove(id).catch(()=>{});
}
function wbPageState() {
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const has = selector => [...document.querySelectorAll(selector)].some(visible);
  const text = document.body?.innerText || '';
  const path = location.pathname;
  const base = {url:location.href, title:document.title, readyState:document.readyState};
  if (has('.captcha-container,.verify-container,[class*="verify-dialog"],[class*="verify-modal"]') || /请完成.{0,8}(验证|校验)|拖动.{0,8}(滑块|拼图)|安全验证/.test(text)) return {...base,status:'verification_required',message:'请本人在 Edge 完成安全验证。'};
  if (/\/404(?:[/?]|$)/.test(path) || has('.access-wrapper,.not-found-wrapper')) return {...base,status:'unavailable',message:'平台页面不可访问，请在 Edge 核查提示。'};
  if (/\/login(?:\/|$)/.test(path) || has('.login-container,.login-modal')) return {...base,status:'login_required',message:'请在 Edge 完成当前网站登录，登录状态不会从 MCP 浏览器复制过来。'};
  if (location.hostname === 'creator.xiaohongshu.com') {
    if (/\/publish\//.test(path)) return {...base,status:has('.upload-content,.creator-tab,input[placeholder*="标题"],.tiptap,.ql-editor') || document.querySelector('input[type="file"]') ? 'ready' : 'loading',surface:'creator_publish'};
    const redId=text.match(/小红书账号[：:]?\s*([a-zA-Z0-9_-]+)/)?.[1] || '';
    return {...base,status:redId || has('[class*="note-manager"],[class*="note-list"]') ? 'ready' : 'loading',surface:'creator',redId};
  }
  const ownLinks=[...document.querySelectorAll('a[href*="/user/profile/"]')].filter(e=>visible(e)&&(e.innerText||e.textContent||'').trim()==='我');
  const self=document.querySelector('.main-container .user a[href*="/user/profile/"],.side-bar .user a[href*="/user/profile/"]')?.getAttribute('href') || (ownLinks.length===1?ownLinks[0].getAttribute('href'):'');
  if (/\/user\/profile\//.test(path)) return {...base,status:has('.user-name,.user-redId,.user-redid,.user-info') ? 'ready':'loading',surface:'profile',self};
  if (/\/explore\/.+/.test(path)) return {...base,status:has('.note-detail-mask,.note-container,.note-scroller') ? 'ready':'loading',surface:'note',self};
  if (/\/search_result/.test(path)) return {...base,status:has('.feeds-container,.search-input,.search-container,.no-result') ? 'ready':'loading',surface:'search',self};
  return {...base,status:self || has('.feeds-container,.note-item,.login-btn') ? 'ready':'loading',surface:'explore',self};
}

function wbSelfLinkDOM() {
  const legacy=document.querySelector('.main-container .user a[href*="/user/profile/"],.side-bar .user a[href*="/user/profile/"]')?.getAttribute('href');
  if(legacy)return legacy;
  const own=[...document.querySelectorAll('a[href*="/user/profile/"]')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&(e.innerText||e.textContent||'').trim()==='我');
  return own.length===1?own[0].getAttribute('href'):'';
}

function wbPageError(message,pageStatus) {
  const codes={login_required:'BROWSER_LOGIN_REQUIRED',verification_required:'BROWSER_VERIFICATION_REQUIRED',identity_unverified:'BROWSER_IDENTITY_UNVERIFIED',unavailable:'BROWSER_PAGE_UNAVAILABLE',loading:'BROWSER_PAGE_NOT_READY',read_failed:'BROWSER_PAGE_READ_FAILED'};
  return Object.assign(new Error(message),{pageStatus,code:codes[pageStatus]||codes.unavailable});
}
async function wbBoundRead(promise,timeout) {
  let timer;
  try {return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(wbPageError('页面读取暂未返回','read_failed')),Math.max(1,timeout));})]);}
  finally {clearTimeout(timer);}
}
async function waitForTabComplete(tabId, expectedUrl, timeout=30000) {
  const deadline=Date.now()+Math.min(Math.max(timeout,1000),35000);
  let state;
  do {
    const tab=await wbBoundRead(chrome.tabs.get(tabId),Math.min(1500,Math.max(1,deadline-Date.now())));
    if(!tab)throw wbPageError('工作标签页不存在，请返回工作台核查。','unavailable');
    if(!allowedHost(tab.url)) {
      // A newly created tab can report about:blank / pendingUrl briefly.
      if(!tab.url || tab.url==='about:blank' || allowedHost(tab.pendingUrl)){await sleep(250);continue;}
      throw wbPageError('小红书页面未打开或连接失败，请检查 Edge 中的实际页面。','unavailable');
    }
    try {state=(await wbBoundRead(chrome.scripting.executeScript({injectImmediately:true,target:{tabId},func:wbPageState}),Math.min(1500,deadline-Date.now())))?.[0]?.result;} catch {state=null;}
    if(state && ['verification_required','unavailable','login_required'].includes(state.status))throw wbPageError(state.message,state.status);
    const samePage=!expectedUrl || (new URL(state?.url||tab.url).hostname===new URL(expectedUrl).hostname && new URL(state?.url||tab.url).pathname.replace(/\/$/,'')===new URL(expectedUrl).pathname.replace(/\/$/,''));
    if(state?.status==='ready' && samePage)return state;
    await sleep(250);
  }while(Date.now()<deadline);
  throw wbPageError(`页面控件未就绪：${state?.surface||'小红书页面'}。请查看 Edge 页面；不会退出登录或重新扫码。`,'loading');
}
async function cmdWaitForLoad({timeout=30000}={}) {const tab=await getOrOpenXhsTab();await waitForTabComplete(tab.id,null,timeout);return null;}

async function wbCreatorCheck({redId,mode='image',identityOnly=false}={}) {
  // Inspect a separate real Edge tab. Do not navigate away from an existing form.
  const t=await wbInspectionTab('creator-check','https://creator.xiaohongshu.com/new/home');
  let handoff=false;
  const unavailable=async e=>{const status=['verification_required','login_required'].includes(e.pageStatus)?e.pageStatus:'unavailable';if(status!=='unavailable'){handoff=true;await chrome.tabs.update(t.id,{active:true}).catch(()=>{});}return {status,errorCode:e.code||'BROWSER_PAGE_UNAVAILABLE',message:e.message,url:(await wbBoundRead(chrome.tabs.get(t.id),1500).catch(()=>null))?.url};};
  try {
    let identity;
    try {identity=await waitForTabComplete(t.id,'https://creator.xiaohongshu.com/new/home',25000);}catch(e){return unavailable(e);}
    if(!redId || !identity.redId)return {status:'identity_unverified',message:'创作后台或工作台空间的账号标识未读取完整，本次停止；尚不能判断账号不一致。',redId:identity.redId,url:identity.url};
    if(identity.redId!==String(redId))return {status:'identity_mismatch',message:'Edge 创作后台账号与当前工作台空间不一致，本次停止。',redId:identity.redId,url:identity.url};
    if(identityOnly)return {...identity,status:'ready',mode,message:'Edge 创作后台身份已核实。'};
    await chrome.tabs.update(t.id,{url:'https://creator.xiaohongshu.com/publish/publish?source=official'});
    let state;
    try {state=await waitForTabComplete(t.id,'https://creator.xiaohongshu.com/publish/publish?source=official',25000);}catch(e){return unavailable(e);}
    let count;
    try{count=(await wbBoundRead(chrome.scripting.executeScript({injectImmediately:true,target:{tabId:t.id},func:()=>document.querySelectorAll('input[type="file"]').length}),3000))?.[0]?.result;}catch(e){return unavailable(e);}
    return {...state,status:count?'ready':'unavailable',redId:identity.redId,mode,message:count?'Edge 创作后台身份和上传控件已核实；实际填写时还会检查。':'发布页上传控件未出现，本次未上传或提交。'};
  }finally {if(!handoff)await wbCloseInspection('creator-check',t.id);}
}
