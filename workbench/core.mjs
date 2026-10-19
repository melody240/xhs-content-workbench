import { createHash } from "node:crypto";

export const WRITE_TOOLS = new Set([
  "publish_content",
  "publish_with_video",
  "delete_cookies",
  "post_comment_to_feed",
  "reply_comment_in_feed",
  "reply_notification",
  "like_feed",
  "favorite_feed",
  "like_notification",
]);
export const PUBLISH_TOOLS = new Set(["publish_content", "publish_with_video"]);
export const LOGIN_TOOLS = new Set([
  "check_login_status",
  "get_login_qrcode",
  "delete_cookies",
  "get_my_profile",
  "get_login_progress",
]);

export function loginStateAfter(
  current,
  tool,
  result,
  at = new Date().toISOString(),
) {
  if (!LOGIN_TOOLS.has(tool)) return current;
  const data = parseResult(result);
  const text = typeof data === "string" ? data : JSON.stringify(data);
  if (result.isError) {
    if (/当前页面未登录/.test(text))
      return {status:"logged_out",at,message:"电脑端尚未完成登录，请扫码并在实际小红书窗口核对提示。"};
    if (current?.status === "session_saved" && tool === "get_my_profile")
      return {...current, at, message: "手机登录已保存，但账号资料读取暂时失败。请重试核实，无需重新扫码。"};
    return {
      status: "error",
      at,
      message: /deadline exceeded|超时/i.test(text)
        ? "小红书页面加载超时，当前账号尚未核实。已在手机确认后，请先重试检查，无需立即重新扫码。"
        : /ERR_CONNECTION|ERR_NETWORK|ERR_INTERNET/i.test(text)
          ? "连接小红书网页时中断，未完成账号核实。已在手机确认后，请先重试检查，不要退出登录或反复生成二维码。"
          : "MCP 未能读取当前账号，暂时无法核实身份。请查看操作结果；此状态不等于未登录。",
    };
  }
  if (tool === "get_login_progress") {
    if (data?.status === "saved") {
      const account = data.account;
      return account?.nickname && account.userId
        ? {
            status: "logged_in",
            at,
            name: account.nickname,
            userId: account.userId,
            message: `扫码登录已保存，当前账号：${account.nickname}`,
          }
        : {
            status: "session_saved",
            at,
            message:
              "扫码登录已保存。账号名称暂未读到，请检查登录核实身份，无需重新扫码。",
          };
    }
    if (data?.status === "expired")
      return {
        status: "expired",
        at,
        message: "二维码已过期，请重新生成后扫码。",
      };
    if (data?.status === "error")
      return {
        status: "error",
        at,
        message: data.message || "扫码结果保存失败，请重试。",
      };
    if (data?.status === "idle" && current?.status === "awaiting_scan")
      return {
        status: "unknown",
        at,
        message: "扫码会话已结束，请检查登录核实账号。",
      };
    return current;
  }
  if (tool === "delete_cookies")
    return {
      status: "logged_out",
      at,
      message: "旧登录已清除，请获取新二维码并扫码确认登录。",
    };
  if (tool === "get_my_profile") {
    const profile = data?.userBasicInfo;
    if (profile?.nickname && profile.redId)
      return {
        status: "logged_in",
        at,
        name: profile.nickname,
        profile,
        message: "当前账号主页已核实",
      };
    return {
      status: "unknown",
      at,
      message:
        "账号主页没有返回有效资料，暂时无法核实身份。请稍后重试读取我的主页；此状态不等于未登录。",
    };
  }
  if (/✅\s*已登录|已处于登录状态/.test(text)) {
    const name = text.match(/用户名[:：][ \t]*([^\r\n]*)/)?.[1]?.trim();
    // A textual login response does not expose a stable account ID. Fetch the
    // profile before attaching historical metrics to this login.
    return {
      status: "logged_in",
      at,
      name,
      message: name
        ? `当前登录账号：${name}`
        : "账号已登录，请读取我的主页确认账号身份。",
    };
  }
  if (
    tool === "get_login_qrcode" &&
    (result.content || []).some((x) => x.type === "image")
  ) {
    return {
      status: "awaiting_scan",
      at,
      message:
        "正在自动等待扫码结果，无需点击检查。",
    };
  }
  if (/未登录/.test(text))
    return {
      status: "logged_out",
      at,
      message: "当前未登录，请获取二维码扫码登录。",
    };
  return { status: "unknown", at, message: "当前登录状态尚未核实。" };
}

export function snapshotsForLogin(snapshots, login) {
  const id = login?.status === "logged_in" && login.profile?.redId;
  return id ? snapshots.filter((s) => s.profile?.redId === id) : [];
}
export function parseResult(result) {
  const texts = (result.content || [])
    .filter((x) => x.type === "text")
    .map((x) => x.text);
  for (const t of texts) {
    try {
      return JSON.parse(t);
    } catch {}
  }
  return texts.join("\n");
}
export function metric(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value).replaceAll(",", "").trim();
  const match = s.match(/^(\d+(?:\.\d+)?)\s*(万|亿)?\+?$/);
  return match
    ? Math.round(
        Number(match[1]) *
          (match[2] === "万" ? 10000 : match[2] === "亿" ? 100000000 : 1),
      )
    : null;
}
export function normalizeFeed(feed) {
  const card = feed.noteCard || feed.note || feed;
  const it = card.interactInfo || {};
  return {
    id: feed.id || card.noteId || "",
    xsecToken: feed.xsecToken || card.xsecToken || "",
    title: card.displayTitle || card.title || "未命名笔记",
    cover:
      card.cover?.urlDefault ||
      card.cover?.url ||
      card.cover?.urlPre ||
      card.imageList?.[0]?.urlDefault ||
      "",
    author: card.user?.nickname || card.user?.nickName || "",
    type: card.type || "normal",
    metrics: {
      likes: metric(it.likedCount),
      favorites: metric(it.collectedCount),
      comments: metric(it.commentCount),
      shares: metric(it.sharedCount),
      views: null,
      impressions: null,
    },
    metricLabels: {
      likes: it.likedCount ?? "",
      favorites: it.collectedCount ?? "",
      comments: it.commentCount ?? "",
      shares: it.sharedCount ?? "",
    },
    publishedAt: card.time || null,
  };
}
export function shanghaiDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function validatePublish(args, tool, now = Date.now()) {
  if (!args.title?.trim()) throw new Error("请填写标题");
  if ([...args.title].length > 20) throw new Error("标题请控制在 20 字以内");
  if (!args.content?.trim()) throw new Error("请填写正文");
  if ([...args.content].length > 1000)
    throw new Error("正文请控制在 1000 字以内");
  if (
    tool === "publish_content" &&
    (!Array.isArray(args.images) || args.images.length < 1)
  )
    throw new Error("请至少选择一张图片");
  if (tool === "publish_with_video" && !args.video)
    throw new Error("请选择视频文件");
  if (
    args.tags &&
    (args.tags.length > 10 || new Set(args.tags).size !== args.tags.length)
  )
    throw new Error("话题最多 10 个，且不能重复");
  if (args.schedule_at) {
    const t = Date.parse(args.schedule_at);
    if (!Number.isFinite(t) || t < now + 3600000 || t > now + 14 * 86400000)
      throw new Error("定时发布时间应在 1 小时至 14 天内");
  }
  if (
    args.visibility &&
    !["公开可见", "仅自己可见", "仅互关好友可见"].includes(args.visibility)
  )
    throw new Error("请选择有效的可见范围");
}
export function submissionKey(tool, args) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        tool,
        args.title,
        args.content,
        args.images || args.video,
        args.tags || [],
        args.schedule_at || "",
        args.visibility || "公开可见",
      ]),
    )
    .digest("hex");
}
export function validEndpoint(input) {
  const u = new URL(input);
  if (
    u.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !["/mcp", "/mcp/"].includes(u.pathname)
  )
    throw new Error("请填写本机 MCP 地址，例如 http://127.0.0.1:18060/mcp");
  return u.href.replace(/\/$/, "");
}
export function validateSchema(value, schema, path = "参数") {
  if (!schema) return;
  if (schema.enum && !schema.enum.includes(value))
    throw new Error(`${path}不在可选范围内`);
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (value === null) {
    if (types.includes("null")) return;
    throw new Error(`${path}不能为空`);
  }
  if (types.includes("object")) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`${path}应为对象`);
    for (const key of schema.required || [])
      if (value[key] === undefined || value[key] === null || value[key] === "")
        throw new Error(`请填写 ${key}`);
    for (const [key, v] of Object.entries(value)) {
      if (schema.additionalProperties === false && !schema.properties?.[key])
        throw new Error(`不支持的参数：${key}`);
      if (schema.properties?.[key])
        validateSchema(v, schema.properties[key], key);
    }
  } else if (types.includes("array")) {
    if (!Array.isArray(value)) throw new Error(`${path}应为列表`);
    value.forEach((x) => validateSchema(x, schema.items, path));
  } else if (types.includes("integer")) {
    if (!Number.isInteger(value)) throw new Error(`${path}应为整数`);
  } else if (types.includes("boolean")) {
    if (typeof value !== "boolean") throw new Error(`${path}应为开关值`);
  } else if (types.includes("string")) {
    if (typeof value !== "string") throw new Error(`${path}应为文字`);
  }
}
