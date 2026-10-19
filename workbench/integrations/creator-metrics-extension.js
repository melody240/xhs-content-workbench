// One browser command reads the official summary. No individual note pages,
// private endpoints, Cookie access or independent browser login are involved.
function wbCreatorMetricsDOM({period,select=false}={}){
  const visible=e=>e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  const controls=[...document.querySelectorAll('button,span,div,a')].filter(e=>visible(e)&&new RegExp('^近\\s*'+period+'\\s*(日|天)$').test(e.innerText?.trim()||''));
  controls.sort((a,b)=>a.childElementCount-b.childElementCount);
  const control=controls[0];
  if(select){if(!control)return {selected:false};control.click();return {selected:true};}
  const text=document.body?.innerText||'',redId=text.match(/小红书账号[：:]?\s*([a-zA-Z0-9_-]+)/)?.[1]||'';
  const start=text.indexOf('笔记数据总览'),end=text.indexOf('最新笔记',start),section=start<0?'':text.slice(start,end>start?end:start+6000);
  const labels=[['exposure','曝光数'],['views','观看数'],['clickRate','封面点击率'],['completionRate','视频完播率'],['likes','点赞数'],['comments','评论数'],['favorites','收藏数'],['shares','分享数'],['netFollowers','净涨粉'],['newFollowers','新增关注'],['unfollows','取消关注'],['profileViews','主页访客']];
  const metrics=labels.map(([key,label])=>{const m=section.match(new RegExp(label+'\\s*([+-]?\\d[\\d,.]*\\s*[万亿kKmM%]?|[-—–])\\s*(?:环比\\s*([+-]?\\d[\\d,.]*\\s*[%万亿]?|[-—–]))?'));return {key,display:m?.[1]?.replace(/\s+/g,'')||'',change:m?.[2]?.replace(/\s+/g,'')||'—'};});
  const range=section.match(/统计周期\s*([^\n]+)/)?.[1]?.trim()||'';
  const parts=range.match(/\d{1,2}-\d{1,2}/g);let rangeDays=null;
  if(parts?.length===2){const [sm,sd]=parts[0].split('-').map(Number),[em,ed]=parts[1].split('-').map(Number);rangeDays=Math.round((Date.UTC(em<sm?2025:2024,em-1,ed)-Date.UTC(2024,sm-1,sd))/86400000)+1;}
  const nickname=document.querySelector('[class*="user-name"],[class*="nickname"]')?.textContent?.trim()||'';
  return {profile:{redId,nickname},period,range,rangeDays,metrics,updatedAt:text.match(/数据最后更新时间\s*([^\n]+)/)?.[1]?.trim()||'',url:location.href,visibleText:section,capturedAt:new Date().toISOString(),controlFound:!!control};
}
async function wbCreatorMetrics({period=7,redId}={}){
  if(![7,30].includes(period))throw Error('请选择近七日或近三十日。');
  const tab=await wbInspectionTab('creator-metrics','https://creator.xiaohongshu.com/new/home');let handoff=false;
  const read=args=>wbBoundRead(chrome.scripting.executeScript({injectImmediately:true,target:{tabId:tab.id},func:wbCreatorMetricsDOM,args:[args]}),4000).then(r=>r?.[0]?.result);
  try{
    const page=await waitForTabComplete(tab.id,'https://creator.xiaohongshu.com/new/home',30000);
    if(!redId||page.redId!==String(redId))throw Object.assign(Error('创作后台账号与当前工作台不一致。'),{code:'BROWSER_IDENTITY_MISMATCH'});
    const chosen=await read({period,select:true});if(!chosen?.selected)throw wbPageError('创作后台的时间范围控件尚未出现。','loading');
    const deadline=Date.now()+15000;let last,stableAt=0;
    do{
      const next=await read({period});
      if(next?.profile.redId!==String(redId))throw Object.assign(Error('创作后台账号已变化，已停止采集。'),{code:'BROWSER_IDENTITY_MISMATCH'});
      if(next.controlFound&&next.rangeDays===period&&next.metrics.filter(m=>m.display).length===12){
        const signature=JSON.stringify([next.range,next.metrics]);
        if(last?.signature===signature&&Date.now()-stableAt>=1200)return {...next,profile:{...next.profile,nickname:next.profile.nickname||undefined}};
        if(last?.signature!==signature){stableAt=Date.now();last={signature};}
      }
      await sleep(300);
    }while(Date.now()<deadline);
    throw wbPageError('创作后台的汇总指标尚未加载完整，本次未覆盖上次数据。','loading');
  }catch(e){if(['login_required','verification_required'].includes(e.pageStatus)){handoff=true;await chrome.tabs.update(tab.id,{active:true}).catch(()=>{});}throw e;}
  finally{if(!handoff)await wbCloseInspection('creator-metrics',tab.id);}
}
