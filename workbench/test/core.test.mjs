import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeFeed,
  metric,
  validatePublish,
  validEndpoint,
  shanghaiDay,
  validateSchema,
  loginStateAfter,
  snapshotsForLogin,
} from "../core.mjs";

test("换号后的登录超时保持未确认，不能继续显示旧账号已登录", () => {
  const old = {
    status: "logged_in",
    name: "旧账号",
    profile: { nickname: "旧账号", redId: "a" },
  };
  const timeout = loginStateAfter(old, "check_login_status", {
    isError: true,
    content: [{ type: "text", text: "context deadline exceeded" }],
  });
  assert.equal(timeout.status, "error");
  assert.equal(timeout.name, undefined);
  assert.equal(timeout.profile, undefined);
  const cleared = loginStateAfter(old, "delete_cookies", {
    content: [{ type: "text", text: "Cookies 已成功删除" }],
  });
  assert.equal(cleared.status, "logged_out");
  const scan = loginStateAfter(cleared, "get_login_qrcode", {
    content: [{ type: "image", data: "test", mimeType: "image/png" }],
  });
  assert.equal(scan.status, "awaiting_scan");
  const checked = loginStateAfter(scan, "check_login_status", {
    content: [{ type: "text", text: "✅ 已登录\n用户名: 新账号" }],
  });
  assert.equal(checked.name, "新账号");
  assert.equal(checked.profile, undefined);
  const noName = loginStateAfter(old, "check_login_status", {
    content: [
      { type: "text", text: "✅ 已登录\n用户名: \n\n你可以使用其他功能了。" },
    ],
  });
  assert.equal(noName.name, "");
  assert.equal(noName.profile, undefined);
});

test("按核实的小红书号分开采集历史，同名账号也不会混合", () => {
  const snapshots = [
    { profile: { nickname: "同名", redId: "a" } },
    { profile: { nickname: "同名", redId: "b" } },
  ];
  assert.deepEqual(snapshotsForLogin(snapshots, { status: "error" }), []);
  assert.deepEqual(
    snapshotsForLogin(snapshots, { status: "logged_in", name: "同名" }),
    [],
  );
  const login = loginStateAfter(null, "get_my_profile", {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          userBasicInfo: { nickname: "同名", redId: "b" },
        }),
      },
    ],
  });
  assert.deepEqual(snapshotsForLogin(snapshots, login), [snapshots[1]]);
  assert.equal(snapshots.length, 2);
});

test("缺失互动数据不会伪装为零，平台简写保留原始显示值", () => {
  const n = normalizeFeed({
    id: "note",
    noteCard: {
      interactInfo: {
        likedCount: "1.2万",
        collectedCount: "0",
        commentCount: "",
      },
    },
  });
  assert.equal(n.metrics.likes, 12000);
  assert.equal(n.metricLabels.likes, "1.2万");
  assert.equal(n.metrics.favorites, 0);
  assert.equal(n.metrics.comments, null);
  assert.equal(n.metrics.shares, null);
  assert.equal(n.metrics.views, null);
  assert.equal(metric("未知"), null);
});
test("北京时间跨日及定时发布边界", () => {
  const now = Date.parse("2030-01-01T00:00:00Z");
  assert.equal(shanghaiDay(new Date("2030-01-01T16:01:00Z")), "2030-01-02");
  const args = { title: "中文笔记", content: "正文", images: ["/test.png"] };
  assert.throws(
    () =>
      validatePublish(
        { ...args, schedule_at: new Date(now + 3599000).toISOString() },
        "publish_content",
        now,
      ),
    /1 小时/,
  );
  assert.doesNotThrow(() =>
    validatePublish(
      { ...args, schedule_at: new Date(now + 3600000).toISOString() },
      "publish_content",
      now,
    ),
  );
  assert.throws(
    () =>
      validatePublish(
        { ...args, schedule_at: new Date(now + 15 * 86400000).toISOString() },
        "publish_content",
        now,
      ),
    /14 天/,
  );
  assert.throws(
    () =>
      validatePublish(
        { ...args, tags: ["重复", "重复"] },
        "publish_content",
        now,
      ),
    /重复/,
  );
});
test("连接设置只允许本机 MCP，拒绝凭据和伪装域名", () => {
  assert.equal(
    validEndpoint("http://127.0.0.1:18060/mcp/"),
    "http://127.0.0.1:18060/mcp",
  );
  for (const u of [
    "https://example.com/mcp",
    "http://localhost.example.com/mcp",
    "http://user:pass@localhost/mcp",
    "http://localhost/mcp?token=123",
  ])
    assert.throws(() => validEndpoint(u));
  assert.throws(
    () =>
      validateSchema(
        { tab: "bad" },
        {
          type: "object",
          properties: { tab: { type: "string", enum: ["note", "fav"] } },
        },
      ),
    /可选范围/,
  );
});


test("已保存的扫码登录不会因资料暂时超时而被要求重新扫码", () => {
  const saved = loginStateAfter(null, "get_login_progress", {content:[{type:"text",text:JSON.stringify({status:"saved"})}]});
  assert.equal(saved.status, "session_saved");
  const delayed = loginStateAfter(saved, "get_my_profile", {isError:true,content:[{type:"text",text:"context deadline exceeded"}]});
  assert.equal(delayed.status, "session_saved");
  const guest = loginStateAfter(delayed, "get_my_profile", {isError:true,content:[{type:"text",text:"当前页面未登录，请先完成扫码登录"}]});
  assert.equal(guest.status, "logged_out");
});
