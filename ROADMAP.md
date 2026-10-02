# 路线图与长期策略

## 策略：三条不变量

1. **证据驱动**：任何"完成"都要有可复现的命令与输出。仓库里的 `scripts/verify-*.mjs` 就是这条规则的产物。
2. **不碰 GenBox 源码**：插件是纯 HTTP 客户端，GenBox 独立升级；GPL 边界干净。
3. **先能用再好看**：工具先保证参数、返回值、错误处理扎实（这是 agent 真正消费的部分），UI 卡片与后台任务后置。

## 阶段与门槛

| 阶段 | 目标 | 完成门槛（证据） | 状态 |
|---|---|---|---|
| G0 可用 | 10 个工具覆盖生图/改图/视频/媒体库 | `verify-tools.mjs` 端到端 OK；`tsc --noEmit` 干净 | ✅ 已完成 |
| G0.5 可装 | 打包成 bundle 并能被宿主加载 | `dsh plugin add <tarball>` 后启动打印 `[genbox] plugin loaded` | ✅ 已完成 |
| G1 可分发 | GitHub 仓库 + npm 包 + `dsh-plugin` topic | 仓库公开可访问、`npm view dsh-genbox-plugin version` 返回 0.1.0、仓库 Topics 里有 `dsh-plugin` | ⏳ **等账号授权** |
| G1.5 可发现 | Discussions 发帖 + 教程博客 | 帖子链接与博客链接 | ⏳ 草稿已写好，等账号授权 |
| G2 可协作 | issue 模板、贡献指南、CI 绿、用户自检工具 | CI 在 PR 上跑通 typecheck+build；`genbox_doctor` 在健康/故障两种环境下给出正确结论；issue 模板要求贴 `verify-all` 与 doctor 输出 | 🟡 只等仓库建立 |
| G3 真跑 | 真实 provider 端到端 | 用真实 Key 生成一张图、一段视频并落盘 | ⏳ 需要你在 GenBox 配 Key |
| G4a 非阻塞 | 生图/生视频支持 `background: true` 立即返回 + `genbox_task` 查询/下载/取消 | `scripts/verify-background.mjs`：生图 85ms 返回、随后 settled + 文件落盘；视频同样通过 | ✅ 已完成 |
| G4b 体验 | UI 卡片（`presentCall`/`presentResult`）、改用 DSH 原生 `ctx.jobs` 后台任务 | 卡片在 Web 端渲染；任务返回原生 jobId | ⬜ 未开始 |
| G5a 视频编辑 | `genbox_video_edit`：trim / concat / speed / mute / resize / extract_frame（本地 ffmpeg，补 GenBox 的改视频缺口） | `scripts/verify-video-edit.mjs`：六个操作全部 FILE-OK（trim 1.53s、concat 5.04s、speed 1.67s、resize 160x120、帧 PNG） | ✅ 已完成 |
| G5b 视频编辑 II | crop / volume / replace_audio / burn_subtitles / to_gif 已补齐（本机 ffmpeg 带 libass） | `scripts/verify-video-edit.mjs`：11/11 FILE-OK | ✅ 已完成 |
| G5c 批注改图 | 纯 JS 生成批注叠加图（箭头/方框/椭圆/画笔 + 编号），拼 GenBox 的 `genbox-annotation-v3` 三件套 | `scripts/verify-annotate.mjs`（ffprobe 独立验证 320x240 RGBA）、`scripts/verify-precision.mjs`（信封通过 GenBox 输入校验，停在 provider 授权门槛） | ✅ 已完成 |
| G5d 扩展 | 抠图 checkpoint 流程、音轨混合（amix） | 各自的端到端脚本 | ⬜ 未开始 |
| G6 复用 | 若出现第二个媒体后端，再抽 `dsh-media` Service Definition / Provider / Consumer 三层 | 第二个 provider 无需改工具层 | ⬜ 观察中 |

## 依赖你（或需要账号）的动作

| 动作 | 需要什么 | 我能做到哪一步 |
|---|---|---|
| 建 GitHub 仓库 | 你的账号登录（`gh auth login`）或给我一个有 `repo` 权限的 token | 仓库内容与 CI 已就绪，只差 push |
| 发布 npm | `npm login`（或 `NPM_TOKEN`） | `pnpm pack` 与 `prepublishOnly` 已就绪，包名 `dsh-genbox-plugin` 未被占用 |
| 加 `dsh-plugin` topic | 同上 | 命令已写在 README |
| Discussions 发帖 | 同上 | 帖子草稿见 docs/community/discussions-post.md |
| 真实 provider 联调 | 在 GenBox 界面配好 Key | 插件侧零改动 |
| 装进 desktop profile | 你同意重启 DSH NEXT | 命令与回滚方式已写在 docs/install.md |

## 节奏

- 每轮只推进一个阶段，并在同一轮内补齐验证脚本。
- 文档滚动更新（本文件 + PLAN.md 的"进展与实测记录"），不写"计划完成"当作"已完成"。
- 社区反馈优先于功能扩张：先回答 Discussions / Issues，再把高频诉求排进 G4/G5。
