// A delayed local request must not spawn another full polling cycle every 5s.
export function singleFlightPoll(run,{visible=()=>true}={}){
 let pending=null;
 return ()=>{
  if(pending)return pending;
  if(!visible())return Promise.resolve();
  pending=Promise.resolve().then(run).finally(()=>{pending=null;});
  return pending;
 };
}
