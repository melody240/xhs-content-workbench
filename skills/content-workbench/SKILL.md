---
name: content-workbench
description: 帮助使用本仓库的小红书内容工作台，连接本机 Edge，完成选题、文案、跨平台评论素材、拼图和发布前检查。
---

# 内容工作台

先阅读仓库 README.md、docs/QUICKSTART.md 和 docs/INTEGRATIONS.md。此技能是操作指南，不会自动安装软件或赋予登录权限。

1. 在仓库根目录执行 `npm run setup`，再执行 `npm start`。只连接本机工作台；不要公开监听端口。
2. 用户本人加载工作台生成的扩展，完成平台登录、验证码及平台权限确认。不要导出 Cookie，不绕过验证。
3. 先让用户选择一个选题，再完成标题、正文、话题和相关素材准备。不得把采集失败伪装成成功，也不得用笔记点赞数代替评论点赞数。
4. 需要程序化检查时，先读 workbench/server.mjs 的真实接口定义及 workbench/integrations/skills-catalog.mjs 的参数白名单，不猜测接口。鉴权配置和账号状态保留在本地数据目录。
5. 标题直白、正文可理解、素材与选题相关。素材需保留来源。语录卡的随机互动数据是创作数据，不能当作真实平台统计或真实人物发言。
6. 平台发布、评论和其他对外写入，必须在用户明确授权的范围内执行；结果不确定时先核查，不能盲目重复提交。

本仓库还保留上游五项 Skills：xhs-auth、xhs-explore、xhs-interact、xhs-publish、xhs-content-ops，位于 workbench/vendor/xiaohongshu-skills/skills/。工作台的适配器只开放有限命令；不等于开放上游的全部自动化行为。
