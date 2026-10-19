import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'workbench'),target=path.join(root,'desktop/resources/workbench');
const blocked=new Set(['data','node_modules','.venv','__pycache__','.git','.DS_Store','test']);
await fs.rm(target,{recursive:true,force:true});
await fs.cp(source,target,{recursive:true,filter:(p)=>!path.relative(source,p).split(path.sep).some(x=>blocked.has(x))});
for(const dep of ['ws','pngjs']){
 await fs.cp(path.join(source,'node_modules',dep),path.join(target,'node_modules',dep),{recursive:true});
}
await fs.mkdir(path.join(root,'desktop/resources/guide'),{recursive:true});
await fs.copyFile(path.join(root,'docs/操作说明书.html'),path.join(root,'desktop/resources/guide/操作说明书.html'));
await fs.copyFile(path.join(root,'LICENSE'),path.join(root,'desktop/resources/LICENSE-xiaohongshu-mcp'));
await fs.copyFile(path.join(root,'THIRD-PARTY-NOTICES.md'),path.join(root,'desktop/resources/THIRD-PARTY-NOTICES.txt'));
console.log('Windows resources prepared from public source; no user data copied.');
