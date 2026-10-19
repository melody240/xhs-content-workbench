import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {diandianContext} from '../integrations/diandian.mjs';
import {cliArguments} from '../integrations/skills-catalog.mjs';

test('Rendered pointpoint extraction waits for stability, binds keyword and degrades without invented data',()=>{
 const cwd=fileURLToPath(new URL('..',import.meta.url));
 execFileSync(process.env.WORKBENCH_PYTHON || cwd+'/vendor/xiaohongshu-skills/.venv/'+(process.platform==='win32'?'Scripts/python.exe':'bin/python'),['test/diandian.py'],{cwd,timeout:10000});
});
test('Pointpoint reference is provenance-labelled and cannot represent a different query or a fake page',()=>{
 const raw={status:'ready',keyword:'习惯',content:'真实网页总结',url:'https://www.xiaohongshu.com/search_result_ai?keyword=%25E4%25B9%25A0%25E6%2583%25AF',platformNoteCount:83};
 assert.equal(diandianContext(raw,'习惯').kind,'platform_ai_summary');
 assert.equal(diandianContext({...raw,keyword:'减肥'},'习惯'),null);
 assert.equal(diandianContext({...raw,url:'https://evil.test/?keyword=习惯'},'习惯'),null);
 assert.equal(diandianContext({...raw,status:'loading'},'习惯'),null);
 assert.equal(diandianContext({...raw,url:'https://www.xiaohongshu.com/search_result_ai?keyword=减肥'},'习惯'),null);
 assert.ok(cliArguments('search-feeds',{keyword:'习惯',diandian:true,listOnly:true}).args.includes('--diandian'));
});
test('The real DOM extractor requires the finished conversation footer, not a pause in streaming',async()=>{
 const python=await fs.readFile(new URL('../integrations/diandian.py',import.meta.url),'utf8');
 const script=python.match(/SUMMARY_DOM = r"""([\s\S]*?)"""/)[1];
 let finished=false,busy=false;
 const rendered={getClientRects:()=>[{}],getAttribute:()=>''};
 const label={...rendered,innerText:'ai总结83篇笔记生成',children:[],querySelector:()=>null};
 const controls=()=>[...(finished?[{...rendered,innerText:'继续与点点对话'}]:[]),...(busy?[{...rendered,innerText:'停止生成'}]:[])];
 const panel={querySelector:()=>null,querySelectorAll:()=>controls()};
 const area={...rendered,innerText:'ai总结83篇笔记生成\n真正的观点正文，长度足够超过标记三十个字，需要在平台完成总结后读取。',querySelector:s=>s==='h1,h2,h3,h4,p,li'?{}:null,querySelectorAll:()=>[],parentElement:panel};
 label.parentElement=area;
 const context={document:{querySelectorAll:()=>[label],body:{}},getComputedStyle:()=>({visibility:'visible'}),location:{href:'https://www.xiaohongshu.com/search_result_ai?keyword=习惯'}};
 assert.equal(vm.runInNewContext(script,context).status,'loading');
 finished=true;assert.equal(vm.runInNewContext(script,context).status,'candidate');
 busy=true;assert.equal(vm.runInNewContext(script,context).status,'loading');
});
