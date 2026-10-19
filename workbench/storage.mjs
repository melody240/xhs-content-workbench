import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// One in-flight immutable snapshot and one replaceable pending snapshot.
// Callers sharing the pending batch settle only after that latest state is on disk.
export class SnapshotWriter {
 constructor(file,{write}={}){this.file=file;this.pending=null;this.running=false;this.write=write||((text)=>this.atomicWrite(text));}
 enqueue(text){
  if(!this.pending){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});this.pending={text,promise,resolve,reject};}
  else this.pending.text=text;
  const promise=this.pending.promise;
  if(!this.running){this.running=true;queueMicrotask(()=>this.drain());}
  return promise;
 }
 async drain(){
  try{while(this.pending){const batch=this.pending;this.pending=null;
   try{await this.write(batch.text);batch.resolve();}catch(error){batch.reject(error);}
  }}finally{this.running=false;}
 }
 async atomicWrite(text){
  const tmp=path.join(path.dirname(this.file),'.'+path.basename(this.file)+'-'+randomUUID()+'.tmp');
  try{await fs.writeFile(tmp,text,{mode:0o600});await fs.rename(tmp,this.file);}
  finally{await fs.unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 }
}
