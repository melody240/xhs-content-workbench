import {collageLayout,preferredColumns,COLLAGE_SIZE} from './collage-layout.js';
import {accountHeaders} from './request.js';

const loadImage=async url=>{const img=new Image();img.src=url;await img.decode();if(!img.naturalWidth||!img.naturalHeight)throw Error('图片加载失败。');return img;};
export function drawCollage(canvas,images,background,{columns=1,title='',mode='ordered',seed=1}={}){
  canvas.width=COLLAGE_SIZE.width;canvas.height=COLLAGE_SIZE.height;
  const c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,canvas.width,canvas.height);
  const fit=Math.min(canvas.width/background.naturalWidth,canvas.height/background.naturalHeight);
  const bw=background.naturalWidth*fit,bh=background.naturalHeight*fit;
  c.drawImage(background,(canvas.width-bw)/2,(canvas.height-bh)/2,bw,bh);
  const layout=collageLayout(images.map(img=>({width:img.naturalWidth,height:img.naturalHeight})),{columns,title:!!title,mode,seed});
  for(const p of layout.placements)c.drawImage(images[p.index],p.x,p.y,p.width,p.height);
  if(title){
    c.fillStyle='#f8c8e4';c.fillRect(40,40,1120,135);c.fillStyle='#17151d';c.textAlign='center';c.textBaseline='middle';
    let size=78;c.font=`700 ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
    while(c.measureText(title).width>1060&&size>30)c.font=`700 ${--size}px "PingFang SC","Microsoft YaHei",sans-serif`;
    c.fillText(title,600,108);
  }
  return layout;
}

export function createCollageUI(ctx){
  let dialog,opening=false;
  async function open(assets,trigger){
    if(dialog?.open||opening)return;
    opening=true;
    try{
    const account=ctx.accountId();
    if(assets.length<2)throw Error('请先选择至少两张图片。');
    const [images,settings]=await Promise.all([Promise.all(assets.map(a=>loadImage(a.url))),ctx.api('/api/materials/background')]);
    const background=await loadImage(settings.background.url);
    if(account!==ctx.accountId())throw Error('账号已变化，请重新选择素材。');
    let columns=preferredColumns(images.map(i=>({width:i.naturalWidth,height:i.naturalHeight}))),mode='scattered',seed=crypto.getRandomValues(new Uint32Array(1))[0],saved=null;
    dialog=document.createElement('dialog');dialog.className='collage-dialog';dialog.setAttribute('aria-label','3:4 拼图');
    dialog.innerHTML=`<div class="dialog-head"><h2>3:4 拼图</h2><button class="btn" type="button" data-collage-close>关闭</button></div><div class="collage-body"><div class="collage-canvas"><canvas aria-label="完整拼图预览"></canvas></div><div class="collage-controls"><div class="field"><label for="collage-title">封面标题</label><input id="collage-title" type="text" maxlength="40" placeholder="可留空"></div><div class="field"><label>排版</label><div class="segmented">${[['scattered','错落'],['1','纵向'],['2','双列']].map(([value,label])=>`<button type="button" data-collage-mode="${value}" aria-pressed="${value==='scattered'}" class="${value==='scattered'?'active':''}">${label}</button>`).join('')}</div></div><button class="btn" type="button" data-collage-random>换个排列</button><div class="collage-inputs">${assets.map((a,n)=>`<img src="${ctx.esc(a.url)}" alt="拼图素材 ${n+1}">`).join('')}</div><p class="collage-state" role="status"></p><div class="collage-actions"><button type="button" class="btn" data-collage-save>保存到素材库</button><button type="button" class="btn primary" data-collage-cover>用作封面</button><button type="button" class="text-btn" data-collage-download>下载图片</button></div></div></div>`;
    const canvas=dialog.querySelector('canvas'),input=dialog.querySelector('#collage-title'),status=dialog.querySelector('.collage-state');
    const update=()=>{saved=null;const layout=drawCollage(canvas,images,background,{columns,title:input.value.trim(),mode,seed});if(mode==='scattered')columns=layout.columns;status.textContent='';};
    input.oninput=update;
    dialog.querySelectorAll('[data-collage-mode]').forEach(b=>b.onclick=()=>{const value=b.dataset.collageMode;mode=value==='scattered'?'scattered':'ordered';columns=mode==='scattered'?preferredColumns(images.map(i=>({width:i.naturalWidth,height:i.naturalHeight}))):Number(value);dialog.querySelectorAll('[data-collage-mode]').forEach(x=>{const active=x.dataset.collageMode===value;x.classList.toggle('active',active);x.setAttribute('aria-pressed',active);});dialog.querySelector('[data-collage-random]').hidden=mode!=='scattered';update();});
    dialog.querySelector('[data-collage-random]').onclick=()=>{seed=crypto.getRandomValues(new Uint32Array(1))[0];update();};
    const blob=()=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('拼图导出失败。')),'image/png'));
    const save=async()=>{
      if(account!==ctx.accountId())throw Error('账号已变化，未保存拼图。');
      if(saved)return saved;
      const r=await fetch('/api/assets?name='+encodeURIComponent('拼图-3比4.png'),{method:'POST',headers:accountHeaders(account,'application/octet-stream'),body:await blob()});
      const a=await r.json();if(!r.ok)throw Error(a.error);
      if(account!==ctx.accountId())throw Error('账号已变化，图片已留在原账号。');
      await ctx.api('/api/materials/collage',{assetId:a.id,sourceAssetIds:assets.map(a=>a.id),background:settings.background.id||'default',columns,mode,seed,title:input.value.trim()});
      saved=a;await ctx.refresh();return a;
    };
    const action=async fn=>{const buttons=[...dialog.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);status.textContent='正在保存…';try{await fn();}catch(e){status.textContent=e.message;}finally{buttons.forEach(b=>b.disabled=false);}};
    dialog.querySelector('[data-collage-save]').onclick=()=>action(async()=>{await save();status.textContent='已保存到素材库';});
    dialog.querySelector('[data-collage-cover]').onclick=()=>action(async()=>{const asset=await save();ctx.useCover(asset);dialog.close();ctx.toast('拼图已设为封面');});
    dialog.querySelector('[data-collage-download]').onclick=async()=>{const url=URL.createObjectURL(await blob()),a=document.createElement('a');a.href=url;a.download='拼图-3比4.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    dialog.querySelector('[data-collage-close]').onclick=()=>dialog.close();
    dialog.addEventListener('click',e=>{const r=dialog.getBoundingClientRect();if(e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))dialog.close();});
    dialog.addEventListener('close',()=>{dialog.remove();dialog=null;trigger?.isConnected&&trigger.focus({preventScroll:true});},{once:true});
    document.body.append(dialog);update();dialog.showModal();
    }finally{opening=false;}
  }
  return {open};
}
