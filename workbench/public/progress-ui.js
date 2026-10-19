// Only counted work gets a percentage; browser/model waits remain indeterminate.
export function renderProgress({title, detail='', completed=null, total=null, action='', tone='blue'}, esc) {
  const counted=Number.isFinite(completed)&&Number.isFinite(total)&&total>0;
  const value=counted?Math.max(0,Math.min(total,completed)):null;
  const color=['blue','violet','cyan'].includes(tone)?tone:'blue';
  return `<section class="task-feedback task-feedback-${color}" role="status" aria-live="polite" data-progress-key="${esc(title)}"><div class="task-feedback-head"><span class="task-signal" aria-hidden="true"><i></i><i></i><i></i></span><div class="task-feedback-copy"><h3>${esc(title)}</h3>${detail?`<p>${esc(detail)}</p>`:''}</div>${action}</div><div class="task-track" ${counted?`role="progressbar" aria-label="${esc(title)}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${value}"`:'aria-hidden="true"'}>${counted?`<span class="task-fill" style="--task-fraction:${value/total}"></span>`:'<span class="task-flow"></span>'}</div>${counted?`<span class="task-count">${value} / ${total} 已完成</span>`:''}</section>`;
}
