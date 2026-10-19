import test from 'node:test';
import assert from 'node:assert/strict';
import {enqueueComments,resumeComments,commentNoteLink,PostComments} from '../integrations/post-comments.mjs';
const setup=()=>{const a={id:'a',identity:{userId:'owner',redId:'red'},state:{}};const j=enqueueComments(a,{key:'key',title:'笔记标题',content:'本篇正文',comments:['第一条补充','第二条补充']});j.status='cancelled';return {a,j};};
const url='https://www.xiaohongshu.com/discovery/item/6ac50af9000000001901d000?xsec_token=visible-link-token';
test('手动发布后的取消任务可以恢复，指定链接归一化，实际作者正文仍由浏览器核实',async()=>{
 const {a,j}=setup();resumeComments(a,{id:j.id,url,confirmed:true});assert.equal(j.status,'waiting_note');assert.match(j.note.url,/\/explore\/6ac50/);
 const calls=[];const skills={operation:async(a,label,fn)=>fn('session'),call:async(method,p)=>{calls.push({method,p});return {status:'verified',sendClicked:true,url:p.url,visibleText:p.text};}};
 await new PostComments({skills,persist:async()=>{}}).process(a,j);assert.equal(j.status,'completed');assert.equal(calls.length,2);assert.equal(calls[0].p.userId,'owner');assert.equal(calls[0].p.body,'本篇正文');
});
test('结果不明、账号变化、未确认和跨账号任务不能恢复发送',()=>{
 const {a,j}=setup();assert.throws(()=>resumeComments(a,{id:j.id}),/核对/);assert.throws(()=>resumeComments(a,{id:'other',confirmed:true}),/当前账号/);
 j.comments[0].status='uncertain';assert.throws(()=>resumeComments(a,{id:j.id,confirmed:true}),/不明/);j.comments[0].status='pending';a.identity.userId='other';assert.throws(()=>resumeComments(a,{id:j.id,confirmed:true}),/账号/);
 for(const bad of ['https://www.xiaohongshu.com.evil.test/explore/6ac50af9000000001901d000','http://www.xiaohongshu.com/explore/6ac50af9000000001901d000','https://www.xiaohongshu.com/user/profile/owner','https://user:pass@www.xiaohongshu.com/explore/6ac50af9000000001901d000'])assert.throws(()=>commentNoteLink(bad));
});
test('同篇任务合并已核实评论，发送结果不明的兄弟任务阻止再次发送',()=>{
 const {a,j}=setup(),old=structuredClone(j);old.id='older';old.status='completed';old.comments[0].status='verified';a.state.postCommentJobs.push(old);resumeComments(a,{id:j.id,confirmed:true});assert.equal(j.comments[0].status,'verified');assert.equal(j.comments[1].status,'pending');old.comments[1].status='uncertain';assert.throws(()=>resumeComments(a,{id:j.id,confirmed:true}),/不明/);
});

import fs from 'node:fs/promises';
import vm from 'node:vm';
test('评论页面函数序列化到独立网页后无需扩展后台全局函数，未知身份阻止发送',async()=>{
 const source=await fs.readFile(new URL('../integrations/source-capture-extension.js',import.meta.url),'utf8');const background=vm.createContext({});vm.runInContext(source,background);
 const page=vm.createContext({URL,location:{pathname:'/explore/note1'},document:{querySelector:()=>null},getComputedStyle:()=>({visibility:'visible'})});
 const serialized=background.wbOwnCommentDOM.toString();const fn=vm.runInContext('('+serialized+')',page);
 assert.match(fn({feedId:'note1',userId:'owner',action:'check',pageState:{status:'ready'}}).error,/登录账号/);
 assert.match(fn({feedId:'note1',userId:'owner',action:'check',pageState:{status:'verification_required',message:'验证码'}}).error,/验证码/);
 const recent=vm.runInContext('('+background.wbOwnRecentDOM.toString()+')',page);assert.match(recent({userId:'owner',redId:'red'}).error,/本人主页/);
});
