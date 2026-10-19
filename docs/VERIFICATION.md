# 公开源码验证记录

本记录只描述此次开源整理实际执行过的检查。

| 检查 | 结果 |
| --- | --- |
| 从独立公开目录执行 npm run setup | 通过：新建 Python 3.12 虚拟环境，安装 Node 与 Python 依赖 |
| npm run check | 通过 |
| npm test | 255 / 255 通过（本机 macOS） |
| 可选 MCP：go test ./... | 所有有测试的 Go 包通过；无测试的包正常编译 |
| 359 组作者素材 | 359 唯一 handle、359 图片、无缺失、逐文件 SHA-256 检查通过，合计 1,398,966 字节 |
| 旧作者池升级 | 保留自定义名称及 hidden 状态，补齐 359 组，不重复导入 |
| 隔离数据目录启动 | health 版本 1.13.1；不读取作者本机账号或素材记录 |
| Chromium 浏览器冒烟 | 359 作者可读、扩展 1.4.8 成功生成、原比例 Canvas 1080×505 有可见文字和图形、页面无 JavaScript 异常 |
| Windows 构建资源准备 | npm ci --prefix desktop、npm run desktop:prepare 通过；启动器语法检查通过 |
| 公开文件审计 | 运行数据、缓存、密钥文件及个人路径检查通过 |
| Gitleaks 8.30.1 扫描公开文件快照 | 零发现；工具下载包摘要与官方 release checksums 匹配 |

浏览器截图来自临时测试账号和演示文字，未登录真实平台、未实际调用模型、未发布笔记或评论。测试结束后已删除临时数据目录。

GitHub CI 会额外运行 Linux、macOS、Windows 源码测试；Windows 仅跳过依赖 POSIX 可执行脚本的一个 MCP mock 集成场景，该场景由 Linux/macOS 覆盖。CI 状态以仓库 Actions 最新记录为准，本文不预先宣称远端已通过。

本次没有重建客户 Windows 安装包，没有进行 Windows 实机安装/升级、真实平台采集、最终发布、定时或评论的验收。手动 Windows 构建工作流属于后续可执行的入口，不等于已完成这些验收。
