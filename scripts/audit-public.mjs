import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
if(!files.length)throw Error('No tracked source to audit');
const blocked=/(^|\/)(?:node_modules|\.venv|__pycache__|data|output|cache|\.git|skills-extension)(\/|$)|(^|\/)(?:\.env(?:\..*)?|cookies\.json|skills-bridge-token|model-settings\.json|state\.json)$|\.(?:log|exe|zip|dmg)$/i;
const keys=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\b(?:ghp|gho|ghu|ghs)_[A-Za-z0-9]{30,}\b/,/\bgithub_pat_[A-Za-z0-9_]{40,}\b/,/\bsk-[A-Za-z0-9_-]{24,}\b/];
const errors=[];
for(const name of files){
 if(blocked.test(name))errors.push(name+': runtime/private artifact');
 const stat=await fs.lstat(path.join(root,name));if(stat.isSymbolicLink())errors.push(name+': unexpected symlink');
 if(stat.size>20*1024*1024)errors.push(name+': oversized public file');
 if(/\.(?:png|jpg|jpeg|webp|ico)$/i.test(name))continue;
 const s=await fs.readFile(path.join(root,name),'utf8');
 if(keys.some(re=>re.test(s)))errors.push(name+': credential-shaped value (redacted)');
 if(/\x2fUsers\x2f(?!user(?:\x2f|\b))/.test(s))errors.push(name+': personal workspace identifier');
}
const seed=path.join(root,'workbench/integrations/quote-author-seed');
const authors=JSON.parse(await fs.readFile(path.join(seed,'authors.json'),'utf8'));
const handles=new Set();let bytes=0;
for(const a of authors){
 if(!/^[a-zA-Z0-9_]{24}\.(?:png|jpg|webp)$/.test(a.file)||!/^@[A-Za-z0-9_]{1,15}$/.test(a.handle))throw Error('Invalid author manifest');
 if(handles.has(a.handle.toLowerCase()))throw Error('Duplicate author');handles.add(a.handle.toLowerCase());
 if(a.sourceURL!==`https://x.com/${a.handle.slice(1)}`)throw Error('Author source mismatch');
 if(Object.keys(a).some(k=>!['name','handle','file','mime','sourceURL','sha256'].includes(k)))throw Error('Unexpected author metadata');
 const b=await fs.readFile(path.join(seed,a.file));bytes+=b.length;
 if(createHash('sha256').update(b).digest('hex')!==a.sha256)throw Error('Avatar checksum mismatch: '+a.file);
 if(!files.includes('workbench/integrations/quote-author-seed/'+a.file))throw Error('Untracked avatar file');
}
if(authors.length!==359)errors.push('Expected all 359 author assets');
if(errors.length)throw Error(errors.join('\n'));
console.log(JSON.stringify({ok:true,trackedFiles:files.length,authors:authors.length,avatarBytes:bytes,note:'Path and credential-pattern audit; not a substitute for specialist secret scanning.'}));
