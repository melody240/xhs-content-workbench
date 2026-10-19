# 参与贡献

1. Fork 仓库，在分支中修改；保持一次 PR 聚焦一个问题。
2. 执行 `npm run setup`、`npm run check`、`npm test`、`npm run audit:public`。修改 MCP 时额外执行 `cd mcp && go test ./...`。
3. 不提交 data、node_modules、虚拟环境、构建缓存、客户安装包、登录状态或真实密钥。新增素材要提供来源并确认可分发。
4. 对外平台写入、登录、验证码和提交结果核查，不得以模拟测试冒充真实验收。
5. 文案保持直白；不要添加多余的小字说明、步骤口号或用户已删除内容的同义句。升级上游保留来源、许可证与 provenance。

Issue 请注明系统、Node/Python 版本、复现步骤和脱敏错误；截图遮住账号与密钥。
