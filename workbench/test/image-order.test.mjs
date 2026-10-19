import test from 'node:test';
import assert from 'node:assert/strict';
import {reorderAssets} from '../public/image-order.js';
test('拖动排序移动完整素材对象，封面跟随第一张，不交换其他图片的相对顺序',()=>{
 const assets=['a','b','c','d'].map(id=>({id,path:'/original/'+id}));
 const result=reorderAssets(assets,'d','a');assert.deepEqual(result.map(a=>a.id),['d','a','b','c']);assert.equal(result[0],assets[3]);assert.equal(result[0].path,'/original/d');assert.deepEqual(assets.map(a=>a.id),['a','b','c','d']);
 assert.deepEqual(reorderAssets(assets,'a','c').map(a=>a.id),['b','c','a','d']);
 assert.equal(reorderAssets(assets,'unknown','a'),assets);assert.equal(reorderAssets(assets,'a','a'),assets);
});

import {bindImageOrder} from '../public/image-order.js';
test('原生拖动在放下后才保存顺序，取消拖动恢复当前顺序，外来拖动不修改笔记',()=>{
 const oldCSS=globalThis.CSS,oldDoc=globalThis.document;globalThis.CSS={escape:s=>s};globalThis.document={querySelector:()=>null};
 try{
 const classes=()=>({add(){},remove(){}}),items=['a','b','c'].map(id=>({dataset:{assetOrder:id},classList:classes(),querySelector:()=>({focus(){}}),closest(){return this;}}));
 const events={},list={querySelector:s=>items.find(i=>s.includes('"'+i.dataset.assetOrder+'"')),querySelectorAll:()=>items,addEventListener:(name,fn)=>events[name]=fn,append:item=>{items.splice(items.indexOf(item),1);items.push(item);}};
 const root={querySelector:()=>list};let assets=['a','b','c'].map(id=>({id})),saved=0;bindImageOrder(root,{getAssets:()=>assets,onReorder:next=>{assets=next;saved++;}});
 const event=item=>({target:item,preventDefault(){},dataTransfer:{setData(){}}});
 events.drop(event(items[1]));assert.equal(saved,0);
 events.dragstart(event(items[0]));events.dragover(event(items[2]));assert.deepEqual(items.map(i=>i.dataset.assetOrder),['b','c','a']);assert.equal(saved,0);events.drop(event(items[0]));assert.equal(saved,1);assert.deepEqual(assets.map(a=>a.id),['b','c','a']);
 events.dragstart(event(items[0]));events.dragover(event(items[2]));events.dragend();assert.deepEqual(items.map(i=>i.dataset.assetOrder),assets.map(a=>a.id));assert.equal(saved,1);
 }finally{globalThis.CSS=oldCSS;globalThis.document=oldDoc;}
});
