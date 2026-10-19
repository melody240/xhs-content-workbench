import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {SnapshotWriter} from '../storage.mjs';
import {AccountStore} from '../accounts.mjs';
import {ResearchAgent} from '../integrations/agent.mjs';
import {compactSnapshots,trimAccountDiagnostics,trimJobDiagnostics,RETENTION} from '../retention.mjs';
import {RotatingLog} from '../rotating-log.mjs';
import {singleFlightPoll} from '../public/polling.js';
const deferred=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve,reject};};
async function directory(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'xhs-retention-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}

test('Slow disk retains at most two snapshots while 1000 overlapping saves persist the latest state',async()=>{
 const entered=deferred(),release=deferred(),writes=[];
 const writer=new SnapshotWriter('unused',{write:async text=>{writes.push(JSON.parse(text));if(writes.length===1){entered.resolve();await release.promise;}}});
 const first=writer.enqueue('{"revision":0}');await entered.promise;
 const last=[];for(let i=1;i<=1000;i++)last.push(writer.enqueue(JSON.stringify({revision:i})));
 assert.equal(new Set(last).size,1,'all superseded pending snapshots share one completion');
 assert.equal(JSON.parse(writer.pending.text).revision,1000);assert.equal(writes.length,1);
 release.resolve();await Promise.all([first,...last]);assert.deepEqual(writes,[{revision:0},{revision:1000}]);assert.equal(writer.pending,null);assert.equal(writer.running,false);
});

test('Snapshot failure rejects that batch, later writes recover and use atomic files',async t=>{
 const dir=await directory(t),file=path.join(dir,'state.json'),writer=new SnapshotWriter(file);await writer.enqueue('original');
 const originalWrite=writer.write;writer.write=async()=>{throw Error('磁盘失败');};await assert.rejects(writer.enqueue('bad'),/磁盘失败/);assert.equal(await fs.readFile(file,'utf8'),'original');
 writer.write=originalWrite;await writer.enqueue('newest');assert.equal(await fs.readFile(file,'utf8'),'newest');assert.deepEqual(await fs.readdir(dir),['state.json']);
});

test('Account persistence compacts diagnostic samples while preserving all assets, drafts and duplicate-publication guards',async t=>{
 const dir=await directory(t),store=await AccountStore.open(dir,'http://127.0.0.1:1/mcp'),a=store.items[0];
 const samples=Array.from({length:1000},(_,i)=>({at:new Date(Date.UTC(2026,0,1)+i*3600000).toISOString(),profile:{redId:'A'},source:'creator',period:i%2?7:30,metrics:{likes:i}}));
 a.state.snapshots=samples;a.state.history=Array.from({length:1000},(_,i)=>({summary:'x'.repeat(10000),id:i}));
 a.state.drafts=[{id:'draft',content:'必须保留'}];a.state.assets={image:{id:'image',path:'/unchanged'}};a.state.submissions={guard:{status:'uncertain',date:'2000-01-01'}};a.state.postCommentJobs=[{status:'sending',comments:[{status:'uncertain'}]}];
 await store.save();assert.ok(a.state.snapshots.length<=RETENTION.snapshots);assert.equal(a.state.snapshots.at(-1),samples.at(-1));assert.equal(a.state.history.length,200);assert.equal(a.state.history[0].summary.length,1000);
 const reopened=await AccountStore.open(dir,'unused'),saved=reopened.items[0].state;assert.equal(saved.drafts[0].content,'必须保留');assert.equal(saved.assets.image.path,'/unchanged');assert.equal(saved.submissions.guard.status,'uncertain');assert.equal(saved.postCommentJobs[0].comments[0].status,'uncertain');
});

test('Daily sampling retains the most recent readings of both creator periods and separate identities',()=>{
 const samples=Array.from({length:1000},(_,i)=>({at:new Date(Date.UTC(2026,0,1)+i*60000).toISOString(),profile:{redId:i%3?'A':'B'},source:'creator',period:i%2?7:30,id:i}));
 const result=compactSnapshots(samples);assert.ok(result.length<40);assert.deepEqual(result.slice(-24),samples.slice(-24));
 for(const id of ['A','B'])for(const period of [7,30])assert.ok(result.includes(samples.slice(0,-24).filter(s=>s.profile.redId===id&&s.period===period).at(-1)));
});

test('Research event retention does not remove evidence, articles, preparations or captures',async t=>{
 const dir=await directory(t),agent=new ResearchAgent({data:dir,skills:{},model:{}});await agent.init();
 const job={id:'j',events:Array.from({length:5000},(_,i)=>({label:'step',detail:'x'.repeat(2000),i})),sources:[{id:'S1',body:'真实依据'}],topics:[{id:'T1',article:{content:'生成正文'},preparation:{status:'partial',captureIds:['C1']}}]};agent.jobs=[job];await agent.save();assert.equal(job.events.length,160);assert.equal(job.events[0].i,4840);assert.equal(job.events[0].detail.length,600);assert.equal(job.droppedEventCount,4840);
 await agent.event(job,'最后一次');assert.equal(job.events.length,160);assert.equal(job.events.at(-1).label,'最后一次');assert.equal(job.droppedEventCount,4841);assert.equal(job.sources[0].body,'真实依据');assert.deepEqual(job.topics[0].preparation.captureIds,['C1']);
});

test('Rotating logs keep the latest messages in three bounded files, including oversized legacy logs',async t=>{
 const dir=await directory(t),file=path.join(dir,'server.log');await fs.writeFile(file,'old'.repeat(5000));await fs.writeFile(file+'.1','older'.repeat(5000));
 const log=new RotatingLog(file,{maxBytes:256,backups:2});
 for(let i=0;i<1000;i++)log.write('message '+i+' '+'.'.repeat(40)+'\n');
 log.write('very long '+'.'.repeat(5000)+'\nLATEST');log.end();await once(log,'finish');
 const files=await fs.readdir(dir);assert.deepEqual(files.sort(),['server.log','server.log.1','server.log.2']);
 for(const name of files)assert.ok((await fs.stat(path.join(dir,name))).size<=256);
 assert.match(await fs.readFile(file,'utf8'),/LATEST$/);assert.equal(log.fd,undefined);
});

test('Slow or failed polls never overlap, hidden windows do no polling, and visible windows recover',async()=>{
 const release=deferred();let calls=0,visible=true;const poll=singleFlightPoll(async()=>{calls++;await release.promise;},{visible:()=>visible});
 const first=poll();for(let i=0;i<1000;i++)assert.equal(poll(),first);await Promise.resolve();assert.equal(calls,1);release.resolve();await first;
 visible=false;await poll();assert.equal(calls,1);visible=true;await poll();assert.equal(calls,2);
 let fail=true;const recovery=singleFlightPoll(()=>{if(fail)throw Error('offline');return 'online';});await assert.rejects(recovery(),/offline/);fail=false;assert.equal(await recovery(),'online');
});

test('The real background launcher uses bounded logging and leaves a responsive service after it exits',async t=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{default:net}=await import('node:net');
 const dir=await directory(t),probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const base='http://127.0.0.1:'+port,root=path.resolve(import.meta.dirname,'..');let pid;
 t.after(async()=>{if(pid){try{process.kill(pid,'SIGTERM');}catch{}for(let n=0;n<60;n++){try{process.kill(pid,0);}catch{break;}await new Promise(r=>setTimeout(r,50));}}});
 // Oversized logs from previous versions are bounded on the next launch too.
 await fs.writeFile(path.join(dir,'server.log'),'x'.repeat(RETENTION.logBytes+1000));
 await promisify(execFile)(process.execPath,['launch.mjs','--no-open'],{cwd:root,env:{...process.env,WORKBENCH_PORT:String(port),WORKBENCH_DATA_DIR:dir},timeout:15000});
 pid=Number(await fs.readFile(path.join(dir,'server.pid'),'utf8'));assert.ok(pid>0);
 assert.equal((await fetch(base+'/api/health')).status,200);
 assert.match(await fs.readFile(path.join(dir,'server.log'),'utf8'),/小红书工作台/);
 for(const name of (await fs.readdir(dir)).filter(n=>/^server\.log(?:\.\d+)?$/.test(n)))assert.ok((await fs.stat(path.join(dir,name))).size<=RETENTION.logBytes);
});
