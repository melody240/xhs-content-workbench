/* Adapted from autoclaw-cc/xiaohongshu-skills, MIT. See bundled LICENSE. */
importScripts('config.js');
importScripts('browser-readiness.js');
let ws, workTabId;
const allowedHost=u=>{try{return ['www.xiaohongshu.com','xiaohongshu.com','creator.xiaohongshu.com'].includes(new URL(u).hostname)&&new URL(u).protocol==='https:';}catch{return false;}};
async function getOrOpenXhsTab(){
  if(workTabId){const t=await chrome.tabs.get(workTabId).catch(()=>null);if(t&&allowedHost(t.pendingUrl||t.url))return t;}
  const tabs=await chrome.tabs.query({});
  const existing=tabs.find(t=>allowedHost(t.url)&&/^\/(explore|search_result)\/?$/.test(new URL(t.url).pathname));
  const t=existing || await chrome.tabs.create({url:'https://www.xiaohongshu.com/explore',active:true});workTabId=t.id;
  await waitForTabComplete(t.id,null,30000);return t;
}
async function cmdNavigate({url}){
  if(!allowedHost(url))throw new Error('仅支持小红书页面。');
  // Start at the requested site; publishing must not visit the public login first.
  let tab=workTabId?await chrome.tabs.get(workTabId).catch(()=>null):null;
  // An unknown creator tab may contain a user's unsaved draft. Only reuse an
  // exact public-page match here; an owned publishing tab uses workTabId above.
  if((!tab||!allowedHost(tab.pendingUrl||tab.url))&&new URL(url).hostname!=='creator.xiaohongshu.com'){
    const tabs=await chrome.tabs.query?.({})||[];
    tab=tabs.find(t=>t.url===url);if(tab)workTabId=tab.id;
  }
  if(!tab||!allowedHost(tab.pendingUrl||tab.url)){tab=await chrome.tabs.create({url,active:true});workTabId=tab.id;}
  else await chrome.tabs.update(tab.id,{url,active:true});
  await waitForTabComplete(tab.id,url,60000);
  const final=await chrome.tabs.get(tab.id);
  if(/\/404(?:[/?]|$)/.test(new URL(final.url).pathname))throw new Error('平台页面不可访问，请在浏览器核查。');
}
async function identity(){
  // A separate tab avoids destroying the publish form during identity checks.
  const t=await wbInspectionTab('identity','https://www.xiaohongshu.com/explore');
  let handoff=false;
  try{
    await waitForTabComplete(t.id,null,30000);
    let self;
    const selfDeadline=Date.now()+10000;
    for(let i=0;i<40&&Date.now()<selfDeadline;i++){
      const r=await wbBoundRead(chrome.scripting.executeScript({injectImmediately:true,target:{tabId:t.id},func:wbSelfLinkDOM}),Math.min(3000,Math.max(1,selfDeadline-Date.now())));
      self=r?.[0]?.result;if(self)break;await sleep(250);
    }
    const userId=String(self||'').match(/\/user\/profile\/([a-zA-Z0-9]+)/)?.[1];
    if(!userId)throw wbPageError('尚未读取到浏览器账号标识，请在 Edge 核查页面；这不能证明账号退出。','identity_unverified');
    const url=new URL(self,'https://www.xiaohongshu.com').href;
    if(!allowedHost(url))throw new Error('账号主页地址异常。');
    await chrome.tabs.update(t.id,{url});await waitForTabComplete(t.id,url,30000);
    let profile={};
    const profileDeadline=Date.now()+7500;
    for(let i=0;i<30&&Date.now()<profileDeadline;i++){
      const r=await wbBoundRead(chrome.scripting.executeScript({injectImmediately:true,target:{tabId:t.id},func:()=>({nickname:document.querySelector('.user-name')?.textContent?.trim()||'',redId:(document.querySelector('.user-redId,.user-redid')?.textContent||document.body.innerText).match(/小红书号[：:]?\s*([a-zA-Z0-9_-]+)/)?.[1]||''})}),Math.min(3000,Math.max(1,profileDeadline-Date.now())));
      profile=r?.[0]?.result||{};if(profile.nickname||profile.redId)break;await sleep(250);
    }
    return {userId,...profile};
  }catch(e){
    if(['login_required','verification_required'].includes(e.pageStatus)){handoff=true;await chrome.tabs.update(t.id,{active:true}).catch(()=>{});}
    throw e;
  }finally{if(!handoff)await wbCloseInspection('identity',t.id);}
}
async function handleCommand({method,params={}}){
  // Feed pages keep changing and background timers can be throttled. Each
  // extractor waits for its own data; do not wait for the whole DOM to go idle.
  if(method==='wait_dom_stable')return cmdWaitForLoad(params);
  if(method==='wb_smart_titles')return wbSmartTitles(params);
  if(method==='wb_form_state')return wbFormState();
  if(method==='wb_publish_assets')return wbCheckPublishAssets(params);
  if(method==='wb_save_draft')return wbSaveDraft();
  if(method==='wb_submit_publish')return wbSubmitPublish(params);
  if(method==='wb_creator_metrics')return wbCreatorMetrics(params);
  if(method==='wb_creator_check')return wbCreatorCheck(params);
  if(method==='wb_read_xhs_comments')return wbReadXhsComments(params);
  if(method==='wb_capture_comment')return wbCaptureComment(params);
  if(method==='wb_douyin_search')return wbDouyinSearch(params);
  if(method==='wb_douyin_comments')return wbDouyinReadComments(params);
  if(method==='wb_douyin_capture_comment')return wbDouyinCaptureComment(params);
  if(method==='wb_douyin_close')return wbDouyinClose();
  if(method==='wb_source_status')return wbSourceStatus();
  if(method==='wb_source_scan')return wbSourceScan(params);
  if(method==='wb_source_open'){const tab=await wbSourceTab(params.url,{openOnly:true});return {url:tab.url};}
  if(method==='wb_capture_material')return wbMaterialCapture(params);
  if(method==='wb_post_own_comment')return wbPostOwnComment(params);
  if(method==='wb_own_recent_notes')return wbOwnRecentNotes(params);
  if(method==='wb_identity')return identity();
  if(method==='wb_open_login'){await cmdNavigate({url:'https://www.xiaohongshu.com/explore'});return {message:'请在浏览器完成登录，再返回工作台核实账号。'};}
  if(method==='navigate')return cmdNavigate(params);
  if(method==='wait_for_load')return cmdWaitForLoad(params);
  if(method==='set_file_input')return cmdSetFileInputViaDebugger(params);
  if(['click_element','click_nth_element','click_element_by_text'].includes(method))return cmdClickViaDebugger(method,params);
  if(method==='press_key')return cmdPressKeyViaDebugger(params);
  if(method==='type_text')return cmdTypeTextViaDebugger(params);
  if(['evaluate','wait_dom_stable','wait_for_selector','has_element','get_elements_count','get_element_text','get_element_attribute','get_scroll_top','get_viewport_height','get_url','get_elements_info','get_iframe_text'].includes(method))return cmdEvaluateInMainWorld(method,params);
  if(['input_text','input_content_editable','scroll_by','scroll_to','scroll_to_bottom','scroll_element_into_view','scroll_nth_element_into_view','dispatch_wheel_event','mouse_move','mouse_click','remove_element','hover_element','select_all_text'].includes(method))return cmdDomInMainWorld(method,params);
  throw new Error('工作台未开放此命令。');
}
function connect(){
  if(ws&&[WebSocket.OPEN,WebSocket.CONNECTING].includes(ws.readyState))return;
  const socket=ws=new WebSocket(WB_CONFIG.url);
  socket.onopen=()=>socket.send(JSON.stringify({role:'extension',token:WB_CONFIG.token,capabilities:['creator-smart-titles-v1','creator-metrics-v1','comment-capture-v1','task-readiness-v1','form-state-v1','source-library-v1','douyin-comments-v1','own-comments-v2']}));
  let queue=Promise.resolve();
  socket.onmessage=event=>{queue=queue.then(async()=>{
    let msg;try{msg=JSON.parse(event.data);}catch{return;}
    if(!msg.id)return;
    try{const result=await handleCommand(msg);if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({id:msg.id,result:result??null}));}
    catch(e){if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({id:msg.id,error:String(e.message||e),errorCode:e.code}));}
  });};
  socket.onclose=()=>setTimeout(connect,5000);
  socket.onerror=()=>{};
}
chrome.alarms.create('skills-keepalive',{periodInMinutes:0.5});
chrome.alarms.onAlarm.addListener(()=>connect());
connect();
