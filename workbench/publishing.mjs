// A retry is safe only when the MCP explicitly reports that preparation failed
// before it received content. Transport failures and later failures stay locked.
export function publicationOutcome(result) {
  if (!result?.isError) return 'submitted';
  const evidence = result.structuredContent?.publishOutcome;
  return evidence?.version === 1 && evidence.stage === 'prepare' &&
    evidence.publishClicked === false && evidence.safeToRetry === true
    ? 'failed_before_submit' : 'uncertain';
}

export const blocksPublication = submission => submission.status !== 'failed_before_submit';

// The old managed binary emitted this exact error only from its publisher
// constructor, before upload or submission. Require a matching timed history
// entry; never infer safety from general timeout wording or unrelated failures.
export function recoverPreparationFailures(state, managed) {
  if (!managed) return 0;
  let changed = 0;
  for (const submission of Object.values(state.submissions || {})) {
    if (submission.status !== 'uncertain') continue;
    const matches = (state.history || []).filter(h =>
      ['publish_content', 'publish_with_video'].includes(h.tool) && h.status === 'error' &&
      h.summary === '发布失败: 导航到发布页面失败: context deadline exceeded' &&
      Number.isFinite(h.duration) && h.duration > 0 &&
      Math.abs(Date.parse(h.at) - Date.parse(submission.at) - h.duration) < 10000);
    if (matches.length !== 1) continue;
    submission.status = 'failed_before_submit';
    submission.previousStatus = 'uncertain';
    submission.failure = matches[0].summary;
    submission.evidence = {stage:'prepare',publishClicked:false,safeToRetry:true,
      historyId:matches[0].id,reason:'legacy_constructor_navigation_failure'};
    matches[0].status = 'not_submitted';
    matches[0].originalSummary = matches[0].summary;
    matches[0].summary = '打开发布页超时，未上传图片、未点击发布。草稿已保留；检查发布页后可手动重试。';
    changed++;
  }
  return changed;
}
