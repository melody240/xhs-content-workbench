import test from 'node:test';
import assert from 'node:assert/strict';
import {screenMaterials,materialExcluded,parseMaterialReview} from '../integrations/material-filter.mjs';
import {mergeMaterials,publicLibrary} from '../integrations/material-library.mjs';

const item=(id,text,extra={})=>({id,platform:'x',url:`https://x.com/author/status/${id}`,text,...extra});
test('模型夹带说明、代码围栏或引号中的花括号时只解析真实 JSON，不执行代码',()=>{
 const expected={items:[{id:'1',category:'useful',confidence:.9,reason:'包含 { } 和 "引号"'}]};
 for(const wrap of [s=>s,s=>'筛选结果如下：\n```json\n'+s+'\n```\n以上是判断。',s=>'说明\n'+s])assert.deepEqual(parseMaterialReview(wrap(JSON.stringify(expected))),expected);
 assert.throws(()=>parseMaterialReview('process.exit()'),/筛选结果/);
});
function model(decide){return {public:()=>({configured:true,hasKey:true}),complete:async messages=>{
 const posts=JSON.parse(messages[1].content).posts;
 return {content:JSON.stringify({items:posts.map(i=>({id:i.id,category:decide(i),confidence:.96,reason:'筛选理由'}))})};
}};}
test('排除广告和无关帖子，有观点的语录与照片一起保留，图片帖不因无正文而删除',async()=>{
 const posts=[item('1','Pre-order my book today'),item('2','广告', {promoted:true}),item('3','不必为了留住别人而缩小自己。',{hasPhotos:true}),item('4','',{hasPhotos:true}),item('5','服务器升级完成')];
 await screenMaterials(posts,model(i=>i.id==='5'?'unrelated':'useful'));
 assert.deepEqual(posts.filter(materialExcluded).map(i=>i.id),['1','2','5']);
 assert.equal(posts[2].contentReview.status,'kept');assert.equal(posts[3].contentReview.status,'kept');
});
test('不把英文原文误判为翻译失败，截图前的真实中文翻译才检查可读性',async()=>{
 const post=item('1','The body never tomorrow because love mountain.');
 await screenMaterials([post],model(()=> 'unreadable'));assert.equal(materialExcluded(post),false);
 post.text='身体从不明天因为爱情山。';await screenMaterials([post],model(()=> 'unreadable'),{stage:'capture'});assert.equal(post.captureReview.status,'excluded');
 const valid=item('2','身后一无所有，前方应有尽有。',{hasPhotos:true});await screenMaterials([valid],model(()=> 'useful'),{stage:'capture'});assert.equal(materialExcluded(valid),false);
});
test('广告判断看推广目的，提到书或链接不会直接过滤；不确定的内容保留',async()=>{
 const posts=[item('1','读完这本书，我才发现自己一直在讨好别人。'),item('2','课程结束后，我学会了拒绝。')];
 await screenMaterials(posts,model(()=> 'uncertain'));assert.ok(posts.every(i=>!materialExcluded(i)));
 const low=model(()=> 'unrelated');low.complete=async()=>({content:'{"items":[{"id":"1","category":"unrelated","confidence":0.6,"reason":"不确定"}]}'});
 const uncertain=item('1','一句有争议的观点');await screenMaterials([uncertain],low);assert.equal(uncertain.contentReview.status,'kept');
});
test('筛选只传帖子正文和照片标记，不传账号、图片数据或链接，重复内容使用同阶段结果',async()=>{
 let calls=0;const post=item('1','不必讨好',{originalData:'secret screenshot',cookie:'secret cookie'}),m=model(()=> 'useful'),complete=m.complete;
 m.complete=async messages=>{calls++;assert.ok(!messages[1].content.includes('secret'));assert.ok(!messages[1].content.includes('https://'));return complete(messages);};
 await screenMaterials([post],m);await screenMaterials([post],m);assert.equal(calls,1);post.text='新的观点';await screenMaterials([post],m);assert.equal(calls,2);
});
test('模型缺失或响应不完整不伪装筛选成功，错误不会删除采集内容',async()=>{
 const post=item('1','真实文字');await screenMaterials([post],{public:()=>({configured:false})});assert.equal(post.contentReview.status,'pending');
 for(const value of ['{}','bad','{"items":[{"id":"wrong","category":"useful","confidence":1,"reason":"ok"}]}'])await assert.rejects(screenMaterials([post],{public:()=>({configured:true,hasKey:true}),complete:async()=>({content:value})}),/筛选结果/);
 assert.equal(post.text,'真实文字');
});
test('筛除内容从待选列表隐藏，保留原记录与已保存图片；来源文本变化可重新审核',async()=>{
 const a={state:{}},source={id:'s',platform:'x',name:'作者'};
 mergeMaterials(a,source,{items:[item('1','广告')]});const old=a.state.materialLibrary.items[0];old.contentReview={status:'excluded'};a.state.materialLibrary.images=[{id:'photo',asset:{id:'asset'},originalAsset:{}}];
 assert.equal(publicLibrary(a).items.length,0);assert.equal(publicLibrary(a).images.length,1);assert.equal(a.state.materialLibrary.items.length,1);
 mergeMaterials(a,source,{items:[item('1','更换为有意义的内容',{hasPhotos:true})]});assert.equal(old.contentReview,undefined);assert.equal(publicLibrary(a).items.length,1);
});

test('旧记录没有正文且照片信息未知时保留待核查，不能误删图片帖；已采到的坏中文也可筛除',async()=>{
 const unknown=item('1','',{title:'未提供标题'}),bad=item('2','明天身体在爱情工作砖头');
 await screenMaterials([unknown,bad],model(()=> 'unreadable'));
 assert.equal(unknown.contentReview.status,'pending');assert.equal(materialExcluded(unknown),false);assert.equal(materialExcluded(bad),true);
});
test('批量模型格式偶发出错只修正一次，修正成功后保存判断',async()=>{
 let calls=0;const m=model(()=> 'useful'),complete=m.complete;
 m.complete=async(messages,options)=>{assert.equal(options.json,true);calls++;return calls===1?{content:'结果没有合法 JSON'}:complete(messages);};
 const p=item('1','值得保留的观点',{hasPhotos:true});await screenMaterials([p],m);assert.equal(calls,2);assert.equal(p.contentReview.status,'kept');
});
test('纯表情只在确认没有照片时排除，照片存在或尚未确认时保留',async()=>{
 const posts=[item('1','🥹',{hasPhotos:false}),item('2','🥹',{hasPhotos:true}),item('3','🥹')];
 await screenMaterials(posts,model(()=> 'uncertain'));assert.equal(materialExcluded(posts[0]),true);assert.equal(materialExcluded(posts[1]),false);assert.equal(materialExcluded(posts[2]),false);
});
test('模型已明确判定无关闲聊时筛除，uncertain 判断始终保留',async()=>{
 const posts=[item('1','哪种蛋白粉不胀气？'),item('2','可能有意义的短句',{hasPhotos:true})];
 const m=model(()=> 'uncertain');m.complete=async()=>({content:JSON.stringify({items:[{id:'1',category:'unrelated',confidence:.7,reason:'健身产品闲聊，没有成长观点'},{id:'2',category:'uncertain',confidence:.9,reason:'图片内容未知'}]})});
 await screenMaterials(posts,m);assert.equal(materialExcluded(posts[0]),true);assert.equal(materialExcluded(posts[1]),false);
});
