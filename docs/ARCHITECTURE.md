# 项目结构

## 业务边界

- `workbench/server.mjs`：本机 HTTP API、账号上下文、任务编排、素材与静态文件服务。只监听 127.0.0.1。
- `accounts.mjs`：账号隔离和可选 MCP 子进程。
- `integrations/content-workflow.mjs`、`agent.mjs`、`writer.mjs`：选题、写作、连续内容准备。
- `integrations/skills.mjs`、`skills_runner.py`、`skills-extension.mjs`：有限命令白名单、Python 调用、带令牌扩展生成与会话绑定。
- `integrations/comment-*`、`douyin-comments-extension.js`：评论采集、点赞筛选、截图及素材关联。
- `integrations/creator-*`：官方编辑器标题候选、创作服务平台数据。
- `integrations/quote-cards.mjs`：语录文案与作者素材池；`public/quote-card-*.js`：原比例 Canvas 渲染与数据格式化。
- `public/collage-*.js`：3:4 拼图排布及交互。
- `storage.mjs`：合并待写快照、原子落盘；`retention.mjs`：历史记录压缩；`rotating-log.mjs`：日志轮转。
- `desktop/desktop/`：Windows Electron 壳、独立数据目录、单实例和按启动令牌关闭后端。
- `mcp/`：可单独构建的 Go MCP，和默认 Edge 路径分开。

前端继续使用原有原生 JavaScript 模块，未为开源整理引入框架迁移或改动用户工作流。本次只抽出可独立使用的目录、补充安装与构建入口，并适配跨平台 Python 路径。

## 数据边界

运行时状态、模型密钥、登录状态、任务记录、草稿、截图及扩展配置归入本机 data。公开素材种子独立放置，只有作者昵称、公开 handle、来源 URL、图片及哈希，不带采集任务、私人账号或 sourceAssetId。

对外模型调用只走用户选择的提供商。浏览器登录留在本机 Edge，验证码交由使用者处理。提交结果未知时阻止重复发布并要求核查。

## 维护约定

优先在业务模块内修改，再补对应测试；不要改写 vendored 上游源码来掩盖适配器问题。升级上游时更新 provenance 并核验扩展辅助函数提取。

界面使用明确的标签和动作名称，不默认添加小字副标题、步骤口号或用户删除过的同义文案。真实状态、错误、必要限制和恢复入口保留。对大规模框架迁移、数据库替换及采集策略变化应单独提交方案。
