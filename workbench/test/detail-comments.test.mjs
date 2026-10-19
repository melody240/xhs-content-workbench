import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('Comment readiness handles delayed rendering, real empty states and bounded deadlines',()=>{
 const cwd=fileURLToPath(new URL('..',import.meta.url));
 execFileSync(process.env.WORKBENCH_PYTHON || cwd+'/vendor/xiaohongshu-skills/.venv/'+(process.platform==='win32'?'Scripts/python.exe':'bin/python'),['test/detail-comments.py'],{cwd,timeout:10000});
});
