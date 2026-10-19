import test from 'node:test';
import {PNG} from 'pngjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {QuoteCards,quoteAuthor,quoteVariants} from '../integrations/quote-cards.mjs';
import {quoteLines,quoteGeometry,randomQuoteMetrics,quoteCount,normalizeQuoteMetrics} from '../public/quote-card-layout.js';
const item={author:'Avery Lane\n@averylane\n·\n1小时',avatar:'https://pbs.twimg.com/profile_images/123/avatar.jpg'};
test('avatar provenance restricts downloads to actual X image hosts and English display names',()=>{
 assert.equal(quoteAuthor(item).handle,'@averylane');
 for(const avatar of ['http://pbs.twimg.com/profile_images/123/a.jpg','https://localhost/profile_images/a.jpg','https://pbs.twimg.com.evil.test/profile_images/a.jpg','https://u:p@pbs.twimg.com/profile_images/a.jpg','https://pbs.twimg.com/media/a.jpg'])assert.equal(quoteAuthor({...item,avatar}),null);
 assert.equal(quoteAuthor({...item,author:'只有中文\n@test'}),null);
});
test('short philosophical variants have no 100-character floor and remain distinct',async()=>{
 let messages;const q=new QuoteCards('/unused',{model:{async complete(m){messages=m;return {content:JSON.stringify({variants:['自由不是答案，是承担选择的能力。','你无法拥有每条路，但能决定走哪条。','自由不是答案，是承担选择的能力。']})};}}});
 const r=await q.generate({topic:'自由'});assert.equal(r.variants.length,2);assert.ok(r.variants.every(v=>v.length<100));assert.match(messages[0].content,/哲学|思考/);assert.match(messages[0].content,/不冒用名人署名/);assert.equal(q.writing,false);
 assert.throws(()=>quoteVariants('{}'),/可用文案/);
});
test('a model failure releases the generation lock and concurrent calls cannot overlap',async()=>{
 let reject;const q=new QuoteCards('/unused',{model:{complete:()=>new Promise((_,r)=>{reject=r;})}});
 const pending=q.generate({topic:'边界'});await assert.rejects(q.generate({topic:'其他'}),/正在生成/);reject(Error('test failure'));await assert.rejects(pending,/test failure/);assert.equal(q.writing,false);
});
test('local avatar copies deduplicate identities and survive restart without external URLs in UI',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'xhs-quote-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let calls=0;
 const q=new QuoteCards(dir,{seedDirectory:null,fetcher:async(url,opt)=>{calls++;assert.equal(opt.redirect,'error');return new Response(PNG.sync.write(new PNG({width:8,height:8})),{headers:{'Content-Type':'image/png'}});}});await q.init();assert.equal(await q.add([item,item]),1);assert.equal(await q.add([item]),0);assert.equal(calls,1);
 const reloaded=new QuoteCards(dir,{seedDirectory:null,});await reloaded.init();assert.equal(reloaded.public().authors.length,1);assert.match(reloaded.public().authors[0].avatarURL,/^\/api\/quote-cards\/avatar\//);
});
test('collection reports actual completed copies and preserves partial work on a browser error',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'xhs-quote-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const q=new QuoteCards(dir,{seedDirectory:null,fetcher:async()=>new Response(PNG.sync.write(new PNG({width:8,height:8})),{headers:{'Content-Type':'image/png'}}),scan:async()=>{await q.add([item]);throw Error('请本人完成验证');}});await q.init();q.collect({target:300});assert.throws(()=>q.collect(),/仍在进行/);
 for(let i=0;i<50&&q.active;i++)await new Promise(r=>setTimeout(r,10));assert.equal(q.result.count,1);assert.match(q.result.error,/验证/);assert.equal(q.public().authors.length,1);
});
test('native-size exports follow content height without a backboard; uniform scaling preserves all template proportions',()=>{
 for(const text of ['一句话','完整文字。'.repeat(100)]){
  const lines=quoteLines(text,t=>Array.from(t).length*32);assert.equal(lines.join(''),text);
  const full=quoteGeometry(lines),half=quoteGeometry(lines,{zoom:50});assert.equal(half.scale,full.scale*.5);assert.equal(full.width,1080);assert.equal(full.outputHeight,full.height);assert.equal(full.x,0);assert.equal(full.y,0);assert.equal(half.width,540);assert.equal(half.outputHeight,Math.ceil(full.height/2));
  assert.equal(full.iconsY-full.lineY,half.iconsY-half.lineY);
 }
 const m=randomQuoteMetrics(()=>.5);assert.ok(m.views>m.likes&&m.bookmarks<m.likes);assert.ok(m.likes>10000);
});

test('browser avatar reads are limited to public X images and explicitly omit credentials',async()=>{
 const {default:vm}=await import('node:vm');const code=await fs.readFile(new URL('../integrations/source-capture-extension.js',import.meta.url),'utf8'),helper=code.slice(code.indexOf('async function wbQuoteAvatarBytes('),code.indexOf('function wbSourceDOM('));
 const calls=[],bytes=PNG.sync.write(new PNG({width:8,height:8}));const sandbox={URL,AbortSignal,Uint8Array,btoa:s=>Buffer.from(s,'binary').toString('base64'),fetch:async(url,opts)=>{calls.push({url,opts});return new Response(bytes,{headers:{'Content-Type':'image/png'}});}};
 vm.runInNewContext(helper+';globalThis.read=wbQuoteAvatarBytes;',sandbox);
 const result=await sandbox.read([{...item},{...item,avatar:'https://private.example/profile_images/a.png'},{...item,avatar:'https://pbs.twimg.com/media/photo.png'}]);
 assert.equal(calls.length,1);assert.equal(calls[0].opts.credentials,'omit');assert.equal(calls[0].opts.redirect,'error');assert.ok(result[0].avatarData.startsWith('data:image/png;base64,'));assert.equal(result[1].avatarData,undefined);
});

test('engagement conversions are related to views, counts compact consistently, and hand edits keep views valid',()=>{
 for(let i=0;i<500;i++){const m=randomQuoteMetrics();assert.ok(m.views>=150000&&m.views<=6000000);assert.ok(m.likes/m.views>=.039&&m.likes/m.views<=.161);for(const k of ['comments','reposts','bookmarks'])assert.ok(m[k]>=0&&m[k]<m.likes);}
 assert.equal(quoteCount(10000),'1.0万');assert.equal(quoteCount(14346),'1.4万');assert.equal(quoteCount(9999),'9,999');
 assert.equal(normalizeQuoteMetrics({views:4,likes:24000,comments:-1}).views,24000);assert.equal(normalizeQuoteMetrics({comments:-1}).comments,0);
});

 test('a clean installation and the old empty author registry get offline seed assets without network or private data',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'xhs-quote-seed-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 for(const empty of [false,true]){
  if(empty)await fs.writeFile(path.join(dir,'quote-authors/authors.json'),'[]');
  const q=new QuoteCards(dir,{fetcher:()=>{throw Error('Must work offline');}});await q.init();assert.equal(q.public().authors.length,359);
  for(const a of q.authors){assert.equal(a.bundled,true);assert.ok((await fs.stat(path.join(q.directory,a.file))).size>100);assert.equal(a.sourceAssetId,undefined);assert.match(a.sourceURL,/^https:\/\/x.com\//);}
 }
 const again=new QuoteCards(dir,{});await again.init();assert.equal(again.authors.length,359);
});


test('full bundled pool upgrades an old registry without overwriting custom name or hidden state',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'xhs-public-seed-upgrade-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const q=new QuoteCards(dir,{});await q.init();
 const custom={...q.authors[0],name:'My Custom Name',hidden:true};
 q.authors=[custom];await q.persist();
 const upgraded=new QuoteCards(dir,{});await upgraded.init();
 assert.equal(upgraded.authors.length,359);assert.equal(upgraded.authors[0].name,'My Custom Name');assert.equal(upgraded.authors[0].hidden,true);
 const restarted=new QuoteCards(dir,{});await restarted.init();assert.equal(restarted.authors.length,359);
});
