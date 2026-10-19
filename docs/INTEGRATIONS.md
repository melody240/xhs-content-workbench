# MCP、Skills 与参考项目

## 实际运行关系

```text
工作台前端 → 本机 Node 服务 → 本项目 Python 适配器 → 上游 Xiaohongshu Skills CLI
                           ↘ 带令牌 WebSocket → 本项目生成的 Edge 扩展 → 当前平台页面
                           ↘ 用户配置的模型接口
可选 MCP 客户端 → Go Xiaohongshu MCP → 独立浏览器会话
```

默认 Edge 路径和可选 MCP 路径是两套连接。不要把两者的登录、账号核实或运行结果混用。

## 已包含的上游代码

### Xiaohongshu Skills

- 来源：https://github.com/autoclaw-cc/xiaohongshu-skills ，MIT。
- 路径：`workbench/vendor/xiaohongshu-skills/`，保留上游 LICENSE、README、SKILL.md、CLI、扩展辅助源码及五项技能。
- 安装快照来自 main，原始记录未提供提交 SHA，因此不虚构版本。文件校验见 `WORKBENCH-PROVENANCE.json`。
- `xhs-auth`：登录及状态；`xhs-explore`：搜索与详情；`xhs-interact`：评论、回复、点赞、收藏；`xhs-publish`：发布表单；`xhs-content-ops`：组合内容操作。
- 适配器代码位于 `workbench/integrations/`，命令白名单位于 `skills-catalog.mjs`。项目不会直接运行上游自动启动的无鉴权桥接服务。
- 生成扩展只复用必要辅助函数，移除 Cookie 读取辅助函数；不启用上游网络日志、风险探测或指纹覆盖。生成清单保留 tabs、scripting、alarms、debugger 权限，X/抖音为可选站点权限。

### Xiaohongshu MCP

- 来源：https://github.com/xpzouying/xiaohongshu-mcp ，Apache-2.0。
- 基线提交：`a5c8f7799980ba1fdd501999843eb2d17e4c9a9f`；本仓库包含工作台使用过程中产生的本地修订，**不是原封不动的上游镜像**。
- 路径：`mcp/`。为了保留内部 Go 导入，module 仍为上游路径；仓库归属见根 README。
- 本地修订包括登录会话/窗口、发布前就绪检查、发布结果识别及相关测试，完整内容以源码为准。
- 这是 HTTP MCP 服务；调用工具需要由客户端读取服务端实际返回的工具清单，不猜测参数。

编译和本机启动（Go 1.24+，首次可能下载浏览器）：

```bash
cd mcp
go build -o xiaohongshu-mcp .
./xiaohongshu-mcp -headless=false -port=127.0.0.1:18060
```

Windows 编译为 `xiaohongshu-mcp.exe`，使用 `./xiaohongshu-mcp.exe` 启动。客户端以 Streamable HTTP 连接 `http://127.0.0.1:18060/mcp`。需要鉴权时通过 `AUTH_TOKEN` 环境变量设置，并让客户端携带 Bearer Token；不要在命令行、仓库或示例中放真实密钥。默认未设令牌，始终只绑定回环地址。

工作台兼容模式需要明确设置 `WORKBENCH_ALLOW_LEGACY_MCP=1`，自定义二进制路径设置 `WORKBENCH_MCP_BINARY`，端点设置 `MCP_URL`。日常使用建议默认 Edge 通道。

## 本项目 Skill

`skills/content-workbench/SKILL.md` 是可供支持 Skills 的 AI 助手读取的操作指南。将该文件夹放入助手的技能目录，或直接让助手阅读。不同客户端的安装位置不同，仓库不自动改写你现有的全局技能。

技能说明不会自动授予发布权限；平台登录和最终对外操作授权仍由本人决定。

## 研究参考，非运行依赖

以下项目曾用于调研，未作为额外 MCP 服务运行，也不需要安装它们才能启动工作台。公开仓库不复制本地调研缓存：

| 项目 | 参考内容 | 原记录版本 |
| --- | --- | --- |
| [zJay26/douyin-skills](https://github.com/zJay26/douyin-skills) | 抖音浏览器流程，MIT | 09e9ccb6c484c59d69e11dbb4bc975c47e5510e5 |
| [ywleeo/browser-mcp](https://github.com/ywleeo/browser-mcp) | 浏览器桥接设计，MIT | 5a17892ff945265e12d60ed78f5e4d2ccfea1b75 |
| [twittershots/twittershots-mcp](https://github.com/twittershots/twittershots-mcp) | X 截图服务方案 | 未记录确定提交；未调用其远程截图 API |

未将 Impeccable、Sites、Codex 自带技能、私人全局配置或第三方开发工具作为本项目运行依赖打包。它们属于开发工具，和上述业务集成不同。
