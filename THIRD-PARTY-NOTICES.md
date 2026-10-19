# 第三方组件与来源

本项目是对现有开源组件的整合和扩展，不是将上游成果宣称为独立原创。

| 组件 | 来源 | 许可证 | 随仓库位置 |
| --- | --- | --- | --- |
| Xiaohongshu MCP | https://github.com/xpzouying/xiaohongshu-mcp | Apache-2.0 | mcp/LICENSE；保留 module 路径及原版权声明 |
| Xiaohongshu Skills | https://github.com/autoclaw-cc/xiaohongshu-skills | MIT | workbench/vendor/xiaohongshu-skills/LICENSE |
| ws 8.22.0 | https://github.com/websockets/ws | MIT | 安装时由 npm 获取，许可证随包 |
| pngjs 7.0.0 | https://github.com/pngjs/pngjs | MIT | 安装时由 npm 获取，许可证随包 |
| Electron / electron-builder | https://www.electronjs.org / https://github.com/electron-userland/electron-builder | MIT，含各自第三方组件声明 | 构建时下载，保留运行时自带 notices |
| Python 运行时 | https://www.python.org | PSF 及附带第三方许可 | Windows 构建时下载，保留自带 LICENSE |
| requests / websockets / python-socks | PyPI，版本见 workbench/skills-requirements.txt | 各包原始许可 | 安装或构建时下载，保留 dist-info 许可证 |

Go 间接依赖见 mcp/go.mod 与 go.sum。Node 依赖及 Electron 构建依赖见各 package-lock.json。其他研究参考项目见 docs/INTEGRATIONS.md，不作为额外运行服务打包。

工作台代码、Python 和扩展适配器、Windows 启动器及文档的本地扩展按 Apache-2.0 提供。vendored 上游代码按其原许可证提供；部分生成的扩展辅助代码源自 MIT 上游，生成目录附带上游 LICENSE。

头像、昵称、平台图形及默认图片按原权利状态提供，不自动由代码许可证授权。详见 docs/ASSETS.md。
