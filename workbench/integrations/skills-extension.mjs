import fs from 'node:fs/promises';
import path from 'node:path';

// The upstream source stays unmodified. Generate a local adapter without its
// Cookie capture, network logger, risk probes, or browser fingerprint overrides.
export async function buildExtension({vendor, directory, port, token}) {
  await fs.mkdir(directory, {recursive:true, mode:0o700});
  const original=(await fs.readFile(path.join(vendor,'extension/background.js'),'utf8')).replace(/\r\n?/g,'\n');
  let helpers=original.slice(original.indexOf('async function cmdWaitForLoad('),original.indexOf('// ─── 302→/404'));
  if(!helpers.includes('function domExecutor'))throw new Error('上游扩展结构改变，请先复核适配器。');
  helpers=helpers.replace(/async function cmdGetCookies\([\s\S]*?\n}\n/,'');
  helpers=helpers.replace('async function cmdWaitForLoad(', 'async function upstreamCmdWaitForLoad(').replace('async function waitForTabComplete(', 'async function upstreamWaitForTabComplete(');
  // executeScript defaults to document_idle. The page may already expose usable
  // controls while a CDN request keeps loading; do not defer the DOM operation.
  helpers=helpers.replaceAll('chrome.scripting.executeScript({','chrome.scripting.executeScript({injectImmediately:true,');
  const header=await fs.readFile(new URL('./skills-extension-header.js',import.meta.url),'utf8');
  await fs.writeFile(path.join(directory,'background.js'),header+'\n'+await fs.readFile(new URL('./creator-titles-extension.js',import.meta.url),'utf8')+'\n'+await fs.readFile(new URL('./creator-metrics-extension.js',import.meta.url),'utf8')+'\n'+await fs.readFile(new URL('./browser-publish.js',import.meta.url),'utf8')+'\n'+await fs.readFile(new URL('./comment-capture-extension.js',import.meta.url),'utf8')+'\n'+await fs.readFile(new URL('./source-capture-extension.js',import.meta.url),'utf8')+'\n'+await fs.readFile(new URL('./douyin-comments-extension.js',import.meta.url),'utf8')+'\n'+helpers,{mode:0o600});
  await fs.copyFile(new URL('./browser-readiness.js',import.meta.url),path.join(directory,'browser-readiness.js'));
  await fs.writeFile(path.join(directory,'config.js'),`const WB_CONFIG = ${JSON.stringify({url:`ws://127.0.0.1:${port}/skills-bridge`,token})};\n`,{mode:0o600});
  await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify({manifest_version:3,name:'小红书工作台 · XHS Skills Bridge',version:'1.4.8',description:'使用当前 Edge 登录，管理内容和所选平台素材。',permissions:['tabs','scripting','alarms','debugger'],host_permissions:['https://www.xiaohongshu.com/*','https://xiaohongshu.com/*','https://creator.xiaohongshu.com/*'],optional_host_permissions:['https://x.com/*','https://twitter.com/*','https://www.douyin.com/*'],background:{service_worker:'background.js'},action:{default_popup:'popup.html'}},null,2));
  await fs.writeFile(path.join(directory,'popup.html'),'<!doctype html><html lang="zh"><meta charset="utf-8"><title>小红书工作台</title><style>body{width:280px;font:14px system-ui;padding:16px;color:#202d34}button{display:block;width:100%;padding:10px;margin:10px 0;background:#f4f7f9;border:1px solid #bccad4;border-radius:8px;font:inherit}p{line-height:1.6}#status{color:#075b85}</style><body><h3>素材平台</h3><p>继续使用当前 Edge 登录。启用后，工作台可读取该平台页面并截图；验证码由本人处理。</p><button id="enable-x">启用 X 素材</button><button id="enable-douyin">启用抖音素材</button><p id="status" role="status"></p><p id="version"></p><button id="reload">应用扩展更新</button><p>请保持本机工作台运行。同一时间只连接一个浏览器配置。</p><script src="popup.js"></script></body></html>');
  await fs.writeFile(path.join(directory,'popup.js'),`document.getElementById('version').textContent='当前扩展 '+chrome.runtime.getManifest().version;document.getElementById('reload').onclick=()=>chrome.runtime.reload();const platforms={x:['https://x.com/*','https://twitter.com/*'],douyin:['https://www.douyin.com/*']};for(const [key,origins] of Object.entries(platforms)){document.getElementById('enable-'+key).onclick=async()=>{const granted=await chrome.permissions.request({origins});document.getElementById('status').textContent=granted?'已启用，返回工作台即可检查素材。':'未启用，其他平台和小红书功能不受影响。';};}\n`);
  await fs.copyFile(path.join(vendor,'LICENSE'),path.join(directory,'LICENSE'));
}
