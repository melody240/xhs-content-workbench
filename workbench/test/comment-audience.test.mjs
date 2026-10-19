import test from 'node:test';
import assert from 'node:assert/strict';
import {screenCommentAudience} from '../integrations/comment-audience.mjs';
import {DEFAULT_AUDIENCE,resolveAudience} from '../public/audience-options.js';
const candidates=[
 {source:{id:'D1',title:'女性成长'},comment:{id:'1',content:'退休后女人就该替儿子家带孩子'},likes:30000},
 {source:{id:'D2',title:'独立与育儿'},comment:{id:'2',content:'当了妈妈也要有自己的工作和存款'},likes:9000},
 {source:{id:'D3',title:'关系边界'},comment:{id:'3',content:'解释可以，但我不再为拒绝反复道歉'},likes:4000}
];
const model=rows=>({public:()=>({verifiedAt:'test'}),complete:async messages=>{const payload=JSON.parse(messages[1].content);assert.equal(payload.audience,DEFAULT_AUDIENCE);assert.match(messages[0].content,/年轻妈妈/);assert.match(messages[0].content,/昵称或头像/);return {content:JSON.stringify({items:rows}),usage:{totalTokens:5}};}});
test('Young adult profile is the shared default; supplied interests remain available',()=>{
 assert.equal(resolveAudience('  '),DEFAULT_AUDIENCE);assert.equal(resolveAudience(),DEFAULT_AUDIENCE);assert.equal(resolveAudience('初入职场的女性'),'初入职场的女性');
});
test('Theme relevance precedes screenshot selection; younger mothers remain and likes retain their ordering',async()=>{
 const m=model([{id:'C2',keep:true,confidence:.98,reason:'关系边界'},{id:'C0',keep:false,confidence:.96,reason:'退休与长辈义务立意'},{id:'C1',keep:true,confidence:.94,reason:'年轻妈妈经济独立'}]);
 const result=await screenCommentAudience(candidates,{model:m,topic:'女性成长'});
 assert.deepEqual(result.candidates.map(c=>c.likes),[9000,4000]);assert.equal(result.review.excluded,1);assert.equal(result.review.mode,'model');
});
test('Rejected comments stay excluded even at low confidence; invalid output retains the manual review fallback',async()=>{
 const result=await screenCommentAudience(candidates.slice(0,1),{model:model([{id:'C0',keep:false,confidence:.6,reason:'语境不确定'}])});assert.equal(result.candidates.length,0);
 for(const rows of [[],[{id:'invented',keep:true,confidence:1,reason:'未知ID'}]]){
  const fallback=await screenCommentAudience(candidates,{model:model(rows)});assert.equal(fallback.review.mode,'rules');assert.equal(fallback.candidates.length,3);assert.ok(fallback.review.error);assert.equal(fallback.review.decisions,undefined);
 }
});
test('Model failure or no model does not gate screenshot collection; explicit promotion is removed',async()=>{
 const pool=[...candidates,{source:{id:'D4'},comment:{content:'立即领取优惠券下单立减'},likes:99999}];
 const result=await screenCommentAudience(pool,{});assert.equal(result.candidates.length,3);assert.equal(result.review.excluded,1);
 const broken={public:()=>({verifiedAt:'test'}),complete:async()=>{throw Error('模拟模型不可用');}};
 const fallback=await screenCommentAudience(candidates,{model:broken});assert.equal(fallback.candidates.length,3);assert.match(fallback.review.error,/不可用/);
 const controller=new AbortController();controller.abort(Error('用户停止'));await assert.rejects(screenCommentAudience(candidates,{model:broken,signal:controller.signal}),/用户停止/);
});

test('Automatic selection uses the actual article, rejects unreadable high-like replies, and does not attach unchecked fallback material',async()=>{
 let seen;const m={public:()=>({verifiedAt:'yes'}),complete:async messages=>{seen=JSON.parse(messages[1].content);return {content:JSON.stringify({items:[{id:'C0',keep:false,confidence:.6,reason:'与本篇聚会拒绝无关'},{id:'C1',keep:false,confidence:.95,reason:'育儿与本篇无关'},{id:'C2',keep:true,confidence:.95,reason:'可以拒绝'}]})};}};
 const context={title:'不想去的聚会可以拒绝',content:'不用为合群勉强自己。'};const r=await screenCommentAudience(candidates,{model:m,context});assert.deepEqual(seen.context,context);assert.deepEqual(r.candidates.map(c=>c.comment.id),['3']);
 assert.equal((await screenCommentAudience(candidates,{context})).candidates.length,0);
});
