import {captureWorkspace, transitionWorkspace, stopWorkspaceTransition} from './workspace-transition.js';
/* One focal sequence: the task title unfolds, while navigation follows it.
   Result titles acknowledge new content. Polling and editing stay still. */
const ease = 'cubic-bezier(.16,1,.3,1)';
const resultSelector = '.research-topic h3, .research-article h2';
const active = new WeakMap();
const installed = new WeakSet();
const taskVisibility = new WeakMap();
const currentMain = root => root.querySelector?.('main');
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const visibleRect = (element) => {
  if (!element || !element.getClientRects().length) return null;
  const rect = element.getBoundingClientRect();
  return rect.width && rect.height ? {x:rect.x,y:rect.y,width:rect.width,height:rect.height} : null;
};
const headings = root => [...(root.querySelectorAll?.(resultSelector) || [])].filter(element=>!element.closest?.('.workspace-outgoing'));
const titleKey = element => `${element.closest('[data-motion-key]')?.dataset.motionKey || ''}:${element.textContent}`;

export function splitCharacters(text) {
  return typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter('zh-CN', {granularity:'grapheme'}).segment(text)].map(item=>item.segment)
    : Array.from(text);
}

export function stopMotion(root) {
  stopWorkspaceTransition(root);
  for (const finish of [...(active.get(root) || [])]) finish();
}

function track(root, animations, restore=()=>{}) {
  let finished=false;
  const records=active.get(root) || new Set();
  active.set(root,records);
  const finish=()=>{
    if (finished) return;
    finished=true;
    for (const animation of animations) animation.cancel();
    restore();
    records.delete(finish);
  };
  records.add(finish);
  Promise.allSettled(animations.map(animation=>animation.finished)).then(finish);
  return finish;
}

export function captureMotion(root, nextView) {
  const layout = root.querySelector('.layout');
  const snapshot={
    view: layout?.dataset.view,
    menuOpen: !!root.querySelector('.sidebar.open'),
    nav: visibleRect(root.querySelector('.nav-item.active .motion-selection') || root.querySelector('.nav-item.active')),
    tab: visibleRect(root.querySelector('.section-tab.active .motion-selection') || root.querySelector('.section-tab.active')),
    titles: headings(root).map(titleKey),
    photo: root.querySelector('.material-reader-picture img,.update-screenshot img')?.getAttribute('src'),
    progress: (()=>{const fill=root.querySelector('.task-fill');return fill?{key:fill.closest('.task-feedback')?.dataset.progressKey,value:Number(fill.style.getPropertyValue('--task-fraction'))}:null;})(),
  };
  // Render replaces this subtree. Finish current effects first so the outgoing copy
  // contains readable text instead of split glyph wrappers.
  stopMotion(root);
  snapshot.workspace = captureWorkspace(root, snapshot.view, nextView);
  return snapshot;
}

function arrive(root, element, frames, duration) {
  if (!element) return;
  element.classList.add('motion-entering');
  track(root,[element.animate(frames,{duration,easing:ease})],()=>element.classList.remove('motion-entering'));
}

function glidePlate(root, element, previous) {
  const next = visibleRect(element);
  if (!next || !previous) return;
  const dx = previous.x - next.x, dy = previous.y - next.y;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  const plate = document.createElement('span');
  plate.className = 'motion-selection';
  plate.setAttribute('aria-hidden','true');
  element.classList.add('motion-gliding');
  element.append(plate);
  const animation = plate.animate([
    {transform:`translate(${dx}px,${dy}px) scale(${previous.width / next.width},${previous.height / next.height})`,opacity:.8},
    {transform:'translate(0,0) scale(1,1)',opacity:1},
  ], {duration:280,easing:ease});
  track(root,[animation],()=>{plate.remove();element.classList.remove('motion-gliding');});
}

function unfoldTitle(root, element, {result=false}={}) {
  const rect=visibleRect(element);
  if (!rect || rect.y>=window.innerHeight || rect.y+rect.height<=0 || element.children.length) return;
  const text=element.textContent;
  const parts=splitCharacters(text);
  // Only short, plain interface/result titles. Never split body or controls.
  if (!text.trim() || parts.length>64) return;
  const original=[...element.childNodes], label=element.getAttribute('aria-label');
  const chars=[], animations=[];
  const restore=()=>{
    element.replaceChildren(...original);
    if (label===null) element.removeAttribute('aria-label'); else element.setAttribute('aria-label',label);
    element.classList.remove('motion-split');
  };
  try {
    const fragment=document.createDocumentFragment();
    for (const part of parts) {
      if (/^\s+$/.test(part)) {fragment.append(document.createTextNode(part));continue;}
      const mask=document.createElement('span'), char=document.createElement('span');
      mask.className='motion-char-mask';mask.setAttribute('aria-hidden','true');
      char.className='motion-char';char.textContent=part;mask.append(char);fragment.append(mask);chars.push(char);
    }
    element.setAttribute('aria-label',text);
    element.classList.add('motion-split');
    element.replaceChildren(fragment);
    const step=Math.min(result?14:22,100/Math.max(1,chars.length-1));
    chars.forEach((char,index)=>animations.push(char.animate([
      {transform:'translateY(.82em) rotate(5deg)',opacity:.15},
      {transform:'translateY(-.035em) rotate(0deg)',opacity:1,offset:.8},
      {transform:'translateY(0) rotate(0deg)',opacity:1},
    ],{duration:result?300:380,delay:index*step,easing:ease,fill:'backwards'})));
    track(root,animations,restore);
  } catch {
    animations.forEach(animation=>animation.cancel());restore();
  }
}

function installFeedback(root) {
  if (installed.has(root) || !root.addEventListener) return;
  installed.add(root);
  if(typeof IntersectionObserver==='function'){
    let observed=[];
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=>entry.target.toggleAttribute('data-task-offscreen',!entry.isIntersecting)),{threshold:.01});
    taskVisibility.set(root,()=>{
      observed.forEach(el=>observer.unobserve(el));
      observed=[...(root.querySelectorAll?.('.task-feedback')||[])];
      observed.forEach(el=>observer.observe(el));
    });
  }
  const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
  preference.addEventListener?.('change',event=>{if(event.matches)stopMotion(root);});
  document.addEventListener('visibilitychange',()=>{
    document.documentElement?.toggleAttribute('data-motion-paused',document.hidden);
    if(document.hidden)stopMotion(root);
  });
  root.addEventListener('pointerdown',event=>{
    if (event.button!==0 || reduced() || typeof Element.prototype.animate!=='function') return;
    const button=event.target.closest?.('.btn:not(.ghost)');
    if (!button || button.disabled || button.getAttribute('aria-disabled')==='true') return;
    const pulse=document.createElement('span');
    pulse.className='motion-press';pulse.setAttribute('aria-hidden','true');
    const rect=button.getBoundingClientRect();
    pulse.style?.setProperty('--press-x',`${Number.isFinite(event.clientX)?event.clientX-rect.left:rect.width/2}px`);
    pulse.style?.setProperty('--press-y',`${Number.isFinite(event.clientY)?event.clientY-rect.top:rect.height/2}px`);
    button.append(pulse);
    track(root,[pulse.animate([
      {transform:'scale(.6)',opacity:.38},
      {transform:'scale(1.45)',opacity:0},
    ],{duration:240,easing:ease})],()=>pulse.remove());
  },{passive:true});
  root.addEventListener('change',event=>{
    const input=event.target;
    if(!input.matches?.('[data-material-pick]')||!input.checked||reduced()||document.hidden||typeof Element.prototype.animate!=='function')return;
    const container=input.closest('.material-image,.material-reader');
    const picture=container?.querySelector('.material-thumbnail,.material-reader-picture');
    if(!picture)return;
    const wave=document.createElement('span');wave.className='photo-selection-wave';wave.setAttribute('aria-hidden','true');picture.append(wave);
    track(root,[wave.animate([
      {transform:'translateX(-110%) skewX(-18deg)',opacity:0},
      {transform:'translateX(0) skewX(-18deg)',opacity:.7,offset:.45},
      {transform:'translateX(110%) skewX(-18deg)',opacity:0},
    ],{duration:360,easing:ease})],()=>wave.remove());
    const mark=picture.querySelector('.material-selection-mark');
    if(mark)track(root,[mark.animate([{transform:'scale(.55)',opacity:.3},{transform:'scale(1.06)',opacity:1,offset:.7},{transform:'scale(1)',opacity:1}],{duration:220,easing:ease})]);
  });
}

export function playMotion(root, previous={}) {
  installFeedback(root);
  taskVisibility.get(root)?.();
  if (reduced() || document.hidden || typeof Element.prototype.animate !== 'function') return;
  const layout = root.querySelector('.layout');
  const changed=!!previous.view && previous.view!==layout?.dataset.view;
  if (changed) {
    const main=currentMain(root);
    if(previous.workspace)transitionWorkspace(root,previous.workspace);
    else arrive(root,main,[
      {opacity:.7,transform:'translateX(12px)'},
      {opacity:1,transform:'translateX(0)'},
    ],320);
    glidePlate(root,root.querySelector('.nav-item.active'),previous.nav);
    glidePlate(root,root.querySelector('.section-tab.active'),previous.tab);
  }
  const main=currentMain(root);
  const picture=main?.querySelector?.('.material-reader-picture,.update-screenshot') || root.querySelector('.material-reader-picture,.update-screenshot');
  const photo=picture?.querySelector('img')?.getAttribute('src');
  if(!changed&&previous.photo&&photo&&previous.photo!==photo)arrive(root,picture,[{opacity:.6,transform:'translateX(8px)'},{opacity:1,transform:'translateX(0)'}],280);
  const fill=main?.querySelector?.('.task-fill') || root.querySelector('.task-fill');
  if(fill&&previous.progress&&fill.closest('.task-feedback')?.dataset.progressKey===previous.progress.key){
    const next=Number(fill.style.getPropertyValue('--task-fraction'));
    if(next>previous.progress.value)track(root,[fill.animate([{transform:`scaleX(${previous.progress.value})`},{transform:`scaleX(${next})`}],{duration:420,easing:ease})]);
  }
  if (changed || !previous.view) unfoldTitle(root,main?.querySelector?.('.page-head h1') || root.querySelector('.page-head h1'));
  const known=new Set(previous.titles || []);
  // Route panels already have their own reveal; avoid dozens of nested glyph layers.
  if(!previous.workspace)headings(main || root).filter(element=>(changed || (!previous.view ? false : !known.has(titleKey(element)))))
    .slice(0,3).forEach(element=>unfoldTitle(root,element,{result:true}));
  const sidebar = root.querySelector('.sidebar.open');
  if (sidebar && !previous.menuOpen) {
    arrive(root,sidebar,[
      {transform:'translateX(calc(-100% - 32px))',opacity:.6},
      {transform:'translateX(0)',opacity:1},
    ],320);
  }
}
