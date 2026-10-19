import {DEFAULT_AUDIENCE} from './audience-options.js';
import {renderProgress} from './progress-ui.js';
import {createCommentUI} from './comments-ui.js';
import {WORD_COUNT_PRESETS, MIN_WORD_COUNT, MAX_WORD_COUNT, PERSONAL_WRITING_PROMPT, countWords, resolveWritingOptions} from './writing-options.js';
const readableIssue = value => /operation was aborted due to timeout/i.test(String(value))?'模型回复超时，已保留完成的内容，可以继续生成。':/context deadline exceeded|BROWSER_[A-Z_]+|Bad Gateway|浏览器操作超时|wait_dom_stable/i.test(String(value))?'页面读取未完成，请稍后重试。详情在设置的日志中查看。':value;
const states = {running:'执行中',stopping:'正在停止',stopped:'已停止',interrupted:'已中断',needs_attention:'需要处理',failed:'执行失败',completed:'已完成'};

export function createAgentUI(ctx) {
  const commentsUI = createCommentUI({...ctx,refreshResearch:()=>refresh()});
  const {esc, api, render, task} = ctx;
  let data=null, loadedFor=null, selectedId=null, selectedTopicId=null, pendingPreparation=null;
  let modelDraft=null, topicDraft=null, audience=DEFAULT_AUDIENCE, topicMode='popular', refreshing=false, requestSequence=0, acceptedSequence=0;
  const feedbacks = new Map();
  const writingSettings = new Map();
  const writingKey = t => ctx.accountId()+':'+current().id+':'+t.id;
  function settings(t) {
    const key=writingKey(t);
    if(!writingSettings.has(key)){
      const target=t.article?.wordCount||100;
      writingSettings.set(key,{preset:WORD_COUNT_PRESETS.includes(target)?String(target):'custom',custom:String(target),allowFictionalExperience:t.article?.allowFictionalExperience??false});
    }
    return writingSettings.get(key);
  }
  const count = v => v==null||String(v).trim()===''?'未提供':v;
  const time = v => v?new Date(v).toLocaleString('zh-CN',{hour12:false}):'未提供';
  const current = () => data?.jobs.find(j=>j.id===selectedId)||data?.jobs[0];
  const selectedTopic = () => {const topics=current()?.topics||[];return topics.find(t=>t.id===selectedTopicId)||topics.find(t=>t.preparation?.status==='running')||[...topics].filter(t=>t.preparation).sort((a,b)=>Date.parse(b.preparation.startedAt||0)-Date.parse(a.preparation.startedAt||0))[0]||topics.find(t=>t.article)||topics[0];};

  async function refresh() {
    const a=ctx.accountId();
    if(loadedFor!==a){pendingPreparation=null;selectedId=null;selectedTopicId=null;topicDraft=null;audience=DEFAULT_AUDIENCE;topicMode='popular';modelDraft=null;}
    const requestedJob=selectedId, sequence=++requestSequence;
    const next=await api('/api/agent'+(requestedJob?'?job='+encodeURIComponent(requestedJob):''));
    if(a!==ctx.accountId()||requestedJob!==selectedId||sequence<acceptedSequence)return;
    acceptedSequence=sequence;data=next;loadedFor=a;await commentsUI.refresh(current(),data.commentJobs,data.jobs);
  }

  function modelForm() {
    const m=modelDraft||data.model;
    return `<section class="research-settings"><div class="panel-head"><h2>模型连接</h2></div><form id="model-form" class="panel-body"><p class="hint">研究资料会发送给所选模型。密钥保存在本机，不返回网页。</p><div class="form-grid"><div class="field"><label for="model-provider">服务商</label><select id="model-provider" name="provider">${Object.entries(data.model.presets).map(([k,p])=>`<option value="${k}" ${m.provider===k?'selected':''}>${esc(p.label)}</option>`).join('')}</select></div><div class="field"><label for="model-name">模型名称</label><input type="text" id="model-name" name="model" required maxlength="120" value="${esc(m.model)}"></div></div><div class="field"><label for="model-key">API 密钥${data.model.hasKey?'（已保存，留空保留）':''}</label><input id="model-key" type="password" name="apiKey" autocomplete="off" placeholder="在此填写密钥"><span class="hint">更换服务商或地址时需重新填写；本机无密钥模型可留空。</span></div><details class="workspace-help"><summary>接口地址与密钥管理</summary><div class="field"><label for="model-url">接口根地址</label><input id="model-url" name="baseURL" type="url" required value="${esc(m.baseURL)}"></div><label class="check-row"><input name="clearKey" type="checkbox">清除已保存密钥</label></details><div class="research-actions"><button class="btn primary" type="submit">保存并测试连接</button><span class="hint">${data.model.verifiedAt?'上次验证：'+esc(time(data.model.verifiedAt)):'尚未验证'}</span></div></form></section>`;
  }

  function evidence(j, ids=null, comments=null) {
    return j.sources.filter(s=>!ids||ids.includes(s.id)).map(s=>`<div class="research-source"><a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.title||'查看原笔记')}</a><p class="hint">${s.detail?'已读详情':'搜索结果'} · 赞 ${esc(count(s.metrics.likes))} · 评论 ${esc(count(s.metrics.comments))} · 收藏 ${esc(count(s.metrics.favorites))}<br>采集于 ${esc(time(s.collectedAt||s.foundAt))}${s.publishedAt?' · 笔记时间 '+esc(time(Number(s.publishedAt)<1e11?Number(s.publishedAt)*1000:Number(s.publishedAt))):' · 发布时间未提供'}</p>${s.comments.filter(c=>!comments||comments.includes(c.id)).map(c=>`<blockquote><p>${esc(c.content)}</p><footer>评论点赞 ${esc(count(c.likes))}</footer></blockquote>`).join('')}${s.detail&&!s.comments.length?'<p class="hint">没有读到可见评论。</p>':''}</div>`).join('');
  }

  const historySort = (a,b) => (Date.parse(b.createdAt||'')||0) - (Date.parse(a.createdAt||'')||0);
  const historyText = j => `${j.topic||'未命名研究'} · ${states[j.status]||j.status||'未知状态'} · ${time(j.createdAt)}`;
  function history() {
    if(!data.jobs.length)return '';
    const ordered=[...data.jobs].sort(historySort), active=current()||ordered[0];
    return `<div class="research-history workspace-history">
      <label for="research-history">研究记录</label>
      <select id="research-history" data-dropdown-limit="5" aria-label="研究记录">
        ${ordered.map(j=>`<option value="${esc(j.id)}" ${j.id===active?.id?'selected':''}>${esc(historyText(j))}</option>`).join('')}
      </select>
    </div>`;
  }
  function status(j) {
    if(!j)return '';
    const running=['running','stopping'].includes(j.status);
    return `${j.error?`<div class="notice warning" role="status"><div>${esc(readableIssue(j.error))}<br>${j.canRetrySummary?'已采集资料保留，可直接重新生成。':'已保存资料；处理后可重新开始。'}</div>${j.canRetrySummary?`<button type="button" class="btn small" data-agent="retry-summary" ${data.active?'disabled':''}>用已有资料重新生成</button>`:''}</div>`:''}${running?renderProgress({title:j.status==='stopping'?'正在结束当前读取':j.events?.at(-1)?.label==='模型选择下一步'?'正在归纳选题':j.events?.at(-1)?.label||'准备执行',detail:j.status==='stopping'?'当前读取结束后停止，不再执行下一步。':`已读到 ${j.sources?.length||0} 条笔记资料 · ${j.sources?.filter(s=>s.detail).length||0} 篇完整正文`,tone:'violet',action:`<button class="btn small" data-agent="stop" ${j.status==='stopping'?'disabled':''}>停止任务</button>`},esc):''}${j.commentAutomation?.status==='running'&&!j.topics?.some(t=>t.preparation?.status==='running')?renderProgress({title:j.events?.at(-1)?.label||'正在整理评论截图',detail:`已保存 ${j.commentAutomation.saved||0} 张`,tone:'cyan'},esc):''}${data.writing?renderProgress({title:'正文正在生成',detail:'按你的写作要求成稿，完成后显示正文。',tone:'violet'},esc):''}`;
  }
  function record(j) {
    return `<details class="research-record"><summary>来源与执行记录 · 阅读 ${j.sources.filter(s=>s.detail).length} 篇</summary>${j.summary?`<p class="research-summary">${esc(j.summary)}</p>`:''}<div class="research-actions"><button class="btn" data-agent="export">导出研究资料</button></div><ol class="research-events">${j.events.map(e=>`<li><time>${esc(time(e.at))}</time><div><strong>${esc(e.label)}</strong>${e.detail?`<p>${esc(e.detail)}</p>`:''}</div></li>`).join('')}</ol><p class="hint">模型 ${esc(j.model.model)} · ${j.counts.model} 次请求 · ${j.usage.reportedCalls?esc(j.usage.totalTokens)+' tokens（部分回报）':'服务商未回报用量'}</p>${j.diandian?`<details><summary>点点方向参考</summary><p class="hint">随本轮搜索读取，仅供方向参考；平台声称的篇数不计入实际阅读量。</p><p>${esc(j.diandian.content)}</p><p class="hint">采集于 ${esc(time(j.diandian.collectedAt))}</p></details>`:''}${evidence(j)}${j.topics.filter(t=>t.article).map(t=>`<details><summary>成稿记录：${esc(t.article.title)}</summary><p>目标 ${esc(t.article.wordCount)} 字 · 实际 ${countWords(t.article.content)} 字 · 模型 ${esc(t.article.model)} · 提示词版本 ${esc(t.article.promptVersion)}</p><p>模型请求 ${esc(t.article.usage?.calls)} 次 · ${esc(t.article.usage?.totalTokens)} tokens</p>${t.article.editorNotes?.length?`<ul>${t.article.editorNotes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`:''}</details>`).join('')}</details>`;
  }
  function topicList(j) {
    if(!j?.sources)return '';
    return `<section class="research-result" aria-label="研究结果"><div class="research-result-head"><div><h2>可写的选题</h2><p class="hint">${esc(j.topic)} · ${esc(states[j.status]||j.status)}</p></div></div>${j.diandian?'<details class="field-help"><summary>点点参考</summary><p>已结合站内点点总结与本轮笔记。原始资料保存在设置的日志中。</p></details>':''}${!j.topics.length?'<p class="hint workspace-empty-line">本轮还没有形成选题。采集情况可在设置的日志中查看。</p>':`<div class="research-topics">${j.topics.map(t=>`<article class="research-topic" data-motion-key="${esc(t.id)}"><div class="research-result-head"><h3>${esc(t.title)}</h3><button class="btn primary" ${t.preparation?.draftId?'data-open-prepared':'data-prepare'}="${esc(t.id)}" ${data.active?'disabled':''}>${t.preparation?.draftId?'查看整篇笔记':t.preparation?.status==='running'?'正在生成':'选用并生成'}${ctx.icon('arrow')}</button></div><p class="topic-angle">${esc(t.angle)}</p><details><summary>选题依据与提纲</summary>${t.evidenceMode==='list'?'<p>依据搜索列表提出方向，未引用正文或评论。</p>':t.evidenceMode==='body'?'<p>依据已读正文，未引用评论。</p>':''}<p>${esc(t.angle)}</p><p>${esc(t.reason)}</p><ul>${t.outline.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>${evidence(j,t.sourceIds,t.commentIds)}</details></article>`).join('')}</div>`}</section>`;
  }
  function researchStart(browse) {
    const ready=data.model.verifiedAt&&data.browser;
    return `<section class="research-start"><form id="research-form" data-kind="${browse?'browse':'topics'}"><div class="field"><label for="research-topic">${browse?'按什么兴趣浏览？':'这次想写什么？'}</label><input type="text" id="research-topic" name="topic" required maxlength="100" placeholder="例如：女性成长、职场边界" value="${esc(topicDraft??data.topic??'')}"></div>${browse?'':`<div class="field"><label for="research-mode">选题模式</label><select id="research-mode" name="topicMode"><option value="popular" ${topicMode==='popular'?'selected':''}>最热选题</option><option value="latest" ${topicMode==='latest'?'selected':''}>最新选题</option></select></div>`}<details class="research-options"><summary>补充受众</summary><div class="field"><label for="research-audience">目标受众</label><input type="text" id="research-audience" name="audience" maxlength="300" value="${esc(audience)}" placeholder="例如：刚进入职场的女性"></div></details><div class="research-actions"><button class="btn primary" type="submit" ${!ready||data.active?'disabled':''}>${ctx.icon(browse?'search':'arrow')}${browse?'开始浏览调研':'一键选题'}</button>${data.active?`<span class="hint">${data.active.accountId===ctx.accountId()?'当前账号':'其他账号'}任务正在运行</span>`:''}</div></form>${!ready?`<div class="research-setup">${!data.model.verifiedAt?'<button class="text-btn" data-nav="model">设置模型</button>':''}${!data.browser?'<button class="text-btn" data-nav="skills">连接浏览器</button>':''}<p class="hint">完成连接后开始；执行时会核实浏览器账号。</p></div>`:''}${browse?'<p class="hint research-scope">仅执行搜索与阅读；不自动点赞、评论或关注，不保证避免风控。</p>':''}</section>`;
  }
  function article(t) {
    const a=t.article;
    if(!a)return '';
    return `<section class="research-article" data-motion-key="${esc(a.id)}" aria-label="完整正文预览"><div class="research-result-head"><h2>${esc(a.title)}</h2><span class="hint">${countWords(a.content)} 字${a.wordCount?' · 目标约 '+esc(a.wordCount)+' 字':''}</span></div><div class="research-article-body">${esc(a.content)}</div>${a.editorNotes?.length?`<details class="workspace-help"><summary>发布前核对</summary><ul>${a.editorNotes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul></details>`:''}${a.fictionalExperiences?.length?`<div class="notice warning writing-fiction" role="note"><strong>这段日常经历是虚构的</strong><p>${a.fictionalExperiences.map(n=>esc(n)).join('<br>')}</p><p>保存前请确认是否采用，或在草稿中换成自己的经历。</p></div>`:''}${(t.preparation?.plan?.tags||a.tags)?.length?`<div class="content-flow-tags" aria-label="本篇话题">${(t.preparation?.plan?.tags||a.tags).map(tag=>`<span>#${esc(tag)}</span>`).join('')}</div>`:''}<div class="research-actions"><button class="btn primary" ${t.preparation?.draftId?'data-open-prepared':'data-prepare'}="${esc(t.id)}" ${data.active?'disabled':''}>${t.preparation?.draftId?'预览整篇笔记':'生成整篇笔记'}</button></div></section>`;
  }
  function writing(j) {
    const t=selectedTopic();
    if(!t)return `<div class="research-empty"><h2>先选一个值得写的题目</h2><p>完成选题研究后，在这里生成和修改正文。</p><button class="btn primary" data-nav="research">去选题</button></div>`;
    const s=settings(t), disabled=data.writing||data.active?'disabled':'';
    return `${!t.article?`<h2 class="writing-selected-topic">${esc(t.title)}</h2>`:''}${preparation(t,j)}<details class="writing-revision" ${!t.article&&!t.preparation?'open':''}><summary>调整正文</summary><div class="writing-settings"><div class="field writing-topic"><label for="writing-topic">正在写哪个选题？</label><select id="writing-topic">${j.topics.map(x=>`<option value="${esc(x.id)}" ${x.id===t.id?'selected':''}>${esc(x.title)}${x.article?' · 已有正文':''}</option>`).join('')}</select></div><div class="field writing-length"><label for="writing-length">正文目标字数</label><select id="writing-length" aria-describedby="writing-length-hint" ${disabled}>${WORD_COUNT_PRESETS.map(n=>`<option value="${n}" ${s.preset===String(n)?'selected':''}>约 ${n} 字</option>`).join('')}<option value="custom" ${s.preset==='custom'?'selected':''}>自定义字数</option></select>${s.preset==='custom'?`<label for="writing-custom-length" class="sr-only">自定义目标字数</label><input id="writing-custom-length" type="number" min="${MIN_WORD_COUNT}" max="${MAX_WORD_COUNT}" step="1" required value="${esc(s.custom)}" placeholder="${MIN_WORD_COUNT}–${MAX_WORD_COUNT}" aria-describedby="writing-length-hint" ${disabled}>`:''}<span class="sr-only" id="writing-length-hint">实际字数供参考，不因偏差拦截正文。</span></div></div><div class="writing-voice"><label class="check-row"><input id="writing-experience" type="checkbox" ${s.allowFictionalExperience?'checked':''} ${disabled}>允许少量生活化经历</label><details class="field-help"><summary>经历设置</summary><p>可加入一个简短日常片段；虚构内容会在预览中单独标注。</p></details></div><div class="writing-toolbar"><button class="btn ${t.article?'':'primary'}" ${t.article?'data-write':'data-prepare'}="${esc(t.id)}" ${disabled}>${ctx.icon('edit')}${t.article?'重新生成正文':'生成整篇笔记'}</button><details class="research-feedback"><summary>${t.article?'修改写作要求':'补充写作要求'}</summary><div class="field"><label for="feedback-${esc(t.id)}">修改要求</label><textarea id="feedback-${esc(t.id)}" data-feedback="${esc(t.id)}" maxlength="600" rows="3" placeholder="例如：开头更直接，少讲道理，多写选择的代价">${esc(feedbacks.get(ctx.accountId()+t.id)||'')}</textarea></div></details></div></details>${article(t)}<details class="workspace-help"><summary>选题依据与参考</summary><p>${esc(t.angle)}</p><p>${esc(t.reason)}</p>${evidence(j,t.sourceIds,t.commentIds)}</details>`;
  }
  function page(surface='research') {
    if(!data||loadedFor!==ctx.accountId())return '<p role="status">正在读取当前账号的内容…</p>';
    if(surface==='model')return modelForm();
    if(surface==='logs')return history()+(current()?.sources?record(current()):'<p class="hint">暂无研究日志。</p>')+`<details class="workspace-help"><summary>内置写作要求</summary><p>${esc(PERSONAL_WRITING_PROMPT).replace(/\n/g,'<br>')}</p><p class="hint">选题按选择的最新或最热排序，读取最多三篇相关详情。选用题目后，自动生成整篇笔记并筛选相关高赞评论截图。任务最长12分钟，模型最多9轮。字数仅提示，不二次拦截。</p></details>`;
    const j=current();
    const header=history()+status(j);
    if(surface==='write')return `<section class="writing-workspace">${header}${writing(j)}</section>`;
    if(surface==='materials')return commentsUI.page(j);
    if(surface==='browse')return researchStart(true)+header+(j?.summary?`<p class="research-summary">${esc(j.summary)}</p>`:'');
    return `<div class="research-workspace">${researchStart(false)}<div class="research-output">${header}${topicList(j)}${!j?.topics?.length&&!data.active?'<section class="research-welcome"><h2>等待选题结果</h2></section>':''}</div></div>`;
  }

  function preparation(t,j){
    const p=t.preparation;if(!p)return '';
    if(p.status==='running')return renderProgress({title:p.stage===2?j.events?.at(-1)?.label||p.label:p.label,tone:'violet',action:`<button class="btn small" data-stop-preparation="${esc(t.id)}">停止生成</button>`},esc)+`<ol class="content-flow-stages" aria-label="整篇笔记生成进度">${['标题正文','匹配话题','评论素材','保存笔记'].map((label,i)=>`<li ${i===p.stage?'aria-current="step"':''} data-state="${i<p.stage?'done':i===p.stage?'current':'pending'}">${label}</li>`).join('')}</ol>`;
    const warnings=[...new Set([p.error,...p.warnings||[]].filter(Boolean))];
    return warnings.length?`<div class="notice warning" role="status">${warnings.map(w=>`<p>${esc(readableIssue(w))}</p>`).join('')}<button class="btn" data-prepare="${esc(t.id)}" data-retry="true">${p.draftId?'重试本篇素材':'继续生成'}</button></div>`:'';
  }
  function openPrepared(t){
    if(!t?.preparation?.draftId)return;
    task('读取整篇笔记',async()=>{const a=ctx.accountId();await ctx.reload();if(a===ctx.accountId())ctx.openDraft?.(t.preparation.draftId);});
  }
  function prepareTopic(id,retry=false){
    const j=current(),t=j.topics.find(t=>t.id===id),a=ctx.accountId(),s=settings(t);
    let options;try{options=resolveWritingOptions({wordCount:Number(s.preset==='custom'?s.custom:s.preset),allowFictionalExperience:s.allowFictionalExperience});}catch(e){ctx.toast(e.message);return;}
    task('开始生成整篇笔记',async()=>{const result=await api('/api/agent/prepare',{jobId:j.id,topicId:t.id,retry,feedback:feedbacks.get(a+t.id)||'',...options});if(a!==ctx.accountId())return;selectedTopicId=t.id;selectedId=j.id;pendingPreparation={jobId:j.id,topicId:t.id,accountId:a};await refresh();if(result.status==='completed'||result.status==='partial'){pendingPreparation=null;await ctx.reload();if(a===ctx.accountId())ctx.openDraft?.(result.draftId);}else ctx.go('write');});
  }
  function bind() {
    commentsUI.bind();
    document.querySelectorAll('[data-prepare]').forEach(b=>b.onclick=()=>prepareTopic(b.dataset.prepare,b.dataset.retry==='true'));
    document.querySelectorAll('[data-open-prepared]').forEach(b=>b.onclick=()=>openPrepared(current()?.topics.find(t=>t.id===b.dataset.openPrepared)));
    document.querySelectorAll('[data-stop-preparation]').forEach(b=>b.onclick=()=>task('正在停止后续生成',async()=>{await api('/api/agent/prepare/stop',{jobId:current().id,topicId:b.dataset.stopPreparation});await refresh();}));
    const f=document.querySelector('#research-form');
    if(f){f.oninput=()=>{topicDraft=f.elements.topic.value;audience=f.elements.audience.value;if(f.elements.topicMode)topicMode=f.elements.topicMode.value;};f.onsubmit=e=>{e.preventDefault();f.oninput();task('正在启动研究',async()=>{const j=await api('/api/agent/start',{kind:f.dataset.kind,topic:topicDraft,audience,topicMode});selectedId=j.id;selectedTopicId=null;await refresh();});};}
    const mode=document.querySelector('#research-mode');if(mode)mode.onchange=()=>{topicMode=mode.value;render();};
    const mf=document.querySelector('#model-form');
    if(mf){mf.oninput=()=>{modelDraft={provider:mf.elements.provider.value,model:mf.elements.model.value,baseURL:mf.elements.baseURL.value};};mf.elements.provider.onchange=()=>{const p=data.model.presets[mf.elements.provider.value];mf.elements.model.value=p.model;mf.elements.baseURL.value=p.baseURL;mf.elements.apiKey.value='';mf.oninput();};mf.onsubmit=e=>{e.preventDefault();const b={...modelDraft||data.model,apiKey:mf.elements.apiKey.value,clearKey:mf.elements.clearKey.checked};mf.elements.apiKey.value='';task('正在测试模型连接',async()=>{try{await api('/api/model',b);await api('/api/model/test',{});ctx.toast('模型连接测试通过');modelDraft=null;ctx.go('settings');}finally{await refresh();}});};}
    const picker=document.querySelector('#research-history');
    if(picker) picker.onchange=()=>{selectedId=picker.value;selectedTopicId=null;task('正在读取研究记录',refresh);};
    const topic=document.querySelector('#writing-topic');if(topic)topic.onchange=()=>{selectedTopicId=topic.value;selectedId=current().id;render();};
    const length=document.querySelector('#writing-length');if(length)length.onchange=()=>{settings(selectedTopic()).preset=length.value;render();document.querySelector(length.value==='custom'?'#writing-custom-length':'#writing-length')?.focus();};
    const customLength=document.querySelector('#writing-custom-length');if(customLength)customLength.oninput=()=>{settings(selectedTopic()).custom=customLength.value;};
    const experience=document.querySelector('#writing-experience');if(experience)experience.onchange=()=>{settings(selectedTopic()).allowFictionalExperience=experience.checked;};
    document.querySelectorAll('[data-open-topic]').forEach(b=>b.onclick=()=>{selectedTopicId=b.dataset.openTopic;selectedId=current().id;ctx.go('write');});
    document.querySelectorAll('[data-agent]').forEach(b=>b.onclick=()=>{const a=b.dataset.agent;if(a==='retry-summary')task('用已有资料生成选题',async()=>{const j=await api('/api/agent/retry-summary',{id:current().id});selectedId=j.id;selectedTopicId=null;await refresh();});else if(a==='stop')task('正在请求停止',async()=>{await api('/api/agent/stop',{id:current().id});await refresh();});else if(a==='export'){const j=current();const url=URL.createObjectURL(new Blob([JSON.stringify(j,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='研究资料-'+j.id+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}});
    document.querySelectorAll('[data-feedback]').forEach(el=>el.oninput=()=>feedbacks.set(ctx.accountId()+el.dataset.feedback,el.value));
    document.querySelectorAll('[data-write]').forEach(b=>b.onclick=()=>{const j=current(),t=j.topics.find(t=>t.id===b.dataset.write),a=ctx.accountId(),s=settings(t);const custom=document.querySelector('#writing-custom-length');if(custom&&!custom.reportValidity())return;let options;try{options=resolveWritingOptions({wordCount:Number(s.preset==='custom'?s.custom:s.preset),allowFictionalExperience:s.allowFictionalExperience});}catch(e){ctx.toast(e.message);return;}task('正在生成正文，通常需要 1–3 分钟',async()=>{await api('/api/agent/write',{jobId:j.id,topicId:t.id,articleId:t.article?.id||null,feedback:feedbacks.get(a+t.id)||'',wordCount:options.wordCount,allowFictionalExperience:options.allowFictionalExperience});if(ctx.accountId()!==a)return;await refresh();ctx.toast('正文已生成，请核对后保存草稿');});});
    document.querySelectorAll('[data-adopt]').forEach(b=>b.onclick=()=>{const j=current(),t=j.topics.find(t=>t.id===b.dataset.adopt),a=ctx.accountId();task('正在保存正文草稿',async()=>{const result=await api('/api/agent/adopt',{jobId:j.id,topicId:t.id,articleId:t.article.id});if(ctx.accountId()!==a)return;await refresh();await ctx.reload();ctx.openDraft?.(result.draftId);ctx.toast('正文与评论截图已带入编辑');});});
  }
  return {
    page, bind, refresh,
    collectionPage:options=>commentsUI.page(options),setCollectionPlatform:platform=>commentsUI.setPlatform(platform),bindCollection:()=>commentsUI.bind(),
    currentJob:()=>current(),commentActive:()=>commentsUI.active(),
    summary:()=>loadedFor===ctx.accountId()?{model:data?.model,browser:data?.browser,active:data?.active,writing:data?.writing}:null,
    connection:()=>({ok:!!data?.browser,label:data?.browser?'浏览器已连接':'浏览器未连接'}),
    async poll(){if(refreshing)return;refreshing=true;try{const before=JSON.stringify(data)+commentsUI.signature();await refresh();if(pendingPreparation&&pendingPreparation.accountId===ctx.accountId()&&pendingPreparation.jobId===current()?.id&&pendingPreparation.topicId===selectedTopic()?.id){const t=selectedTopic();if(t.preparation?.draftId&&['completed','partial'].includes(t.preparation.status)){pendingPreparation=null;if(!ctx.currentView||ctx.currentView()==='write'){await ctx.reload();ctx.openDraft?.(t.preparation.draftId);return;}}}if(!commentsUI.editing()&&before!==JSON.stringify(data)+commentsUI.signature()&&ctx.isVisible()){ctx.beforeRender?.();render();}}finally{refreshing=false;}}
  };
}
