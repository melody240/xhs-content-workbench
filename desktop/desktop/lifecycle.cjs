const path = require('node:path');
function runtimeLayout(resources, userData) {
  return {workbench:path.join(resources,'workbench'),python:path.join(resources,'python','python.exe'),data:path.join(userData,'workbench'),extension:path.join(userData,'workbench','skills-extension'),log:path.join(userData,'launcher.log')};
}
function localNavigation(value, origin) {
  try {const u=new URL(value);return u.origin===origin&&!u.username&&!u.password;}catch{return false;}
}
function externalNavigation(value) {
  try {const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}
}
function backendEnvironment(parent, layout, {port,token,instanceId}) {
  const out={};
  for(const k of ['SystemRoot','WINDIR','PATH','Path','PATHEXT','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','COMSPEC','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','no_proxy'])if(parent[k])out[k]=parent[k];
  return {...out,ELECTRON_RUN_AS_NODE:'1',NODE_USE_ENV_PROXY:'1',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONNOUSERSITE:'1',WORKBENCH_DATA_DIR:layout.data,WORKBENCH_LOG_FILE:path.join(layout.data,'server.log'),WORKBENCH_PYTHON:layout.python,WORKBENCH_PORT:String(port),WORKBENCH_DESKTOP_TOKEN:token,WORKBENCH_DESKTOP_INSTANCE:instanceId};
}
module.exports={runtimeLayout,localNavigation,externalNavigation,backendEnvironment};
