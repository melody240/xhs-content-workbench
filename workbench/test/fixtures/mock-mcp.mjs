#!/usr/bin/env node
// Isolated test double: never opens a browser or contacts a real platform.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const portArg=process.argv[process.argv.indexOf('-port')+1];
const port=Number(portArg.split(':').at(-1));
const dir=process.env.MOCK_STATE_DIR || path.dirname(process.env.COOKIES_PATH);
const sessionFile=path.join(dir,'mock-session.json');
let saved=process.env.MOCK_PRESET === '1', waiting=false, foreign=false;
try { saved=JSON.parse(await fs.readFile(sessionFile,'utf8')).saved; } catch {}
const identity=path.basename(dir);
const profile=()=>({userBasicInfo:{nickname:'模拟-'+identity.slice(0,8),redId:foreign?'wrong-id':identity},feeds:[{id:'note-'+identity,xsecToken:'fake',noteCard:{displayTitle:'模拟笔记',interactInfo:{likedCount:'3'}}}]});
const names=['get_my_profile','get_feed_detail','get_login_qrcode','get_login_progress','show_login_browser','delete_cookies','publish_content','publish_with_video','mock_confirm','mock_identity_drift'];
const server=http.createServer(async(req,res)=>{
 if(req.url==='/health'){res.end('{}');return;}
 let raw='';for await(const c of req)raw+=c;
 const b=JSON.parse(raw);let result;
 const text=data=>({content:[{type:'text',text:typeof data==='string'?data:JSON.stringify(data)}]});
 if(b.method==='tools/list')result={tools:names.map(name=>({name,inputSchema:{type:'object'}}))};
 else {
  const name=b.params.name;
  await fs.appendFile(path.join(dir,'calls.log'),name+'\n');
  if(name==='get_my_profile')result=saved?text(profile()):{isError:true,...text('当前页面未登录，请先完成扫码登录')};
  else if(name==='get_feed_detail')result=text({data:{note:{interactInfo:{likedCount:'3',collectedCount:'1',commentCount:'0'}}}});
  else if(name==='get_login_qrcode'){waiting=true;result={content:[{type:'image',mimeType:'image/png',data:'dGVzdA=='}]};}
  else if(name==='get_login_progress')result=text({sequence:1,status:saved?'saved':waiting?'waiting':'idle',...(saved?{account:{nickname:profile().userBasicInfo.nickname,userId:identity}}:{})});
  else if(name==='mock_confirm'){saved=true;waiting=false;await fs.writeFile(sessionFile,JSON.stringify({saved}));result=text('confirmed');}
  else if(name==='delete_cookies'){saved=false;waiting=false;await fs.writeFile(sessionFile,JSON.stringify({saved}));result=text('已退出');}
  else if(name==='mock_identity_drift'){foreign=true;result=text('simulated');}
  else if(name.startsWith('publish'))result={isError:true,...text('模拟提交后响应异常')};
  else result=text('window shown');
 }
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:b.id,result}));
});
server.listen(port,'127.0.0.1');
process.on('SIGTERM',()=>{server.close();server.closeAllConnections();});
