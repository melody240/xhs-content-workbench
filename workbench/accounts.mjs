import fs from "node:fs/promises";
import {SnapshotWriter} from "./storage.mjs";
import {trimAccountDiagnostics} from "./retention.mjs";
import {RotatingLog} from "./rotating-log.mjs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const blank = endpoint => ({
  settings: {endpoint, monitorMinutes: 0}, drafts: [], history: [], snapshots: [],
  submissions: {}, assets: {}, login: {status: "unknown", message: "请扫码连接这个账号。"},
});
function runtime() {
  return {toolCache: [], active: null, lastMonitorError: null, requestId: 0,
    sessionId: null, loginWatch: 0, loginWatchTimer: null, monitorTimer: null,
    child: null, starting: null};
}
async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve);});
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

export class AccountStore {
  static async open(data, endpoint) {
    const store = new AccountStore(data);
    const file = path.join(data, "state.json");
    let saved;
    try {saved = JSON.parse(await fs.readFile(file, "utf8"));}
    catch (e) {if (e.code !== "ENOENT") throw e;}
    store.serviceProxy = process.env.XHS_PROXY || saved?.serviceProxy || "";
    if (saved?.schemaVersion === 2) {
      if (!Array.isArray(saved.accounts)) throw new Error("账号记录不完整，请恢复备份。");
      store.items = saved.accounts.map(a => ({...a, runtime: runtime()}));
      store.selectedAccountId = saved.selectedAccountId;
    } else {
      if (saved) await fs.copyFile(file, path.join(data, `state-before-multi-${Date.now()}.json`));
      const state = {...blank(endpoint), ...saved};
      const id = randomUUID();
      const label = state.login?.name || state.login?.profile?.nickname || "原有账号";
      store.items = [{id, label, legacy: true, managed: false, state, runtime: runtime(),
        identity: state.login?.profile?.redId ? {redId: state.login.profile.redId} : {}}];
    }
    if (!store.get(store.selectedAccountId) || store.get(store.selectedAccountId)?.archivedAt) store.selectedAccountId = store.items.find(a => !a.archivedAt)?.id || null;
    for (const a of store.items) {
      if (!/^[a-f0-9-]{36}$/.test(a.id)) throw new Error("账号标识无效，请恢复备份。");
      for (const d of a.state.drafts) d.accountId = a.id;
      for (const asset of Object.values(a.state.assets)) {
        asset.accountId = a.id;
        if (asset.url?.startsWith("/media/") && !asset.url.includes("account=")) asset.url += `?account=${a.id}`;
      }
    }
    await store.save();
    return store;
  }
  constructor(data) {this.data = data; this.items = []; this.chain = Promise.resolve(); this.writer = new SnapshotWriter(path.join(data,"state.json")); this.closing = false;}
  get(id) {return this.items.find(a => a.id === id);}
  list(archived = false) {return this.items.filter(a => !!a.archivedAt === archived).map(a => {
    const snapshot = a.identity?.redId
      ? a.state.snapshots.filter(s => s.profile?.redId === a.identity.redId).at(-1)
      : undefined;
    const day = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    return {id: a.id, label: a.label, alias: a.alias || "", topic: a.topic || "", archivedAt:a.archivedAt,
      managed:a.managed,legacy:a.legacy,login:a.state.settings.operationChannel==='mcp'?a.state.login:a.state.browserLogin||{status:'unknown'},legacyLogin:a.state.login,operationChannel:a.state.settings.operationChannel||'edge',waiting: a.state.settings.operationChannel==='mcp'&&a.state.loginFlow?.status === "waiting",
      draftCount: a.state.drafts.length, monitorMinutes: a.state.settings.monitorMinutes,
      lastCollectedAt: snapshot?.at, noteCount: snapshot?.notes?.length,
      submissionsToday:Object.values(a.state.submissions).filter(s => s.date === day).map(s => ({status:s.status,title:s.title})),
      active:a.runtime.active, lastMonitorError:a.runtime.lastMonitorError};
  });}
  async archive(id) {
    const a=this.get(id);
    if (!a || a.archivedAt) throw new Error("账号不存在或已删除");
    if (a.runtime.active || a.runtime.starting || (a.state.settings.operationChannel==='mcp'&&a.state.loginFlow?.status === "waiting")) throw new Error("账号正在执行操作或等待扫码，请完成后再删除。");
    a.archivedAt=new Date().toISOString();
    clearInterval(a.runtime.monitorTimer);clearTimeout(a.runtime.loginWatchTimer);a.runtime.loginWatch++;
    if(a.runtime.child){a.runtime.child.kill("SIGTERM");a.runtime.child=null;}
    if(this.selectedAccountId===id)this.selectedAccountId=this.items.find(x=>!x.archivedAt)?.id || null;
    await this.save();
  }
  async restore(id) {
    const a=this.get(id);
    if(!a?.archivedAt)throw new Error("回收站中没有这个账号");
    delete a.archivedAt;
    if(!this.selectedAccountId)this.selectedAccountId=id;
    await this.save();return a;
  }
  save() {
    for(const a of this.items)trimAccountDiagnostics(a.state);
    const text = JSON.stringify({schemaVersion: 2, serviceProxy: this.serviceProxy, selectedAccountId: this.selectedAccountId,
      accounts: this.items.map(({runtime, ...a}) => a)}, null, 2);
    this.chain = this.writer.enqueue(text);
    return this.chain;
  }

  async add(label = "") {
    const a = {id: randomUUID(), label: String(label || `新账号 ${this.items.length + 1}`).trim().slice(0, 40),
      managed: true, legacy: false, state: blank(null), identity: {}, runtime: runtime()};
    // Adding a workspace only stores local materials. The Edge channel does
    // not depend on an independent browser binary or start a login session.
    await fs.mkdir(path.join(this.data, "accounts", a.id), {recursive: true, mode: 0o700});
    this.items.push(a);
    await this.save();
    return a;
  }
  async ensure(a) {
    if (a.archivedAt) throw new Error("账号已移入回收站，请先恢复。");
    if (!a.managed) return;
    if (this.closing) throw new Error("服务正在关闭，请稍后重试。");
    if (a.runtime.starting) return a.runtime.starting;
    if (a.runtime.child && a.runtime.child.exitCode === null && !a.runtime.child.killed) return;
    const start = async () => {
      const binary = process.env.WORKBENCH_MCP_BINARY || path.resolve(root, "../runtime/xiaohongshu-mcp-workbench-darwin-arm64");
      await fs.access(binary, fs.constants.X_OK);
      const dir = path.join(this.data, "accounts", a.id);
      await fs.mkdir(dir, {recursive: true, mode: 0o700});
      const port = await freePort();
      if (this.closing) throw new Error("服务正在关闭");
      const log = new RotatingLog(path.join(dir, "service.log"));
      log.on("error",()=>{});
      // No session is copied or inspected: MCP alone owns its account's session file.
      const env = {...process.env, COOKIES_PATH: path.join(dir, "cookies.json")};
      delete env.XHS_FP_SEED;
      if (this.serviceProxy) env.XHS_PROXY = this.serviceProxy;
      if (env.MCP_AUTH_TOKEN) env.AUTH_TOKEN = env.MCP_AUTH_TOKEN;
      const child = spawn(binary, ["-port", `127.0.0.1:${port}`], {cwd: dir, env,
        stdio: ["ignore", "pipe", "pipe"]});
      child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
      child.once("close",()=>log.end());child.once("error",()=>log.end());
      let spawnError;
      child.once("error", e => {spawnError = e;});
      a.runtime.child = child;
      a.state.settings.endpoint = `http://127.0.0.1:${port}/mcp`;
      a.runtime.sessionId = null;
      a.runtime.toolCache = [];
      await this.save();
      for (let i = 0; i < 80; i++) {
        if (spawnError || child.exitCode !== null) throw new Error("账号服务启动失败，请查看该账号服务日志。");
        try {
          const r = await fetch(`http://127.0.0.1:${port}/health`, {signal: AbortSignal.timeout(500)});
          if (r.ok) return;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      child.kill("SIGTERM");
      throw new Error("账号服务启动超时，请检查浏览器环境后重试。");
    };
    a.runtime.starting = start().finally(() => {a.runtime.starting = null;});
    return a.runtime.starting;
  }
  async close() {
    this.closing = true;
    for (const a of this.items) if (a.runtime.child) a.runtime.child.kill("SIGTERM");
    await this.chain;
  }
}
