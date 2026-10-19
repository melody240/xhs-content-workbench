// Visible DOM + normal pointer input only. No private API or response interception.
async function wbFormState() {
  if(!workTabId)return {status:'unknown'};
  const tab=await wbBoundRead(chrome.tabs.get(workTabId),1500).catch(e=>/No tab with id/i.test(e.message)?null:{readError:true});
  if(tab?.readError)return {status:'unknown'};
  if(!tab)return {status:'ended',reason:'tab_closed'};
  if(!allowedHost(tab.url))return {status:'ended',reason:'left_platform'};
  if(new URL(tab.url).hostname!=='creator.xiaohongshu.com'||!/\/publish\//.test(new URL(tab.url).pathname))return {status:'ended',reason:'left_form'};
  try{return (await wbBoundRead(chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:()=>{
    const text=document.body?.innerText||'';
    const editing=[...document.querySelectorAll('input[placeholder*="标题"],[contenteditable="true"]')].some(e=>e.getClientRects().length);
    if(!editing&&/(^|\n)(发布成功|提交成功|笔记已发布)([！!。 ]|\n|$)/.test(text))return {status:'ended',reason:'submission_acknowledged'};
    const uploader=[...document.querySelectorAll('.upload-content')].some(e=>e.getClientRects().length);
    if(!editing&&uploader&&document.querySelectorAll('input[type="file"]').length&&/点击上传|拖拽.{0,20}上传/.test(text))return {status:'ended',reason:'form_reset'};
    return {status:'open'};
  }}),2000))?.[0]?.result||{status:'unknown'};}catch{return {status:'unknown'};}
}
async function wbFindPublishTab({useWorkTab=false}={}) {
  const tabs=await wbBoundRead(chrome.tabs.query({url:'https://creator.xiaohongshu.com/publish/*'}),3000);
  // A remembered tab is a target only for a workbench-owned form operation.
  // Read-only inspection must not silently report an old form among many tabs.
  if(useWorkTab){
    const tab=tabs.find(t=>t.id===workTabId);
    if(!tab)throw new Error('本轮发布标签页已关闭或已离开发布表单，请在 Edge 核查；不会另开表单。');
    return tab;
  }
  if(tabs.length!==1)throw new Error(tabs.length?'存在多个发布标签页，无法确定你要核查的表单。请只保留需要核查的发布页。':'没有当前发布表单，请在 Edge 打开需要核查的草稿。');
  return tabs[0];
}
async function wbCheckPublishAssets({imageCount,waitMs=30000,useWorkTab=false}) {
  let tab;
  try{tab=await wbFindPublishTab({useWorkTab});}catch(e){return {status:'blocked',message:e.message};}
  const until=Date.now()+Math.min(Math.max(waitMs,0),30000);
  let result,useDebugger=false;
  do {
    try {
      if(useDebugger)result=await wbReadAssetsViaDebugger(tab.id,imageCount);
      else result=(await wbBoundRead(chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:wbPublishAssetsDOM,args:[imageCount]}),1500))?.[0]?.result;
    }catch {
      useDebugger=true;
      result=await wbReadAssetsViaDebugger(tab.id,imageCount);
    }
    if(result?.status==='unverified')break;
    if(result?.status==='ready'||result?.status==='blocked')return {...result,tabId:tab.id};
    if(Date.now()>=until)break;
    await sleep(500);
  }while(true);
  if(result?.status==='unverified')return {...result,tabId:tab.id};
  return {...result,tabId:tab.id,status:'not_ready',message:result?.temporaryCount?'图片本机预览可用，平台上传结果尚未核实；未保存或提交。':'图片数量或加载状态尚未通过核查。请在当前 Edge 检查图片，未保存或提交。'};
}
async function wbReadAssetsViaDebugger(tabId,expected) {
  const target={tabId};let attached=false;
  const send=(method,params={})=>wbBoundRead(chrome.debugger.sendCommand(target,method,params),2000);
  try {
    await wbBoundRead(chrome.debugger.attach(target,'1.3'),3000);attached=true;
    const ax=await send('Accessibility.getFullAXTree');
    if(ax.nodes?.some(n=>!n.ignored&&n.role?.value==='StaticText'&&/安全验证|请完成.{0,8}验证/.test(n.name?.value||'')))return {status:'blocked',message:'当前页面需要本人完成验证。'};
    const {root}=await send('DOM.getDocument',{depth:1});
    const items=await send('DOM.querySelectorAll',{nodeId:root.nodeId,selector:'.img-preview-area .pr'});
    const images=await send('DOM.querySelectorAll',{nodeId:root.nodeId,selector:'.img-preview-area .pr img.preview'});
    let loaded=0,persistent=0,temporary=0;
    for(const nodeId of images.nodeIds){
      const {object}=await send('DOM.resolveNode',{nodeId});
      try {
        // Inspect only this rendered image, never page stores or credentials.
        const r=await send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(){const src=this.currentSrc||this.src||"";return {complete:this.complete,naturalWidth:this.naturalWidth,persistent:src.startsWith("https://"),temporary:src.startsWith("blob:")}}',returnByValue:true});
        if(r.result?.value?.complete&&r.result.value.naturalWidth>0){loaded++;if(r.result.value.persistent)persistent++;if(r.result.value.temporary)temporary++;}
      }finally{if(object.objectId)await send('Runtime.releaseObject',{objectId:object.objectId}).catch(()=>{});}
    }
    return {status:expected>0&&items.nodeIds.length===expected&&images.nodeIds.length===expected&&persistent===expected?'ready':'waiting',imageCount:items.nodeIds.length,loadedCount:loaded,persistentCount:persistent,temporaryCount:temporary};
  }catch{return {status:'unverified',message:'当前图片读取未完成，请在 Edge 手动核查；未保存或提交。'};}
  finally{if(attached)await chrome.debugger.detach(target).catch(()=>{});}
}
function wbPublishAssetsDOM(expected) {
  if(location.hostname!=='creator.xiaohongshu.com'||!/\/publish\//.test(location.pathname)||/安全验证|请完成.{0,8}验证/.test(document.body?.innerText||''))return {status:'blocked',message:'当前发布表单需要人工核查。'};
  const items=[...document.querySelectorAll('.img-preview-area .pr')];
  const images=items.map(e=>e.querySelector('img.preview')||e.querySelector('img'));
  const loaded=images.filter(i=>i?.complete&&i.naturalWidth>0);
  const persistent=loaded.filter(i=>/^https:\/\//.test(i.currentSrc||i.src||'')).length;
  const temporary=loaded.filter(i=>/^blob:/.test(i.currentSrc||i.src||'')).length;
  return {status:items.length===expected&&expected>0&&persistent===expected?'ready':'waiting',imageCount:items.length,loadedCount:loaded.length,persistentCount:persistent,temporaryCount:temporary};
}
async function wbSaveDraft() {
  let target,attached=false,clicked=false;
  try {
    const tab=await wbFindPublishTab({useWorkTab:true});target={tabId:tab.id};
    const inspect=async()=> (await wbBoundRead(chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:wbDraftButtonDOM}),3000))?.[0]?.result;
    await chrome.tabs.update(tab.id,{active:true});
    let state=await inspect();if(state?.error)return {savedClicked:false,message:state.error};
    await chrome.debugger.attach(target,'1.3');attached=true;
    state=await inspect();if(state?.error)return {savedClicked:false,message:state.error};
    const {x,y}=await wbResolveControl(target,state);
    await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
    clicked=true;
    await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
    await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
    return {savedClicked:true,status:'needs_verification',message:'已点击暂存，请重新打开平台草稿箱核查。'};
  }catch(e){return {savedClicked:clicked,status:'uncertain',message:String(e.message||e)};}
  finally {if(attached)await chrome.debugger.detach(target).catch(()=>{});}
}
function wbDraftButtonDOM() {
  if(location.hostname!=='creator.xiaohongshu.com'||!/\/publish\//.test(location.pathname))return {error:'当前不是创作后台发布表单。'};
  const images=[...document.querySelectorAll('.img-preview-area .pr')].map(e=>e.querySelector('img.preview')||e.querySelector('img'));
  if(!images.length||images.some(i=>!i?.complete||i.naturalWidth<=0||!/^https:\/\//.test(i.currentSrc||i.src||'')))return {error:'平台图片未完成加载或上传，未点击暂存。请在 Edge 核查图片。'};
  const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  const buttons=[...document.querySelectorAll('button,xhs-publish-btn')].filter(visible).filter(e=>e.tagName==='XHS-PUBLISH-BTN'?e.getAttribute('is-save-draft')==='true'&&e.getAttribute('save-text')==='暂存离开':e.innerText?.trim()==='暂存离开');
  if(buttons.length!==1)return {error:'没有唯一可用的暂存按钮，请在 Edge 核查。'};
  const e=buttons[0];if(e.disabled||e.hasAttribute('disabled')||e.getAttribute('aria-disabled')==='true'||e.getAttribute('save-disabled')==='true')return {error:'暂存按钮不可用。'};
  e.scrollIntoView({block:'center',behavior:'instant'});
  const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,top=document.elementFromPoint(x,y);
  if(!top||(top!==e&&!e.contains(top)))return {error:'暂存按钮被遮挡，请在 Edge 核查。'};
  return e.tagName==='XHS-PUBLISH-BTN'?{control:{name:'暂存离开',host:{x:r.x,y:r.y,width:r.width,height:r.height}}}:{button:{x,y}};
}
// The platform exposes two native buttons inside one closed shadow component.
// Read their real accessibility names and bounds; never click the host midpoint.
async function wbResolveControl(target,state) {
  if(state?.button)return state.button;
  if(!state?.control)throw new Error('操作按钮无法核实。');
  const {name}=state.control;
  const tree=await wbBoundRead(chrome.debugger.sendCommand(target,'Accessibility.getFullAXTree'),3000);
  const buttons=(tree?.nodes||[]).filter(n=>!n.ignored&&n.role?.value==='button'&&n.name?.value===name);
  if(buttons.length!==1||!buttons[0].backendDOMNodeId)throw new Error('没有唯一可用的'+name+'按钮。');
  if(buttons[0].properties?.some(p=>p.name==='disabled'&&p.value?.value===true))throw new Error(name+'按钮不可用。');
  const box=await wbBoundRead(chrome.debugger.sendCommand(target,'DOM.getContentQuads',{backendNodeId:buttons[0].backendDOMNodeId}),3000);
  const q=box?.quads?.length===1?box.quads[0]:null;
  if(!Array.isArray(q)||q.length!==8||q.some(v=>!Number.isFinite(v)))throw new Error('按钮位置无法核实。');
  const xs=q.filter((_,i)=>i%2===0),ys=q.filter((_,i)=>i%2===1),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
  if(right<=left||bottom<=top)throw new Error('按钮位置无法核实。');
  // Custom-element children may extend beyond the inline host box. Ownership
  // is verified by the actual hit target below, using viewport coordinates.
  const point={x:(left+right)/2,y:(top+bottom)/2};
  const hit=(await wbBoundRead(chrome.scripting.executeScript({injectImmediately:true,target:{tabId:target.tabId},func:wbControlHitDOM,args:[point]}),3000))?.[0]?.result;
  if(hit!==true)throw new Error(name+'按钮被遮挡，请在 Edge 核查。');
  return point;
}
function wbControlHitDOM({x,y}) {
  if(location.hostname!=='creator.xiaohongshu.com'||!/\/publish\//.test(location.pathname))return false;
  const host=[...document.querySelectorAll('xhs-publish-btn')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
  const top=document.elementFromPoint(x,y);
  return host.length===1&&!!top&&(top===host[0]||host[0].contains(top));
}
async function wbSubmitPublish({title,content,imageCount,mode='image',tags=[],visibility='公开可见',scheduleAt}) {
  let target,attached=false,clicked=false,evidenceBefore;
  try {
    const tab=await wbFindPublishTab({useWorkTab:true});target={tabId:tab.id};
    const inspect=async()=> (await wbBoundRead(chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:wbPublishDOM,args:[{title,content,imageCount,mode,tags,visibility,scheduleAt}]}),3000))?.[0]?.result;
    let before=await inspect();
    if(before?.error)return {publishClicked:false,status:'not_submitted',message:before.error,url:tab.url};
    await chrome.tabs.update(tab.id,{active:true});
    await chrome.debugger.attach(target,'1.3');attached=true;
    // The debugging notice can resize the page; remeasure after attaching.
    before=await inspect();
    if(before?.error)return {publishClicked:false,status:'not_submitted',message:before.error,url:tab.url};
    evidenceBefore=(await wbBoundRead(chrome.debugger.sendCommand(target,'Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true}),3000)).data;
    const {x,y}=await wbResolveControl(target,before);
    await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
    clicked=true;
    await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
    await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
    let after;
    const deadline=Date.now()+30000;
    do {
      after=(await wbBoundRead(chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:()=>({url:location.href,text:(document.body?.innerText||'').slice(-5000)})}),Math.min(3000,Math.max(1,deadline-Date.now()))))?.[0]?.result;
      if(/(^|\n)(发布成功|提交成功|笔记已发布)([！!。 ]|\n|$)/g.test(after?.text||''))break;
      if(/安全验证|请完成.{0,8}验证|发布失败/.test(after?.text||''))break;
      await sleep(500);
    }while(Date.now()<deadline);
    const evidenceAfter=(await wbBoundRead(chrome.debugger.sendCommand(target,'Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true}),3000)).data;
    const acknowledged=/(^|\n)(发布成功|提交成功|笔记已发布)([！!。 ]|\n|$)/g.test(after?.text||'');
    return {publishClicked:true,status:acknowledged?'submitted':'uncertain',message:acknowledged?'Edge 页面显示提交结果，请到笔记管理核实审核或排期。':'已点击发布，页面未给出明确结果。请核查后台，禁止自动重试。',url:after?.url,visibleText:after?.text,evidenceBefore,evidenceAfter};
  }catch(e){return {publishClicked:clicked,status:clicked?'uncertain':'not_submitted',message:String(e.message||e),evidenceBefore};}
  finally {if(attached)await chrome.debugger.detach(target).catch(()=>{});}
}
function wbPublishDOM({title,content,imageCount,mode,tags,visibility='公开可见',scheduleAt}) {
  const text=document.body?.innerText||'';
  const state={status:location.hostname==='creator.xiaohongshu.com'&&/\/publish\//.test(location.pathname)&&!/安全验证|请完成.{0,8}验证/.test(text)?'ready':'blocked',surface:'creator_publish'};
  if(state.status!=='ready'||state.surface!=='creator_publish')return {error:state.message||'Edge 发布表单未就绪，未点击发布。'};
  const visible=e=>!!e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  const titleInput=[...document.querySelectorAll('div.d-input input,input[placeholder*="标题"]')].find(visible);
  const body=[...document.querySelectorAll('div[role="textbox"][contenteditable="true"],div.tiptap[contenteditable="true"],div.ql-editor')].find(visible);
  const normalize=s=>String(s||'').normalize('NFKC').replace(/[\s\u200b-\u200d\ufeff]/g,'');
  if(titleInput?.value!==title)return {error:'平台标题与本地草稿不一致，未点击发布。'};
  const expected=normalize(content+tags.map(t=>'#'+t).join(''));
  if(!body || ![normalize(content),expected].includes(normalize(body.innerText)))return {error:'平台正文与本地草稿不一致，未点击发布。'};
  if(tags.some(t=>!normalize(body.innerText).includes(normalize('#'+t))))return {error:'平台话题没有全部填入，未点击发布。'};
  if(mode==='image' && document.querySelectorAll('.img-preview-area .pr').length!==imageCount)return {error:'平台图片数量与草稿不一致，请在 Edge 核查，未点击发布。'};
  if(mode==='image'&&[...document.querySelectorAll('.img-preview-area .pr')].some(e=>{const i=e.querySelector('img.preview')||e.querySelector('img');return !i?.complete||i.naturalWidth<=0||!/^https:\/\//.test(i.currentSrc||i.src||'');}))return {error:'平台图片没有完整加载或仍为临时预览，未点击发布。'};
  if(mode!=='image'||visibility!=='公开可见'||scheduleAt)return {error:'视频、非公开或定时提交需在 Edge 手动核对并完成。'};
  const permission=[...document.querySelectorAll('div.permission-card-wrapper div.d-select-content')].find(visible);
  const schedule=[...document.querySelectorAll('.post-time-wrapper .d-switch')].find(visible);
  if(permission?.innerText?.trim()!=='公开可见'||!schedule||schedule.getAttribute('aria-checked')==='true'||/checked|active|is-on/.test(schedule.className)||schedule.querySelector('input:checked'))return {error:'平台可见范围或定时状态无法核实，未点击发布。'};
  const candidates=[...document.querySelectorAll('button,xhs-publish-btn')].filter(visible).filter(e=>/^(发布|定时发布)$/.test(e.innerText?.trim()) || e.tagName==='XHS-PUBLISH-BTN' && e.getAttribute('is-publish')==='true');
  if(candidates.length!==1)return {error:'没有唯一可用的发布按钮，请在 Edge 手动核查，未点击发布。'};
  const e=candidates[0];if(e.disabled || e.hasAttribute('disabled') || e.getAttribute('aria-disabled')==='true'||e.getAttribute('submit-disabled')==='true')return {error:'平台发布按钮不可用，未点击发布。'};
  e.scrollIntoView({block:'center',behavior:'instant'});
  const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,top=document.elementFromPoint(x,y);
  if(!top || (top!==e&&!e.contains(top)))return {error:'发布按钮被遮挡，未点击发布。'};
  return e.tagName==='XHS-PUBLISH-BTN'?{control:{name:'发布',host:{x:r.x,y:r.y,width:r.width,height:r.height}}}:{button:{x,y}};
}
