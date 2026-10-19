// Read the official editor's visible suggestions, never an invented model list.
async function wbSmartTitles({title,content,tags=[],imageCount,useWorkTab=true,apply=true}) {
 const tab=await wbFindPublishTab({useWorkTab});
 const assets=await wbCheckPublishAssets({imageCount,useWorkTab,waitMs:0});
 if(assets.status!=='ready'&&!(assets.status==='not_ready'&&assets.imageCount===imageCount&&assets.loadedCount===imageCount))throw Error(assets.message||'平台图片尚未就绪。');
 const read=async (action,chosenTitle)=>(await wbBoundRead(chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:wbSmartTitleDOM,args:[{action,title,content,tags,chosenTitle}]}),3000))?.[0]?.result;
 let value=await read('read');
 if(value?.error)throw Error(value.error);
 if(!value?.candidates?.length){value=await read('open');if(value?.error)throw Error(value.error);}
 const until=Date.now()+15000;
 while(!value?.candidates?.length&&Date.now()<until){await sleep(400);value=await read('read');if(value?.error)throw Error(value.error);}
 if(!value?.candidates?.length)throw Error('平台未返回智能标题，原标题已保留。可在 Edge 核查后重试。');
 if(!apply)return {...value,source:'creator',applied:false};
 const clicked=await read('apply',value.candidates[0]);if(clicked?.error)throw Error(clicked.error);
 let verified;
 const deadline=Date.now()+2000;
 do{verified=await read('verify',value.candidates[0]);if(verified?.error)throw Error(verified.error);if(verified?.applied)break;await sleep(100);}while(Date.now()<deadline);
 if(!verified?.applied)throw Error('智能标题尚未确认写入，请查看 Edge 表单；不会发布。');
 return {candidates:value.candidates,title:verified.title,applied:true,source:'creator'};
}
function wbSmartTitleDOM({action,title,content,tags=[],chosenTitle}){
 const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
 const norm=s=>String(s||'').replace(/\[话题\]#/g,'').normalize('NFKC').replace(/[\s\u200b-\u200d\ufeff]/g,'');
 const input=[...document.querySelectorAll('input[placeholder*="标题"]')].find(visible);
 const body=[...document.querySelectorAll('div[role="textbox"][contenteditable="true"],div.tiptap[contenteditable="true"],div.ql-editor')].find(visible);
 if(!input||input.value!==title&&!(action==='verify'&&input.value===chosenTitle))return {error:'平台标题与本篇草稿不一致，未改动标题。'};
 if(!body||![norm(content),norm(content+tags.map(t=>'#'+t).join(''))].includes(norm(body.innerText)))return {error:'平台正文与本篇草稿不一致，未改动标题。'};
 if(action==='verify')return {title:input.value,applied:input.value===chosenTitle};
 const leaves=[...document.querySelectorAll('body *')].filter(e=>visible(e)&&e.children.length===0&&e.textContent.trim());
 const trigger=leaves.find(e=>e.textContent.trim()==='智能标题');
 if(!trigger)return {error:'平台未显示“智能标题”入口，请在 Edge 检查图文编辑页。'};
 const anchor=trigger.getBoundingClientRect();
 // The official menu floats below its trigger. Accept only a compact group of
 // text-only leaves from one positioned overlay; never scrape the whole page.
 const groups=new Set();
 for(const leaf of leaves){
  const r=leaf.getBoundingClientRect();if(r.top<anchor.bottom-4||r.top>anchor.bottom+700||r.right<anchor.left-340||r.left>anchor.right+30)continue;
  let parent=leaf.parentElement;
  for(let depth=0;parent&&depth<6;depth++,parent=parent.parentElement){
   if(parent===document.body)break;
   if(!['absolute','fixed'].includes(getComputedStyle(parent).position)||parent.querySelector('input,textarea,[contenteditable="true"]'))continue;
   const entries=leaves.filter(e=>parent.contains(e));
   if(entries.length>=2&&entries.length<=10&&entries.every(e=>{const t=e.textContent.trim();return Array.from(t).length<=40&&!/智能标题|换一换|加载中|生成中/.test(t);}))groups.add(parent);
   break;
  }
 }
 const group=[...groups].sort((a,b)=>a.getBoundingClientRect().width*a.getBoundingClientRect().height-b.getBoundingClientRect().width*b.getBoundingClientRect().height)[0];
 const entries=group?leaves.filter(e=>group.contains(e)):[];
 const candidates=entries.map(e=>e.textContent.trim());
 if(action==='open'&&!entries.length){trigger.click();return {opened:true,candidates:[]};}
 if(action==='apply'){
  if(!entries.length)return {error:'智能标题菜单已关闭，请重试。'};
  const first=candidates[0];if(first!==chosenTitle)return {error:'平台候选已变化，请重新获取。'};if(Array.from(first).length>20)return {error:'平台首个标题超过20字，请在 Edge 调整；原标题未改动。'};
  entries[0].click();
  return {candidates,clicked:true};
 }
 return {candidates};
}
