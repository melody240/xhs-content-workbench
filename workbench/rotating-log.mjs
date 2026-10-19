import fs from 'node:fs';
import path from 'node:path';
import {Writable} from 'node:stream';
import {Console} from 'node:console';
import {RETENTION} from './retention.mjs';

// Synchronous, bounded writes: console bursts cannot build an async buffer of
// full messages. Each file is owned by one process/sink and reopened on rotation.
export class RotatingLog extends Writable {
 constructor(file,{maxBytes=RETENTION.logBytes,backups=RETENTION.logBackups}={}){
  super();if(!Number.isInteger(maxBytes)||maxBytes<128||!Number.isInteger(backups)||backups<1)throw Error('Invalid log limits');
  this.file=file;this.maxBytes=maxBytes;this.backups=backups;
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  for(const name of [file,...Array.from({length:backups},(_,i)=>file+'.'+(i+1))])this.trimExisting(name);
  this.fd=fs.openSync(file,'a',0o600);this.bytes=fs.fstatSync(this.fd).size;
 }
 trimExisting(file){
  let fd;try{fd=fs.openSync(file,'r+');const size=fs.fstatSync(fd).size;if(size<=this.maxBytes)return;
   const tail=Buffer.alloc(this.maxBytes);fs.readSync(fd,tail,0,tail.length,size-tail.length);fs.writeSync(fd,tail,0,tail.length,0);fs.ftruncateSync(fd,tail.length);
  }catch(e){if(e.code!=='ENOENT')throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}
 }
 rotate(){
  fs.closeSync(this.fd);this.fd=undefined;
  for(let i=this.backups;i>=1;i--){const from=i===1?this.file:this.file+'.'+(i-1),to=this.file+'.'+i;try{fs.renameSync(from,to);}catch(e){if(e.code!=='ENOENT')throw e;}}
  this.fd=fs.openSync(this.file,'a',0o600);this.bytes=0;
 }
 _write(chunk,encoding,callback){
  try{let bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,encoding);
   if(bytes.length>this.maxBytes){const mark=Buffer.from('[日志过长，保留末尾]\n');bytes=Buffer.concat([mark,bytes.subarray(bytes.length-(this.maxBytes-mark.length))]);}
   if(this.bytes+bytes.length>this.maxBytes)this.rotate();
   let offset=0;while(offset<bytes.length)offset+=fs.writeSync(this.fd,bytes,offset,bytes.length-offset);
   this.bytes+=bytes.length;callback();
  }catch(e){callback(e);}
 }
 _final(callback){try{if(this.fd!==undefined){fs.closeSync(this.fd);this.fd=undefined;}callback();}catch(e){callback(e);}}
 _destroy(error,callback){try{if(this.fd!==undefined){fs.closeSync(this.fd);this.fd=undefined;}}catch(e){error||=e;}callback(error);}
}
export function installProcessLogging(file){
 const sink=new RotatingLog(file);sink.on('error',()=>{});
 globalThis.console=new Console({stdout:sink,stderr:sink});
 process.on('uncaughtExceptionMonitor',error=>console.error(error));
 return sink;
}
