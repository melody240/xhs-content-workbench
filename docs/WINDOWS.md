# Windows 构建与升级

## 源码运行

Windows 也可直接按 README 安装 Node.js / Python，执行 `npm run setup`、`npm start`。不要复制 Mac 的 `.venv`、node_modules 或已登录浏览器资料。

## 构建安装器

建议使用 Windows x64 和 Python 3.11+（已安装 pip）：

```bash
npm run setup
npm ci --prefix desktop
npm run desktop:prepare
python desktop/tools/fetch-python.py
npm --prefix desktop run build:win
```

构建会下载 Python Windows 嵌入式运行时和依赖、Electron、NSIS 等文件，需能访问其官方分发服务。Python 下载器比对官方 Sigstore 文件中的摘要；这只是摘要匹配，**不等于已独立验证签名身份**。构建资源来自当前公开源码，包含 359 组素材种子，不复制本机账号或 data。

安装器在 `desktop/output/`，只把 `XHS-Workbench-Setup-<版本>-win-x64.exe` 发给使用者。其他 blockmap、win-unpacked 和调试文件是构建产物，不是多个安装包。

也可以在 GitHub「Actions → Build Windows installer → Run workflow」手动构建。完成后下载该运行的安装器 artifact。工作流不自动发布 Release，下载 artifact 需要 GitHub 登录。

## 普通升级

保留 `appId = local.xhs.workbench.desktop`、exe 名称 `XHSWorkbench` 和用户目录 `%APPDATA%\XHSWorkbench`。使用**递增版本号**构建安装器，退出旧工作台后直接安装。无需先卸载；不要勾选清理用户资料或删除 AppData。修改版本时同步根目录、workbench、desktop 的 package.json / lockfile 和 health 版本。

此仓库首次公开的源码版本是 1.13.1，未在本次开源整理中重建或替换之前的客户 Windows ZIP。后续发给现有客户的升级应使用更高版本号并先备份用户数据。

## 验收

CI 构建和单元测试不能证明所有 Windows 显卡、代理和浏览器组合都正常。发布前在 Windows 实机核实：安装/升级、359 组作者导入、语录卡预览与导出、扩展连接、账号保留、截图与退出保存。平台最终发布、定时与评论结果以真实平台状态为准。
