// Pure publishing view. State and side effects stay with app.js and domain UIs.
export function renderPublishWorkspace({composer, options, esc, icon, btn, materials, readiness, comments, commentTasks, uploadedList}) {
  return `${readiness}${composer.preparation?.warnings?.length?`<div class="notice warning" role="status">${[...new Set(composer.preparation.warnings)].map(w=>`<p>${esc(w)}</p>`).join('')}</div>`:''}<div class="publish-workspace ${composer.mode==='video'?'video-workspace':''}">${composer.mode==='image'?`<aside class="publish-materials-column">${materials}</aside>`:''}<section class="panel editor publish-editor-column">
<div class="publish-editor-head">
<h2>编辑笔记</h2>
</div>
<div class="tabbar" role="tablist" aria-label="笔记类型">
<button role="tab" aria-selected="${composer.mode === "image"}" data-mode="image" class="${composer.mode === "image" ? "active" : ""}">${icon("image")}图文笔记</button>
<button role="tab" aria-selected="${composer.mode === "video"}" data-mode="video" class="${composer.mode === "video" ? "active" : ""}">${icon("video")}视频笔记</button>
</div>
<form id="composer" novalidate>
<div class="field composer-media">
<div class="field-label">${composer.mode === "image" ? "已选图片" : "视频素材"}${composer.mode === "image" ? `<span class="media-count">${composer.assets.length} / 18</span>` : ""}</div>
<input id="file-input" type="file" accept="${composer.mode === "image" ? "image/png,image/jpeg,image/webp,image/gif" : "video/mp4,video/quicktime,video/webm"}" ${composer.mode === "image" ? "multiple" : ""} hidden>
<button type="button" class="upload-zone ${composer.assets.length?'compact-upload':''}" id="upload-zone" aria-describedby="upload-limit">${icon("plus")}<strong>${composer.mode === "image" ? "添加图片" : "添加视频"}</strong>
</button>
<span class="sr-only" id="upload-limit">${composer.mode === "image" ? "支持 PNG、JPG、WebP、GIF，每张不超过 32 MB，可拖入图片" : "支持 MP4、MOV、WebM，不超过 1 GB"}</span>
<div id="uploaded-list">${uploadedList}</div>
</div>
<div class="field">
<div class="title-field-head"><label for="note-title">笔记标题 <small id="title-count">${[...composer.title].length} / 20</small>
</label>
${composer.mode==='image'?'<button type="button" class="btn small" data-action="platform-smart-title">平台智能标题</button>':''}</div>
<input type="text" id="note-title" name="title" value="${esc(composer.title)}" placeholder="给这篇笔记起一个标题" autocomplete="off">
</div>
<div class="field">
<label for="note-content">正文内容 <small id="content-count">${[...composer.content].length} / 1000</small>
</label>
<textarea id="note-content" name="content" rows="8" placeholder="写下你想表达的内容…">${esc(composer.content)}</textarea>
</div>
<div class="field">
<label for="note-tags">话题 <small>最多 10 个</small>
</label>
<input id="note-tags" name="tags" type="text" value="${esc(composer.tags)}" placeholder="女性成长，边界感，个人成长">
<details class="field-help">
<summary>话题填写帮助</summary>
<p>用逗号分隔，提交前在 Edge 核对正式话题。</p>
</details>
</div>
<div class="field-row">
<div class="field">
<label for="visibility">谁可以看</label>
<select id="visibility" name="visibility">${options.visibility.map((x) => `<option ${composer.visibility === x ? "selected" : ""}>${x}</option>`).join("")}</select>
</div>
<div class="field">
<label>发布方式</label>
<div class="segmented">
<button type="button" data-schedule="now" class="${composer.scheduleMode === "now" ? "active" : ""}">立即发布</button>
<button type="button" data-schedule="later" class="${composer.scheduleMode === "later" ? "active" : ""}">定时发布</button>
</div>
</div>
</div>${composer.scheduleMode === "later" ? `<div class="field">
<label for="schedule-time">定时发布时间 <small>北京时间</small>
</label>
<input type="datetime-local" id="schedule-time" name="schedule" value="${esc(composer.schedule)}">
<p class="hint">选择 1 小时至 14 天内的时间。</p>
</div>` : ""}${comments}<details class="workspace-help">
<summary>配乐</summary>
<p>工作台暂未接入平台曲库或自动选音乐。图文请在小红书官方编辑器查看是否有“添加音乐”；没有入口时用手机编辑。视频可先在剪映等编辑器配好音乐，再上传成片。</p>
<p class="hint">需要平台曲库音乐时，在官方编辑器选好并试听后手动发布。工作台不能确认音乐是否保留。</p>
</details>
<details data-disclosure="publish-options">
<summary>更多发布选项</summary>${composer.mode === "image" && composer.assets.length ? `<details class="workspace-help">
<summary>封面比例</summary>
<p>默认保留原图。生成 4:3 封面会添加白底；想要无白边的 4:3 封面，请先准备好相应尺寸图片。</p>
<button type="button" class="btn small" data-action="fit-cover">生成 4:3 白底封面</button>
</details>` : ''}<div class="actions">${btn("检查发布页", "check-publish-page", "", "link")}</div>${composer.mode === "image" ? `<div class="field">
<label class="check-label">
<input type="checkbox" name="isOriginal" ${composer.isOriginal ? "checked" : ""}>声明原创</label>
<p class="hint">请按素材实际来源决定是否声明。</p>
</div>` : ""}<div class="field">
<label for="products">关联商品</label>
<input id="products" name="products" type="text" value="${esc(composer.products)}" placeholder="可选，填写商品名称或 ID">
<p class="hint">商品绑定请在 Edge 真实发布表单中手动核对。</p>
</div>
<p class="hint">当前发布接口没有 AI 内容声明参数。含 AI 生成内容的笔记，请在平台核对相应声明。</p>
</details>
</form>
<details class="composer-preview" data-disclosure="note-preview">
<summary>查看笔记预览</summary>
<div id="preview">
</div>
<div class="preview-note">${icon("info")}<span>实际排版、审核和公开状态以小红书平台为准。</span>
</div>
</details>
<div id="preflight">
</div>${commentTasks}</section>
</div>`;
}
