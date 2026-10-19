import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";

test("隔离模拟 MCP：跨站拦截、上传、草稿恢复、缺失指标及异常发布防重复", async (t) => {
  // This mock never contacts Xiaohongshu or the user's running MCP.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-workbench-test-"));
  const calls = [];
  let progressFault = false;
  let progressStatus = "saved";
  let progressSequence = 1;
  let failBeforeSubmit = true;
  const mock = http.createServer(async (req, res) => {
    const parts = [];
    for await (const c of req) parts.push(c);
    const b = JSON.parse(Buffer.concat(parts));
    let result;
    if (b.method === "tools/list")
      result = {
        tools: [
          "get_my_profile",
          "check_publish_page",
          "get_feed_detail",
          "publish_content",
          "check_login_status",
          "get_login_qrcode",
          "get_login_progress",
          "show_login_browser",
          "delete_cookies",
        ].map((name) => ({ name, inputSchema: { type: "object" } })),
      };
    else {
      calls.push(b.params.name);
      const data =
        b.params.name === "get_my_profile"
          ? {
              userBasicInfo: { nickname: "测试账号", redId: "account-a" },
              feeds: [
                {
                  id: "1",
                  xsecToken: "test",
                  noteCard: {
                    displayTitle: "仅用于测试",
                    interactInfo: { likedCount: "3" },
                  },
                },
              ],
            }
          : {
              data: {
                note: {
                  interactInfo: {
                    likedCount: "",
                    collectedCount: "0",
                    commentCount: "",
                    sharedCount: "1",
                  },
                },
              },
            };
      result =
        b.params.name === "publish_content" ||
        b.params.name === "check_login_status"
          ? {
              isError: true,
              content: [
                {
                  type: "text",
                  text:
                    b.params.name === "check_login_status"
                      ? "context deadline exceeded"
                      : "模拟提交后响应异常",
                },
              ],
            }
          : { content: [{ type: "text", text: JSON.stringify(data) }] };
      if (b.params.name === "get_login_qrcode")
        result = {
          content: [{ type: "image", mimeType: "image/png", data: "dGVzdA==" }],
        };
      if (b.params.name === "get_login_progress")
        result = {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                sequence: progressSequence,
                status: progressStatus,
                account: { nickname: "新账号", userId: "user-b" },
              }),
            },
          ],
        };
    }
    if (b.params?.name === "show_login_browser") result = {content:[{type:"text",text:"window shown"}]};
    if (b.params?.name === 'check_publish_page') result={content:[{type:'text',text:'只读检查通过'},{type:'image',mimeType:'image/png',data:'dGVzdA=='}],structuredContent:{publishPage:{status:'ready',message:'只读检查通过'}}};
    if (b.params?.name === 'publish_content' && failBeforeSubmit) result={isError:true,content:[{type:'text',text:'发布页准备失败'}],structuredContent:{publishOutcome:{version:1,stage:'prepare',publishClicked:false,safeToRetry:true}}};
    if (b.params?.name === "get_login_progress" && progressFault) {
      progressFault = false;
      result = {isError:true, content:[{type:"text",text:"temporary failure"}]};
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: b.id, result }));
  });
  mock.listen(0, "127.0.0.1");
  await once(mock, "listening");
  const probe = http.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      WORKBENCH_PORT: String(port),
      WORKBENCH_DATA_DIR: dir,
      WORKBENCH_ALLOW_LEGACY_MCP: '1',
      MCP_URL: `http://127.0.0.1:${mock.address().port}/mcp`,
      WORKBENCH_LEGACY_LEDGER: path.join(dir, "no-legacy.json"),
    },
  });
  let logs = "";
  child.stderr.on("data", (x) => (logs += x));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, "exit");
      child.kill("SIGTERM");
      await stopped;
    }
    await new Promise(resolve => mock.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  await Promise.race([
    once(child.stdout, "data"),
    once(child, "exit").then(() => {
      throw new Error(logs || "server failed");
    }),
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("startup timed out")),
        5000,
      );
      timer.unref();
    }),
  ]);
  const base = `http://127.0.0.1:${port}`;
  const post = (route, body, headers = {}) =>
    fetch(base + route, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workbench-Request": "1",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await post(
        "/api/drafts",
        { title: "bad" },
        { Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await fetch(base + "/api/drafts", { method: "POST", body: "{}" })).status,
    403,
  );
  const draft = await (
    await post("/api/drafts", { title: "测试草稿", content: "仅本机保存" })
  ).json();
  assert.ok(draft.id);
  assert.equal(
    (await (await fetch(base + "/api/status")).json()).drafts[0].title,
    "测试草稿",
  );
  const upload = await fetch(base + "/api/assets?name=sample.png", {
    method: "POST",
    headers: { "X-Workbench-Request": "1" },
    body: Buffer.from([137, 80, 78, 71, 1, 2, 3, 4]),
  });
  assert.equal(upload.status, 200);
  const asset = await upload.json();
  const range = await fetch(base + asset.url, {
    headers: { Range: "bytes=0-3" },
  });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 4);
  await post("/api/channel",{channel:"mcp"});
  const snapshot = await (await post("/api/monitor/refresh", {})).json();
  assert.equal(snapshot.notes[0].metrics.likes, 3);
  assert.equal(snapshot.notes[0].metrics.comments, null);
  assert.equal(snapshot.notes[0].metrics.favorites, 0);
  const payload = {
    name: "publish_content",
    args: {
      title: "测试提交",
      content: "不会发往真实平台",
      images: [asset.path],
    },
  };
  const check = await post('/api/call',{name:'check_publish_page',args:{mode:'image'}});
  assert.equal(check.status,200);
  const checked=await (await fetch(base+'/api/status')).json();
  assert.equal(checked.publishCheck.status,'ready');
  assert.equal(checked.publishCheck.mode,'image');
  assert.match(checked.publishCheck.image,/^data:image\/png;base64,/);
  assert.equal(Object.keys(checked.submissions).length,0);
  assert.equal(calls.filter(x=>x==='publish_content').length,0);
  assert.equal((await post("/api/call", payload)).status, 409);
  assert.equal(calls.filter((x) => x === "publish_content").length, 0);
  const preparation = await post('/api/call',{...payload,confirmed:true});
  assert.equal((await preparation.json()).submissionStatus,'failed_before_submit');
  failBeforeSubmit=false;
  const first = await post("/api/call", { ...payload, confirmed: true });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).submissionStatus, "uncertain");
  assert.equal(
    (await post("/api/call", { ...payload, confirmed: true })).status,
    409,
  );
  assert.equal(
    (
      await post("/api/call", {
        ...payload,
        args: { ...payload.args, title: "不同标题" },
        confirmed: true,
      })
    ).status,
    409,
  );
  assert.equal(calls.filter((x) => x === "publish_content").length, 2);
  const pendingState=await(await fetch(base+'/api/status')).json(),pendingKey=Object.keys(pendingState.submissions)[0];
  assert.equal((await post('/api/submissions/acknowledge',{key:'wrong-account-key'})).status,404);
  const acknowledged=await(await post('/api/submissions/acknowledge',{key:pendingKey})).json();assert.equal(acknowledged.status,'uncertain');
  const afterAcknowledge=await(await fetch(base+'/api/status')).json();assert.ok(afterAcknowledge.submissions[pendingKey].acknowledgedAt);assert.equal(afterAcknowledge.submissions[pendingKey].status,'uncertain');
  assert.equal((await post('/api/call',{...payload,confirmed:true})).status,409);assert.equal(calls.filter(x=>x==='publish_content').length,2);
  const storedRegistry = JSON.parse(
    await fs.readFile(path.join(dir, "state.json"), "utf8"),
  );
  const stored = storedRegistry.accounts[0].state;
  assert.equal(Object.values(stored.submissions)[0].status, "uncertain");
  assert.equal(Object.values(stored.submissions)[0].attempts[0].status,'failed_before_submit');
  assert.match(
    await (await fetch(base + "/api/export")).text(),
    /统计范围/,
  );
  const loginCheck = await (
    await post("/api/call", { name: "check_login_status", args: {} })
  ).json();
  assert.equal(loginCheck.login.status, "error");
  const afterError = await (await fetch(base + "/api/status")).json();
  assert.equal(afterError.login.name, undefined);
  assert.equal(afterError.snapshot, null);
  assert.equal(afterError.snapshots.length, 0);
  assert.equal(afterError.historicalSnapshotCount, 1);
  const preservedRegistry = JSON.parse(
    await fs.readFile(path.join(dir, "state.json"), "utf8"),
  );
  const preserved = preservedRegistry.accounts[0].state;
  assert.equal(preserved.snapshots.length, 1);
  assert.equal(preserved.login.status, "error");
  assert.equal((await post("/api/login/window",{})).status,409,"no login window is available after the scan ends");
  const qr = await (
    await post("/api/call", { name: "get_login_qrcode", args: {} })
  ).json();
  assert.equal(qr.login.status, "awaiting_scan");
  assert.equal((await post("/api/login/window",{})).status,200);
  assert.equal(calls.filter(x=>x==="show_login_browser").length,1);
  assert.equal(calls.filter(x=>x==="get_login_qrcode").length,1,"focusing must not replace the QR");
  const sameQr = await (await post("/api/call", {name:"get_login_qrcode", args:{}})).json();
  assert.equal(sameQr.reused, true, "refreshing must reuse the live QR");
  const duringScan = await (await post("/api/call", {name:"check_login_status", args:{}})).json();
  assert.equal(duringScan.login.status, "awaiting_scan");
  assert.equal(calls.filter(x => x === "check_login_status").length, 1, "pending scan must not open another browser");
  const restored = await (await fetch(base + "/api/status")).json();
  assert.equal(restored.loginFlow.qr.data, "dGVzdA==", "a page reload restores the same QR");
  let completed;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 100));
    completed = await (await fetch(base + "/api/monitor/state")).json();
    if (completed.login.status === "logged_in") break;
  }
  assert.equal(completed.login.name, "新账号");
  assert.equal(completed.login.userId, "user-b");
  assert.equal(completed.snapshot, null);
  assert.equal(calls.filter((x) => x === "get_login_progress").length, 2);
  assert.equal(
    calls.filter((x) => x === "check_login_status").length,
    1,
    "auto detection must not repeatedly launch login browsers",
  );
  await post("/api/call", { name: "get_login_qrcode", args: {} });
  const beforeLogout = calls.filter(x => x === "get_login_progress").length;
  await post("/api/call", {
    name: "delete_cookies",
    args: {},
    confirmed: true,
  });
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(
    (await (await fetch(base + "/api/monitor/state")).json()).login.status,
    "logged_out",
  );
  assert.equal(
    calls.filter((x) => x === "get_login_progress").length,
    beforeLogout,
    "logging out must cancel the pending watch",
  );
  progressStatus = "waiting";
  await post("/api/call", {name:"get_login_qrcode", args:{}});
  progressFault = true;
  await new Promise(r => setTimeout(r, 800));
  const retrying = await (await fetch(base + "/api/monitor/state")).json();
  assert.equal(retrying.loginFlow.status, "waiting", "temporary progress errors must not lose the QR");
  assert.equal(retrying.login.status, "awaiting_scan");
  progressStatus = "saved";
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r,100));
    if ((await (await fetch(base + "/api/monitor/state")).json()).login.status === "logged_in") break;
  }
  assert.equal((await (await fetch(base + "/api/monitor/state")).json()).login.name, "新账号");
  progressStatus = "waiting";
  await post("/api/call", {name:"get_login_qrcode", args:{}});
  progressSequence = 2;
  progressStatus = "saved";
  await new Promise(r => setTimeout(r,800));
  const superseded = await (await fetch(base + "/api/monitor/state")).json();
  assert.equal(superseded.login.status, "expired", "a different Inspector session cannot complete the displayed QR");
  assert.equal(superseded.loginFlow.qr, undefined);

});
