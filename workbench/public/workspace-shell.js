import {renderProgress} from './progress-ui.js';
// One route registry owns the sidebar, section tabs and page titles.
export const routes = {
  research: { title: '选题', group: 'content' },
  write: { title: '正文', group: 'content' },
  materials: { title: '素材库', group: 'content' },
  updates: { title: '博主更新', group: 'content' },
  sources: { title: '素材博主', group: 'content' },
  comments: { title: '评论截图', group: 'content' },
  drafts: { title: '本地草稿', group: 'content' },
  browse: { title: '浏览调研', group: 'content' },
  publish: { title: '配图与发布', group: 'content' },
  monitor: { title: '笔记表现', group: 'monitor' },
  account: { title: '账号', group: 'system' },
  settings: { title: '设置', group: 'system' },
  model: { title: '模型设置', group: 'system' },
  skills: { title: '浏览器连接与工具', group: 'system' },
  tools: { title: 'MCP 工具', group: 'system' },
  history: { title: '日志', group: 'system' },
};

export const normalizeRoute = value => ['materials','updates','sources','comments'].includes(value)?'publish':value==='overview'?'account':Object.hasOwn(routes, value) ? value : 'research';
export const isAgentRoute = value => ['research', 'write', 'browse', 'model'].includes(value);
export const contentViews = Object.freeze(['research', 'write', 'publish', 'drafts']);
export const isContentRoute = value => contentViews.includes(value);
const systemTabs = ['settings', 'account', 'model', 'history'];

export function renderNavigation(view, { icon, esc, draftCount }) {
  const group = routes[view].group;
  const items = [
    ['research', '内容工作区', 'edit', 'content'],
    ['monitor', '笔记表现', 'chart', 'monitor'],
    ['settings', '设置', 'settings', 'system'],
  ];
  return `<nav aria-label="主要导航">${items.map(([id, label, symbol, itemGroup]) => `<button class="nav-item ${group === itemGroup ? 'active' : ''}" data-nav="${id}" ${group === itemGroup ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${esc(label)}</span>${id === 'research' && draftCount ? `<span class="nav-count" aria-label="${draftCount} 份本地草稿">${draftCount}</span>` : ''}</button>`).join('')}</nav>`;
}

export function renderSectionTabs(view, esc) {
  const group = routes[view].group;
  const tabs = group === 'content' ? contentViews : group === 'system' ? systemTabs : [];
  if (!tabs.length) return '';
  if(group==='system'&&!systemTabs.includes(view))return '<button class="text-btn section-back" data-nav="settings">返回设置</button>';
  return `<nav class="section-tabs" aria-label="${group === 'content' ? '内容步骤' : '系统功能'}">${tabs.map(id => `<button class="section-tab ${view === id ? 'active' : ''}" data-nav="${id}" ${view === id ? 'aria-current="page"' : ''}>${esc(routes[id].title === '浏览器连接与工具' ? '浏览器' : routes[id].title === '设置' ? '连接概览' : routes[id].title)}</button>`).join('')}</nav>`;
}

export function renderLayout(view, ctx) {
  const {state, esc, icon, avatar, accountName, accountStatus, connection, menuOpen, headActions, accountNotice, notice, noticeType, busy, taskProgress, page} = ctx;
  const route = routes[view];
  const group = view === 'settings' ? '' : route.group === 'content' ? '内容工作区' : route.group === 'system' ? '系统管理' : '';
  const scrim=menuOpen?`<button class="nav-scrim" data-action="menu" aria-label="点击收起导航" tabindex="-1"></button>`:"";
  const showConnection = !['overview','settings','account','drafts','history','model'].includes(view);
  return `<div class="layout" data-view="${esc(view)}" data-account="${esc(state.accountId||'')}"><aside class="sidebar ${menuOpen?'open':''}"><div class="brand"><img src="/mark.svg" alt=""><div><strong>小红书工作台</strong></div></div>${renderNavigation(view,{icon,esc,draftCount:state.drafts.length})}<div class="rail-foot">${icon('link')}<span>资料保存在本机</span></div></aside>${scrim}<div class="main-shell"><header class="topbar"><div class="breadcrumb"><button class="btn icon-only ghost mobile-menu" data-action="menu" aria-label="${menuOpen?'收起导航':'展开导航'}" aria-expanded="${menuOpen}">${icon(menuOpen?'close':'menu')}</button>${group?`<span class="workspace">${group}</span><span class="workspace">/</span>`:''}<span>${esc(route.title)}</span></div><div class="topbar-right">${showConnection?`<span class="connection-status"><span class="status-dot ${connection.ok?'green':'red'}"></span>${esc(connection.label)}</span>`:''}<div class="account-control">${avatar()}<label class="sr-only" for="account-switcher">当前操作账号</label><select id="account-switcher" class="compact-select account-switcher" ${busy?'disabled':''}>${(state.accounts||[]).map(a=>`<option value="${esc(a.id)}" ${a.id===state.accountId?'selected':''}>${esc(a.alias||a.label)}</option>`).join('')}</select></div></div></header><main class="main" id="main"><div class="page-head"><div><h1>${esc(route.title)}</h1></div>${headActions()}</div>${renderSectionTabs(view,esc)}<div class="workspace-stage"><div class="workspace-content"><div id="account-notice">${accountNotice()}</div>${notice?`<div class="notice ${noticeType}" role="status">${icon('info')}<span>${esc(notice)}</span></div>`:''}${busy?renderProgress({title:busy,detail:busy.includes('正文')?'模型正在处理文案，完成后会显示结果。':'正在处理，请稍候。',...taskProgress},esc):''}${page()}</div></div></main></div></div>`;
}
