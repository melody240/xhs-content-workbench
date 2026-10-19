import test from 'node:test';
import assert from 'node:assert/strict';
import {renderProgress} from '../public/progress-ui.js';
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
test('browser and model waits carry no invented percentage or completion value',()=>{
 const html=renderProgress({title:'正在归纳选题',detail:'已读到3条资料',tone:'violet'},esc);
 assert.match(html,/正在归纳选题/);assert.match(html,/task-flow/);assert.doesNotMatch(html,/aria-valuenow|role="progressbar"|%|已完成/);
});
test('only actual counted work gets a bounded progressbar and completed count',()=>{
 const html=renderProgress({title:'导入素材',completed:2,total:3},esc);
 assert.match(html,/aria-valuenow="2"/);assert.match(html,/aria-valuemax="3"/);assert.match(html,/2 \/ 3 已完成/);assert.match(html,/--task-fraction:0.666/);
 assert.match(renderProgress({title:'导入素材',completed:99,total:3},esc),/aria-valuenow="3"/);
 assert.match(renderProgress({title:'导入素材',completed:-2,total:3},esc),/aria-valuenow="0"/);
 for(const opts of [{completed:2,total:0},{completed:NaN,total:2},{completed:1,total:Infinity}])assert.doesNotMatch(renderProgress({title:'任务',...opts},esc),/aria-valuenow/);
});
test('progress content is escaped and color choices cannot inject markup',()=>{
 const html=renderProgress({title:'<任务"',detail:'<script>',tone:'" onmouseover="x'},esc);
 assert.doesNotMatch(html,/<script>|onmouseover/);assert.match(html,/task-feedback-blue/);assert.match(html,/&lt;任务&quot;/);
});
