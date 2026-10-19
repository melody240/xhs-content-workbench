import {singleFlightPoll} from './polling.js';
import {renderPublishWorkspace} from './publish-ui.js';
import {renderCreatorMonitor} from './monitor-ui.js';
import {createAgentUI} from "./agent-ui.js";
import {normalizeRoute, isAgentRoute, renderLayout} from "./workspace-shell.js";
import {createMaterialsUI} from './materials-ui.js';
import {materialRoute} from './material-query.js';
import {coverBlob} from './cover.js';
import {createCollageUI} from './collage-ui.js';
import {createQuoteCardUI} from './quote-card-ui.js';
import {bindImageOrder, openAssetImage} from './image-order.js';
import {renderManagement} from "./management-ui.js";
import { meta, labels, options, icons, writeTools } from "./catalog.js";
import { createSkillsUI } from "./skills-ui.js";
import { accountHeaders } from "./request.js";
import {captureMotion, playMotion} from './motion.js';
import {rememberDisclosures, restoreDisclosures} from './disclosures.js';
import {enhanceDropdowns, closeDropdowns} from './dropdowns.js';

const $ = (q, root = document) => root.querySelector(q);
const $$ = (q, root = document) => [...root.querySelectorAll(q)];
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.grid}"/></svg>`;
const fmt = (v) =>
  v === null || v === undefined
    ? "—"
    : new Intl.NumberFormat("zh-CN").format(v);
const date = (v, full = false) =>
  v
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        ...(full ? { year: "numeric" } : {}),
      }).format(new Date(v))
    : "尚未采集";
const titleOf = (t) => meta[t]?.[0] || t;
const empty = (symbol, title, text, button = "") =>
  `<div class="empty"><div class="empty-symbol">${icon(symbol)}</div><h3>${title}</h3><p>${text}</p>${button}</div>`;
const btn = (label, action, cls = "", symbol = "") =>
  `<button class="btn ${cls}" data-action="${action}">${symbol ? icon(symbol) : ""}${label}</button>`;
const safeURL = (v) => {
  if (typeof v !== "string" || !v.trim()) return "";
  try {
    const u = new URL(v, location.origin);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
};
const assetURL = (v) =>
  typeof v === "string" && v.startsWith("/media/") ? v : safeURL(v);
const initialComposer = () => ({
  id: null,
  mode: "image",
  title: "",
  content: "",
  tags: "",
  assets: [],
  video: null,
  visibility: "公开可见",
  scheduleMode: "now",
  schedule: "",
  isOriginal: false,
  products: "",
  autoCommentsEnabled: false,
  autoComments: ['', ''],
});
let composer = initialComposer();
try {
  composer = {
    ...composer,
    ...JSON.parse(localStorage.getItem("xhs-composer") || "{}"),
  };
} catch {}
let state = {
  connection: { ok: false, message: "正在连接" },
  tools: [],
  drafts: [],
  history: [],
  snapshots: [],
  snapshot: null,
  settings: { endpoint: "http://127.0.0.1:18060/mcp", monitorMinutes: 0 },
  submissions: {},
};
const entry=materialRoute(location.hash.slice(1));
let collectionPanel=entry.panel,collectionTrigger=null,collectionHTML='',collectionAccount=null,collectionPlatform=entry.panel==='comments'?'抖音':'X';
let view = normalizeRoute(entry.view),
  selectedTool = "search_feeds",
  toolResult = null,
  toolArgs = {},
  toolFilter = "",
  busy = "",
  taskProgress = null,
  period = 7,
  menuOpen = false;
let accountEditId = null;
let notice = "",
  noticeType = "warning";
const skillsUI=createSkillsUI({api,task,render,reload:load,esc,icon,renderObject,accountId:()=>state.accountId,accountName,composer:()=>({title:composer.title.trim(),content:composer.content,tags:tags(),images:composer.assets.map(a=>a.path),video:composer.video?.path,visibility:composer.visibility,is_original:composer.isOriginal,...(composer.scheduleMode==='later'?{schedule_at:composer.schedule+':00+08:00'}:{})}),confirm:confirmAction,go,toast});
const agentUI=createAgentUI({currentView:()=>view,api,task,render,beforeRender:collectComposer,esc,icon,toast,go,reload:load,openDraft:id=>{const d=state.drafts.find(d=>d.id===id);if(!d)throw Error('草稿已变化，请重新读取。');composer={...initialComposer(),...d};materialsUI.setFilter({assetIds:d.contentFlowId?d.assets.map(a=>a.id):null});stash();go('publish');},useAssets:assets=>{collectComposer();if(composer.assets.length+assets.filter(a=>!composer.assets.some(b=>a.id===b.id)).length>18)throw Error('图片总数超过18张，请先整理。');for(const a of assets)if(!composer.assets.some(b=>b.id===a.id))composer.assets.push(a);composer.mode='image';stash();go('publish');},openMaterials,materialCount:jobId=>materialsUI.count(jobId),refreshMaterials:()=>materialsUI.refresh(),accountId:()=>state.accountId,isVisible:()=>isAgentRoute(view)&&view!=="model"||view==='publish'||!!collectionPanel});
const materialsUI=createMaterialsUI({api,task,render,esc,toast,go,openQuote:trigger=>quoteCardUI.open(trigger),openCollage:async(records,trigger)=>{collectComposer();await collageUI.open(records.map(r=>r.asset),trigger);},beforeRender:collectComposer,researchJob:()=>agentUI.currentJob(),commentActive:()=>agentUI.commentActive(),openCollection,showMaterials:()=>openMaterials(),accountId:()=>state.accountId,useAssets:assets=>{collectComposer();if(composer.assets.length+assets.filter(a=>!composer.assets.some(b=>a.id===b.id)).length>18)throw Error('图片总数超过 18 张，请先整理发布页。');composer.mode='image';for(const a of assets)if(!composer.assets.some(b=>b.id===a.id))composer.assets.push(a);stash();}});

const collageUI=createCollageUI({api,esc,toast,accountId:()=>state.accountId,refresh:async()=>{await materialsUI.refresh();render();},useCover:asset=>{collectComposer();if(composer.assets.length>=18&&!composer.assets.some(a=>a.id===asset.id))throw Error('图片已达18张，请先移除一张。');composer.mode='image';composer.assets=[asset,...composer.assets.filter(a=>a.id!==asset.id)];stash();render();}});

const quoteCardUI=createQuoteCardUI({api,esc,toast,accountId:()=>state.accountId,refresh:async()=>{await materialsUI.refresh();render();},useAsset:asset=>{collectComposer();if(composer.assets.length>=18&&!composer.assets.some(a=>a.id===asset.id))throw Error('图片已达18张，请先移除一张。');composer.mode='image';if(!composer.assets.some(a=>a.id===asset.id))composer.assets.push(asset);stash();render();}});

async function api(url, body, method) {
  const opt = {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: accountHeaders(state.accountId),
  };
  if (body !== undefined) {
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  const response = await fetch(url, opt);
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || "请求失败"); error.status = response.status; throw error; }
  return data;
}
function toast(message, error = false) {
  const e = document.createElement("div");
  e.className = `toast${error ? " error" : ""}`;
  e.setAttribute("role", error ? "alert" : "status");
  e.textContent = message;
  $("#toasts").append(e);
  setTimeout(() => e.remove(), 6000);
}
function stash() {
  try {
    localStorage.setItem(`xhs-composer:${state.accountId}`, JSON.stringify({...composer, accountId: state.accountId}));
  } catch {
    toast("浏览器存储已满，请使用“保存本地草稿”", true);
  }
}
function openCollection(panel,trigger){
  if(view==='publish')collectComposer();
  if(panel==='collect')panel=collectionPlatform==='X'?'updates':'comments';
  else if(panel==='updates')collectionPlatform='X';
  else if(panel==='comments'&&collectionPlatform==='X')collectionPlatform='抖音';
  if(panel==='comments')agentUI.setCollectionPlatform(collectionPlatform);
  collectionPanel=panel;collectionTrigger=trigger||document.activeElement;collectionHTML='';renderCollection();
  document.querySelector('#collection-panel [data-close-collection]')?.focus({preventScroll:true});
}
function closeCollection(){
  collectionPanel=null;collectionHTML='';collectionAccount=null;document.querySelector('#collection-panel')?.remove();
  if(collectionTrigger?.isConnected)collectionTrigger.focus({preventScroll:true});
  else document.querySelector('[data-collection="collect"]')?.focus({preventScroll:true});
}
function openMaterials(options={}){
  collectComposer();materialsUI.setFilter(options);closeCollection();
  if(view!=='publish')go('publish');else render();
}
function renderCollection(){
  if(!collectionPanel)return;
  if(collectionAccount&&collectionAccount!==state.accountId){closeCollection();return;}
  collectionAccount=state.accountId;
  const tabs=collectionPanel==='sources'?'':`<nav class="segmented collection-platforms" aria-label="采集平台">${['X','抖音','小红书'].map(p=>`<button type="button" data-collection-platform="${p}" class="${collectionPlatform===p?'active':''}" aria-pressed="${collectionPlatform===p}">${p}</button>`).join('')}</nav>`;
  const html=`<header class="collection-head"><h2 id="collection-title">${collectionPanel==='sources'?'素材博主':'采集素材'}</h2><div class="actions">${collectionPanel==='updates'?'<button class="btn small" data-collection="sources">管理博主</button>':collectionPanel==='sources'?'<button class="btn small" data-collection="collect">返回采集</button>':''}<button type="button" class="btn icon-only" data-close-collection aria-label="关闭采集面板">${icon('close')}</button></div></header><div class="collection-content">${tabs}${collectionPanel==='comments'?agentUI.collectionPage({showPlatforms:false}):materialsUI.page(collectionPanel,{platform:'x'})}</div>`;
  let panel=document.querySelector('#collection-panel');
  if(!panel){panel=document.createElement('aside');panel.id='collection-panel';panel.className='collection-drawer';panel.setAttribute('role','region');panel.setAttribute('aria-labelledby','collection-title');document.body.append(panel);}
  if(html!==collectionHTML){
    const top=panel.querySelector('.collection-content')?.scrollTop||0;
    const focused=document.activeElement?.closest('#collection-panel')?document.activeElement.id:null,selection=document.activeElement?.selectionStart;
    // Preserve a picked upload file; polling can still refresh the library.
    if(collectionPanel==='comments'&&html.includes('id="comment-manual-form"')&&panel.querySelector('#comment-manual-file')?.files?.length)return;
    panel.innerHTML=html;panel.dataset.kind=collectionPanel;collectionHTML=html;panel.querySelector('.collection-content').scrollTop=top;
    if(focused){const el=document.getElementById(focused);el?.focus({preventScroll:true});if(Number.isInteger(selection)&&el?.setSelectionRange&&el.type==='text')el.setSelectionRange(selection,selection);}
  }
  panel.querySelector('[data-close-collection]').onclick=closeCollection;
  panel.querySelectorAll('[data-collection-platform]').forEach(b=>b.onclick=()=>{collectionPlatform=b.dataset.collectionPlatform;openCollection('collect',b);});
  document.querySelectorAll('[data-collection]').forEach(b=>b.onclick=()=>openCollection(b.dataset.collection,b));
  materialsUI.bind();agentUI.bindCollection();
  enhanceDropdowns(panel);
}
function go(next) {
  const route=materialRoute(next);
  if(route.panel)return openCollection(route.panel);
  closeDropdowns();
  if (view === "publish") collectComposer();
  closeCollection();view = normalizeRoute(route.view);
  location.hash = view;menuOpen = false;render();window.scrollTo({ top: 0 });
}
window.addEventListener("keydown", e => {
 if(e.key!=="Escape"||document.querySelector('dialog[open]'))return;
 if(closeDropdowns(true))return;
 if(collectionPanel){closeCollection();return;}
 if(menuOpen){menuOpen=false;render();$(".mobile-menu")?.focus();}
});
window.addEventListener("hashchange", () => {
 const route=materialRoute(location.hash.slice(1)),next=normalizeRoute(route.view);
 if(next!==view){if(view==='publish')collectComposer();view=next;closeCollection();render();}
 if(route.panel)openCollection(route.panel);
 if(route.view!==location.hash.slice(1))history.replaceState(null,'','#'+next);
});
function accountName() {
  const workspace=state.accounts?.find(a=>a.id===state.accountId);
  if(workspace)return workspace.alias||workspace.label;
  if(["research","skills","monitor","drafts"].includes(view)){const a=state.accounts?.find(a=>a.id===state.accountId);return a?.alias||a?.label||"选择研究账号";}
  return state.login?.status === "logged_in"
    ? state.login.name || state.login.profile?.nickname || "已登录账号"
    : state.login?.status === "awaiting_scan"
      ? "等待扫码"
      : state.login?.status === "logged_out"
        ? "未登录"
        : "账号待核实";
}
function accountStatus() {
  if(view==='publish'&&state.operationChannel==='edge')return state.publishCheck?.status==='ready'?'创作后台已核实':'发布前核实创作后台';
  if(isAgentRoute(view)||view==="skills")return "浏览器通道";
  if(view==="drafts")return "本地账号空间";
  if(view==="monitor"&&state.monitor?.source==='skills')return state.monitor.connected ? "浏览器采集通道" : "浏览器扩展未连接";
  return (
    {
      logged_in: state.login?.name ? "Edge 账号已核实" : "待核实身份",
      logged_out: "未登录",
      awaiting_scan: "等待手机确认",
      session_saved: "扫码已保存，待读取身份",
      expired: "请重新获取二维码",
      error: "账号页面读取失败",
      unknown: "当前账号尚未核实",
    }[state.login?.status] || "当前账号尚未核实"
  );
}
function avatar(size = "") {
  const src = safeURL(
    state.login?.profile?.images || state.login?.profile?.imageb,
  );
  return src
    ? `<img class="avatar ${size}" src="${esc(src)}" alt="${esc(accountName())}的头像" referrerpolicy="no-referrer">`
    : `<span class="avatar ${size}">${esc(accountName()[0])}</span>`;
}
function accountNotice() {
  if(view==='publish'&&state.operationChannel==='edge')return '';
  if(view==='monitor'&&state.monitor?.source==='skills'&&state.monitor.connected)return '';
  if(view==='monitor'&&state.monitor?.source==='skills')return `<div class="notice" role="status">${icon('link')}<span>${state.monitor.connected?'通过当前 Edge 账号读取，和选题共用登录。':'请在 Edge 打开小红书并连接工作台。'}</span></div>`;
  if(['overview','account','drafts','settings'].includes(view)||isAgentRoute(view)||view==='skills')return '';
  return state.login?.status === "logged_in"
    ? ""
    : `<div class="notice warning" role="status">${icon("user")}<span>${state.operationChannel==='edge'?'Edge 通道':'独立 MCP 通道'}：${esc(state.login?.message || "当前账号尚未核实，请检查登录。")}${state.historicalSnapshotCount ? " 历史采集已保留，核实新账号前不显示为当前数据。" : ""}</span></div>`;
}
function syncAccountDisplay() {
  const account = $("#current-account");
  if (account)
    account.innerHTML = `${avatar()}<div><strong>${esc(accountName())}</strong><small>${esc(accountStatus())}</small></div>`;
  const warning = $("#account-notice");
  if (warning) warning.innerHTML = ["account","research"].includes(view)?"":accountNotice();
  const message = $("#login-status-message");
  if (message) {
    message.textContent = state.login?.message || "当前账号尚未核实。";
    message.parentElement.classList.toggle(
      "warning",
      state.login?.status !== "logged_in",
    );
  }
}
function render() {
  const focused=document.activeElement?.closest('#app')?document.activeElement:null;
  const focusId=focused?.id,selection=focused?.selectionStart,selectionEnd=focused?.selectionEnd;
  const materialScroll=document.querySelector('.publish-materials-column')?.scrollTop||0;
  rememberDisclosures($("#app"));
  const motionBefore = captureMotion($("#app"), normalizeRoute(view));
  view = normalizeRoute(view);
  const connection = view === "skills" ? skillsUI.connection() : view === "monitor" && state.monitor?.source === "skills" ? {ok:state.monitor.connected,label:state.monitor.connected?"浏览器已连接":"浏览器未连接"} : isAgentRoute(view) ? agentUI.connection() : {ok:state.connection.ok,label:state.connection.ok?(state.operationChannel==='edge'?"Edge 已连接":"独立 MCP 已连接"):"操作通道未连接"};
  const pages = {
    research:()=>agentUI.page("research"),write:()=>agentUI.page("write"),browse:()=>agentUI.page("browse"),model:()=>agentUI.page("model"),
    monitor:monitorPage,publish:publishPage,drafts:draftsPage,tools:toolsPage,skills:skillsUI.page,history:historyPage,account:accountPage,settings:settingsPage
  };
  closeDropdowns();
  $("#app").innerHTML = renderLayout(view,{state,esc,icon,avatar,accountName,accountStatus,connection,menuOpen,headActions,accountNotice,notice,noticeType,busy,taskProgress,page:()=>skillsUI.formNotice()+pages[view]()});
  restoreDisclosures($("#app"));
  const materialColumn=document.querySelector('.publish-materials-column');if(materialColumn)materialColumn.scrollTop=materialScroll;
  if(focusId){const el=document.getElementById(focusId);el?.focus({preventScroll:true});if(Number.isInteger(selection)&&['text','textarea','url'].includes(el?.type))el.setSelectionRange(selection,selectionEnd);}
  bind();
  if(view === "skills")skillsUI.bind();
  if(isAgentRoute(view)||view==="history")agentUI.bind();
  if(view==='publish')materialsUI.bind();
  if(view === "publish")updatePreview();
  document.querySelectorAll('[data-collection]').forEach(b=>b.onclick=()=>openCollection(b.dataset.collection,b));
  renderCollection();
  enhanceDropdowns(document);
  playMotion($("#app"), motionBefore);
}
function headActions() {
  if (view === "monitor")
    return `<div class="actions"><a class="btn" href="/api/export?period=${period}&account=${esc(state.accountId || '')}" download>${icon("download")}导出数据</a>${btn(busy ? "采集中…" : "刷新数据", "refresh-monitor", "primary", "refresh")}</div>`;
  if (view === "publish")
    return `<div class="actions">${btn("保存草稿", "save-draft", "", "file")}${btn("预览并发布", "review-publish", "primary", "arrow")}</div>`;
  if (view === 'research')return '<details class="workspace-help"><summary>更多</summary><button class="text-btn" data-nav="browse">浏览调研</button></details>';
  if (view === "drafts") return btn("新建笔记", "new-draft", "primary", "plus");
  if (view === "history") return btn("刷新记录", "reload", "", "refresh");
  return "";
}
function monitorPage() { return renderCreatorMonitor(state,{period,esc,date}); }

function submissionRecords() {
 const rows=Object.entries(state.submissions||{}).filter(([,s])=>['uncertain','submitting','submitted'].includes(s.status)).sort((a,b)=>Date.parse(b[1].at)-Date.parse(a[1].at));
 if(!rows.length)return '';
 return `<details class="submission-records"><summary>发布记录 · ${rows.length} 条待核对</summary><p class="hint">保留历史提交结果，避免重复发布。收起提醒只影响显示，不会改成已发布。</p>${rows.map(([key,s])=>`<div class="submission-record"><div><strong>${esc(s.title)}</strong><p class="hint">${date(s.at)} · ${s.status==='submitted'?'已提交，平台结果待核实':'提交结果尚未确认'}${s.acknowledgedAt?' · 提醒已收起':''}</p></div>${!s.acknowledgedAt?`<button type="button" class="btn small" data-ack-submission="${esc(key)}">收起此提醒</button>`:''}</div>`).join('')}<button type="button" class="text-btn" data-nav="history">查看操作记录</button></details>`;
}
function publishReadiness() {
 const sameTitle=s=>s.title?.trim()===composer.title.trim();
 const pending=Object.values(state.submissions||{}).find(s=>['uncertain','submitting','submitted'].includes(s.status)&&!s.acknowledgedAt&&sameTitle(s));
 const failed=Object.values(state.submissions||{}).filter(s=>s.status==='failed_before_submit'&&sameTitle(s)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
 const check=state.publishCheck?.mode===composer.mode&&(!failed||Date.parse(state.publishCheck.at)>=Date.parse(failed.at))?state.publishCheck:null;
 const message=pending?'当前笔记曾提交，结果还未确认。请核对平台结果，再继续。':failed&&!check?'当前笔记上次未完成提交，文稿已保留。':'';
 return (message?`<div class="notice warning" role="status">${icon('info')}<span>${esc(message)}</span></div>`:'')+submissionRecords();
}
function publishPage() {
  return renderPublishWorkspace({composer,options,esc,icon,btn,
    materials:composer.mode==='image'?materialsUI.picker():'',
    readiness:publishReadiness(),comments:postCommentsForm(),
    commentTasks:commentTasks(),uploadedList:uploadedList()});
}
function commentTasks(all=false){
 const jobs=(state.postCommentJobs||[]).filter((j,i,arr)=>arr.findIndex(other=>other.key===j.key)===i).filter(j=>all||j.status!=='completed');
 if(!jobs.length)return '';
 const labels={waiting_note:'等待核实新笔记',sending:'正在发送',completed:'评论已核实',needs_attention:'需要处理',cancelled:'尚未发送'};
 return `<details class="comment-tasks" data-disclosure="comment-history"><summary>评论记录 · ${jobs.length} 篇笔记${jobs.some(j=>j.status==='needs_attention')?' · 需要处理':''}</summary>${jobs.map(j=>`<div class="comment-task"><strong>${esc(j.title)}</strong><p class="hint">${esc(labels[j.status]||j.status)}${j.message?' · '+esc(j.message):''}</p><ol>${j.comments.map(c=>`<li>${esc(c.text)} <span class="hint">${({verified:'已核实',uncertain:'结果待核对',sending:'正在发送',pending:'未发送',blocked:'未发送'})[c.status]||''}</span></li>`).join('')}</ol><div class="actions">${j.status!=='completed'?`<button type="button" class="btn small" data-resume-comments="${esc(j.id)}">核实笔记并继续</button>`:''}${!['completed','cancelled'].includes(j.status)?`<button type="button" class="text-btn" data-cancel-comments="${esc(j.id)}">停止后续评论</button>`:''}</div></div>`).join('')}</details>`;
}
function postCommentsForm(){
 const texts=composer.autoComments||[],count=Math.max(2,texts.length);
 return `<section class="post-comments-editor"><label class="check-row"><input type="checkbox" name="autoCommentsEnabled" id="auto-comments-enabled" ${composer.autoCommentsEnabled?'checked':''}>发布后，以我的账号补充评论</label>${composer.autoCommentsEnabled?`${Array.from({length:count},(_,i)=>`<div class="field"><label for="after-comment-${i}">评论 ${i+1}</label><textarea id="after-comment-${i}" name="afterComment${i}" rows="2" maxlength="200" placeholder="写一句补充观点">${esc(texts[i]||'')}</textarea></div>`).join('')}<button class="btn small" type="button" data-action="generate-post-comments">按正文生成两条</button>`:''}</section>`;
}
async function fitCover(show=true){
 collectComposer();if(composer.mode!=='image'||!composer.assets.length)return;
 const a=state.accountId,first=composer.assets[0],blob=await coverBlob(assetURL(first.url));if(!blob){if(show)toast('封面已经是 4:3');return;}
 const response=await fetch('/api/assets?name='+encodeURIComponent('封面4-3.png'),{method:'POST',headers:accountHeaders(a,'application/octet-stream'),body:blob}),asset=await response.json();if(!response.ok)throw Error(asset.error||'封面保存失败');
 if(a!==state.accountId||composer.assets[0]?.id!==first.id)throw Error('账号或封面已变化，处理结果保存在原账号。');
 composer.assets[0]={...asset,originalAssetId:first.originalAssetId||first.id};stash();if(show)toast('封面已调整为 4:3，原图仍保留');
}
function uploadedList() {
 if(composer.mode==='video')return composer.video?`<div class="result-note">${icon('video')}<div><strong>${esc(composer.video.name)}</strong><small>${(composer.video.size/1024/1024).toFixed(1)} MB</small></div><button type="button" class="btn small" data-remove-video>移除</button></div>`:'';
 if(!composer.assets.length)return '';
 return `<p class="sr-only" id="image-order-help">拖动图片调整顺序，点击图片放大。第一张为封面；键盘可用 Alt + 方向键排序。</p><div class="uploaded-list" aria-label="已选图片，按发布顺序排列">${composer.assets.map((a,i)=>`<div class="upload-item" data-asset-order="${esc(a.id)}" draggable="true"><button type="button" class="upload-image-preview" data-preview-asset="${esc(a.id)}" aria-describedby="image-order-help" aria-label="放大第 ${i+1} 张图片：${esc(a.name)}"><img draggable="false" src="${esc(assetURL(a.url))}" alt="${esc(a.name)}"></button><span class="badge">${i===0?'封面':i+1}</span><button type="button" class="upload-remove" data-remove="${i}" aria-label="移除第 ${i+1} 张图片">${icon('close')}</button><button type="button" class="image-drag-handle" aria-label="拖动第 ${i+1} 张图片调整顺序" data-order-handle>${icon('grid')}</button></div>`).join('')}</div><p class="sr-only" id="image-order-status" role="status" aria-live="polite"></p>`;
}
function tags() {
  return [
    ...new Set(
      composer.tags
        .split(/[,，\n]/)
        .map((x) => x.trim().replace(/^#/, ""))
        .filter(Boolean),
    ),
  ];
}
function collectComposer() {
  const form = $("#composer");
  if (!form) return;
  for (const key of [
    "title",
    "content",
    "tags",
    "visibility",
    "schedule",
    "products",
  ])
    if (form.elements[key]) composer[key] = form.elements[key].value;
  composer.isOriginal = !!form.elements.isOriginal?.checked;
  composer.autoCommentsEnabled = !!form.elements.autoCommentsEnabled?.checked;
  if(form.elements.afterComment0)composer.autoComments = [0,1,2].map(i=>form.elements["afterComment"+i]?.value||" ").map(s=>s.trim()).filter(Boolean);
  stash();
}
function updatePreview() {
  if (!$("#preview")) return;
  const src =
    composer.mode === "image" ? assetURL(composer.assets[0]?.url || "") : "";
  $("#preview").innerHTML =
    `<div class="preview"><div class="preview-profile">${avatar()}<span>${esc(accountName())}</span><span class="follow">关注</span></div><div class="preview-picture">${composer.mode === "video" && composer.video ? `<video controls preload="metadata" src="${esc(assetURL(composer.video.url))}"></video>` : src ? `<img src="${esc(src)}" alt="笔记封面预览"><span class="picture-counter">1 / ${composer.assets.length}</span>` : `<div class="preview-placeholder">${icon(composer.mode === "video" ? "video" : "image")}选好素材后，在这里预览</div>`}</div><div class="preview-text"><h3 class="${composer.title ? "" : "muted"}">${esc(composer.title || "你的笔记标题")}</h3><p class="${composer.content ? "" : "muted"}">${esc(composer.content || "正文预览")}</p><div class="preview-tags">${tags()
      .map((t) => "#" + esc(t))
      .join(" ")}</div></div></div>`;
  const length = [...composer.title].length,
    body = [...composer.content].length;
  if ($("#title-count")) {
    $("#title-count").textContent = `${length} / 20`;
    $("#title-count").classList.toggle("text-danger", length > 20);
  }
  if ($("#content-count")) {
    $("#content-count").textContent = `${body} / 1000`;
    $("#content-count").classList.toggle("text-danger", body > 1000);
  }
  $("#preflight").innerHTML = `<div class="preflight"><h3>发布前检查</h3><ul>${[
    [
      composer.mode === "image" ? composer.assets.length > 0 : !!composer.video,
      "已选择发布素材",
    ],
    [
      length > 0 && length <= 20,
      !length
        ? "待填写标题"
        : length > 20
          ? "标题超出 20 字"
          : "标题在 20 字以内",
    ],
    [
      body > 0 && body <= 1000,
      !body
        ? "待填写正文"
        : body > 1000
          ? "正文超出 1000 字"
          : "正文在 1000 字以内",
    ],
  ]
    .map(
      ([ok, t]) =>
        `<li class="${ok ? "ready" : "pending"}">${icon(ok ? "check" : "info")}<span>${ok ? t : t.replace("已选择", "待选择")}</span></li>`,
    )
    .join("")}</ul></div>`;
}
function draftsPage() {
  return state.drafts.length
    ? `<div class="notice">${icon("file")}<span>这里是本机草稿，不是小红书平台草稿箱。</span></div><div class="draft-grid">${state.drafts.map((d) => `<article class="panel draft-tile">${d.assets?.[0] ? `<img src="${esc(assetURL(d.assets[0].url))}" alt="${esc(d.title || "草稿封面")}">` : ""}<span class="badge">${d.mode === "video" ? "视频" : "图文"}草稿</span><h3>${esc(d.title || "未命名笔记")}</h3><p>${esc(d.content || "还没有正文，继续写下你的想法。")}</p><span class="small">${date(d.updatedAt, true)}</span><div class="actions"><button class="btn small" data-edit-draft="${esc(d.id)}">继续编辑 ${icon("arrow")}</button><button class="btn small ghost" data-delete-draft="${esc(d.id)}" aria-label="删除本地草稿 ${esc(d.title)}">${icon("trash")}</button></div></article>`).join("")}</div>`
    : `<section class="panel">${empty("file", "留住还没写完的想法", "在发布页保存本地草稿，下次打开就能继续编辑。", btn("新建笔记", "new-draft", "primary", "plus"))}</section>`;
}
function toolsPage() {
  const selected =
    state.tools.find((t) => t.name === selectedTool) || state.tools[0];
  if (selected) selectedTool = selected.name;
  const groups = ["发布", "发现", "互动", "通知", "账号", "其他"];
  return `<div class="tool-layout"><aside class="panel tool-list"><input id="tool-search" type="text" aria-label="搜索工具" placeholder="搜索功能…" value="${esc(toolFilter)}"><div id="tool-options">${groups
    .map((group) => {
      const ts = state.tools.filter(
        (t) =>
          (meta[t.name]?.[2] || "其他") === group &&
          (titleOf(t.name) + t.name + (meta[t.name]?.[1] || ""))
            .toLowerCase()
            .includes(toolFilter.toLowerCase()),
      );
      return ts.length
        ? `<div class="tool-group">${group}</div>${ts.map((t) => `<button class="tool-item ${selectedTool === t.name ? "active" : ""}" data-tool="${t.name}">${icon(meta[t.name]?.[3])}${titleOf(t.name)}</button>`).join("")}`
        : "";
    })
    .join(
      "",
    )}</div></aside><section class="panel tool-panel">${selected ? `<div class="actions" style="justify-content:space-between"><h2>${titleOf(selected.name)}</h2><span class="badge ${writeTools.has(selected.name) ? "warning" : "blue"}">${writeTools.has(selected.name) ? "操作账号" : "读取数据"}</span></div><p>${esc(meta[selected.name]?.[1] || selected.description)}</p>${["get_feed_detail", "like_feed", "favorite_feed", "post_comment_to_feed", "reply_comment_in_feed", "user_profile"].includes(selected.name) ? `<div class="field"><label for="note-link">粘贴完整小红书链接 <small>自动填写标识</small></label><div class="actions" style="flex-wrap:nowrap"><input id="note-link" type="url" placeholder="https://www.xiaohongshu.com/explore/…"><button class="btn" data-action="parse-link">识别链接</button></div><p class="hint">使用带 xsec_token 的完整网页链接，也可以从搜索结果进入详情。</p></div>` : ""}${selected.name === "publish_content" || selected.name === "publish_with_video" ? `<div class="notice">${icon("edit")}<span>发布工作台提供图片选择、实时预览与定时设置。</span></div>${btn("打开发布工作台", "go-publish", "primary", "arrow")}` : `<form id="tool-form" class="tool-form">${schemaForm(selected.inputSchema, "", toolArgs, selected.name)}<div class="actions"><button type="submit" class="btn primary" ${busy ? "disabled" : ""}>${icon("arrow")}${writeTools.has(selected.name) ? "核对并执行" : "执行操作"}</button></div></form>`}<details><summary>接口说明与技术信息</summary><p class="small muted">${esc(selected.description)}</p><code class="small">${esc(selected.name)}</code></details>${toolResult ? `<div class="tool-result"><div class="actions" style="justify-content:space-between"><h3>操作结果</h3><span class="badge ${toolResult.result.isError ? "error" : "success"}">${toolResult.result.isError ? "执行失败" : "已返回"}</span></div>${renderResult(toolResult.result)}<p class="small muted">${date(toolResult.observedAt, true)}</p></div>` : ""}` : empty("link", "等待连接工具", "请到连接设置中检查 MCP 服务地址。", btn("打开连接设置", "go-settings"))}</section></div>`;
}
function schemaForm(schema, prefix = "", values = {}, tool = "") {
  return (
    Object.entries(schema.properties || {})
      .map(([key, s]) => {
        const name = prefix ? `${prefix}.${key}` : key,
          type = Array.isArray(s.type)
            ? s.type.find((t) => t !== "null")
            : s.type,
          required = (schema.required || []).includes(key),
          value = values?.[key] ?? "";
        let control;
        if (type === "object")
          return `<fieldset><legend>${esc(labels[key] || key)}</legend>${schemaForm(s, name, value || {}, tool)}</fieldset>`;
        let opts = options[key];
        if (key === "tab")
          opts =
            tool === "list_notifications"
              ? [
                  ["mentions", "评论和 @"],
                  ["likes", "赞和收藏"],
                  ["connections", "新增关注"],
                ]
              : [
                  ["note", "笔记"],
                  ["fav", "收藏"],
                  ["liked", "点赞"],
                ];
        if (type === "boolean")
          return `<div class="field"><label for="f-${name}">${esc(labels[key] || key)}</label><select id="f-${name}" name="${name}"><option value="">使用默认值</option><option value="true" ${value === true ? "selected" : ""}>是</option><option value="false" ${value === false ? "selected" : ""}>否</option></select><p class="hint">${esc(s.description || "")}</p></div>`;
        if (opts)
          control = `<select name="${name}" id="f-${name}"><option value="">使用默认值</option>${opts
            .map((o) => {
              const [v, label] = Array.isArray(o) ? o : [o, o];
              return `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(label)}</option>`;
            })
            .join("")}</select>`;
        else if (type === "array" || key === "content")
          control = `<textarea id="f-${name}" name="${name}" rows="4" placeholder="${type === "array" ? "每行一项" : "填写内容"}" ${required ? "required" : ""}>${esc(Array.isArray(value) ? value.join("\n") : value)}</textarea>`;
        else
          control = `<input id="f-${name}" name="${name}" type="${type === "integer" ? "number" : "text"}" value="${esc(value)}" ${type === "integer" ? 'step="1"' : ""} placeholder="${esc(labels[key] || key)}" ${required ? "required" : ""} autocomplete="off">`;
        return `<div class="field"><label for="f-${name}">${esc(labels[key] || key)}${required ? '<span class="required">必填</span>' : ""}</label>${control}${["xsec_token", "feed_id", "user_id", "comment_id"].includes(key) ? `<p class="hint">${esc(s.description)}</p>` : ""}</div>`;
      })
      .join("") || '<div class="notice">此操作无需填写参数。</div>'
  );
}
function readSchema(form, schema, prefix = "") {
  const out = {};
  for (const [key, s] of Object.entries(schema.properties || {})) {
    const name = prefix ? `${prefix}.${key}` : key,
      type = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type;
    if (type === "object") {
      const sub = readSchema(form, s, name);
      if (Object.keys(sub).length) out[key] = sub;
      continue;
    }
    const el = form.elements.namedItem(name);
    if (!el) continue;
    if (type === "boolean") {
      if (el.value !== "") out[key] = el.value === "true";
      continue;
    }
    const value = el.value.trim();
    if (value === "") continue;
    out[key] =
      type === "array"
        ? value
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean)
        : type === "integer"
          ? Number(value)
          : value;
  }
  return out;
}
function parseMCP(result) {
  for (const b of result.content || []) {
    if (b.type === "text") {
      try {
        return JSON.parse(b.text);
      } catch {}
    }
  }
  return null;
}
function renderResult(result) {
  if (
    selectedTool === "get_login_qrcode" &&
    !result.isError &&
    state.login?.status === "logged_in"
  )
    return `<div class="notice" role="status">${icon("user")}<span>账号已核实：${esc(accountName())}。可以继续使用工作台。</span></div>`;
  if (
    selectedTool === "get_login_qrcode" &&
    !result.isError &&
    state.login?.status === "expired"
  )
    return `<div class="notice warning" role="status">${icon("info")}<span>${esc(state.login.message)}</span></div>`;
  const errorText = (result.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  if (result.isError && /deadline exceeded|响应超时/i.test(errorText)) {
    return `<div class="notice warning">${icon("info")}<span>小红书页面加载超时，本次操作未能确认结果。登录检查超时不代表已登录或未登录；请稍后重试。</span></div><details><summary>查看技术错误信息</summary><pre class="raw">${esc(errorText)}</pre></details>`;
  }
  if (
    result.isError &&
    /ERR_CONNECTION|ERR_NETWORK|ERR_INTERNET/i.test(errorText)
  ) {
    return `<div class="notice warning">${icon("info")}<span>连接小红书网页时中断，本次操作未完成。已扫码并在手机确认后，请先重试检查登录，无需立即重新扫码。</span></div><details><summary>查看技术错误信息</summary><pre class="raw">${esc(errorText)}</pre></details>`;
  }
  const data = parseMCP(result);
  const blocks = result.content || [];
  let html = blocks
    .filter(
      (b) =>
        b.type === "image" &&
        ["image/png", "image/jpeg", "image/webp"].includes(b.mimeType) &&
        /^[A-Za-z0-9+/=\s]+$/.test(b.data),
    )
    .map(
      (b) =>
        `<img class="result-image" src="data:${b.mimeType};base64,${b.data}" alt="MCP 返回的二维码或图片">`,
    )
    .join("");
  if (data) {
    const list = data.feeds || data.data?.feeds || data.notes;
    if (Array.isArray(list)) {
      html += data.userBasicInfo
        ? `<div class="kv"><dt>账号昵称</dt><dd>${esc(data.userBasicInfo.nickname)}</dd></div>`
        : "";
      html += `<div class="result-list">${
        list.length
          ? list
              .map((f) => {
                const n = f.noteCard || f;
                return `<div class="result-note">${safeURL(n.cover?.urlDefault || n.cover?.url) ? `<img src="${esc(safeURL(n.cover.urlDefault || n.cover.url))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}<div><strong>${esc(n.displayTitle || n.title || "未命名笔记")}</strong><small>${esc(n.user?.nickname || n.user?.nickName || "")} · ${esc(n.interactInfo?.likedCount || "—")} 赞</small></div><button class="btn small" data-result-detail="${esc(f.id)}" data-token="${esc(f.xsecToken || "")}">详情</button></div>`;
              })
              .join("")
          : '<p class="muted small">本次没有返回笔记。</p>'
      }</div>`;
    } else if (data.note || data.data?.note) {
      const payload = data.data || data,
        n = payload.note,
        c = payload.comments;
      html += `<h3 style="margin-top:16px">${esc(n.title)}</h3><p class="result-text">${esc(n.desc)}</p><div class="actions">${[
        ["点赞", "likedCount"],
        ["收藏", "collectedCount"],
        ["评论", "commentCount"],
      ]
        .map(
          ([k, v]) =>
            `<span class="badge">${k} ${esc(n.interactInfo?.[v] || "—")}</span>`,
        )
        .join(
          "",
        )}</div><h3 style="margin-top:22px">评论</h3>${(c?.list || []).map((x) => `<div class="comment"><header><strong>${esc(x.userInfo?.nickname || x.userInfo?.nickName || "用户")}</strong><small>${esc(x.likeCount ?? "—")} 赞</small></header><p>${esc(x.content)}</p></div>`).join("") || '<p class="small muted">本次没有返回评论。</p>'}`;
    } else {
      html += renderObject(data);
    }
    html += `<details><summary>查看原始返回数据</summary><pre class="raw">${esc(JSON.stringify(data, null, 2))}</pre></details>`;
  } else
    html += blocks
      .filter((b) => b.type === "text")
      .map((b) => `<div class="result-text">${esc(b.text)}</div>`)
      .join("");
  return html;
}
function renderObject(data) {
  if (!data || typeof data !== "object")
    return `<p class="result-text">${esc(data)}</p>`;
  if (Array.isArray(data)) return data.map(renderObject).join("");
  const friendly = {
    count: "数量",
    total: "总计",
    mentions: "评论和 @",
    likes: "赞和收藏",
    connections: "新增关注",
    unread: "未读",
    title: "标题",
    content: "内容",
    nickname: "昵称",
    status: "状态",
    message: "信息",
    limit: "读取上限",
    filtered: "已过滤",
    is_logged_in: "登录状态",
  };
  return `<dl>${Object.entries(data)
    .map(
      ([k, v]) =>
        `<div class="kv"><dt>${esc(friendly[k] || labels[k] || k)}</dt><dd>${v && typeof v === "object" ? `<details><summary>展开内容</summary>${renderObject(v)}</details>` : esc(v === true ? "是" : v === false ? "否" : (v ?? "未提供"))}</dd></div>`,
    )
    .join("")}</dl>`;
}
function historyPage() {
  return submissionRecords()+commentTasks(true)+agentUI.page("logs")+`<section class="panel">${state.history.length ? `<div class="table-wrap"><table><thead><tr><th>操作</th><th>结果</th><th>说明</th><th>时间</th><th>用时</th></tr></thead><tbody>${state.history.map((h) => `<tr><td class="nowrap">${esc(h.tool === "monitor" ? "采集笔记表现" : titleOf(h.tool))}</td><td class="nowrap"><span class="history-dot ${h.status !== "success" ? "error" : ""}"></span>${h.status === "not_submitted" ? "未提交" : h.status === "error" ? "需要检查" : "已返回"}</td><td class="history-summary">${esc(h.summary)}</td><td class="small nowrap muted">${date(h.at)}</td><td class="small muted">${(h.duration / 1000).toFixed(1)}s</td></tr>`).join("")}</tbody></table></div>` : empty("clock", "操作记录会保存在这里", "读取数据、执行工具或提交笔记后，可以回看结果与执行时间。")}</section><div class="notice" style="margin-top:20px">${icon("info")}<span>发布工具返回完成不代表笔记已经公开。审核、公开状态与定时排期应在小红书后台核查；结果不确定时不会自动重试提交。</span></div>`;
}
function accountPage() {
  const login = state.login || {};
  const flow = state.loginFlow || {};
  const waiting = flow.status === "waiting";
  const signedIn = login.status === "logged_in";
  const qr = waiting && flow.qr;
  let body;
  if(state.operationChannel==='edge')body=`<p>用你日常打开的 Edge 完成登录和验证码，再核实身份。选题、采集和发布共用这个浏览器。</p><p>${esc(state.login?.message||'请先核实 Edge 登录账号。')}</p><div class="actions">${btn('核实 Edge 账号','check-login','primary','refresh')}${btn('打开小红书登录页','start-login','','link')}${btn('检查创作后台','check-publish-page','','link')}</div><p class="hint">工作台保留各账号的资料和草稿；切换账号空间不会切换 Edge 的实际登录。需要用其他账号时，请先在 Edge 切换，再到对应空间核实。</p>`;
  else if (waiting) {
    body = `<div class="scan-layout"><div class="scan-image">${qr ? `<img src="data:${esc(qr.mimeType)};base64,${esc(qr.data)}" alt="小红书登录二维码">` : icon("qr")}</div><div class="scan-copy"><span class="badge">等待手机确认</span><h2>打开小红书，扫一扫</h2><p>在手机上确认登录。成功后这里会自动显示账号。</p><p class="muted small">本次等待截止 ${date(flow.expiresAt)}。离开此页或刷新页面不会重新生成二维码。</p><div class="account-next">${btn("打开实际登录窗口", "show-login-window", "", "link")}</div><p class="muted small">会打开独立的 Chromium 窗口。如果出现滑块、拼图或短信验证，请在那个窗口完成。</p><div class="scan-wait" role="status"><span class="status-dot green"></span>${esc(login.message || "正在等待扫码结果…")}</div></div></div>`;
  } else if (signedIn) {
    body = `<div class="account-summary">${avatar("large")}<div><span class="badge success">已登录</span><h2>${esc(accountName())}</h2><p class="muted">${login.profile?.redId ? `小红书号 ${esc(login.profile.redId)} · ` : ""}核实于 ${date(login.at)}</p></div></div><div class="account-next">${btn("进入发布工作台", "go-publish", "primary", "edit")}${btn("查看笔记表现", "go-monitor", "", "chart")}</div>`;
  } else {
    const ready = login.status === "logged_out";
    body = `<div class="account-summary"><span class="account-symbol">${icon("user")}</span><div><h2>${ready ? "登录你的小红书账号" : "继续完成账号登录"}</h2><p>${ready ? "准备好手机，扫码并确认即可。" : esc(login.message || "可以先核实已有登录，或开始扫码。")}</p></div></div><div class="account-next">${!ready && login.status !== "expired" ? btn("重试核实", "check-login", "primary", "refresh") : ""}${btn(login.status === "expired" ? "重新获取二维码" : "扫码登录", "start-login", ready || login.status === "expired" ? "primary" : "", "qr")}</div>`;
  }
  const all = state.accounts || [];
  const deleted = state.archivedAccounts || [];
  const fleet = state.fleetRefresh || {};
  const edit = all.find(a => a.id === accountEditId);
  const statusText = a => a.active ? a.active.label : a.waiting ? "等待扫码" : ({logged_in:"已保存登录",logged_out:"未登录",session_saved:"待读取身份",error:"需要处理",expired:"二维码过期",unknown:"待核实"}[a.login?.status] || "待核实");
  const submitText = a => a.submissionsToday?.length ? a.submissionsToday.map(s => ({failed_before_submit:"未提交，可重试",submitting:"正在提交",uncertain:"结果待核查",submitted:"已提交，待后台核实"}[s.status] || s.status)).join("；") : "无提交记录";
  const list = `<section class="panel account-list"><div class="panel-head"><div><h2>账号列表 <span class="badge">${all.length} 个</span></h2><p>统一查看登录、草稿、采集和提交情况，按账号进入操作。</p></div><div class="actions"><button class="btn" data-action="refresh-all-accounts" ${fleet.running || busy ? "disabled" : ""}>${icon("refresh")}${fleet.running ? `正在刷新 ${fleet.completed}/${fleet.total}` : "刷新所有已登录账号"}</button>${btn("添加账号", "add-account", "primary", "plus")}</div></div>${all.length ? `<div class="table-wrap account-overview"><table><thead><tr><th>账号</th><th>内容方向</th><th>登录与任务</th><th>本地草稿</th><th>最近采集</th><th>今日提交</th><th>管理</th></tr></thead><tbody>${all.map(a=>`<tr><td><strong>${esc(a.alias || a.label)}</strong><small class="account-table-sub">${esc(a.alias ? a.label : a.login?.profile?.redId ? `小红书号 ${a.login.profile.redId}` : "尚未读取账号资料")}</small>${a.id === state.accountId ? '<span class="badge">当前操作</span>' : ""}</td><td>${esc(a.topic || "未设置")}</td><td><span class="badge ${a.login?.status === 'logged_in' ? 'success' : ''}">${esc(statusText(a))}</span>${a.lastMonitorError ? `<small class="account-table-sub">采集失败：${esc(a.lastMonitorError.message)}</small>` : ""}</td><td class="number">${a.draftCount}</td><td>${a.lastCollectedAt ? date(a.lastCollectedAt) : "尚未采集"}${a.noteCount !== undefined ? `<small class="account-table-sub">本次 ${a.noteCount} 篇</small>` : ""}</td><td>${esc(submitText(a))}</td><td><div class="account-table-actions"><button class="btn small" data-select-account="${esc(a.id)}" ${a.id === state.accountId ? 'disabled' : ''}>进入</button><button class="btn small" data-edit-account="${esc(a.id)}">备注</button><button class="btn small ghost" data-archive-account="${esc(a.id)}">删除</button></div></td></tr>`).join("")}</tbody></table></div>` : empty("user","添加第一个账号","分别扫码后，可在这里统一管理多个账号。")}${fleet.results?.length ? `<div class="account-fleet-result">本轮采集：${fleet.results.filter(r=>r.ok).length} 个成功，${fleet.results.filter(r=>!r.ok).length} 个需要检查。未登录、等待扫码或正在执行的账号会跳过。</div>` : ""}${edit ? `<form class="account-edit-form" id="account-edit-form"><h3>备注：${esc(edit.label)}</h3><div class="field-row"><div class="field"><label for="account-alias">账号备注</label><input id="account-alias" name="alias" maxlength="40" value="${esc(edit.alias)}" placeholder="例如：女性成长主号"></div><div class="field"><label for="account-topic">内容方向</label><input id="account-topic" name="topic" maxlength="100" value="${esc(edit.topic)}" placeholder="例如：女性成长、宝妈育儿"></div></div><div class="actions"><button class="btn primary" type="submit">保存备注</button>${btn("取消", "cancel-account-edit")}</div></form>` : ""}</section>${deleted.length ? `<details class="account-trash panel"><summary>已删除账号（${deleted.length}）</summary><p class="muted">账号已从工作台移除，数据和登录文件保留，可恢复使用。</p>${deleted.map(a=>`<div class="account-trash-row"><span>${esc(a.alias || a.label)} · 删除于 ${date(a.archivedAt)}</span><button class="btn small" data-restore-account="${esc(a.id)}">恢复账号</button></div>`).join("")}</details>` : ""}`;
  if (!state.accountId) return list;
  return `${list}<section class="panel account-panel"><div class="panel-head"><h2>${state.operationChannel==='edge'?'Edge 登录':'MCP 独立登录'}</h2></div><div class="panel-body">${body}</div><div class="account-bottom"><p>当前空间仅用于这个账号；其他账号请点“添加账号”。</p>${state.operationChannel!=='edge' && !waiting && signedIn ? btn("退出此账号", "logout-account", "", "logout") : ""}</div></section><p class="account-help">${icon("info")}${state.operationChannel==='edge'?'核实的身份属于 Edge；所有日常操作共用此浏览器。创作后台登录与主页登录分别核查。':'当前为高级独立 MCP 模式，Skills 已暂停。登录保存在 MCP 自己的浏览器，和 Edge 不共用。'}</p>`;
}
function settingsPage() {
  return renderManagement(state,agentUI.summary(),{esc,icon,date});
}

function bind() {
  const backgroundFile=$('#collage-background-file');if(backgroundFile)backgroundFile.onchange=()=>{const file=backgroundFile.files[0],account=state.accountId;if(!file)return;task('保存拼图背景',async()=>{if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>32*1024*1024)throw Error('请选择不超过32 MB的PNG、JPG或WebP图片。');const r=await fetch('/api/assets?name='+encodeURIComponent(file.name),{method:'POST',headers:accountHeaders(account,'application/octet-stream'),body:file});const asset=await r.json();if(!r.ok)throw Error(asset.error);if(account!==state.accountId)throw Error('账号已变化，请重新设置背景。');await api('/api/materials/background',{assetId:asset.id});await load();await materialsUI.refresh();toast('背景已更换');});};
  const commentsToggle=$("#auto-comments-enabled");if(commentsToggle)commentsToggle.onchange=()=>{collectComposer();render();};
  const switcher = $("#account-switcher");
  if (switcher) switcher.onchange = () => switchWorkspace(switcher.value);
  $$('[data-enter-workspace]').forEach(e=>e.onclick=async()=>{
    if(busy)return;
    const id=e.dataset.enterWorkspace;
    if(id!==state.accountId)await switchWorkspace(id);
    if(state.accountId===id)go(e.dataset.destination);
  });
  $$("[data-select-account]").forEach(e => {e.disabled = !!busy || e.dataset.selectAccount === state.accountId; e.onclick = () => switchWorkspace(e.dataset.selectAccount);});
  $$("[data-edit-account]").forEach(e => {e.disabled = !!busy; e.onclick = () => {accountEditId=e.dataset.editAccount;render();$("#account-alias")?.focus();};});
  $$("[data-archive-account]").forEach(e => {e.disabled=!!busy;e.onclick=()=>{
    const target=state.accounts.find(a=>a.id===e.dataset.archiveAccount);
    confirmAction("删除工作台账号", `将“${target.alias || target.label}”移入回收站并停止该账号的后台任务。草稿、素材和登录文件保留，可以恢复。`, "移入回收站", ()=>task("正在移除账号",async()=>{
      if(target.id===state.accountId)stash();
      const r=await api("/api/accounts/archive",{accountId:target.id});
      if(target.id===state.accountId){state.accountId=r.accountId;restoreComposer(state.accountId);}
      accountEditId=null;await load();
    }),true);
  };});
  $$("[data-restore-account]").forEach(e=>{e.disabled=!!busy;e.onclick=()=>task("正在恢复账号",async()=>{await api("/api/accounts/restore",{accountId:e.dataset.restoreAccount});await load();});});
  $("#account-edit-form")?.addEventListener("submit",e=>{e.preventDefault();const form=e.currentTarget;const input={accountId:accountEditId,alias:form.elements.alias.value,topic:form.elements.topic.value};task("正在保存账号备注",async()=>{await api("/api/accounts/update",input);accountEditId=null;await load();});});
  $(".skip-link").onclick = (e) => {
    e.preventDefault();
    const main = $("#main");
    main.tabIndex = -1;
    main.focus();
  };
  $$("[data-nav]").forEach((e) => (e.onclick = () => go(e.dataset.nav)));
  $$('[data-ack-submission]').forEach(e=>e.onclick=()=>task('收起历史提醒',async()=>{collectComposer();await api('/api/submissions/acknowledge',{key:e.dataset.ackSubmission});await load();}));
  $$('[data-resume-comments]').forEach(e=>e.onclick=()=>{collectComposer();const j=state.postCommentJobs.find(j=>j.id===e.dataset.resumeComments);if(!j)return;showDialog('核实本人笔记并继续评论',`<p>“${esc(j.title)}”</p><p class="hint">优先在本人主页查找。若已手动发布，可粘贴电脑端笔记链接。会核实作者和正文，再发送尚未发送的评论；结果不明的评论不会重发。</p><label for="comment-note-url">笔记链接（可选）</label><input id="comment-note-url" type="url" placeholder="https://www.xiaohongshu.com/explore/…"><ol>${j.comments.map(c=>`<li>${esc(c.text)}</li>`).join('')}</ol>`,'核实并继续',async()=>{const url=$('#comment-note-url')?.value.trim();await task('核实笔记并继续评论',async()=>{const result=await api('/api/post-comments/resume',{id:j.id,url,confirmed:true});await load();toast(result.message||'已开始核实本人笔记');});});});
  $$("[data-cancel-comments]").forEach(e=>e.onclick=()=>task("停止后续评论",async()=>{collectComposer();await api("/api/post-comments/cancel",{id:e.dataset.cancelComments});await load();}));
  $$("[data-action]").forEach((e) => {
    if (e.tagName === "BUTTON") e.type = "button";
    e.onclick = () => action(e.dataset.action);
  });
  $("#period")?.addEventListener("change", (e) => {
    period = Number(e.target.value);
    render();
    action("refresh-monitor");
  });
  $$("[data-detail]").forEach(
    (e) =>
      (e.onclick = () => {
        const n = state.snapshot.notes.find((n) => n.id === e.dataset.detail);
        if(state.monitor?.source==='skills')skillsUI.chooseDetail(n.id,n.xsecToken);
        else openDetail(n.id, n.xsecToken);
      }),
  );
  $$("[data-result-detail]").forEach(
    (e) =>
      (e.onclick = () => openDetail(e.dataset.resultDetail, e.dataset.token)),
  );
  $$("[data-tool]").forEach(
    (e) =>
      (e.onclick = () => {
        selectedTool = e.dataset.tool;
        toolArgs = {};
        toolResult = null;
        render();
      }),
  );
  $("#tool-search")?.addEventListener("input", (e) => {
    toolFilter = e.target.value;
    const pos = e.target.selectionStart;
    render();
    $("#tool-search").focus();
    $("#tool-search").setSelectionRange(pos, pos);
  });
  $("#tool-form")?.addEventListener("submit", executeToolForm);
  $$("[data-mode]").forEach(
    (e) =>
      (e.onclick = () => {
        collectComposer();
        composer.mode = e.dataset.mode;
        stash();
        render();
      }),
  );
  $$("[data-schedule]").forEach(
    (e) =>
      (e.onclick = () => {
        collectComposer();
        composer.scheduleMode = e.dataset.schedule;
        stash();
        render();
      }),
  );
  $("#composer")?.addEventListener("input", () => {
    collectComposer();
    updatePreview();
  });
  $("#composer")?.addEventListener("submit", (e) => e.preventDefault());
  $("#upload-zone")?.addEventListener("click", () => $("#file-input").click());
  $("#file-input")?.addEventListener("change", (e) =>
    uploadFiles(e.target.files),
  );
  const zone = $("#upload-zone");
  if (zone) {
    zone.ondragover = (e) => {
      e.preventDefault();
      zone.classList.add("dragover");
    };
    zone.ondragleave = () => zone.classList.remove("dragover");
    zone.ondrop = (e) => {
      e.preventDefault();
      zone.classList.remove("dragover");
      uploadFiles(e.dataTransfer.files);
    };
  }
  $$("[data-remove]").forEach(
    (e) =>
      (e.onclick = () => {
        collectComposer();
        composer.assets.splice(Number(e.dataset.remove), 1);
        stash();
        render();
      }),
  );
  $$("[data-preview-asset]").forEach(e=>e.onclick=()=>{const asset=composer.assets.find(a=>a.id===e.dataset.previewAsset);if(asset)openAssetImage({...asset,url:assetURL(asset.url)},e);});
  bindImageOrder($('#uploaded-list'), {getAssets:()=>composer.assets,onReorder:assets=>{collectComposer();composer.assets=assets;stash();render();}});
  $("[data-remove-video]")?.addEventListener("click", () => {
    collectComposer();
    composer.video = null;
    stash();
    render();
  });
  $$("[data-edit-draft]").forEach(
    (e) =>
      (e.onclick = () => {
        composer = {
          ...initialComposer(),
          ...state.drafts.find((d) => d.id === e.dataset.editDraft),
        };
        materialsUI.setFilter({assetIds:composer.contentFlowId?composer.assets.map(a=>a.id):null});
        stash();
        go("publish");
      }),
  );
  $$("[data-delete-draft]").forEach(
    (e) =>
      (e.onclick = () =>
        confirmAction(
          "删除本地草稿",
          "此操作只删除这份本机草稿。已上传的素材文件仍会保留。",
          "删除草稿",
          async () => {
            await api(
              `/api/drafts/${e.dataset.deleteDraft}`,
              undefined,
              "DELETE",
            );
            await load();
            toast("本地草稿已删除");
          },
          true,
        )),
  );
  $("#connection-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const endpoint = $("#endpoint").value;
    await task("检查 MCP 连接", async () => {
      await api("/api/connection", { endpoint });
      await load();
      toast("连接已更新");
    });
  });
  $("#monitor-source")?.addEventListener("change",async e=>{
    const source=e.target.value;
    await task("正在切换采集通道",async()=>{await api('/api/monitor/settings',{source});await load();toast('采集通道已更新');});
  });
  $("#monitor-interval")?.addEventListener("change", async (e) => {
    try {
      state.settings = await api("/api/monitor/settings", {
        minutes: Number(e.target.value),
      });
      toast(
        state.settings.monitorMinutes
          ? `已设置每 ${state.settings.monitorMinutes} 分钟采集`
          : "已关闭自动采集",
      );
    } catch (err) {
      toast(err.message, true);
    }
  });
  if (busy)
    $$(
      '[data-action="refresh-monitor"],[data-action="review-publish"],[data-action="start-login"],[data-action="add-account"],[data-action="logout-account"],[data-action="check-login"],#tool-form button[type="submit"]',
    ).forEach((e) => (e.disabled = true));
  $$("img").forEach((img) =>
    img.addEventListener(
      "error",
      () => {
        img.alt = img.alt || "图片暂时无法加载";
        img.style.objectFit = "contain";
      },
      { once: true },
    ),
  );
}
async function task(label, fn) {
  if (busy) {
    toast("当前操作还在执行，请稍候");
    return;
  }
  if(view==='publish')collectComposer();
  busy = label;
  taskProgress = null;
  notice = "";
  render();
  try {
    return await fn();
  } catch (e) {
    notice = e.message;
    noticeType = "error";
    toast(e.message, true);
  } finally {
    busy = "";
    taskProgress = null;
    render();
  }
}
function restoreComposer(id, legacy = false) {
  try {
    let saved = localStorage.getItem(`xhs-composer:${id}`);
    if (!saved && legacy) saved = localStorage.getItem("xhs-composer");
    composer = {...initialComposer(), ...JSON.parse(saved || "{}"), accountId: id};
    // Old media links are pinned to this workspace as well.
    for (const asset of [...composer.assets, ...(composer.video ? [composer.video] : [])])
      if (asset.url?.startsWith("/media/") && !asset.url.includes("account=")) asset.url += `?account=${id}`;
  } catch {composer = {...initialComposer(), accountId: id};}
}
async function switchWorkspace(id) {
  if (id === state.accountId || busy) return;
  if (view === "publish") collectComposer();
  stash();
  return task("正在切换操作账号", async () => {
    await api("/api/accounts/select", {accountId: id});
    state.accountId = id;
    toolArgs = {}; toolResult = null;
    closeCollection();collectionAccount=null;
    restoreComposer(id);
    await load();
    notice = "已切换操作账号，其他账号的登录仍保留。";
    noticeType = "success";
  });
}
async function load() {
  const previous = state.accountId;
  try {state = await api("/api/status");}
  catch (e) {
    if (e.status !== 410) throw e;
    stash(); state.accountId = null;
    state = await api("/api/status");
    restoreComposer(state.accountId);
    notice = "原账号已移入回收站，已显示当前可用账号。";
  }
  if (!previous) restoreComposer(state.accountId, state.accounts?.find(a => a.id === state.accountId)?.legacy);
  else if (previous !== state.accountId) restoreComposer(state.accountId);
  await skillsUI.refresh().catch(()=>{});
  await agentUI.refresh().catch(()=>{});
  await materialsUI.refresh().catch(()=>{});
  if((!previous||previous!==state.accountId)&&composer.contentFlowId)materialsUI.setFilter({assetIds:composer.assets.map(a=>a.id)});
  if (view === "monitor" && state.lastMonitorError && !notice) {
    notice = `最近一次采集未完成：${state.lastMonitorError.message}。页面保留上次成功的数据。`;
    noticeType = "warning";
  }
  if(entry.panel&&location.hash!=='#'+view)history.replaceState(null,'','#'+view);
  render();
}

// Read local state only. This never triggers another platform visit, and
// updating the account in other tabs does not reset a form being edited.
const pollLocalState=singleFlightPoll(async () => {
  if(!busy && document.visibilityState === "visible")await skillsUI.poll().catch(()=>{});
  if((isAgentRoute(view)&&view!=="model"||view==="settings"||view==="history"||view==='publish'||collectionPanel)&&!busy)await agentUI.poll().catch(()=>{});
  if((view==='publish'||collectionPanel)&&!busy&&document.visibilityState === "visible")await materialsUI.poll().catch(()=>{});
  if(!busy)renderCollection();
  if (busy || accountEditId || document.visibilityState !== "visible") return;
  try {
    const polledAccount=state.accountId;
    const latest = await api("/api/monitor/state");
    if(polledAccount!==state.accountId)return;
    const commentsChanged=JSON.stringify(latest.postCommentJobs)!==JSON.stringify(state.postCommentJobs);
    const accountsChanged = JSON.stringify([latest.accounts,latest.archivedAccounts,latest.fleetRefresh]) !== JSON.stringify([state.accounts,state.archivedAccounts,state.fleetRefresh]);
    const loginChanged = JSON.stringify(latest.monitor)!==JSON.stringify(state.monitor) || latest.login?.at !== state.login?.at || JSON.stringify(latest.loginFlow) !== JSON.stringify(state.loginFlow);
    const samplesChanged =
      latest.snapshot?.at !== state.snapshot?.at ||
      latest.lastMonitorError?.at !== state.lastMonitorError?.at;
    Object.assign(state, latest);
    if(commentsChanged&&view==='publish'){collectComposer();render();}
    if (view === "monitor" && (loginChanged || samplesChanged)) {
      notice = latest.lastMonitorError
        ? `最新采集未完成：${latest.lastMonitorError.message}`
        : "";
      noticeType = "warning";
      render();
    } else if (loginChanged || accountsChanged) {
      if (["overview","account"].includes(view) || (view === "tools" && selectedTool === "get_login_qrcode")) render();
      else syncAccountDisplay();
    }
  } catch (e) {
    if (e.status === 410) await load().catch(() => {});
    // Retain the last observed state and timestamp while the local server is offline.
  }
},{visible:()=>document.visibilityState === "visible"});
setInterval(()=>{void pollLocalState().catch(()=>{});},5000);
async function action(a) {
  if(a==='platform-smart-title'){
    let args;try{args=publishArgs();if(composer.mode!=='image')throw Error('平台智能标题当前仅支持图文笔记。');}catch(e){toast(e.message,true);return;}
    return task('正在上传本篇图文并获取平台智能标题',async()=>{
      const account=state.accountId;
      const r=await api('/api/skills/smart-titles',{composer:args});
      if(account!==state.accountId)return;
      collectComposer();if(JSON.stringify(publishArgs())!==JSON.stringify(args))throw Error('平台标题已生成，但本地文稿已修改；请在 Edge 核对，本地修改已保留。');composer.title=r.title;if($('#note-title'))$('#note-title').value=r.title;updatePreview();stash();await saveDraft(false);await skillsUI.refresh();render();toast('已采用平台首个智能标题');
    });
  }
  if (a === 'check-publish-page') {
    collectComposer();
    return task('正在检查真实发布页，不会提交内容', async()=>{
      const r=await api('/api/call',{name:'check_publish_page',args:{mode:composer.mode}});
      await load();
      notice=r.result.structuredContent?.publishPage?.message || state.publishCheck?.message || '发布页检查没有返回明确结果，请查看操作记录。';
      noticeType=r.result.isError ? 'warning' : 'success';
      render();
    });
  }
  if(a === "finish-publish-flow")return skillsUI.finish();
  if(a === "skills-compose"){collectComposer();return skillsUI.chooseCompose(composer.mode);}
  if (a === "cancel-account-edit") {accountEditId=null;render();return;}
  if (a === "refresh-all-accounts") return task("正在安排账号采集",async()=>{await api("/api/accounts/refresh",{});await load();});
  if (a === "menu") {
    menuOpen = !menuOpen;
    render();
    return;
  }
  if (a === "reload") return task("读取操作记录", load);
  if(a==='change-collage-background')return $('#collage-background-file')?.click();
  if(a==='reset-collage-background')return task('恢复默认背景',async()=>{await api('/api/materials/background',{});await load();toast('已恢复默认背景');});
  if (a === "refresh-monitor")
    return task("正在采集笔记表现", async () => {
      await api("/api/monitor/refresh", {period});
      await load();
      toast("笔记数据已更新");
    });
  if (a === "go-settings") return go("settings");
  if (a === "go-publish") {
    if (view === "tools" && selectedTool === "publish_with_video")
      composer.mode = "video";
    return go("publish");
  }
  if (a === "save-draft") return saveDraft();
  if (a === "review-publish") return reviewPublish();
  if (a === "fit-cover") return task("调整封面比例",fitCover);
  if (a === "generate-post-comments") {collectComposer();return task("生成发布后评论",async()=>{const r=await api("/api/post-comments/generate",{title:composer.title,content:composer.content});composer.autoComments=r.comments;composer.autoCommentsEnabled=true;stash();toast("评论已生成，发布前可以修改");});}
  if (a === "new-draft") {
    if (composer.title || composer.content || composer.assets.length)
      return confirmAction(
        "新建笔记",
        "先前的输入会继续保存在本地草稿中。",
        "保存并新建",
        async () => {
          await saveDraft(false);
          composer = initialComposer();
          stash();
          go("publish");
        },
      );
    composer = initialComposer();
    stash();
    return go("publish");
  }
  if (a === "show-login-window") {
    try {
      await api("/api/login/window", {});
      toast("请在独立的小红书窗口完成验证");
    } catch(e) { toast(e.message,true); }
    return;
  }

  if (a === "account-tool" || a === "manage-account") return go("account");
  if (a === "go-monitor") return go("monitor");
  if (a === "check-login")
    return task("正在核实 Edge 当前账号", async () => {
      const r = await api("/api/call", { name: "get_my_profile", args: {tab: "note"} });
      await load();
      if (r.result.isError) throw new Error(state.login?.message || "暂时未能读取账号，请稍后重试；无需先退出登录。");
    });
  if (a === "qrcode" || a === "start-login") {
    go("account");
    return task("正在打开 Edge 登录页", async () => {
      const r = await api("/api/call", { name: "get_login_qrcode", args: {} });
      await load();
      if (r.result.isError) throw new Error(state.login?.message || "登录页未打开，请检查 Edge 扩展连接。");
    });
  }
  if (a === "add-account") {
    if (view === "publish") collectComposer();
    stash();
    go("account");
    return task("正在添加账号空间", async () => {
      const created = await api("/api/accounts", {});
      await api("/api/accounts/select", {accountId: created.accountId});
      state.accountId = created.accountId;
      restoreComposer(state.accountId);
      toolArgs = {}; toolResult = null;
      await load();
      const r = await api("/api/call", {name: "get_login_qrcode", args: {}});
      await load();
      if (r.result.isError) throw new Error("登录页未打开，请到浏览器连接中检查扩展。");
    });
  }
  if(a === "channel-edge" || a === "channel-mcp")return confirmAction("切换操作通道",a==="channel-edge"?"以后通过 Edge 执行操作，不再后台打开独立 MCP 浏览器。":"独立 MCP 不使用 Edge 的登录。此模式暂停 Skills 和选题；同一账号重新登录可能使另一浏览器会话失效。","确认切换",()=>task("切换通道",async()=>{await api("/api/channel",{channel:a==="channel-edge"?"edge":"mcp"});await load();}));
  if (a === "logout-account") return confirmAction("退出当前账号", "只清除这个账号的登录；其他账号和本地草稿保留。", "退出此账号", () => task("正在退出当前账号", async () => {
    const r = await api("/api/call", {name: "delete_cookies", args: {}, confirmed: true});
    await load();
    if (r.result.isError) throw new Error("退出未完成，请查看结果后重试。");
  }));
  if (a === "parse-link") {
    try {
      const u = new URL($("#note-link").value);
      if (
        !(
          u.hostname === "xiaohongshu.com" ||
          u.hostname.endsWith(".xiaohongshu.com")
        )
      )
        throw new Error();
      const id = u.pathname.split("/").filter(Boolean).at(-1);
      const token = u.searchParams.get("xsec_token");
      if (!id || !token) {
        toast("请复制带 xsec_token 的完整网页链接", true);
        return;
      }
      const tool = state.tools.find((t) => t.name === selectedTool);
      toolArgs = readSchema($("#tool-form"), tool.inputSchema);
      toolArgs[selectedTool === "user_profile" ? "user_id" : "feed_id"] = id;
      toolArgs.xsec_token = token;
      render();
      toast("已识别链接");
    } catch {
      toast("请输入完整的小红书网页链接", true);
    }
    return;
  }
}
async function uploadFiles(files) {
  if (busy) return;
  collectComposer();
  const mode = composer.mode,
    list = [...files];
  if (!list.length) return;
  if (mode === "video" && list.length !== 1) {
    toast("一次选择一个视频", true);
    return;
  }
  for (const f of list) {
    if (
      (mode === "image" && !/\.(png|jpe?g|webp|gif)$/i.test(f.name)) ||
      (mode === "video" && !/\.(mp4|mov|webm)$/i.test(f.name))
    ) {
      toast("文件格式不符合当前笔记类型", true);
      return;
    }
  }
  await task("正在导入素材", async () => {
    for (const [i, f] of list.entries()) {
      const response = await fetch(
        `/api/assets?name=${encodeURIComponent(f.name)}`,
        {
          method: "POST",
          headers: accountHeaders(state.accountId, "application/octet-stream"),
          body: f,
        },
      );
      const asset = await response.json();
      if (!response.ok) throw new Error(asset.error || "上传失败");
      if (mode === "image") composer.assets.push(asset);
      else composer.video = asset;
      stash();
      busy = "正在导入素材";
      taskProgress = {completed:i+1,total:list.length,detail:"图片原尺寸保存在本机"};
      render();
    }
    toast("素材已保存到本机");
  });
}
async function saveDraft(show = true) {
  collectComposer();
  try {
    const draft = await api("/api/drafts", {...composer, accountId: state.accountId});
    composer.id = draft.id;
    stash();
    state.drafts = [draft, ...state.drafts.filter((d) => d.id !== draft.id)];
    if (show) {
      toast("已保存到本地草稿");
      render();
    }
    return draft;
  } catch (e) {
    toast(e.message, true);
    throw e;
  }
}
function publishArgs() {
  collectComposer();
  if (!composer.title.trim()) throw new Error("请填写笔记标题");
  if ([...composer.title].length > 20) throw new Error("标题不能超过 20 字");
  if (!composer.content.trim()) throw new Error("请填写正文");
  if ([...composer.content].length > 1000)
    throw new Error("正文不能超过 1000 字");
  if (tags().length > 10) throw new Error("话题最多 10 个");
  if (composer.mode === "image" && !composer.assets.length)
    throw new Error("请先选择图片");
  if (composer.mode === "video" && !composer.video)
    throw new Error("请先选择视频");
  const args = {
    title: composer.title.trim(),
    content: composer.content,
    tags: tags(),
    visibility: composer.visibility,
  };
  if (composer.mode === "image") {
    args.images = composer.assets.map((a) => a.path);
    args.is_original = composer.isOriginal;
  } else args.video = composer.video.path;
  if (composer.scheduleMode === "later") {
    if (!composer.schedule) throw new Error("请选择定时发布时间");
    args.schedule_at = composer.schedule + ":00+08:00";
    const t = Date.parse(args.schedule_at);
    if (t < Date.now() + 3600000 || t > Date.now() + 14 * 86400000)
      throw new Error("定时发布时间应在 1 小时至 14 天内");
  }
  const products = composer.products
    .split(/[,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (products.length) args.products = products;
  return args;
}
let preparingReview=false;
async function reviewPublish() {
  if(preparingReview||busy)return;preparingReview=true;
  let args;
  try {
    args = publishArgs();
    if(composer.autoCommentsEnabled&&!(composer.autoComments||[]).some(s=>s.trim()))throw Error('请填写发布后评论，或关闭评论开关。');
  } catch (e) {
    toast(e.message, true);
    return;
  }finally{preparingReview=false;}
  const picture = composer.assets[0]?.url;
  const afterComments=composer.autoCommentsEnabled?(composer.autoComments||[]).filter(s=>s.trim()):[];
  const body = `${picture && composer.mode === "image" ? `<img class="review-cover" src="${esc(assetURL(picture))}" alt="准备提交的封面">` : ""}<h3>${esc(args.title)}</h3><p class="review-body">${esc(args.content)}</p><p class="review-tags">${args.tags.map((x) => "#" + esc(x)).join(" ")}</p><div class="review-meta"><span>${composer.mode === "image" ? `${args.images.length} 张图片` : "1 个视频"}</span><span>${esc(args.visibility)}</span><span>${args.schedule_at ? `${date(args.schedule_at, true)} 定时发布` : "立即提交发布"}</span></div>${afterComments.length?`<div class="review-comments"><h3>发布后评论 · ${esc(accountName())}</h3>${afterComments.map((text,i)=>`<p>${i+1}. ${esc(text)}</p>`).join('')}</div>`:''}<label class="check-row review-manual"><input id="finish-in-browser" type="checkbox" ${args.schedule_at||composer.mode==='video'?'checked':''}>只填写表单，最后一步我在浏览器发布</label><p class="hint">本篇笔记和以上评论都会使用“${esc(accountName())}”账号。评论在确认新笔记后执行。</p>`;
  showDialog(
    "最后核对一次",
    body,
    "确认并继续",
    async () => {
      const manual=$('#finish-in-browser')?.checked;
      await saveDraft(false);
      await task("正在提交笔记，请勿重复操作", async () => {
        if(manual){await api('/api/skills/run',{command:composer.mode==='image'?'fill-publish':'fill-publish-video',composer:args,confirmed:true,afterComments});await load();notice='表单已填写，请在 Edge 核对并发布。启用的评论会等待本人新笔记确认后执行。';noticeType='success';return;}
        const r = await api("/api/call", {
          name:
            composer.mode === "image"
              ? "publish_content"
              : "publish_with_video",
          args,
          confirmed: true,
          afterComments,
        });
        await load();
        if (r.result.isError) {
          notice = r.submissionStatus === 'failed_before_submit'
            ? '本次没有点击发布。草稿已保留；点击“检查发布页”，可用后再手动重试。'
            : "发布结果需要核查。请先查看平台后台，避免重复发布。";
          noticeType = "warning";
        } else {
          notice =
            "Edge 页面已返回提交结果。请到小红书后台核对审核状态或定时排期，当前不直接标记“已公开发布”。";
          noticeType = "warning";
        }
        view = "history";
        location.hash = "history";
      });
    },
  );
}
function confirmAction(title, text, label, fn, danger = false) {
  showDialog(title, `<p>${esc(text)}</p>`, label, fn, danger);
}
function showDialog(title, body, label, fn, danger = false) {
  const d = $("#dialog");
  d.innerHTML = `<div class="dialog-head"><h2>${title}</h2><button class="btn icon-only ghost" id="close-dialog" aria-label="关闭">${icon("close")}</button></div><div class="dialog-body">${body}</div><div class="dialog-foot"><button class="btn" id="cancel-dialog">${danger ? "取消" : "返回修改"}</button><button class="btn ${danger ? "danger" : "primary"}" id="confirm-dialog">${label}</button></div>`;
  $("#close-dialog").onclick = $("#cancel-dialog").onclick = () => d.close();
  $("#confirm-dialog").onclick = async () => {
    d.close();
    try {
      await fn();
    } catch (e) {
      toast(e.message, true);
    }
  };
  d.showModal();
  enhanceDropdowns(d);
  $("#cancel-dialog").focus();
}
async function executeToolForm(e) {
  e.preventDefault();
  const tool = state.tools.find((t) => t.name === selectedTool);
  toolArgs = readSchema(e.target, tool.inputSchema);
  if (writeTools.has(selectedTool)) {
    showDialog(
      `确认${titleOf(selectedTool)}`,
      `${renderObject(toolArgs)}<p class="small muted" style="margin-top:15px">这会对当前登录的小红书账号执行实际操作。请先核对账号身份。</p>`,
      `确认${titleOf(selectedTool)}`,
      () => executeTool(selectedTool, toolArgs, true),
      selectedTool === "delete_cookies",
    );
  } else await executeTool(selectedTool, toolArgs);
}
async function executeTool(name, args, confirmed = false) {
  await task(`正在${titleOf(name)}`, async () => {
    toolResult = await api("/api/call", { name, args, confirmed });
    await load();
    if (toolResult.result.isError) toast("工具返回错误，请查看操作结果", true);
    else toast("操作结果已返回");
  });
}
function openDetail(id, token) {
  selectedTool = "get_feed_detail";
  toolArgs = { feed_id: id, xsec_token: token };
  toolResult = null;
  go("tools");
  executeTool(selectedTool, toolArgs);
}

$("#app").innerHTML =
  '<div class="boot"><h1>小红书工作台</h1><p class="muted" style="margin:12px 0 35px">正在连接本机服务…</p><div class="skeleton" style="width:40%;height:30px"></div><div class="skeleton" style="height:220px"></div></div>';
try {
  await load();
} catch (e) {
  state.connection = { ok: false, message: e.message };
  notice = "管理台连接失败，请确认本机服务正在运行。";
  noticeType = "error";
  render();
}
