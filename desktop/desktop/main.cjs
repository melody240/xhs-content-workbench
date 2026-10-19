const {app,BrowserWindow,Menu,dialog,shell,clipboard}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {randomBytes,randomUUID}=require('node:crypto');
const {runtimeLayout,localNavigation,externalNavigation,backendEnvironment}=require('./lifecycle.cjs');
const PORT=18180,ORIGIN=`http://127.0.0.1:${PORT}`;
let win,child,layout,logHandle,quitting=false,stopping=false,failed=false,quitPending=false;
const token=randomBytes(32).toString('hex'),instanceId=randomUUID();
app.setName('小红书工作台');
app.setPath('userData',path.join(app.getPath('appData'),'XHSWorkbench'));
const locked=app.requestSingleInstanceLock();
if(!locked)app.quit();
else {
 app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
 app.whenReady().then(start).catch(reportFailure);
 app.on('before-quit',e=>{if(!quitting){e.preventDefault();void quitSafely();}});
 app.on('window-all-closed',()=>app.quit());
}
function record(message){if(logHandle&&!logHandle.writableEnded)logHandle.write(new Date().toISOString()+' '+message+'\n');}
async function edgePath(){
 for(const base of [process.env['ProgramFiles(x86)'],process.env.ProgramFiles,process.env.LOCALAPPDATA].filter(Boolean)){
  const target=path.join(base,'Microsoft','Edge','Application','msedge.exe');try{await fs.access(target);return target;}catch{}
 }
 return null;
}
async function openEdge(url){
 const exe=await edgePath();
 if(!exe){const {response}=await dialog.showMessageBox(win,{type:'info',title:'需要 Microsoft Edge',message:'请先安装 Microsoft Edge。',detail:'程序已内置工作台运行环境。浏览器由你本人安装和登录。',buttons:['打开官方下载页','取消'],defaultId:0,cancelId:1});if(response===0)await shell.openExternal('https://www.microsoft.com/edge/download');return;}
 const p=spawn(exe,[url],{windowsHide:true,stdio:'ignore'});p.once('error',e=>record('Edge: '+e.message));p.unref();
}
async function setup(){
 const {response}=await dialog.showMessageBox(win,{type:'info',title:'首次连接浏览器',message:'只需要设置一次浏览器扩展',detail:'1. 打开 Edge 扩展管理页，开启“开发人员模式”。\n2. 点击“加载解压缩的扩展”。\n3. 选择下方文件夹。\n4. 返回工作台，在“设置 → 连接概览 → 管理浏览器”核实账号。\n\n'+layout.extension,buttons:['打开扩展管理页','打开扩展文件夹','复制文件夹路径','关闭'],defaultId:0,cancelId:3});
 if(response===0)await openEdge('edge://extensions/');if(response===1)await shell.openPath(layout.extension);if(response===2)clipboard.writeText(layout.extension);
}
function buildMenu(){
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  {label:'工作台',submenu:[{label:'首次设置',click:()=>void setup()},{label:'打开 Edge',click:()=>void openEdge('https://www.xiaohongshu.com/explore')},{label:'打开创作后台',click:()=>void openEdge('https://creator.xiaohongshu.com')},{type:'separator'},{label:'退出工作台',accelerator:'Alt+F4',click:()=>app.quit()}]},
  {label:'编辑',submenu:[{role:'undo',label:'撤销'},{role:'redo',label:'重做'},{type:'separator'},{role:'cut',label:'剪切'},{role:'copy',label:'复制'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'}]},
  {label:'查看',submenu:[{label:'刷新页面',accelerator:'Ctrl+R',click:()=>win?.reload()},{role:'resetZoom',label:'恢复缩放'},{role:'zoomIn',label:'放大'},{role:'zoomOut',label:'缩小'},{role:'togglefullscreen',label:'全屏'}]},
  {label:'帮助',submenu:[{label:'操作说明书',click:()=>void shell.openPath(path.join(process.resourcesPath,'guide','操作说明书.html'))},{label:'浏览器扩展设置',click:()=>void setup()},{label:'打开扩展文件夹',click:()=>void shell.openPath(layout.extension)},{label:'打开数据文件夹',click:()=>void shell.openPath(layout.data)},{label:'打开日志文件夹',click:()=>void shell.openPath(app.getPath('userData'))},{label:'关于',click:()=>void dialog.showMessageBox(win,{type:'info',title:'关于小红书工作台',message:'小红书工作台 '+app.getVersion(),detail:'Windows x64 独立发行版\n运行环境随程序提供。所有账号、素材和密钥保存在此电脑。\n\n当前发行版未签名，Windows 实机验收尚未完成。',buttons:['知道了']})}]}
 ]));
}
async function freePort(){await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',()=>reject(new Error('本机端口 18180 已被占用。请关闭其他工作台程序后再启动；本程序不会连接或停止它。')));s.listen(PORT,'127.0.0.1',()=>s.close(resolve));});}
async function readHealth(){try{const r=await fetch(ORIGIN+'/api/health',{signal:AbortSignal.timeout(1200)});if(!r.ok)return null;return await r.json();}catch{return null;}}
async function start(){
 const resources=app.isPackaged?process.resourcesPath:path.resolve(__dirname,'../resources');
 layout=runtimeLayout(resources,app.getPath('userData'));
 await fs.mkdir(layout.data,{recursive:true});
 try{await fs.writeFile(path.join(layout.data,'state.json'),JSON.stringify({schemaVersion:2,selectedAccountId:null,accounts:[],serviceProxy:''}),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
 const {RotatingLog}=await import(pathToFileURL(path.join(layout.workbench,'rotating-log.mjs')).href);
 logHandle=new RotatingLog(layout.log);logHandle.on('error',()=>{});
 await freePort();
 await fs.access(layout.python);await fs.access(path.join(layout.workbench,'server.mjs'));
 await new Promise((resolve,reject)=>{
  const p=spawn(layout.python,['-B','-X','utf8',path.join(resources,'runtime-check.py')],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{p.kill();reject(new Error('运行环境检查超时。'));},15000);p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.once('error',e=>{clearTimeout(timer);reject(e);});p.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('内置运行环境检查失败。请重新安装此程序。'+err.slice(0,500)));});
 });
 child=spawn(process.execPath,[path.join(layout.workbench,'server.mjs')],{cwd:layout.workbench,windowsHide:true,stdio:'ignore',env:backendEnvironment(process.env,layout,{port:PORT,token,instanceId})});
 child.once('error',reportFailure);child.once('exit',code=>{record('service exited: '+code);if(!stopping&&!failed)void reportFailure(new Error('工作台后台已退出，文稿保留。请重新打开程序；详细原因在日志文件夹。'));});
 let ready=false;
 for(let n=0;n<100;n++){const h=await readHealth();if(h?.service==='xiaohongshu-workbench'&&h.desktopInstance===instanceId){ready=true;break;}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,200));}
 if(!ready)throw new Error('工作台未能启动。请用“打开日志”查看原因，再重新启动。');
 const sessionName='persist:xhs-workbench-desktop';
 win=new BrowserWindow({width:1440,height:960,minWidth:900,minHeight:650,title:'小红书工作台',backgroundColor:'#eeeef8',show:false,autoHideMenuBar:false,webPreferences:{partition:sessionName,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false}});
 win.webContents.session.setPermissionRequestHandler((wc,permission,callback)=>callback(permission==='clipboard-sanitized-write'&&localNavigation(wc.getURL(),ORIGIN)));
 win.webContents.session.setPermissionCheckHandler((wc,permission,origin)=>permission==='clipboard-sanitized-write'&&origin===ORIGIN);
 win.webContents.on('will-navigate',(event,url)=>{if(!localNavigation(url,ORIGIN)){event.preventDefault();if(externalNavigation(url))void openEdge(url);}});
 win.webContents.setWindowOpenHandler(({url})=>{if(externalNavigation(url))void openEdge(url);return {action:'deny'};});
 win.on('close',event=>{if(!quitting){event.preventDefault();app.quit();}});
 buildMenu();await win.loadURL(ORIGIN);win.show();record('ready');
 const marker=path.join(app.getPath('userData'),'setup-seen.json');
 try{await fs.access(marker);}catch{await fs.writeFile(marker,JSON.stringify({version:app.getVersion()}));void setup();}
}
async function quitSafely(){
 if(stopping||quitPending)return;
 quitPending=true;
 if(child&&child.exitCode===null){
  try{const [a,s,r]=await Promise.all(['/api/accounts','/api/skills/status','/api/agent'].map(async u=>{const q=await fetch(ORIGIN+u,{signal:AbortSignal.timeout(1200)});return q.ok?q.json():{};}));
   if((a.accounts||[]).some(v=>v.active)||s.active||r.active||r.writing){const {response}=await dialog.showMessageBox(win,{type:'question',title:'任务还在执行',message:'退出会中断当前任务。',buttons:['继续等待','退出'],defaultId:0,cancelId:0});if(response!==1){quitPending=false;return;}}
  }catch{}
 }
 stopping=true;
 if(child&&child.exitCode===null){
  const exited=new Promise(resolve=>child.once('exit',resolve));
  try{await fetch(ORIGIN+'/api/desktop/shutdown',{method:'POST',headers:{'X-Workbench-Request':'1','X-Workbench-Desktop-Token':token},signal:AbortSignal.timeout(2000)});}catch{}
  await Promise.race([exited,new Promise(r=>setTimeout(r,5000))]);if(child.exitCode===null)child.kill();
 }
 if(logHandle&&!logHandle.writableEnded)await new Promise(resolve=>logHandle.end(resolve));quitting=true;app.quit();
}
async function reportFailure(error){
 if(failed)return;failed=true;record('failure: '+error.message);
 await app.whenReady();
 const {response}=await dialog.showMessageBox({type:'error',title:'工作台未能启动',message:error.message,detail:'你的资料不会被删除。可关闭程序后重试，或查看此电脑上的启动日志。',buttons:layout?['打开日志','关闭']:['关闭'],defaultId:layout?1:0,cancelId:layout?1:0});
 if(layout&&response===0)await shell.openPath(app.getPath('userData'));
 await quitSafely();
}
