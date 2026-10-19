import test from 'node:test';
import assert from 'node:assert/strict';
import {materialAssets,pickMaterialAssets,setMaterialArchived} from '../integrations/material-assets.mjs';
import {filterMaterials,materialRoute} from '../public/material-query.js';
import {normalizeRoute,renderSectionTabs} from '../public/workspace-shell.js';
const asset=id=>({id,name:id+'.png',mime:'image/png',url:'/media/'+id+'.png',path:'/uploads/'+id+'.png',accountId:'a'});
function fixture(){
 const assets=Object.fromEntries(['x','dy','xhs','local','original-x','original-dy','diagnostic'].map(id=>[id,asset(id)]));assets.diagnostic.name='evidenceAfter.png';
 return {id:'a',state:{assets,drafts:[{id:'draft',assets:[assets.dy,assets.x]}],submissions:{s:{evidence:{screenshots:[assets.diagnostic.url]}}},materialLibrary:{images:[{id:'old-x-id',asset:assets.x,originalAsset:assets['original-x'],platform:'x',capturedAt:'2026-10-12'}]},commentCaptures:[{id:'old-dy-id',asset:assets.dy,originalAsset:assets['original-dy'],platform:'抖音',jobId:'job',observedLikes:1809,capturedAt:'2026-10-13'}, {id:'old-xhs-id',asset:assets.xhs,originalAsset:assets.xhs,platform:'小红书',jobId:'job',recordedLikes:10,capturedAt:'2026-10-13'}, {id:'second-reference',asset:assets.dy,originalAsset:assets['original-dy'],platform:'抖音',jobId:'another',capturedAt:'2026-10-13'}]}};
}
test('One asset view combines all platforms with stable IDs and job associations, excluding evidence and duplicate files',()=>{
 const a=fixture(),before=JSON.stringify(a),all=materialAssets(a);
 assert.deepEqual(new Set(all.map(r=>r.id)),new Set(['x','dy','xhs','local']));assert.equal(JSON.stringify(a),before);
 assert.deepEqual(new Set(all.find(r=>r.id==='dy').jobIds),new Set(['job','another']));assert.equal(all.find(r=>r.id==='dy').likes,1809);
 assert.equal(filterMaterials(all,{category:'douyin-comments'}).length,1);assert.equal(filterMaterials(all,{jobId:'job'}).length,2);assert.equal(filterMaterials(all).length,4);
 assert.deepEqual(pickMaterialAssets(a,['old-dy-id','dy','old-x-id']).map(a=>a.id),['dy','x']);
 assert.throws(()=>pickMaterialAssets({id:'b',state:{assets:{}}},['dy']),/当前账号/);
});
test('Unified soft deletion and restore leave draft order, original files and evidence references intact',()=>{
 const a=fixture(),draft=JSON.stringify(a.state.drafts),evidence=JSON.stringify(a.state.submissions),assets=JSON.stringify(a.state.assets);
 setMaterialArchived(a,'old-dy-id');assert.equal(filterMaterials(materialAssets(a)).length,3);assert.equal(filterMaterials(materialAssets(a),{deleted:true})[0].id,'dy');assert.throws(()=>pickMaterialAssets(a,['dy']),/已删除/);
 assert.equal(JSON.stringify(a.state.drafts),draft);assert.equal(JSON.stringify(a.state.submissions),evidence);assert.equal(JSON.stringify(a.state.assets),assets);
 setMaterialArchived(a,'dy',false);assert.equal(filterMaterials(materialAssets(a)).length,4);assert.equal(pickMaterialAssets(a,['old-dy-id'])[0].id,'dy');
});
test('Legacy collection routes resolve to publication panels and never impersonate the research tab',()=>{
 for(const route of ['comments','updates','sources']){assert.equal(normalizeRoute(route),'publish');assert.deepEqual(materialRoute(route),{view:'publish',panel:route});}
 assert.deepEqual(materialRoute('materials'),{view:'publish',panel:null});assert.deepEqual(materialRoute('research'),{view:'research',panel:null});
 const tabs=renderSectionTabs(normalizeRoute('comments'),String);assert.match(tabs,/class="section-tab active" data-nav="publish"/);assert.doesNotMatch(tabs,/class="section-tab active" data-nav="research"/);
});

test('A prepared article shows only its explicit assets; no matches means empty, never all history',()=>{
 const all=[{id:'right',category:'xhs-comments',jobIds:['same-job']},{id:'wrong',category:'douyin-comments',jobIds:['same-job']}];
 assert.deepEqual(filterMaterials(all,{assetIds:['right']}).map(r=>r.id),['right']);assert.equal(filterMaterials(all,{assetIds:[]}).length,0);assert.equal(filterMaterials(all,{assetIds:null}).length,2);
});
