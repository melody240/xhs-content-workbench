const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function reorderAssets(assets,fromId,toId){
 const from=assets.findIndex(a=>a.id===fromId),to=assets.findIndex(a=>a.id===toId);
 if(from<0||to<0||from===to)return assets;
 const result=[...assets], [moved]=result.splice(from,1);result.splice(to,0,moved);return result;
}
export function openAssetImage(asset,trigger){
 if(!asset?.url?.startsWith('/media/'))return;
 const dialog=document.createElement('dialog');dialog.className='material-lightbox';dialog.setAttribute('aria-label','查看已选图片');
 dialog.innerHTML=`<div class="dialog-head"><h2>查看图片</h2><div class="actions"><a class="text-btn" href="${escapeHTML(asset.url)}" download="${escapeHTML(asset.name||'图片.png')}">下载原图</a><button class="btn" type="button" data-close-image>关闭</button></div></div><div class="material-lightbox-scroll" tabindex="0" aria-label="完整图片，长图可滚动"><img src="${escapeHTML(asset.url)}" alt="${escapeHTML(asset.name||'已选图片原图')}"></div>`;
 dialog.querySelector('[data-close-image]').onclick=()=>dialog.close();
 let backdropDown=false;
 dialog.addEventListener('pointerdown',e=>{const box=dialog.getBoundingClientRect();backdropDown=e.target===dialog&&(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom);});
 dialog.addEventListener('click',e=>{if(backdropDown&&e.target===dialog)dialog.close();backdropDown=false;});
 dialog.addEventListener('close',()=>{dialog.remove();if(trigger?.isConnected)trigger.focus({preventScroll:true});},{once:true});document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-close-image]').focus();
}
let cleanupOrder;
export function bindImageOrder(root,{getAssets,onReorder}){
 cleanupOrder?.();if(!root)return;
 const list=root.querySelector('.uploaded-list');if(!list)return;
 const controller=new AbortController(),opts={signal:controller.signal};let source=null,ordered=null,lastTarget=null,suppressClick=false;
 const finish=()=>{list.querySelectorAll('.is-dragging,.drop-target').forEach(e=>e.classList.remove('is-dragging','drop-target'));source=null;ordered=null;lastTarget=null;};
 cleanupOrder=()=>{controller.abort();finish();};
 const start=id=>{source=id;ordered=[...getAssets()];list.querySelector(`[data-asset-order="${CSS.escape(id)}"]`)?.classList.add('is-dragging');};
 const hover=target=>{const id=target?.dataset.assetOrder;if(!source||!id||id===source||lastTarget===id)return;lastTarget=id;ordered=reorderAssets(ordered,source,id);list.querySelectorAll('.drop-target').forEach(e=>e.classList.remove('drop-target'));target.classList.add('drop-target');for(const a of ordered){const el=list.querySelector(`[data-asset-order="${CSS.escape(a.id)}"]`);if(el)list.append(el);}};
 const commit=()=>{const next=ordered,current=getAssets(),id=source;finish();if(!next||current.length!==next.length||current.some(a=>!next.some(n=>n.id===a.id)))return;if(next.some((a,i)=>a.id!==current[i].id)){onReorder(next);const item=document.querySelector(`[data-asset-order="${CSS.escape(id)}"]`);item?.querySelector('button')?.focus();}};
 list.addEventListener('dragstart',e=>{const item=e.target.closest('[data-asset-order]');if(!item)return;start(item.dataset.assetOrder);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',source);},opts);
 list.addEventListener('dragover',e=>{if(!source)return;e.preventDefault();e.dataTransfer.dropEffect='move';hover(e.target.closest('[data-asset-order]'));},opts);
 list.addEventListener('drop',e=>{if(!source)return;e.preventDefault();suppressClick=true;commit();setTimeout(()=>{suppressClick=false;},0);},opts);
 list.addEventListener('dragend',()=>{if(source){for(const a of getAssets()){const el=list.querySelector(`[data-asset-order="${CSS.escape(a.id)}"]`);if(el)list.append(el);}finish();}},opts);
 list.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();suppressClick=false;}},{capture:true,signal:controller.signal});
 list.addEventListener('keydown',e=>{if(!e.altKey||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;const item=e.target.closest('[data-asset-order]');if(!item)return;const assets=getAssets(),at=assets.findIndex(a=>a.id===item.dataset.assetOrder),to=at+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1);if(!assets[to])return;e.preventDefault();onReorder(reorderAssets(assets,assets[at].id,assets[to].id));document.querySelector(`[data-asset-order="${CSS.escape(assets[at].id)}"] button`)?.focus();const status=document.querySelector('#image-order-status');if(status)status.textContent=`图片已移到第 ${to+1} 张${to===0?'，现在是封面':''}`;},opts);
 list.addEventListener('pointerdown',e=>{const handle=e.target.closest('[data-order-handle]');if(!handle||e.button!==0)return;e.preventDefault();const item=handle.closest('[data-asset-order]');start(item.dataset.assetOrder);handle.setPointerCapture(e.pointerId);const move=ev=>{hover(document.elementFromPoint(ev.clientX,ev.clientY)?.closest('[data-asset-order]'));};const done=ev=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',done);handle.removeEventListener('pointercancel',cancel);suppressClick=true;commit();};const cancel=()=>{for(const a of getAssets()){const el=list.querySelector(`[data-asset-order="${CSS.escape(a.id)}"]`);if(el)list.append(el);}handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',done);handle.removeEventListener('pointercancel',cancel);finish();};handle.addEventListener('pointermove',move,opts);handle.addEventListener('pointerup',done,opts);handle.addEventListener('pointercancel',cancel,opts);},opts);
}
