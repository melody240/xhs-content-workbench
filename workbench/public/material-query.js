export const MATERIAL_FILTERS=[['all','全部'],['x','X帖子'],['douyin-comments','抖音评论'],['xhs-comments','小红书评论'],['local','本地图片']];
export function filterMaterials(records,{category='all',jobId=null,assetIds=null,deleted=false}={}){
 return records.filter(r=>Boolean(r.archivedAt)===deleted&&(category==='all'||r.category===category)&&(!jobId||(r.jobIds||[]).includes(jobId))&&(!assetIds||assetIds.includes(r.id)));
}
export function materialRoute(value){
 const panels={comments:'comments',updates:'updates',sources:'sources'};
 return {view:['materials',...Object.keys(panels)].includes(value)?'publish':value,panel:panels[value]||null};
}
