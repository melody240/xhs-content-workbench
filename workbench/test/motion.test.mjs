import test from 'node:test';
import assert from 'node:assert/strict';
import {captureMotion,playMotion,stopMotion,splitCharacters} from '../public/motion.js';

function setup({reduce=false,view='research',open=false}={}) {
  const calls=[];
  const element={classList:{add(){},remove(){}},animate(frames,options){calls.push({frames,options});return {finished:Promise.resolve(),cancel(){}};}};
  globalThis.window={matchMedia:()=>({matches:reduce})};
  globalThis.document={hidden:false};
  globalThis.Element=class {};
  Element.prototype.animate=element.animate;
  const root={querySelector(selector){
    if(selector==='.layout')return {dataset:{view}};
    if(selector==='main')return element;
    if(selector==='.sidebar.open')return open?element:null;
    return null;
  }};
  return {calls,root};
}

test('polling and same-route refresh never replay page movement',()=>{
  const {calls,root}=setup();
  playMotion(root,{view:'research',menuOpen:false});
  assert.equal(calls.length,0);
});
test('page changes animate immediately without deferring the render',()=>{
  const {calls,root}=setup({view:'publish'});
  assert.equal(playMotion(root,{view:'research',menuOpen:false}),undefined);
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.duration,320);
  assert.equal(calls[0].frames.at(-1).transform,'translateX(0)');
});
test('reduced-motion suppresses JavaScript spatial animation',()=>{
  const {calls,root}=setup({reduce:true,view:'publish',open:true});
  playMotion(root,{view:'research',menuOpen:false});
  assert.equal(calls.length,0);
});
test('navigation drawer only moves when newly opened',()=>{
  const {calls,root}=setup({open:true});
  playMotion(root,{view:'research',menuOpen:true});
  assert.equal(calls.length,0);
  playMotion(root,{view:'research',menuOpen:false});
  assert.equal(calls.length,1);
});
test('missing animation support and initial boot leave content usable',()=>{
  const {calls,root}=setup();
  playMotion(root,captureMotion({querySelector:()=>null}));
  assert.equal(calls.length,0);
  delete Element.prototype.animate;
  assert.doesNotThrow(()=>playMotion(root,{view:'publish'}));
});

function titleScene({view='research',text='选题',reduce=false,results=[]}={}) {
  const animations=[], listeners=new Map(), media={matches:reduce,addEventListener(type,fn){listeners.set('media:'+type,fn);}};
  class Node {
    constructor(tag='span',text='') {this.tag=tag;this.nodes=[];this.value=text;this.attrs=new Map();this.dataset={};this.classes=new Set();this.classList={add:v=>this.classes.add(v),remove:v=>this.classes.delete(v)};this.rect={x:30,y:100,width:180,height:40};}
    get childNodes(){return this.nodes;}
    get children(){return this.nodes.filter(n=>n.tag!=='#text');}
    get textContent(){return this.nodes.length?this.nodes.map(n=>n.textContent).join(''):this.value;}
    set textContent(value){this.value=value;this.nodes=[];}
    append(...nodes){for(const n of nodes){if(n.tag==='#fragment')this.append(...n.nodes);else this.nodes.push(n);}}
    replaceChildren(...nodes){this.nodes=[];this.value='';this.append(...nodes);}
    getAttribute(key){return this.attrs.get(key)??null;}
    setAttribute(key,value){this.attrs.set(key,value);}
    removeAttribute(key){this.attrs.delete(key);}
    closest(selector){return selector==='.workspace-outgoing'?null:this.owner||null;}
    getClientRects(){return [this.rect];}
    getBoundingClientRect(){return this.rect;}
    remove(){this.removed=true;}
    animate(frames,options){let resolve,reject;const finished=new Promise((a,b)=>{resolve=a;reject=b;});const a={frames,options,target:this,finished,complete:resolve,cancel(){this.cancelled=true;reject(Error('cancelled'));}};animations.push(a);return a;}
  }
  globalThis.Element=Node;
  globalThis.window={innerHeight:900,matchMedia:()=>media};
  globalThis.document={hidden:false,createElement:tag=>new Node(tag),createTextNode:text=>new Node('#text',text),createDocumentFragment:()=>new Node('#fragment'),addEventListener:(type,fn)=>listeners.set(type,fn)};
  const title=new Node('h1');title.append(new Node('#text',text));
  const resultNodes=results.map(({id,text})=>{const n=new Node('h3');n.append(new Node('#text',text));n.owner=new Node('article');n.owner.dataset.motionKey=id;return n;});
  const main=new Node('main');main.querySelectorAll=()=>resultNodes;
  const root={querySelector(s){if(s==='.layout')return {dataset:{view}};if(s==='.page-head h1')return title;if(s==='main')return main;return null;},querySelectorAll:()=>resultNodes,addEventListener:(type,fn)=>listeners.set(type,fn)};
  return {root,title,resultNodes,animations,listeners,media,Node};
}

test('Chinese and combining emoji stay intact when splitting text',()=>{
  assert.deepEqual(splitCharacters('女性👨‍👩‍👧‍👦é'),['女','性','👨‍👩‍👧‍👦','é']);
});
test('split-title has one accessible name and restores the original nodes on completion',async()=>{
  const {root,title,animations}=titleScene();
  const original=title.childNodes[0];title.setAttribute('aria-label','原标签');
  playMotion(root,{});
  assert.equal(title.getAttribute('aria-label'),'选题');
  assert.equal(title.textContent,'选题');
  assert.equal(title.children.length,2);
  assert.ok(title.children.every(n=>n.getAttribute('aria-hidden')==='true'));
  assert.equal(animations.length,2);
  assert.ok(animations[1].options.delay>animations[0].options.delay);
  for(const a of animations)a.complete();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(title.childNodes[0],original);
  assert.equal(title.getAttribute('aria-label'),'原标签');
  assert.equal(title.children.length,0);
  assert.equal(title.classes.size,0);
});
test('render interruption cancels old animations and polling does not replay titles',()=>{
  const {root,title,animations}=titleScene({results:[{id:'one',text:'生活秩序'}]});
  playMotion(root,{});
  const snapshot=captureMotion(root);
  assert.ok(animations.every(a=>a.cancelled));
  assert.equal(title.children.length,0);
  assert.deepEqual(snapshot.titles,['one:生活秩序']);
  const before=animations.length;
  playMotion(root,snapshot);
  assert.equal(animations.length,before);
});
test('only new result identities reveal on the same route, without moving the page',()=>{
  const {root,animations}=titleScene({results:[{id:'old',text:'一样标题'},{id:'new',text:'一样标题'}]});
  playMotion(root,{view:'research',titles:['old:一样标题']});
  assert.equal(animations.length,4);
  assert.ok(animations.every(a=>a.options.duration>=200&&a.options.duration<=400));
  stopMotion(root);
});
test('long titles and nested interactive content are left unmodified',()=>{
  const {root,title,animations,Node}=titleScene({text:'字'.repeat(65)});
  playMotion(root,{});assert.equal(animations.length,0);
  title.replaceChildren(new Node('a','链接标题'));
  playMotion(root,{});assert.equal(animations.length,0);
});
test('offscreen result titles allocate no glyph animations',()=>{
  const {root,resultNodes,animations}=titleScene({results:[{id:'new',text:'结果'}]});
  resultNodes[0].rect.y=1500;
  playMotion(root,{view:'research',titles:[]});
  assert.equal(animations.length,0);
});
test('changing reduced-motion or hiding the page immediately restores text',()=>{
  const {root,title,animations,listeners}=titleScene();
  playMotion(root,{});
  listeners.get('media:change')({matches:true});
  assert.ok(animations.every(a=>a.cancelled));assert.equal(title.children.length,0);
  playMotion(root,{});
  document.hidden=true;listeners.get('visibilitychange')();
  assert.ok(animations.every(a=>a.cancelled));assert.equal(title.children.length,0);
});
test('reduced-motion at startup skips splitting and preserves exact text',()=>{
  const {root,title,animations}=titleScene({reduce:true});
  playMotion(root,{});
  assert.equal(animations.length,0);assert.equal(title.children.length,0);assert.equal(title.textContent,'选题');
});
test('failed per-character animation restores visible accessible text',()=>{
  const {root,title}=titleScene();
  const animate=Element.prototype.animate;
  Element.prototype.animate=function(){throw Error('unsupported');};
  assert.doesNotThrow(()=>playMotion(root,{}));
  assert.equal(title.children.length,0);assert.equal(title.textContent,'选题');assert.equal(title.getAttribute('aria-label'),null);
  Element.prototype.animate=animate;
});
test('primary press feedback is delegated once and ignores disabled controls',()=>{
  const {root,animations,listeners,Node}=titleScene();
  const press=new Node('button');press.disabled=true;
  playMotion(root,{view:'research',titles:[]});
  const handler=listeners.get('pointerdown');
  handler({button:0,target:{closest:()=>press}});
  assert.equal(animations.length,0);
  press.disabled=false;handler({button:0,target:{closest:()=>press}});
  assert.equal(animations.length,1);
  playMotion(root,{view:'research',titles:[]});
  assert.equal(listeners.get('pointerdown'),handler);
  stopMotion(root);assert.equal(animations[0].cancelled,true);
});
test('rapid navigation starts from the moving plate position instead of the destination button',()=>{
  const {root,Node}=titleScene();
  const button=new Node('button'),plate=new Node('span');
  button.rect.y=300;plate.rect.y=180;
  const query=root.querySelector;
  root.querySelector=s=>s==='.nav-item.active .motion-selection'?plate:s==='.nav-item.active'?button:query(s);
  assert.equal(captureMotion(root).nav.y,180);
});

test('photo selection responds once to actual checking and removes effects on interruption',()=>{
 const {root,Node,animations,listeners}=titleScene();
 const picture=new Node('button'),mark=new Node('span');picture.querySelector=()=>mark;
 const container={querySelector:()=>picture};
 const input={checked:true,matches:()=>true,closest:()=>container};
 playMotion(root,{view:'research',titles:[]});
 listeners.get('change')({target:input});
 assert.equal(animations.length,2);assert.equal(picture.childNodes.length,1);
 stopMotion(root);assert.equal(picture.childNodes[0].removed,true);
 input.checked=false;listeners.get('change')({target:input});assert.equal(animations.length,2);
});
test('task effects pause outside the viewport and observer references do not accumulate on redraw',t=>{
 const {root,Node}=titleScene();const old=globalThis.IntersectionObserver;
 t.after(()=>{globalThis.IntersectionObserver=old;});
 let report,observes=0,unobserves=0;
 globalThis.IntersectionObserver=class{constructor(fn){report=fn;}observe(){observes++;}unobserve(){unobserves++;}};
 let panel=new Node();panel.toggleAttribute=(name,on)=>on?panel.setAttribute(name,''):panel.removeAttribute(name);
 const query=root.querySelectorAll;root.querySelectorAll=s=>s==='.task-feedback'?[panel]:query(s);
 playMotion(root,{view:'research',titles:[]});report([{target:panel,isIntersecting:false}]);
 assert.equal(panel.getAttribute('data-task-offscreen'),'');
 report([{target:panel,isIntersecting:true}]);assert.equal(panel.getAttribute('data-task-offscreen'),null);
 playMotion(root,{view:'research',titles:[]});assert.equal(observes,2);assert.equal(unobserves,1);
});
