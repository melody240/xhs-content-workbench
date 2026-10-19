import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
const code=await fs.readFile(new URL('../integrations/douyin-comments-extension.js',import.meta.url),'utf8');
test('Douyin only uses allowed public pages and reuses/cleans its own tab without closing human verification',async()=>{
 let created=0,updated=0,closed=0;const tabs=new Map();
 const s={URL,WB_SOURCE_ORIGINS:{douyin:['https://www.douyin.com/*']},wbSourceTabs:new Map(),chrome:{permissions:{contains:async()=>true},tabs:{create:async o=>{const t={id:++created,...o};tabs.set(t.id,t);return t;},get:async id=>tabs.get(id),update:async(id,o)=>{updated++;Object.assign(tabs.get(id),o);return tabs.get(id);},remove:async()=>closed++}}};vm.createContext(s);vm.runInContext(code,s);
 await s.wbDouyinPage('https://www.douyin.com/video/123');await s.wbDouyinPage('https://www.douyin.com/search/女性成长?type=video');assert.equal(created,1);assert.equal(updated,1);
 s.wbSourceTabs.get('douyin:comments').handoff=true;await s.wbDouyinClose();assert.equal(closed,0);s.wbSourceTabs.get('douyin:comments').handoff=false;await s.wbDouyinClose();assert.equal(closed,1);
 await assert.rejects(s.wbDouyinPage('https://evil.test/video/123'),/来源链接无效/);
});
test('Douyin screenshot waits for loaded images and stable bounds, always detaches debugger and verifies original text',async()=>{
 let attached=0,detached=0,measure=0;const result={ready:true,content:'原评论',author:'作者',likes:'1.5万',clip:{x:1,y:1,width:100,height:50},viewport:{width:800,height:600}};
 const s={URL,sleep:async()=>{},wbDouyinPage:async()=>({id:1}),wbDouyinInspect:async()=>({}),chrome:{debugger:{attach:async()=>attached++,detach:async()=>detached++,sendCommand:async()=>({data:'pixels'})}}};vm.createContext(s);vm.runInContext(code,s);
 s.wbDouyinPage=async()=>({id:1});s.wbDouyinInspect=async(t,p)=>p.action==='find'?{found:true}:++measure===1?{ready:false,message:'头像加载中'}:result;
 const r=await s.wbDouyinCaptureComment({url:'https://www.douyin.com/video/1',expectedText:'原评论',expectedAuthor:'作者'});assert.equal(r.originalData,'pixels');assert.equal(detached,attached);assert.ok(measure>=5);
});
test('Douyin DOM reads comment own likes and refuses wrong authors, incomplete images, captcha and clipping',()=>{
 const body={innerText:'页面正文',closest:()=>null},avatar={complete:true,naturalWidth:40,currentSrc:'avatar',getBoundingClientRect:()=>({width:40,height:40,bottom:70})};
 const content={innerText:'这是原评论正文',scrollHeight:40,clientHeight:40},author={innerText:'原作者'},like={innerText:'1.5万'};
 let clipped=false,blocked=false;
 const card={parentElement:body,getAttribute:()=>null,querySelector:q=>q.includes('comment-content')?content:q.includes('comment-user-name')?author:q.includes('comment-like-count')?like:null,querySelectorAll:q=>q==='img'?[avatar]:[],scrollIntoView:()=>{},getBoundingClientRect:()=>({left:30,top:30,right:330,bottom:clipped?900:130,width:300,height:100}),contains:x=>x===card};
 const doc={body,querySelector:()=>null,querySelectorAll:q=>q.includes('captcha')?(blocked?[card]:[]):q.includes('comment-level-1')?[card]:[],elementFromPoint:()=>card};
 const s={URL,document:doc,location:{href:'https://www.douyin.com/video/1'},innerWidth:800,innerHeight:600,getComputedStyle:()=>({display:'block',visibility:'visible',overflowY:'visible'})};vm.createContext(s);vm.runInContext(code,s);
 const inspect=p=>s.wbDouyinDOM({url:s.location.href,action:'measure',expectedText:content.innerText,expectedAuthor:'原作者',...p});
 assert.equal(inspect().likes,'1.5万');assert.match(inspect({expectedAuthor:'其他作者'}).error,/不一致/);avatar.complete=false;assert.equal(inspect().ready,false);avatar.complete=true;clipped=true;assert.match(inspect().error,/一屏/);clipped=false;blocked=true;assert.match(inspect().error,/验证/);
});
test('Douyin searches through the home control and preserves an error page for recovery',async()=>{
 const calls=[],entry={id:9,owned:true};const s={URL,Date,sleep:async()=>{},wbSourceTabs:new Map([['douyin:comments',entry]]),chrome:{tabs:{query:async()=>[]}}};vm.createContext(s);vm.runInContext(code,s);
 s.wbDouyinPage=async url=>{calls.push(url);return {id:9};};s.wbDouyinInspect=async(t,p)=>p.action==='submit-search'?{submitted:true}:{url:'https://www.douyin.com/jingxuan/search/test?type=general',items:Array.from({length:6},(_,i)=>({url:'https://www.douyin.com/video/'+i,title:'视频'}))};
 const result=await s.wbDouyinSearch({keyword:'test'});assert.deepEqual(calls,['https://www.douyin.com/?recommend=1']);assert.match(result.url,/jingxuan\/search/);assert.equal(result.items.length,6);
 s.wbDouyinInspect=async()=>{throw Error('抖音返回网关错误（502）');};await assert.rejects(s.wbDouyinSearch({keyword:'test'}),/502/);assert.equal(entry.handoff,true);
});
test('Douyin accepts selected-app search results, validates keyword, and rejects gateway content early',()=>{
 const keyword='从小事做起，行胜于言',url='https://www.douyin.com/search/'+encodeURIComponent(keyword);let clicked=0,events=[];
 class Input{};Object.defineProperty(Input.prototype,'value',{set(v){this.val=v;},get(){return this.val;}});
 const input=new Input();Object.assign(input,{placeholder:'搜索你感兴趣的内容',getBoundingClientRect:()=>({width:100,height:30}),focus:()=>{},dispatchEvent:e=>events.push(e.type)});
 const button={innerText:'搜索',getAttribute:()=>null,getBoundingClientRect:()=>({width:50,height:30}),click:()=>clicked++};input.getAttribute=()=>null;
 const anchor={href:'https://www.douyin.com/jingxuan/video/123',innerText:'真实视频标题',getBoundingClientRect:()=>({width:100,height:100}),closest:()=>null,querySelector:()=>null};
 const document={body:{innerText:'搜索页面'},querySelectorAll:q=>q==='input'?[input]:q.startsWith('button')?[button]:q.startsWith('a[href*=')?[anchor]:[]};
 const s={URL,HTMLInputElement:Input,Event:class{constructor(type){this.type=type;}},document,location:{href:'https://www.douyin.com/'},getComputedStyle:()=>({display:'block',visibility:'visible'})};vm.createContext(s);vm.runInContext(code,s);
 assert.equal(s.wbDouyinDOM({action:'submit-search',url,keyword}).loading,true);assert.equal(input.value,keyword);assert.equal(s.wbDouyinDOM({action:'submit-search',url,keyword}).loading,true);assert.equal(clicked,1);assert.deepEqual(events,['input','change']);
 s.location.href='https://www.douyin.com/root/search/'+encodeURIComponent(keyword)+'?type=general';const r=s.wbDouyinDOM({action:'search',url});assert.equal(r.items[0].url,anchor.href);
 assert.equal(s.wbDouyinDOM({action:'search',url:url+'别的词'}).loading,true);
 document.body.innerText='502 Bad Gateway\nnginx/1.10.2';assert.match(s.wbDouyinDOM({action:'search',url}).error,/网关/);
 assert.throws(()=>s.wbDouyinURL('https://www.douyin.com.evil.test/jingxuan/search/test'),/无效/);
});
test('Douyin browser input submits exact text and releases debugger even on navigation failure',async()=>{
 const calls=[];let detached=0;const s={sleep:async()=>{},chrome:{debugger:{attach:async()=>{},detach:async()=>detached++,sendCommand:async(t,m,p)=>calls.push({m,p})}}};vm.createContext(s);vm.runInContext(code,s);
 await s.wbDouyinTypeSearch({id:3},{x:100,y:30},'从小事做起，行胜于言');assert.equal(calls.find(c=>c.m==='Input.insertText').p.text,'从小事做起，行胜于言');assert.equal(calls.filter(c=>c.p.key==='Enter').length,2);assert.equal(detached,1);
 s.chrome.debugger.sendCommand=async()=>{throw Error('navigation failure');};await assert.rejects(s.wbDouyinTypeSearch({id:3},{x:100,y:30},'测试'),/navigation/);assert.equal(detached,2);
});
