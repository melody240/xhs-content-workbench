import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.WORKBENCH_PORT || 18180);
const url = `http://127.0.0.1:${port}`;
async function running() {
  try {
    const r = await fetch(url + "/api/health", {
      signal: AbortSignal.timeout(1500),
    });
    const b = await r.json();
    if (b.service !== "xiaohongshu-workbench")
      throw new Error("端口被其他程序占用");
    return true;
  } catch (e) {
    if (e.message === "端口被其他程序占用") throw e;
    return false;
  }
}
if (!(await running())) {
  const data = process.env.WORKBENCH_DATA_DIR || path.join(root, "data");
  await fs.mkdir(data, { recursive: true, mode: 0o700 });
  const child = spawn(process.execPath, [path.join(root, "server.mjs")], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: {...process.env, WORKBENCH_LOG_FILE:path.join(data,"server.log")},
  });
  child.on("error", (e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
  child.unref();
  if (child.pid) await fs.writeFile(path.join(data, "server.pid"), String(child.pid), {mode: 0o600});
  let ready = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await running()) {
      ready = true;
      break;
    }
  }
  if (!ready) throw new Error("启动失败，请查看 workbench/data/server.log");
}
console.log(`小红书工作台已启动：${url}\n关闭此窗口后服务仍会运行。`);
if (process.platform === "darwin" && !process.argv.includes("--no-open"))
  spawn("open", [url], { stdio: "ignore" }).unref();
