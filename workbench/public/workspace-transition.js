import {isContentRoute} from './workspace-shell.js';

// Route movement is separate from title, photo and progress feedback.
// Each render owns at most one inert outgoing layer; refreshes never copy a page.
export const workspaceTiming = Object.freeze({exit:300, enter:460, follow:48, ease:'cubic-bezier(.16,1,.3,1)'});
const running = new WeakMap();
const moduleSelector = '.research-start, .research-output, .writing-workspace, .publish-materials-column, .publish-editor-column, .draft-tile';

export function stopWorkspaceTransition(root) { running.get(root)?.(); }

export function captureWorkspace(root, from, to) {
  if (!from || from===to || !isContentRoute(from) || !isContentRoute(to) ||
      document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      (!window.gsap && typeof Element.prototype.animate!=='function')) return null;
  const content=root.querySelector('.workspace-stage > .workspace-content');
  if (!content) return null;
  const outgoing=content.cloneNode(true);
  // cloneNode does not preserve edited textarea/select state.
  const controls=content.querySelectorAll('input,textarea,select');
  outgoing.querySelectorAll('input,textarea,select').forEach((copy,index)=>{
    copy.value=controls[index].value;
    if ('checked' in copy) copy.checked=controls[index].checked;
  });
  outgoing.querySelectorAll('[id],[for],[autofocus]').forEach(node=>{
    node.removeAttribute('id');node.removeAttribute('for');node.removeAttribute('autofocus');
  });
  outgoing.setAttribute('aria-hidden','true');
  outgoing.inert=true;
  outgoing.classList.add('workspace-outgoing');
  return {outgoing,height:content.offsetHeight};
}

// Only sibling panels move. The page wrapper never translates with them.
function modules(content) {
  const candidates=[...content.querySelectorAll(moduleSelector)];
  const panels=candidates.filter(node=>!candidates.some(other=>other!==node&&other.contains(node)));
  for(const node of content.children||[]) {
    if(!panels.some(panel=>node===panel||node.contains(panel)))panels.push(node);
  }
  return panels.filter(node=>{
    if(!node.getBoundingClientRect)return true;
    const rect=node.getBoundingClientRect();
    return rect.height>0&&rect.bottom>-48&&rect.top<window.innerHeight+48;
  }).slice(0,12);
}

export function moduleTiming(node,index,entering) {
  const rhythm=[0,82,26,112,46,96];
  const lag=rhythm[index%rhythm.length];
  const weight=node.matches?.('.research-output,.publish-editor-column')?22:0;
  return {
    duration:(entering?workspaceTiming.enter:workspaceTiming.exit)+weight+(index%3)*10,
    delay:(entering?workspaceTiming.follow:0)+(entering?lag:Math.round(lag*.68)),
    easing:entering?workspaceTiming.ease:'cubic-bezier(.38,.08,.3,1)',
  };
}

export function transitionWorkspace(root, snapshot) {
  stopWorkspaceTransition(root);
  const stage=root.querySelector('.workspace-stage');
  const content=stage?.querySelector(':scope > .workspace-content');
  if (!stage || !content || !snapshot?.outgoing) return;
  const outgoing=snapshot.outgoing;
  const animations=[],pieces=[];
  let finished=false,context,timeline;
  const minHeight=stage.style.minHeight;
  const finish=()=>{
    if (finished) return;
    finished=true;
    context?.revert();
    timeline?.kill();
    animations.forEach(animation=>animation.cancel());
    pieces.forEach(node=>node.classList?.remove('workspace-motion-piece'));
    outgoing.remove();
    stage.classList.remove('is-transitioning');
    stage.style.minHeight=minHeight;
    running.delete(root);
  };
  running.set(root,finish);
  const distance=stage.clientWidth+64;
  stage.style.minHeight=`${Math.max(snapshot.height,content.offsetHeight)}px`;
  stage.classList.add('is-transitioning');
  stage.append(outgoing);
  const animate=(target,frames,options)=>{
    const animation=target.animate(frames,{easing:workspaceTiming.ease,fill:'both',...options});
    animations.push(animation);
  };
  try {
    // Gather geometry once, then create compositor-only animations in a batch.
    const groups=[[outgoing,false,modules(outgoing)],[content,true,modules(content)]];
    const gsap=window.gsap;
    if(gsap?.context && gsap?.timeline) {
      // One clock owns all pieces. Context restores inline styles on completion,
      // navigation, hidden tabs or reduced motion; no retained ticker or DOM copy.
      context=gsap.context(()=>{},stage);
      context.add(()=>{
        timeline=gsap.timeline({paused:true,defaults:{overwrite:'auto',force3D:true},onComplete:finish});
        for(const [layer,entering,nodes] of groups) {
          (nodes.length?nodes:[layer]).forEach((node,index)=>{
            const timing=moduleTiming(node,index,entering);
            pieces.push(node);node.classList?.add('workspace-motion-piece');
            timeline.fromTo(node,
              {x:entering?distance:0,opacity:entering ? 0.16 : 1},
              {x:entering?0:-distance,opacity:entering?1:0,
                duration:timing.duration/1000,ease:entering?'power3.out':'power2.in',immediateRender:true},
              timing.delay/1000);
          });
        }
      });
      timeline.play(0);
      return;
    }
    // Readable, dependency-free fallback if the local GSAP script is unavailable.
    for(const [layer,entering,nodes] of groups) {
      // Empty/simple views can still participate without a separate wrapper tween.
      const targets=nodes.length?nodes:[layer];
      targets.forEach((node,index)=>{
        pieces.push(node);
        node.classList?.add('workspace-motion-piece');
        animate(node,entering?[
          {transform:`translate3d(${distance}px,0,0)`,opacity:.12},
          {transform:'translate3d(0,0,0)',opacity:1},
        ]:[
          {transform:'translate3d(0,0,0)',opacity:1},
          {transform:`translate3d(${-distance}px,0,0)`,opacity:0},
        ],moduleTiming(node,index,entering));
      });
    }
    Promise.allSettled(animations.map(animation=>animation.finished)).then(finish);
  } catch { finish(); }
}
