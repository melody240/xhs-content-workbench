import {creatorSnapshot} from './creator-metrics.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {buildExtension} from './skills-extension.mjs';
import {SKILLS_COMMANDS,cliArguments} from './skills-catalog.mjs';
import {validatePublish,normalizeFeed} from '../core.mjs';
const fail=(message,status=409,code)=>Object.assign(new Error(message),{status,...(code?{code}:{})});
const pageErrorCodes=new Set(['BROWSER_IDENTITY_MISMATCH','BROWSER_LOGIN_REQUIRED','BROWSER_VERIFICATION_REQUIRED','BROWSER_IDENTITY_UNVERIFIED','BROWSER_PAGE_UNAVAILABLE','BROWSER_PAGE_NOT_READY','BROWSER_PAGE_READ_FAILED']);
const allowedMethods=new Set(['wb_smart_titles','wb_read_xhs_comments','wb_creator_metrics','wb_douyin_search','wb_douyin_comments','wb_douyin_capture_comment','wb_douyin_close','wb_own_recent_notes','wb_source_status','wb_source_scan','wb_source_open','wb_capture_material','wb_post_own_comment','wb_form_state','wb_publish_assets','wb_save_draft','wb_creator_check','wb_submit_publish','wb_capture_comment','wb_identity','wb_open_login','navigate','wait_for_load','set_file_input','click_element','click_nth_element','click_element_by_text','press_key','type_text','evaluate','wait_dom_stable','wait_for_selector','has_element','get_elements_count','get_element_text','get_element_attribute','get_scroll_top','get_viewport_height','get_url','get_elements_info','get_iframe_text','input_text','input_content_editable','scroll_by','scroll_to','scroll_to_bottom','scroll_element_into_view','scroll_nth_element_into_view','dispatch_wheel_event','mouse_move','mouse_click','remove_element','hover_element','select_all_text']);
export function matchSkillsIdentity(expected,actual){
 let matches=0;
 for(const k of ['userId','redId'])if(expected?.[k]&&actual?.[k]){if(String(expected[k])!==String(actual[k]))return false;matches++;}
 return matches>0;
}
export class SkillsIntegration{
 constructor({root,data,port,runner,recordIdentity,commandTimeout=90000}){this.commandTimeout=commandTimeout;this.stalled=null;this.recordIdentity=recordIdentity;this.root=root;this.data=data;this.port=port;this.runner=runner;this.pending=new Map();this.binding=null;this.form=null;this.active=null;this.session=null;this.child=null;this.extension=null;this.lastError='';}
 async init(server){
  this.vendor=path.join(this.root,'vendor/xiaohongshu-skills');
  this.directory=path.join(this.data,'skills-extension');
  this.python=process.env.WORKBENCH_PYTHON || path.join(this.vendor,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const secret=path.join(this.data,'skills-bridge-token');
  try{this.token=(await fs.readFile(secret,'utf8')).trim();}catch(e){if(e.code!=='ENOENT')throw e;this.token=randomBytes(32).toString('hex');await fs.writeFile(secret,this.token,{mode:0o600});}
  this.available=false;
  try{await fs.access(this.python,fs.constants.X_OK);await buildExtension({vendor:this.vendor,directory:this.directory,port:this.port,token:this.token});this.available=true;}catch(e){this.lastError='Skills 依赖未就绪：'+e.message;}
  this.wss=new WebSocketServer({noServer:true,maxPayload:50*1024*1024,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
   const origin=req.headers.origin;
   if(req.url!=='/skills-bridge'|| ![`127.0.0.1:${this.port}`,`localhost:${this.port}`].includes(req.headers.host) || (origin&&!/^chrome-extension:\/\/[a-p]{32}$/.test(origin))){socket.destroy();return;}
   this.wss.handleUpgrade(req,socket,head,ws=>this.accept(ws,origin));
  });
 }
 accept(ws,origin){
  const timer=setTimeout(()=>ws.close(1008,'握手超时'),5000);
  ws.on('error',()=>{});
  ws.once('message',async raw=>{
   clearTimeout(timer);let hello;try{hello=JSON.parse(raw);}catch{ws.close(1008);return;}
   const token=Buffer.from(String(hello.token||''));const expected=Buffer.from(this.token);
   if(token.length!==expected.length||!timingSafeEqual(token,expected)){ws.close(1008,'未授权');return;}
   if(hello.role==='extension'){
    if(!origin||this.extension){ws.close(1008,'只连接一个浏览器配置');return;}
    this.capabilities=Array.isArray(hello.capabilities)?hello.capabilities.filter(x=>['creator-smart-titles-v1','creator-metrics-v1','comment-capture-v1','task-readiness-v1','form-state-v1','source-library-v1','douyin-comments-v1','own-comments-v2'].includes(x)):[];this.extension=ws;this.session=randomUUID();this.binding=null;this.stalled=null;if(this.form)this.form.phase='uncertain';this.lastError='';
    ws.on('message',raw=>{let msg;try{msg=JSON.parse(raw);}catch{return;}
     // A timed-out request releases its resolver immediately. Keep only a small
     // stall marker so a late reply can unlock the bridge without replaying it.
     if(this.stalled?.id===msg.id&&this.stalled.session===this.session){this.stalled=null;if(this.lastCommand?.id===msg.id){this.lastCommand.status=msg.error?'error':'returned';this.lastCommand.finishedAt=new Date().toISOString();}}
     const p=this.pending.get(msg.id);if(p&&p.session===this.session){this.pending.delete(msg.id);clearTimeout(p.timer);if(this.lastCommand?.id===msg.id){this.lastCommand.status=msg.error?'error':'returned';this.lastCommand.finishedAt=new Date().toISOString();}msg.error?p.reject(fail(String(msg.error),502,pageErrorCodes.has(msg.errorCode)?msg.errorCode:undefined)):p.resolve(msg.result);}});
    ws.on('close',()=>{if(this.extension!==ws)return;this.extension=null;this.session=null;this.binding=null;this.stalled=null;if(this.form)this.form.phase='uncertain';for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(fail('浏览器扩展已断开，请核查页面后重新连接。',502));}this.pending.clear();this.child?.kill('SIGTERM');});
   }else if(hello.role==='cli'&&!origin){
    try{if(!this.active||hello.session!==this.session)throw fail('操作会话已过期，请重新核实账号。');
     const result=hello.method==='ping_server'?{extension_connected:!!this.extension}:await this.call(hello.method,hello.params,hello.session);
     if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({result}));
    }catch(e){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({error:e.message}));}finally{ws.close();}
   }else ws.close(1008,'无效连接');
  });
 }
 call(method,params={},session=this.session){
  if(!allowedMethods.has(method))return Promise.reject(fail('工作台未开放此浏览器命令。',403));
  if(this.stalled)return Promise.reject(fail('上一条 Edge 命令尚未结束。请检查页面或重新加载现有扩展；无需重新扫码。'));
  if(!this.extension||!session||session!==this.session)return Promise.reject(fail('请先在浏览器加载工作台扩展。'));
  const id=randomUUID();
  this.lastCommand={id,method,startedAt:new Date().toISOString(),status:'running'};
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);this.stalled={id,method,session};if(this.lastCommand?.id===id)this.lastCommand.status='timed_out';reject(fail('浏览器操作超时（'+method+'），请检查实际页面；登录保留，不会自动重试。上一条命令结束前暂停新操作。',504));},this.commandTimeout);
   this.pending.set(id,{resolve,reject,timer,session});
   this.extension.send(JSON.stringify({id,method,params}),e=>{if(e){this.pending.delete(id);clearTimeout(timer);reject(fail('浏览器连接发送失败',502));}});
  });
 }
 composerKey(composer){return createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(composer).sort(([a],[b])=>a.localeCompare(b))))).digest('hex');}
 status(accountId){const bound=!!this.extension&&!this.stalled&&this.binding?.accountId===accountId;return {installed:this.available,source:'https://github.com/autoclaw-cc/xiaohongshu-skills',extensionDirectory:this.directory,connected:!!this.extension,stalled:!!this.stalled,lastCommand:this.lastCommand?{method:this.lastCommand.method,status:this.lastCommand.status,startedAt:this.lastCommand.startedAt,finishedAt:this.lastCommand.finishedAt}:null,creatorMetrics:!!this.extension&&this.capabilities?.includes('creator-metrics-v1'),taskReadiness:!!this.extension&&this.capabilities?.includes('task-readiness-v1'),commentCapture:!!this.extension&&this.capabilities?.includes('comment-capture-v1'),sourceLibrary:!!this.extension&&this.capabilities?.includes('source-library-v1'),douyinComments:!!this.extension&&this.capabilities?.includes('douyin-comments-v1'),ownComments:!!this.extension&&this.capabilities?.includes('own-comments-v2'),active:this.active,binding:this.binding,form:this.form?{accountId:this.form.accountId,phase:this.form.phase,title:this.form.title}:null,ready:bound&&this.binding.source!=='creator',creatorReady:bound&&this.binding.source==='creator',lastError:this.lastError,commands:SKILLS_COMMANDS};}
 async operation(a,label,fn){
  if(!this.available)throw fail('Skills 运行环境未就绪。',503);
  if(this.active)throw fail('浏览器正在执行其他 Skills 操作，请等待完成。');
  this.active={label,accountId:a.id,startedAt:new Date().toISOString()};
  const session=this.session;
  try{const result=await fn(session);if(session!==this.session)throw fail('浏览器连接已变化，本次结果不能确认。');this.lastError='';return result;}
  catch(e){this.lastError=e.message;throw e;}finally{this.active=null;}
 }
 async verify(a,session,{enroll=false}={}){
  if(!session)throw fail('请先在浏览器加载工作台扩展。');
  const actual=await this.call('wb_identity',{},session);
  if(enroll&&!a.identity?.userId&&!a.identity?.redId&&this.recordIdentity)await this.recordIdentity(a,actual);
  if(!matchSkillsIdentity(a.identity,actual)){this.binding=null;throw fail(`浏览器账号${actual.nickname?'“'+actual.nickname+'”':''}与当前工作台空间不一致或缺少共同账号标识。请切换到对应账号空间，或在账号管理中绑定当前 Edge 身份。`,409,'BROWSER_IDENTITY_MISMATCH');}
  this.binding={accountId:a.id,...actual,at:new Date().toISOString(),session};if(this.recordIdentity)await this.recordIdentity(a,actual);return this.binding;
 }
 async bind(a){return this.operation(a,'核实浏览器账号',async session=>{if(this.form&&this.form.accountId!==a.id)throw fail('请先结束另一个账号的表单流程。');await this.verify(a,session,{enroll:true});return this.status(a.id);});}
 async verifyCreator(a,session,mode='image',{identityOnly=true}={}){
  if(!this.capabilities?.includes('task-readiness-v1'))throw fail('请在 Edge 重新加载工作台扩展。');
  const value=await this.call('wb_creator_check',{redId:a.identity?.redId,mode,identityOnly},session);
  if(value?.status!=='ready'){
   const code=value?.status==='identity_mismatch'?'BROWSER_IDENTITY_MISMATCH':value?.status==='login_required'?'BROWSER_LOGIN_REQUIRED':value?.status==='verification_required'?'BROWSER_VERIFICATION_REQUIRED':pageErrorCodes.has(value?.errorCode)?value.errorCode:'BROWSER_IDENTITY_UNVERIFIED';
   if(['BROWSER_IDENTITY_MISMATCH','BROWSER_LOGIN_REQUIRED'].includes(code))this.binding=null;
   throw fail(value?.message||'创作后台尚未就绪。',['BROWSER_IDENTITY_MISMATCH','BROWSER_LOGIN_REQUIRED','BROWSER_VERIFICATION_REQUIRED'].includes(code)?409:502,code);
  }
  if(!a.identity?.redId||!value.redId)throw fail('创作后台账号标识未读取完整，本次停止。',502,'BROWSER_IDENTITY_UNVERIFIED');
  if(String(value.redId)!==String(a.identity.redId)){this.binding=null;throw fail('创作后台账号与工作台空间不一致。',409,'BROWSER_IDENTITY_MISMATCH');}
  this.binding={accountId:a.id,redId:value.redId,nickname:a.label,source:'creator',at:new Date().toISOString(),session};return value;
 }
 async smartTitles(a,composer){
  if(!this.capabilities?.includes('creator-smart-titles-v1'))throw fail('请在 Edge 扩展中点击“应用扩展更新”，再使用平台智能标题。');
  if(composer?.video)throw fail('平台智能标题当前仅接入图文笔记。',400);
  await this.execute(a,{command:'fill-publish',confirmed:true,composer,titleOnly:true});
  return this.operation(a,'采用平台首个智能标题',async session=>{
   if(this.form?.accountId!==a.id||this.form.session!==session||this.form.phase!=='ready')throw fail('本篇平台表单已变化，请重新填写。');
   const result=await this.call('wb_smart_titles',{title:composer.title,content:composer.content,tags:composer.tags||[],imageCount:composer.images.length},session);
   if(result?.applied!==true||result.source!=='creator'||!result.candidates?.length||result.title!==result.candidates[0]||Array.from(result.title).length>20)throw fail('平台标题写入未确认，请检查 Edge，本地原标题保留。',502);
   this.form={...this.form,phase:'title-preview',title:result.title,composerKey:this.composerKey({...composer,title:result.title})};
   return {title:result.title,candidates:result.candidates,source:'creator'};
  });
 }
 async preparePublish(a,mode='image'){return this.operation(a,'核实 Edge 发布账号',session=>this.verifyCreator(a,session,mode));}
 async inspectAssets(a,{imageCount}={}){
  if(!Number.isInteger(imageCount)||imageCount<1||imageCount>18)throw fail('请提供预期的图片数量。',400);
  if(this.form&&this.form.accountId!==a.id)throw fail('请切回表单所属账号核查。');
  return this.operation(a,'核查平台图片',async session=>{await this.verifyCreator(a,session);return this.call('wb_publish_assets',{imageCount,waitMs:0},session);});
 }
 async login(a){return this.operation(a,'打开小红书登录页',async session=>{if(this.form)throw fail('请先保存或结束当前表单流程。');this.binding=null;return this.call('wb_open_login',{},session);});}
 finish(a){if(this.active)throw fail('有操作正在执行。');if(this.form&&this.form.accountId!==a.id)throw fail('请切回所属账号结束流程。');this.form=null;return this.status(a.id);}
 async reconcileForm(a){return this.operation(a,'核对上一轮发布流程',()=>this.releaseFinishedForm(a));}
 async releaseFinishedForm(a){
  if(!this.form||this.form.accountId!==a.id||this.form.session!==this.session||!this.capabilities?.includes('form-state-v1'))return;
  const state=await this.call('wb_form_state',{},this.session).catch(()=>({status:'unknown'}));
  if(state?.status==='ended'){this.lastForm={accountId:a.id,title:this.form.title,at:new Date().toISOString(),reason:state.reason};this.form=null;}
 }
 async ensureNoForm(a){await this.releaseFinishedForm(a);if(this.form)throw fail('上一轮发布流程尚未结束，请点击“结束本轮发布流程”后继续。');}
 async execute(a,{command,input={},confirmed=false,composer,titleOnly=false}){
  const {spec,args}=cliArguments(command,input);
  if(spec.write&&confirmed!==true)throw fail('请先确认将对浏览器当前账号执行此操作。',400);
  return this.operation(a,spec.label,async session=>{
   if(!spec.compose&&!spec.continuation&&(this.binding?.accountId!==a.id||this.binding?.session!==session))throw fail('请先核实浏览器账号，与当前工作台空间建立对应。');
   if(spec.compose&&composer&&this.form?.phase==='title-preview'&&this.form.accountId===a.id&&this.form.session===session){
    if(this.form.composerKey===this.composerKey(composer)&&(this.form.assetsVerified!==false||titleOnly)){
     await this.verifyCreator(a,session,command==='fill-publish-video'?'video':'image');
     this.form.phase='ready';return {result:{reused:true},command,accountId:a.id,status:this.status(a.id)};
    }
    // Only this workbench-owned title preview may be refilled after local edits.
    this.form=null;
   }
   if(!spec.continuation)await this.releaseFinishedForm(a);
   if(this.form && (!spec.continuation||this.form.accountId!==a.id||this.form.session!==session))throw fail('浏览器有未完成的表单，请保存或结束本轮流程后继续。');
   if(spec.continuation&&(!this.form||this.form.phase!==spec.continuation))throw fail('没有对应的本轮表单，请先填写表单。');
   if(spec.compose||spec.continuation)await this.verifyCreator(a,session,command==='fill-publish-video'?'video':'image');else await this.verify(a,session);
   const files=await fs.mkdtemp(path.join(this.data,'skills-task-'));
   try{
    if(spec.compose){
     if(!composer||typeof composer!=='object')throw fail('请先在发布工作台填写并保存素材与文案。',400);
     if(command!=='long-article')validatePublish(composer,command==='fill-publish'?'publish_content':'publish_with_video');
     else if(typeof composer.title!=='string'||!composer.title.trim()||composer.title.length>100||typeof composer.content!=='string'||!composer.content.trim()||composer.content.length>100000)throw fail('请填写有效的长文标题和正文。',400);
     const assets=command==='fill-publish-video'?[composer.video]:(composer.images||[]);
     if(!Array.isArray(assets)||assets.length>18)throw fail('图片数量不符合要求。',400);
     for(const file of assets){if(!Object.values(a.state.assets).some(x=>x.path===file))throw fail('素材不属于当前账号空间。');if((await fs.stat(file)).size>32*1024*1024)throw fail('Skills 通道单个素材不能超过 32 MB。',400);}
     await fs.writeFile(path.join(files,'title.txt'),composer.title,{mode:0o600});await fs.writeFile(path.join(files,'content.txt'),composer.content,{mode:0o600});
     args.push('--title-file='+path.join(files,'title.txt'),'--content-file='+path.join(files,'content.txt'));
     if(command==='fill-publish-video')args.push('--video='+composer.video);else if(assets.length)args.push('--images',...assets);
     if(command!=='long-article'){
      if(composer.tags?.length)args.push('--tags',...composer.tags);
      if(composer.schedule_at)args.push('--schedule-at='+composer.schedule_at);
      if(composer.visibility)args.push('--visibility='+composer.visibility);
      if(composer.is_original&&command==='fill-publish')args.push('--original');
     }
    }
    if(command==='next-step'){await fs.writeFile(path.join(files,'description.txt'),input.content,{mode:0o600});args.push('--content-file='+path.join(files,'description.txt'));}
    // Mark before the first mutation. Failure keeps the form reserved, never retries.
    if(spec.compose)this.form={accountId:a.id,session,phase:'uncertain',title:composer.title,assetsVerified:true};
    const result=command==='save-draft'?await this.call('wb_save_draft',{},session):await this.run(args,session);
    if(command==='fill-publish'){
     const images=await this.call('wb_publish_assets',{imageCount:composer.images.length,useWorkTab:true},session);
     if(images?.status!=='ready'&&titleOnly&&images?.status==='not_ready'&&images.imageCount===composer.images.length&&images.loadedCount===composer.images.length)this.form.assetsVerified=false;
     else if(images?.status!=='ready')throw fail(images?.message||'平台图片尚未完成上传，请检查当前 Edge 表单。',502);
    }
    if(command==='save-draft'&&result.savedClicked!==true)throw fail(result.message||'暂存未执行',502);
    if(command==='save-draft'&&result.status==='uncertain'){this.form.phase='uncertain';throw fail(result.message||'暂存结果待核查',502);}
    if(spec.compose)this.form.phase=command==='long-article'?'long':'ready';
    if(command==='next-step')this.form.phase='ready';
    if(command==='save-draft'){this.form=null;result.status='程序已执行暂存，请到平台草稿箱重新打开核查。';}
    return {result,at:new Date().toISOString(),command,accountId:a.id,status:this.status(a.id)};
   }finally{await fs.rm(files,{recursive:true,force:true});}
  });
 }
 async checkCreator(a,mode='image'){
  return this.operation(a,'检查 Edge 创作后台',async session=>{
   if(!this.capabilities?.includes('task-readiness-v1'))throw fail('请在 Edge 扩展管理页重新加载工作台扩展，当前扩展仍是旧版。');
   if(!['image','video'].includes(mode))throw fail('请选择图文或视频',400);
   return this.call('wb_creator_check',{redId:a.identity?.redId,mode},session);
  });
 }
 async selfProfile(a){
  return this.operation(a,'读取 Edge 账号主页',async session=>{
   await this.ensureNoForm(a);
   const identity=await this.verify(a,session);
   const profile=await this.run(['workbench-monitor-self'],session);
   if(!matchSkillsIdentity(identity,{userId:profile.userId,redId:profile.basicInfo?.redId}))throw fail('Edge 主页与当前账号不一致，本次停止。');
   return profile;
  });
 }
 async submitForm(a,composer){
  return this.operation(a,'提交 Edge 发布表单',async session=>{
   if(!this.capabilities?.includes('task-readiness-v1'))throw fail('请在 Edge 重新加载工作台扩展。');
   if(this.form?.accountId!==a.id||this.form?.session!==session||this.form?.phase!=='ready')throw fail('没有属于当前账号的已填写表单。');
   // Publishing requires the creator identity, not a separate public-site login.
   try{await this.verifyCreator(a,session,composer.video?'video':'image',{identityOnly:true});}catch(e){return {publishClicked:false,status:'not_submitted',message:e.message};}
   this.form.phase='uncertain';
   const result=await this.call('wb_submit_publish',{title:composer.title,content:composer.content,imageCount:composer.images?.length,mode:composer.video?'video':'image',tags:composer.tags||[],visibility:composer.visibility||'公开可见',scheduleAt:composer.schedule_at},session);
   if(result.publishClicked===false)this.form.phase='ready';
   else if(result.status==='submitted')this.form=null;
   return result;
  });
 }
 async readXhsComments(a,source){return this.operation(a,'读取网页小红书评论',async session=>{await this.verify(a,session);return this.call('wb_read_xhs_comments',{url:`https://www.xiaohongshu.com/explore/${encodeURIComponent(source.feedId)}?xsec_token=${encodeURIComponent(source.xsecToken)}&xsec_source=pc_search`},session);});}
 async searchDouyin(a,input){return this.operation(a,'搜索抖音评论素材',session=>{if(!this.capabilities?.includes('douyin-comments-v1'))throw fail('请在 Edge 扩展中点击“应用扩展更新”，启用抖音评论采集。');return this.call('wb_douyin_search',input,session);});}
 async readDouyinComments(a,input){return this.operation(a,'读取抖音评论',session=>this.call('wb_douyin_comments',input,session));}
 async closeDouyin(){if(this.capabilities?.includes('douyin-comments-v1'))await this.call('wb_douyin_close').catch(()=>{});}
 async captureComment(a,source,comment){
  if(source.platform==='抖音')return this.operation(a,'截图抖音高赞评论',async session=>{
   const url=source.url,result=await this.call('wb_douyin_capture_comment',{url,commentId:comment.platformId,expectedText:comment.content,expectedAuthor:comment.author},session);
   if(new URL(result.url).pathname!==new URL(url).pathname||result.content!==comment.content||result.author!==comment.author)throw fail('抖音截图对象与原评论不一致，未保存。',502);
   return result;
  });
  return this.operation(a,'截图真实评论',async session=>{
   await this.ensureNoForm(a);
   if(!this.capabilities?.includes('comment-capture-v1'))throw fail('请在 Edge 扩展管理页重新加载“小红书工作台 · XHS Skills Bridge”，再返回截图。');
   await this.verify(a,session);
   const url=`https://www.xiaohongshu.com/explore/${encodeURIComponent(source.feedId)}?xsec_token=${encodeURIComponent(source.xsecToken)}&xsec_source=pc_search`;
   const result=await this.call('wb_capture_comment',{url,commentId:comment.platformId,expectedText:comment.content},session);
   await this.verify(a,session);
   if(result?.commentId!==comment.platformId||new URL(result.url).pathname!==new URL(url).pathname)throw fail('截图对象与原评论不一致，本次未保存。',502);
   return result;
  });
 }
 async monitor(a,{period=7}={}){
  await this.ensureNoForm(a);
  return this.operation(a,'读取创作后台笔记表现',async session=>{
   if(!this.capabilities?.includes('creator-metrics-v1'))throw fail('请应用工作台扩展更新，再读取创作后台数据。',409);
   const value=await this.call('wb_creator_metrics',{period,redId:a.identity?.redId},session);
   const snapshot=creatorSnapshot(value,a.identity);snapshot.profile.nickname||=a.label;
   this.binding={accountId:a.id,redId:snapshot.profile.redId,nickname:snapshot.profile.nickname,source:'creator',at:snapshot.at,session};
   return snapshot;
  });
 }
 async run(args,session){
  if(this.runner)return this.runner(args,session);
  return new Promise((resolve,reject)=>{
   const child=spawn(this.python,['-B','-X','utf8',path.join(this.root,'integrations/skills_runner.py'),...args],{cwd:this.vendor,env:{...process.env,PYTHONUNBUFFERED:'1',XHS_WORKBENCH_BRIDGE:`ws://127.0.0.1:${this.port}/skills-bridge`,XHS_WORKBENCH_TOKEN:this.token,XHS_WORKBENCH_SESSION:session},windowsHide:true,stdio:['ignore','pipe','pipe']});
   this.child=child;let out='',size=0,done=false;
   const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);out='';this.child=null;err?reject(err):resolve(value);};
   const timer=setTimeout(()=>{child.kill('SIGTERM');finish(fail('Skills 操作超时，请先查看浏览器结果；登录保留，不会重试。',504));},600000);
   child.stdout.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>8*1024*1024){child.kill('SIGTERM');finish(fail('返回数据过大，请缩小采集范围。',502));}else out+=chunk;});
   child.stderr.resume();
   child.once('error',()=>finish(fail('Python 启动失败，请检查 Skills 运行环境。',503)));
   child.once('exit',code=>{if(done)return;let result;try{result=JSON.parse(out);}catch{return finish(fail('Skills 未返回有效结果，请在浏览器核查。',502));}if(code!==0||result.error||result.success===false)return finish(fail(result.error||result.message||'Skills 执行未完成',502));finish(null,result);});
  });
 }
 close(){this.child?.kill('SIGTERM');for(const client of this.wss?.clients||[])client.terminate();this.wss?.close();}
}
