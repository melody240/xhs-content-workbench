const field=(label,flag,extra={})=>({label,flag,type:'string',...extra});
const note={feedId:field('笔记 ID','feed-id',{required:true}),xsecToken:field('笔记链接中的 xsec_token','xsec-token',{required:true})};
export const SKILLS_COMMANDS=[
 {name:'search-feeds',label:'搜索笔记',group:'发现',description:'按关键词和互动排序查找相关内容。',fields:{keyword:field('搜索关键词','keyword',{required:true}),sortBy:field('排序','sort-by',{options:['综合','最新','最多点赞','最多评论','最多收藏']}),noteType:field('笔记类型','note-type',{options:['不限','图文','视频']}),listOnly:field('列表采集','list-only',{type:'boolean',internal:true}),diandian:field('点点方向参考','diandian',{type:'boolean',internal:true})}},
 {name:'get-feed-detail',label:'笔记详情与评论',group:'发现',description:'读取指定笔记及已加载评论，最多加载 50 条。',fields:{...note,loadAllComments:field('继续加载评论（最多 50 条）','load-all-comments',{type:'boolean'})}},
 {name:'list-feeds',label:'首页推荐',group:'发现',description:'读取当前浏览器账号的首页推荐。',fields:{}},
 {name:'user-profile',label:'查看用户主页',group:'发现',description:'读取指定用户主页及笔记。',fields:{userId:field('用户 ID','user-id',{required:true}),xsecToken:field('主页链接中的 xsec_token','xsec-token',{required:true})}},
 {name:'post-comment',label:'发表评论',group:'互动',write:true,description:'用已核实的浏览器账号发表评论，执行前会再次确认。',fields:{...note,content:field('评论内容','content',{required:true,multiline:true})}},
 {name:'reply-comment',label:'回复评论',group:'互动',write:true,description:'回复指定评论。',fields:{...note,commentId:field('评论 ID','comment-id',{required:true}),content:field('回复内容','content',{required:true,multiline:true})}},
 {name:'like-feed',label:'点赞 / 取消点赞',group:'互动',write:true,description:'修改该笔记的点赞状态。',fields:{...note,unlike:field('取消点赞','unlike',{type:'boolean'})}},
 {name:'favorite-feed',label:'收藏 / 取消收藏',group:'互动',write:true,description:'修改该笔记的收藏状态。',fields:{...note,unfavorite:field('取消收藏','unfavorite',{type:'boolean'})}},
 {name:'fill-publish',label:'填写图文表单',group:'发布',write:true,compose:true,description:'使用发布工作台当前内容，在浏览器上传图片并填写表单，停在最终发布之前。',fields:{}},
 {name:'fill-publish-video',label:'填写视频表单',group:'发布',write:true,compose:true,description:'使用发布工作台当前视频与文案填写表单。此通道视频上限 32 MB。',fields:{}},
 {name:'long-article',label:'长文排版',group:'发布',write:true,compose:true,description:'使用当前标题正文创建长文并获取可选模板，不提交发布。',fields:{}},
 {name:'select-template',label:'选择长文模板',group:'发布',write:true,continuation:'long',description:'选择本轮长文排版返回的模板名称。',fields:{name:field('模板名称','name',{required:true})}},
 {name:'next-step',label:'长文下一步',group:'发布',write:true,continuation:'long',description:'进入长文发布页并填写描述，最后在浏览器核对。',fields:{content:field('笔记描述','content-file',{required:true,multiline:true})}},
 {name:'save-draft',label:'保存平台草稿',group:'发布',write:true,continuation:'ready',description:'暂存本轮已填写的表单。程序返回后，请到平台草稿箱重新打开核查。',fields:{}},
];
export function cliArguments(command,input={}){
 const spec=SKILLS_COMMANDS.find(s=>s.name===command);if(!spec)throw new Error('未开放的 Skills 命令');
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('参数格式错误');
 for(const key of Object.keys(input))if(!Object.hasOwn(spec.fields,key))throw new Error('存在不支持的参数');
 const out=[command];
 for(const [key,f] of Object.entries(spec.fields)){
  const value=input[key];
  if(f.type==='boolean'){if(value!==undefined&&typeof value!=='boolean')throw new Error(`${f.label}格式错误`);if(value)out.push(`--${f.flag}`);continue;}
  if(value!==undefined&&typeof value!=='string')throw new Error(`${f.label}格式错误`);
  const text=(value||'').trim();if(f.required&&!text)throw new Error(`请填写${f.label}`);
  if(text.length>4000)throw new Error(`${f.label}过长`);
  if(f.options&&text&&!f.options.includes(text))throw new Error(`${f.label}选项无效`);
  if(text && f.flag!=='content-file')out.push(`--${f.flag}=${text}`);
 }
 if(command==='get-feed-detail')out.push('--max-comment-items=50');
 return {spec,args:out};
}
