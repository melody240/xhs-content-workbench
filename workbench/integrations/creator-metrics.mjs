export const CREATOR_METRICS=[
  ['exposure','曝光数'],['views','观看数'],['clickRate','封面点击率'],['completionRate','视频完播率'],
  ['likes','点赞数'],['comments','评论数'],['favorites','收藏数'],['shares','分享数'],
  ['netFollowers','净涨粉'],['newFollowers','新增关注'],['unfollows','取消关注'],['profileViews','主页访客']
];
export function creatorValue(text){
  const value=String(text??'').trim();if(!value||/^[-—–]+$/.test(value))return null;
  const match=value.replaceAll(',','').match(/^([+-]?\d+(?:\.\d+)?)\s*([万亿kKmM%]?)$/);
  if(!match)return null;return Number(match[1])*({万:1e4,亿:1e8,k:1e3,K:1e3,m:1e6,M:1e6}[match[2]]||1);
}
export function creatorRangeDays(range){
 const parts=String(range||'').match(/\d{1,2}-\d{1,2}/g);if(parts?.length!==2)return null;
 const [sm,sd]=parts[0].split('-').map(Number),[em,ed]=parts[1].split('-').map(Number);
 const start=Date.UTC(2024,sm-1,sd),end=Date.UTC(em<sm?2025:2024,em-1,ed);
 return Math.round((end-start)/86400000)+1;
}
export function creatorSnapshot(value,expected){
  if(!value?.profile?.redId||String(value.profile.redId)!==String(expected?.redId))throw Object.assign(Error('创作后台账号与当前工作台不一致，未保存数据。'),{status:409,code:'BROWSER_IDENTITY_MISMATCH'});
  if(![7,30].includes(value.period)||creatorRangeDays(value.range)!==value.period||!Array.isArray(value.metrics)||!value.metrics.length)throw Object.assign(Error('创作后台数据尚未读取完整，保留上次结果。'),{status:502});
  const metrics=Object.fromEntries(CREATOR_METRICS.map(([key,label])=>{
    const row=value.metrics.find(r=>r.key===key);return [key,{label,value:creatorValue(row?.display),display:row?.display||'—',change:row?.change||'—'}];
  }));
  if(!Object.values(metrics).some(m=>m.value!==null))throw Object.assign(Error('没有读取到后台指标。'),{status:502});
  return {at:new Date().toISOString(),profile:value.profile,channel:'skills',source:'creator',period:value.period,range:value.range,updatedAt:value.updatedAt||'',metrics,notes:[],hasMore:false,evidence:{url:value.url,visibleText:value.visibleText,capturedAt:value.capturedAt}};
}
