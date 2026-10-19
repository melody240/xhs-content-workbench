import test from 'node:test';
import assert from 'node:assert/strict';
import {publicationOutcome,blocksPublication,recoverPreparationFailures} from '../publishing.mjs';

test('Only explicit preparation evidence permits a manual retry; every ambiguous or after-click failure remains blocked',()=>{
  const outcome = overrides => ({isError:true,structuredContent:{publishOutcome:{version:1,stage:'prepare',publishClicked:false,safeToRetry:true,...overrides}}});
  assert.equal(publicationOutcome(outcome()),'failed_before_submit');
  for(const result of [{isError:true},outcome({stage:'submit'}),outcome({publishClicked:true}),outcome({safeToRetry:false}),outcome({version:2})]) assert.equal(publicationOutcome(result),'uncertain');
  assert.equal(publicationOutcome({}), 'submitted');
  assert.equal(blocksPublication({status:'failed_before_submit'}),false);
  for(const status of ['submitting','submitted','uncertain','unknown']) assert.equal(blocksPublication({status}),true);
});

test('Legacy recovery requires the exact constructor failure and the matching attempt timing; preserves audit evidence',()=>{
  const fixture=()=>({submissions:{a:{at:'2026-10-10T01:18:17.920Z',status:'uncertain',title:'preserved'}},history:[{id:'h',at:'2026-10-10T01:23:19.016Z',duration:301095,tool:'publish_content',status:'error',summary:'发布失败: 导航到发布页面失败: context deadline exceeded'}]});
  const state=fixture();
  assert.equal(recoverPreparationFailures(state,true),1);
  assert.equal(state.submissions.a.status,'failed_before_submit');
  assert.equal(state.submissions.a.evidence.historyId,'h');
  assert.equal(state.history[0].originalSummary,fixture().history[0].summary);
  assert.equal(recoverPreparationFailures(state,true),0);
  const afterClick=fixture();afterClick.history[0].summary='发布失败: 小红书发布失败: context deadline exceeded';
  assert.equal(recoverPreparationFailures(afterClick,true),0);
  const late=fixture();late.history[0].at='2026-10-11T01:23:19.016Z';assert.equal(recoverPreparationFailures(late,true),0);
  assert.equal(recoverPreparationFailures(fixture(),false),0);
});
