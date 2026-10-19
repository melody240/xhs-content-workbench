const submissionLabels = { failed_before_submit: '未提交，可重试', submitting: '正在提交', uncertain: '结果待核查', submitted: '已提交，待平台核实' };

export function renderFleet(state, { esc, icon, date, busy }) {
  const accounts = state.accounts || [];
  const draftCount = accounts.reduce((sum, a) => sum + (a.draftCount || 0), 0);
  const submittedCount = accounts.filter(a => a.submissionsToday?.length).length;
  const pending = accounts.filter(a => a.lastMonitorError || a.submissionsToday?.some(s => s.status === 'uncertain')).length;
  const fleet = state.fleetRefresh || {};
  return `<section class="fleet-overview" aria-label="全部账号概览">
    <div class="fleet-toolbar"><p>${accounts.length} 个账号<span>·</span>${draftCount} 份本地草稿<span>·</span>${submittedCount} 个账号今日有提交记录${pending ? `<span>·</span><strong>${pending} 个账号需要核查</strong>` : ''}</p><button class="btn" data-action="reload">${icon('refresh')}刷新总览</button></div>
    ${!accounts.length ? `<div class="empty"><h2>添加账号，开始整理内容</h2><p>每个账号分别保存登录、草稿、素材与数据。</p><button class="btn primary" data-nav="account">${icon('plus')}添加账号</button></div>` : `<div class="fleet-list">${accounts.map(a => {
      const current = a.id === state.accountId;
      const submissions = a.submissionsToday || [];
      const needsReview = submissions.some(s => s.status === 'uncertain');
      const status = a.waiting ? '等待扫码' : a.login?.status === 'logged_in' ? '账号已核实' : '账号待核实';
      return `<article class="fleet-account"><div class="fleet-account-main"><div class="fleet-name"><h2>${esc(a.alias || a.label)}</h2>${current ? '<span class="badge blue">当前操作</span>' : ''}</div><p>${esc(a.topic || '内容方向未设置')}<span>·</span>${esc(status)}</p>${a.active ? `<p class="fleet-task" role="status">${esc(a.active.label)}</p>` : ''}${a.lastMonitorError ? `<p class="fleet-error">最近采集未完成：${esc(a.lastMonitorError.message)}</p>` : ''}</div><dl class="fleet-facts"><div><dt>本地草稿</dt><dd>${a.draftCount ?? 0} 份</dd></div><div><dt>最近采集</dt><dd>${a.lastCollectedAt ? esc(date(a.lastCollectedAt)) : '尚未采集'}</dd></div><div><dt>今日提交</dt><dd class="${needsReview ? 'fleet-error' : ''}">${submissions.length ? submissions.map(s => esc(submissionLabels[s.status] || s.status)).join('；') : '暂无记录'}</dd></div></dl><div class="fleet-account-actions"><button class="btn primary" data-enter-workspace="${esc(a.id)}" data-destination="research" ${busy ? 'disabled' : ''}>进入内容${icon('arrow')}</button><button class="text-btn" data-enter-workspace="${esc(a.id)}" data-destination="monitor" ${busy ? 'disabled' : ''}>看数据</button><button class="text-btn" data-enter-workspace="${esc(a.id)}" data-destination="account" ${busy ? 'disabled' : ''}>管理账号</button></div></article>`;
    }).join('')}</div>`}
    <div class="fleet-footer"><p>账号材料分别保存。进入账号工作区后，操作使用右上角选中的账号。</p><button class="btn" data-nav="account">${icon('user')}管理全部账号</button></div>
    ${fleet.running ? `<p class="notice" role="status">账号数据正在采集：${fleet.completed}/${fleet.total}。完成后总览会更新。</p>` : ''}
    <details class="workspace-help"><summary>登录与数据怎么看？</summary><p>默认登录状态属于 Edge。选题、截图、采集和发布使用同一浏览器，每次执行前会核实身份；进入工作区不会自动切换 Edge 中的小红书账号。提交记录也不等于笔记已经公开，审核与排期需要在平台核对。</p></details>
  </section>`;
}
