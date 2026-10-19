import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs/promises';
const source=(await fs.readFile(new URL('../public/cover.js',import.meta.url),'utf8')).replace('export async function','async function');
test('封面等比例放入 4:3 画布，已有 4:3 不重新编码，不裁切或修改内图',async()=>{
 const calls=[];let size={w:360,h:800};const canvas={getContext:()=>({fillRect:(...args)=>calls.push(['background',...args]),drawImage:(...args)=>calls.push(['draw',...args.slice(1)])}),toBlob:cb=>cb({type:'image/png'})};
 const ctx=vm.createContext({Image:class{constructor(){this.naturalWidth=size.w;this.naturalHeight=size.h;}async decode(){}},document:{createElement:tag=>{assert.equal(tag,'canvas');return canvas;}}});vm.runInContext(source,ctx);const out=await ctx.coverBlob('/local.png');assert.equal(out.type,'image/png');assert.equal(canvas.width,1600);assert.equal(canvas.height,1200);assert.deepEqual(calls[1],['draw',530,0,540,1200]);
 size={w:800,h:600};assert.equal(await ctx.coverBlob('/local.png'),null);assert.equal(calls.length,2);
});

test('发布预览沿用原图路径，不自动调用白底封面转换或重新上传',async()=>{
 const app=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8'),review=app.slice(app.indexOf('let preparingReview=false;'),app.indexOf('function confirmAction('));
 const original={id:'original',url:'/media/original.png',path:'/local/original.png'},composer={mode:'image',assets:[original],autoCommentsEnabled:false};let dialog;
 const ctx=vm.createContext({composer,busy:false,publishArgs:()=>({title:'原图发布',content:'正文',tags:[],visibility:'公开可见',images:composer.assets.map(a=>a.path)}),fitCover:()=>{throw Error('不允许隐式处理封面');},fetch:()=>{throw Error('不允许隐式上传');},esc:String,assetURL:s=>s,accountName:()=> '测试账号',showDialog:(...args)=>{dialog=args;},toast:e=>{throw Error(e);}});
 vm.runInContext(review,ctx);await ctx.reviewPublish();assert.ok(dialog);assert.match(dialog[1],/\/media\/original.png/);assert.equal(composer.assets[0],original);assert.equal(composer.assets[0].path,'/local/original.png');
});
