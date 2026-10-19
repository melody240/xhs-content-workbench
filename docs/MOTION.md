# 动效实现与参考

## 当前节奏

沿用当前玻璃视觉、布局和文案，迁移个人参考案例 08 的 M02「加速离场、减速落定」、M04「有界错峰」与 M11「结果进入编辑场景的对象连续性」。只取动作关系，不复制参考片的品牌外观、字幕或素材。

内容页切换由本地 GSAP 3.15.0 的单条时间线统筹，离场基础 300ms（power2.in），入场基础 460ms（power3.out），跟进 48ms。模块起始节奏 0/82/26/112/46/96ms，编辑/结果栏额外保留 22ms 落定时间，第二模块再加 10ms，双栏总计约 622ms。父舞台静止，模块各自向左退出、从右进入。文字落定后保持可读，不对正文作逐字动画。

短标题初次展开 380ms、新结果标题 300ms，总错峰不超过 100ms。导航高光 280ms，按压 240ms，选图扫光 360ms、勾选回落 220ms。弹窗 240ms，保留轻位移与透明度，不再逐帧模糊整张弹窗。

仅在真实切换/操作时启动，普通轮询不重播；玻璃面移动期间关闭实时背景模糊，最多 12 个可见模块，不引入鼠标跟随光斑。完成、重复导航、系统减少动态效果或页面隐藏会 revert GSAP context 并移除快照/临时层，恢复原内联样式；GSAP 加载失败回退到原生 Web Animations。

## 实现入口

- workbench/public/workspace-transition.js：每次切换的 GSAP timeline、独立模块节奏、context 清理与原生回退。
- workbench/public/motion.js：导航、短标题、图片勾选及真实进度反馈。
- workbench/public/liquid.css：弹窗与移动玻璃面的状态。
- workbench/public/vendor/gsap/：锁定的离线运行文件、来源、哈希与原许可证链接。

开发时使用 gsap 与 reference-led-ui-motion 两项技能；个人视频及个人技能库不作为运行依赖随仓库分发。GSAP 库使用自己的 Standard no-charge license，并非 Apache-2.0 / MIT。
