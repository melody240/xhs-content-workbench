import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PNG} from 'pngjs';
import {commentLikes,rankedComments,collectComments,sameCommentCapture} from '../integrations/comment-collection.mjs';
const source=(id,comments)=>({id,platform:'抖音',url:'https://www.douyin.com/video/'+id,title:'测试来源',detail:true,comments});
const c=(content,likes,author='作者')=>({content,likes,author,id:content});
test('Ranking uses own visible likes, skips unknown counts and keeps highest liked duplicate',()=>{
 assert.equal(commentLikes('1.5万'),15000);assert.equal(commentLikes('9,123'),9123);assert.equal(commentLikes('2.4k'),2400);assert.equal(commentLikes(null),null);
 assert.equal(commentLikes('赞'),null);assert.equal(commentLikes('0'),0);
 const ranked=rankedComments([source('1',[c('同一句真实评论',2),c('没有点赞数字的评论',null)]),source('2',[c('同一句真实评论','1.5万'),c('另一条有效评论',50),c('哈哈',90000)])]);
 assert.deepEqual(ranked.map(x=>x.likes),[15000,50]);assert.equal(ranked[0].source.id,'2');
});
test('Positional ids do not suppress new comments; same real URL, author and text remain idempotent',()=>{
 const j={id:'j'},s=source('1',[]),comment=c('真实评论内容',30);
 const r={jobId:'j',kind:'browser',platform:'抖音',sourceId:s.id,commentId:comment.id,sourceURL:s.url,recordedComment:comment.content,observedAuthor:comment.author};
 assert.equal(sameCommentCapture(r,j,{...s,id:'D9'},{...comment,id:'D9C7'}),true);
 assert.equal(sameCommentCapture(r,j,s,{...comment,content:'另一个新的评论'}),false);
 assert.equal(sameCommentCapture(r,{id:'other'},s,comment),false);
});
test('Douyin samples three keyword results, ranks comments and preserves raw screenshots and evidence on retry',async t=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'comment-collect-'));t.after(()=>fs.rm(data,{recursive:true,force:true}));await fs.mkdir(path.join(data,'uploads'));
 const bytes=PNG.sync.write({width:1,height:1,data:Buffer.from([255,255,255,255])}),a={id:'A',state:{assets:{}}},job={id:'j',topic:'女性成长',sources:[],topics:[]};let captures=0,closed=0;
 const skills={searchDouyin:async({},{keyword})=>{assert.equal(keyword,job.topic);return {url:'https://www.douyin.com/search/test',items:[1,2,3,4].map(i=>({url:'https://www.douyin.com/video/'+i,title:'示例'+i}))};},readDouyinComments:async(a,{url})=>({comments:[c('来自来源'+url.at(-1)+'的评论',100*Number(url.at(-1)))]}),captureComment:async(a,s,c)=>{captures++;return {originalData:bytes.toString('base64'),content:c.content,author:c.author,likes:c.likes,clip:{x:0,y:0,width:1,height:1},viewport:{width:1,height:1},capturedAt:new Date().toISOString()};},closeDouyin:async()=>closed++};
 const options={data,a,job,skills,persist:async()=>{},event:async()=>{},platforms:['抖音']};await collectComments(options);
 assert.equal(job.commentSources.length,3);assert.equal(job.commentAutomation.saved,3);assert.equal(a.state.commentCaptures[0].selection.method,'comment_likes');assert.equal(a.state.commentCaptures.at(-1).selection.rank,1);
 await collectComments(options);assert.equal(captures,3);assert.equal(closed,2);assert.equal(job.commentAutomation.saved,3);
 assert.deepEqual(await fs.readFile(a.state.commentCaptures[0].originalAsset.path),bytes);
});
test('Capture errors preserve topics and return a recoverable result; verification stops further captures',async()=>{
 const a={id:'A',state:{}},job={id:'j',topic:'主题',sources:[{id:'S1',detail:true,comments:[c('测试评论内容',30),c('另一条测试评论',20)]}],topics:[{sourceIds:['S1'],title:'保留的选题'}]};let captures=0;
 await collectComments({data:'unused',a,job,skills:{captureComment:async()=>{captures++;throw Error('请本人完成验证码');}},persist:async()=>{},event:async()=>{},platforms:['小红书']});
 assert.equal(job.topics[0].title,'保留的选题');assert.equal(job.commentAutomation.status,'partial');assert.equal(captures,1);
});

test('list-only XHS research reads real comment details before ranking; empty topic IDs do not drop existing comments',async()=>{
 const a={id:'A',state:{}},job={id:'wide',topic:'女性成长',sources:[{id:'S1',feedId:'note',xsecToken:'token',detail:false,comments:[]}],topics:[{sourceIds:['S1']}]};let read=0,captured;
 const skills={execute:async(a,request)=>{read++;assert.equal(request.command,'get-feed-detail');return {result:{note:{noteId:'note',title:'真实笔记'},comments:[{id:'c',content:'评论说的是自主选择自己的生活',likeCount:500}]}};},captureComment:async(a,s,c)=>{captured=c;throw Error('测试阻止文件写入');}};
 await collectComments({data:'unused',a,job,skills,persist:async()=>{},event:async()=>{},platforms:['小红书']});assert.equal(read,1);assert.equal(captured.likes,'500');assert.equal(job.sources[0].detail,true);
 job.topics=[];captured=null;await collectComments({data:'unused',a,job,skills,persist:async()=>{},event:async()=>{},platforms:['小红书']});assert.equal(read,1);assert.ok(captured);
});

test('Chosen-topic collection carries the final article, avoids other source captures, and preserves existing source identities',async t=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'chosen-comments-'));t.after(()=>fs.rm(data,{recursive:true,force:true}));await fs.mkdir(path.join(data,'uploads'));
 const bytes=PNG.sync.write({width:1,height:1,data:Buffer.from([255,255,255,255])}),a={id:'A',state:{assets:{}}};
 const job={id:'j',topic:'女性成长',sources:[{id:'S1',detail:true,feedId:'note1',xsecToken:'t',title:'拒绝聚会',comments:[c('不想去就说不，我不会为此反复解释',200)]},{id:'S2',detail:true,title:'理财',comments:[c('另一主题存款建议',99999)]}],topics:[{id:'t1',sourceIds:['S1']},{id:'t2',sourceIds:['S2']}],commentSources:[{id:'D1',platform:'抖音',url:'https://www.douyin.com/video/1',comments:[{id:'D1C1',content:'旧评论',author:'原作者',platformId:'old'}]}]};
 const selection={topicId:'t1',title:'别为合群答应聚会',content:'不想去的聚会可以拒绝',keyword:'拒绝聚会'};const captured=[];
 const model={public:()=>({verifiedAt:'yes'}),complete:async messages=>{const p=JSON.parse(messages[1].content);assert.equal(p.context.content,selection.content);return {content:JSON.stringify({items:p.comments.map(c=>({id:c.id,keep:true,confidence:1,reason:'支持本篇'}))})};}};
 const skills={searchDouyin:async(a,input)=>{assert.equal(input.keyword,'拒绝聚会');return {items:[{url:'https://www.douyin.com/video/1',title:'拒绝聚会'}]};},readDouyinComments:async()=>({comments:[{content:'新评论也在讲拒绝不想去的聚会',likes:300,author:'新作者',platformId:'new'},{content:'旧评论',likes:100,author:'原作者',platformId:'old'}]}),captureComment:async(a,s,comment)=>{captured.push({source:s.id,id:comment.id});return {originalData:bytes.toString('base64'),content:comment.content,author:comment.author,likes:comment.likes,clip:{x:0,y:0,width:1,height:1},viewport:{width:1,height:1}};},closeDouyin:async()=>{}};
 const state=await collectComments({data,a,job,skills,model,selection,persist:async()=>{},event:async()=>{}});
 assert.ok(captured.every(c=>c.source!=='S2'));assert.equal(job.commentSources[0].comments[0].id,'D1C2');assert.equal(job.commentSources[0].comments[1].id,'D1C1');assert.equal(state.captureIds.length,state.saved);assert.ok(a.state.commentCaptures.every(r=>r.selection.topicId==='t1'));
});

test('Automatic matching failure is distinct from unread or rejected comments on each platform',async()=>{
 for(const platform of ['小红书','抖音'])for(const outcome of ['timeout','invalid','rejected','empty']){
  const comment=c('不想参加的聚会可以直接说不',900),a={id:'A',state:{}},job={id:'j',topic:'女性成长',sources:[{id:'S1',detail:true,comments:outcome==='empty'?[]:[comment]}],topics:[{id:'T1',sourceIds:['S1']}]};
  const model={public:()=>({verifiedAt:'yes'}),complete:async()=>{if(outcome==='timeout')throw Error('模型读取超时');return {content:JSON.stringify({items:outcome==='invalid'?[]:[{id:'C0',keep:false,confidence:1,reason:'无关'}]})};}};
  const skills={searchDouyin:async()=>({items:[{url:'https://www.douyin.com/video/1'}]}),readDouyinComments:async()=>({comments:outcome==='empty'?[]:[comment]}),captureComment:async()=>{throw Error('不应截图');}};
  const state=await collectComments({data:'unused',a,job,skills,model,selection:{topicId:'T1',title:'拒绝聚会',content:'不想去可以拒绝'},platforms:[platform],persist:async()=>{},event:async()=>{}});
  assert.equal(state.saved,0);assert.equal(state.errors.length,1);assert.equal(state.errors[0].platform,platform);
  if(['timeout','invalid'].includes(outcome)){assert.equal(state.errors[0].stage,'matching');assert.match(state.errors[0].message,/匹配未完成.*重试/);assert.doesNotMatch(state.errors[0].message,/未读到|没有.*评论/);assert.ok(state.errors[0].detail);}
  else if(outcome==='rejected'){assert.match(state.errors[0].message,/已筛选.*没有与本篇/);assert.doesNotMatch(state.errors[0].message,/未读到/);}
  else assert.match(state.errors[0].message,/点赞数/);
 }
});
