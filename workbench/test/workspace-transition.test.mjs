import test from 'node:test';
import assert from 'node:assert/strict';
import {captureWorkspace,transitionWorkspace,stopWorkspaceTransition,moduleTiming} from '../public/workspace-transition.js';
function environment(reduce=false) {
 globalThis.window={matchMedia:()=>({matches:reduce})};globalThis.document={hidden:false};globalThis.Element=class {};Element.prototype.animate=()=>{};
}
test('refreshes, system routes and reduced motion never clone the outgoing page',()=>{
 environment();let queries=0;const root={querySelector(){queries++;throw Error('unexpected clone');}};
 assert.equal(captureWorkspace(root,'publish','publish'),null);assert.equal(captureWorkspace(root,'publish','settings'),null);
 environment(true);assert.equal(captureWorkspace(root,'publish','research'),null);assert.equal(queries,0);
});
test('outgoing copy retains edited form values and cannot receive focus',()=>{
 environment();const attrs=new Set(['id','for','autofocus']),original=[{value:'刚编辑的正文'},{value:'private',checked:true}],copies=[{value:'旧正文'},{value:'public',checked:false}];
 const outgoing={querySelectorAll:s=>s==='input,textarea,select'?copies:[{removeAttribute:k=>attrs.delete(k)}],setAttribute(k,v){this[k]=v;},classList:{add(){}}};
 const content={offsetHeight:600,cloneNode:()=>outgoing,querySelectorAll:()=>original};
 assert.equal(captureWorkspace({querySelector:()=>content},'publish','research').height,600);assert.deepEqual(copies,original);assert.equal(outgoing.inert,true);assert.equal(outgoing['aria-hidden'],'true');assert.equal(attrs.size,0);
});
function scene() {
 environment();const animations=[],classes=new Set();
 const animate=function(frames,options){let done;const a={frames,options,target:this,finished:new Promise(r=>done=r),complete:()=>done(),cancel(){this.cancelled=true;}};animations.push(a);return a;};
 const nested={animate,contains:()=>false},panel={animate,contains:n=>n===nested};
 const content={offsetHeight:400,querySelectorAll:()=>[panel,nested],animate},outgoing={querySelectorAll:()=>[],animate,remove(){this.removed=true;}};
 const stage={clientWidth:800,style:{minHeight:''},classList:{add:v=>classes.add(v),remove:v=>classes.delete(v)},querySelector:()=>content,append(){}};
 return {root:{querySelector:()=>stage},snapshot:{outgoing,height:700},stage,outgoing,content,panel,animations,classes};
}
test('content travels beyond full width and nested panels are not staggered twice',async()=>{
 const {root,snapshot,stage,outgoing,content,panel,animations,classes}=scene();transitionWorkspace(root,snapshot);
 assert.equal(stage.style.minHeight,'700px');assert.equal(animations.filter(a=>a.target===panel).length,1);
 const exit=animations.find(a=>a.target===outgoing),entry=animations.find(a=>a.target===panel);
 assert.equal(exit.frames.at(-1).transform,'translate3d(-864px,0,0)');assert.equal(exit.frames.at(-1).opacity,0);assert.equal(entry.frames[0].transform,'translate3d(864px,0,0)');assert.ok(entry.options.delay>0);assert.ok(entry.options.duration<800);assert.ok(!animations.some(a=>a.target===content));
 animations.forEach(a=>a.complete());await new Promise(r=>setImmediate(r));assert.equal(outgoing.removed,true);assert.equal(stage.style.minHeight,'');assert.equal(classes.size,0);
});
test('interruption cancels every animation and restores normal flow',()=>{
 const {root,snapshot,stage,outgoing,animations,classes}=scene();transitionWorkspace(root,snapshot);stopWorkspaceTransition(root);stopWorkspaceTransition(root);
 assert.ok(animations.every(a=>a.cancelled));assert.equal(outgoing.removed,true);assert.equal(stage.style.minHeight,'');assert.equal(classes.size,0);
});
test('animation failure leaves the editor visible and cleans up its temporary layer',()=>{
 const {root,snapshot,stage,outgoing,panel,classes}=scene();panel.animate=()=>{throw Error('unavailable');};assert.doesNotThrow(()=>transitionWorkspace(root,snapshot));assert.equal(outgoing.removed,true);assert.equal(stage.style.minHeight,'');assert.equal(classes.size,0);
});

test('sibling modules have different starts and duration with a bounded settling tail',()=>{
 const left=moduleTiming({matches:()=>false},0,true),right=moduleTiming({matches:()=>true},1,true),third=moduleTiming({matches:()=>false},2,true);
 assert.ok(right.delay>left.delay+70);assert.ok(right.duration>left.duration);assert.ok(third.delay<right.delay);
 assert.ok(Math.max(...[left,right,third].map(t=>t.delay+t.duration))<850);
});


function gsapScene(){
 const sceneValue=scene(),calls=[];let options,reverted=0,killed=0;
 const timeline={fromTo(target,from,to,position){calls.push({target,from,to,position});return this;},play(){this.played=true;return this;},kill(){killed++;}};
 window.gsap={context(fn){fn();return {add(fn){fn();},revert(){reverted++;}};},timeline(config){options=config;return timeline;}};
 return {...sceneValue,calls,timeline,complete:()=>options.onComplete(),cleaned:()=>({reverted,killed})};
}
test('GSAP uses one paused timeline with independent module positions and a faster exit',()=>{
 const s=gsapScene();transitionWorkspace(s.root,s.snapshot);
 assert.equal(s.timeline.played,true);assert.equal(s.animations.length,0);
 const exit=s.calls.find(c=>c.target===s.outgoing),entry=s.calls.find(c=>c.target===s.panel);
 assert.equal(exit.to.x,-864);assert.equal(entry.from.x,864);assert.equal(entry.to.x,0);
 assert.equal(exit.to.ease,'power2.in');assert.equal(entry.to.ease,'power3.out');assert.ok(exit.to.duration<entry.to.duration);assert.ok(entry.position>exit.position);
 s.complete();assert.equal(s.outgoing.removed,true);assert.equal(s.stage.style.minHeight,'');assert.deepEqual(s.cleaned(),{reverted:1,killed:1});
});
test('interrupting GSAP reverts styles once and leaves no outgoing or animated layer',()=>{
 const s=gsapScene();transitionWorkspace(s.root,s.snapshot);stopWorkspaceTransition(s.root);stopWorkspaceTransition(s.root);s.complete();
 assert.deepEqual(s.cleaned(),{reverted:1,killed:1});assert.equal(s.outgoing.removed,true);assert.equal(s.classes.size,0);assert.equal(s.stage.style.minHeight,'');
});
test('a failed GSAP setup restores the readable page and discards its snapshot',()=>{
 const s=gsapScene();window.gsap.timeline=()=>{throw Error('synthetic timeline failure');};
 assert.doesNotThrow(()=>transitionWorkspace(s.root,s.snapshot));assert.equal(s.outgoing.removed,true);assert.equal(s.stage.style.minHeight,'');assert.equal(s.classes.size,0);
});

test('a partially built GSAP timeline is still owned by its context and fully reverted',()=>{
 const s=gsapScene(),append=s.timeline.fromTo.bind(s.timeline);let count=0;
 s.timeline.fromTo=(...args)=>{if(++count===2)throw Error('synthetic partial setup');return append(...args);};
 assert.doesNotThrow(()=>transitionWorkspace(s.root,s.snapshot));assert.deepEqual(s.cleaned(),{reverted:1,killed:1});assert.equal(s.outgoing.removed,true);assert.equal(s.classes.size,0);
});
