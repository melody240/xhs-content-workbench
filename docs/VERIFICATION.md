# 公开源码验证记录

本记录只描述此次开源整理实际执行过的检查。

| 检查 | 结果 |
| --- | --- |
| 从独立公开目录执行 npm run setup | 通过：新建 Python 3.12 虚拟环境，安装 Node 与 Python 依赖 |
| npm run check | 通过 |
| npm test | 256 / 256 通过（本机 macOS） |
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

首次远端 CI 已通过 Linux/macOS 与 MCP；Windows 检出 CRLF 导致 Cookie 辅助函数移除失败及两项 POSIX 权限断言不适用的问题。已在扩展生成入口统一换行符，补充 CRLF 回归，并将 POSIX 权限断言限于适用系统；Windows 文件权限由本机 ACL 决定。修订后的远端结果以 Actions 为准。

修订后的[远端 CI](https://github.com/melody240/xhs-content-workbench/actions/runs/39184271862)已全部通过：Linux、macOS、Windows 与 Go MCP。对应代码提交为 2b789d85a6231a800f0df99ffcb843a6ad2c9a29。工作台测试在 Linux/macOS 为 256 项通过，Windows 为 255 项通过并明确跳过一项 POSIX mock 场景。

依赖审计另见 SECURITY.md：运行依赖零告警，桌面构建链保留 8 项由同一底层问题传递的中等级告警，未为消除数字而强制变更已锁定的安装器工具链。

## GSAP 动效更新（2026-10-19）

使用原生模块保持布局与业务流程，添加本地 GSAP 3.15.0 时间线。此轮源码版 258 项测试通过，公开维护版 260 项测试通过（额外包含完整作者池与 CRLF 扩展回归）。新增覆盖 GSAP 错峰位置、退出/进入曲线、完成清理、连续中断及异常恢复。

本机 Chromium 验证：两个主模块保持顶边对齐；6 次快速切页后无 outgoing、motion-piece 或内联位移残留；图片选中反馈结束清理；弹窗 filter 为 none；系统减少动态效果和键盘切换可用；GSAP 加载失败时原生回退仍可进入编辑页。截图及测试使用临时账号和合成素材，未登录平台或对外发布。Windows 客户交付包未更新，真实设备帧率不能由此测试代替。

窄屏已按真实 390px 视口验证，无横向溢出；动态选择反馈以动画完成事件核查清理，而非依赖固定等待。GSAP 初始化到一半异常的路径也有独立回归，确保已分配的 context 仍能恢复内容。
