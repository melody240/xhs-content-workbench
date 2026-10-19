import fs from 'node:fs/promises';
import path from 'node:path';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export const MODEL_PRESETS={deepseek:{label:'DeepSeek',baseURL:'https://api.deepseek.com',model:'deepseek-flash'},custom:{label:'自定义兼容接口',baseURL:'',model:''}};
export function endpoint(value){
 let u;try{u=new URL(value);}catch{throw fail('请填写模型服务的完整地址。');}
 if(u.username||u.password||u.search||u.hash)throw fail('模型地址不能包含凭据或查询参数。');
 if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw fail('远程模型必须使用 HTTPS；本机模型可使用 HTTP。');
 if(/\/(chat\/completions|responses)\/?$/.test(u.pathname))throw fail('填写接口根地址，不包含 /chat/completions。');
 return u.href.replace(/\/$/,'');
}
export class ModelConnection{
 constructor(data,{fetcher=fetch}={}){this.file=path.join(data,'model-settings.json');this.fetcher=fetcher;this.config={provider:'deepseek',...MODEL_PRESETS.deepseek,apiKey:'',verifiedAt:null};}
 async init(){try{this.config=JSON.parse(await fs.readFile(this.file,'utf8'));await fs.chmod(this.file,0o600);}catch(e){if(e.code!=='ENOENT')throw e;}}
 public(){const {apiKey,...safe}=this.config;return {...safe,hasKey:!!apiKey,configured:!!safe.baseURL&&!!safe.model, presets:MODEL_PRESETS};}
 async save(input){
  const provider=input.provider||'custom';if(!MODEL_PRESETS[provider])throw fail('模型服务类型无效。');
  const baseURL=endpoint(input.baseURL),model=String(input.model||'').trim();if(!model||model.length>120)throw fail('请填写有效的模型名称。');
  // Never carry a credential across providers or destinations implicitly.
  let apiKey=this.config.baseURL===baseURL&&this.config.provider===provider?this.config.apiKey:'';
  if(input.apiKey)apiKey=String(input.apiKey).trim();if(input.clearKey)apiKey='';
  if(apiKey.length>4096||/[\r\n]/.test(apiKey))throw fail('密钥格式无效。');
  this.config={provider,baseURL,model,apiKey,verifiedAt:null};await this.persist();return this.public();
 }
 async persist(){const temp=this.file+'.tmp';await fs.writeFile(temp,JSON.stringify(this.config),{mode:0o600});await fs.rename(temp,this.file);}
 async complete(messages,{signal,maxTokens=2500,json=false,config=this.config}={}){
  if(!config.baseURL||!config.model)throw fail('请先配置模型。',409);
  let response;
  try{response=await this.fetcher(endpoint(config.baseURL)+'/chat/completions',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(config.apiKey?{Authorization:`Bearer ${config.apiKey}`}:{})},body:JSON.stringify({model:config.model,messages,max_tokens:maxTokens,stream:false,...(config.provider==='deepseek'?{thinking:{type:'disabled'},...(json?{response_format:{type:'json_object'}}:{})}:{})}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000)});}catch(e){if(signal?.aborted)throw signal.reason;throw fail('模型连接失败或超时，请检查服务地址、网络及服务商状态。',502);}
  if(!response.ok){await response.body?.cancel();throw fail(response.status===401||response.status===403?'模型拒绝访问，请检查密钥和模型权限。':response.status===429?'模型额度或频率受限，请稍后再试。':`模型服务返回 HTTP ${response.status}，本次任务已停止。`,502);}
  const reader=response.body.getReader();let size=0;const parts=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024){await reader.cancel();throw fail('模型返回内容过大。',502);}parts.push(Buffer.from(value));}}
  catch(e){await reader.cancel().catch(()=>{});if(signal?.aborted)throw signal.reason;if(e.status)throw e;throw fail('模型回复中断或超时，已保留本轮内容，请稍后重试。',502);}
  let body;try{body=JSON.parse(Buffer.concat(parts).toString());}catch{throw fail('模型服务返回格式不正确。',502);}
  const content=body.choices?.[0]?.message?.content;
  if(typeof content!=='string'||!content.trim())throw fail('模型没有返回正文，请选择支持 Chat Completions 文本输出的模型。',502);
  if(body.choices[0].finish_reason==='length')throw fail('模型输出超过本次长度限制，请调整模型或缩小任务。',502);
  const usage=body.usage;return {content,usage:usage?{promptTokens:Number(usage.prompt_tokens)||0,completionTokens:Number(usage.completion_tokens)||0,totalTokens:Number(usage.total_tokens)||0}:null};
 }
 async test(){const config={...this.config};const r=await this.complete([{role:'user',content:'只回复 OK'}],{maxTokens:32,config});if(this.config.baseURL!==config.baseURL||this.config.model!==config.model||this.config.apiKey!==config.apiKey)throw fail('配置已变化，请重新测试。',409);this.config.verifiedAt=new Date().toISOString();await this.persist();return {ok:true,at:this.config.verifiedAt,usage:r.usage};}
}
