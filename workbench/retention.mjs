export const RETENTION=Object.freeze({history:200,events:160,snapshots:120,recentSnapshots:24,logBytes:2*1024*1024,logBackups:2});
const short=(value,max=1000)=>typeof value==='string'?value.slice(0,max):value;

// Preserve recent resolution, then the last daily reading per identity/channel/period.
// Snapshots are derived samples; assets, drafts and submission/idempotency ledgers
// are deliberately outside this policy.
export function compactSnapshots(samples,{limit=RETENTION.snapshots,recent=RETENTION.recentSnapshots}={}){
 if(!Array.isArray(samples))return [];
 if(samples.length<=recent)return samples;
 const tail=samples.slice(-recent),days=new Map();
 for(const s of samples.slice(0,-recent)){
  const time=Date.parse(s.at),day=Number.isFinite(time)?new Date(time+8*3600000).toISOString().slice(0,10):String(s.at);
  const key=JSON.stringify([day,s.profile?.redId||s.profile?.userId,s.source||s.channel,s.period]);days.set(key,s);
 }
 const keep=new Set([...days.values(),...tail]);
 return samples.filter(s=>keep.has(s)).slice(-limit);
}
export function trimAccountDiagnostics(state){
 if(Array.isArray(state.history)){state.history=state.history.slice(0,RETENTION.history);for(const item of state.history)item.summary=short(item.summary);}
 if(Array.isArray(state.snapshots))state.snapshots=compactSnapshots(state.snapshots);
}
export function trimJobDiagnostics(jobs){
 for(const job of jobs){if(Array.isArray(job.events)){if(job.events.length>RETENTION.events){job.droppedEventCount=(job.droppedEventCount||0)+job.events.length-RETENTION.events;job.events.splice(0,job.events.length-RETENTION.events);}for(const e of job.events){e.label=short(e.label,200);e.detail=short(e.detail,600);}}}
}
