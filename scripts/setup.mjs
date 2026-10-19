import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(Number(process.versions.node.split('.')[0])<22)throw Error('需要 Node.js 22 或更新版本');
function run(command,args,options={}){const r=spawnSync(command,args,{cwd:root,stdio:'inherit',...options});if(r.error)throw r.error;if(r.status!==0)throw Error(`${command} 执行失败 (${r.status})`);}
// npm's JS entry avoids Windows .cmd shell quoting and paths-with-spaces issues.
const npm=process.env.npm_execpath;
if(!npm)throw Error('请通过 npm run setup 执行');
const configured=process.env.WORKBENCH_SETUP_PYTHON;
const candidates=configured?[[configured,[]]]:(process.platform==='win32'?[['py',['-3']],['python',[]]]:[['python3',[]],['python',[]]]);
const python=candidates.find(([c,a])=>spawnSync(c,[...a,'-c','import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)'],{stdio:'ignore'}).status===0);
if(!python)throw Error('需要 Python 3.11+；安装后重新打开终端，或设置 WORKBENCH_SETUP_PYTHON 为解释器路径');
const venv=path.join(root,'workbench/vendor/xiaohongshu-skills/.venv');
const bin=path.join(venv,process.platform==='win32'?'Scripts/python.exe':'bin/python');
if(!fs.existsSync(bin))run(python[0],[...python[1],'-m','venv',venv]);
run(process.execPath,[npm,'ci','--prefix','workbench','--ignore-scripts']);
run(bin,['-m','pip','install','--disable-pip-version-check','-r',path.join(root,'workbench/skills-requirements.txt')]);
console.log('安装完成。执行 npm start，然后打开 http://127.0.0.1:18180');
