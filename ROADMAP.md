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
| G1 可分发 | GitHub 仓库 + npm 包 + `dsh-plugin` topic | 仓库公开可访问、`npm view dsh-genbox-plugin version` 返回 0.1.0、仓库 Topics 里有 `dsh-plugin` | ✅ 已完成：仓库 [liwei9745/dsh-genbox-plugin](https://github.com/liwei9745/dsh-genbox-plugin) 公开、Topics 含 `dsh-plugin`、npm 最新 **0.1.1**（0.1.2 已构建待发布） |
| G1.5 可发现 | Discussions 发帖 + 教程博客 | 帖子链接与博客链接 | ✅ 已完成：[#8669 公告帖](https://github.com/deepseek-ai/deepseek-harness/discussions/8669)（含 4 条作者更新）+ [#8672 教程](https://github.com/deepseek-ai/deepseek-harness/discussions/8672) |
| G2 可协作 | issue 模板、贡献指南、CI 绿、用户自检工具 | CI 在 PR 上跑通 typecheck+build；`genbox_doctor` 在健康/故障两种环境下给出正确结论；issue 模板要求贴 `verify-all` 与 doctor 输出 | ✅ 已完成：CI 在每次 push 上跑 typecheck + build；`CONTRIBUTING.md`、`.github/ISSUE_TEMPLATE/bug_report.yml`、`genbox_doctor` 两态验证 |
| G3 真跑 | 真实 provider 端到端 | 用真实 Key 生成一张图、一段视频并落盘 | ✅ 已完成（2026-10-02）：真实 `gpt-image` 上 t2i 92.5s、i2i、**inpaint 62.6s**、**variations 120.4s**，产物均落盘并有断言 |
| G4a 非阻塞 | 生图/生视频支持 `background: true` 立即返回 + `genbox_task` 查询/下载/取消 | `scripts/verify-background.mjs`：生图 85ms 返回、随后 settled + 文件落盘；视频同样通过 | ✅ 已完成 |
| G4b 体验 | UI 卡片（`presentCall`/`presentResult`/`presentationMeta`）、DSH 原生 `ctx.jobs` 后台任务 | `scripts/verify-presentation.mjs` 12 项断言全过（结果卡片从持久化 meta 重建）；`nativeJobs` 桩验证通过 | ✅ 已完成（渲染需客户端支持） |
| G5a 视频编辑 | `genbox_video_edit`：trim / concat / speed / mute / resize / extract_frame（本地 ffmpeg，补 GenBox 的改视频缺口） | `scripts/verify-video-edit.mjs`：六个操作全部 FILE-OK（trim 1.53s、concat 5.04s、speed 1.67s、resize 160x120、帧 PNG） | ✅ 已完成 |
| G5b 视频编辑 II | crop / volume / replace_audio / burn_subtitles / to_gif 已补齐（本机 ffmpeg 带 libass） | `scripts/verify-video-edit.mjs`：11/11 FILE-OK | ✅ 已完成 |
| G5c 批注改图 | 纯 JS 生成批注叠加图（箭头/方框/椭圆/画笔 + 编号），拼 GenBox 的 `genbox-annotation-v3` 三件套 | `scripts/verify-annotate.mjs`（ffprobe 独立验证 320x240 RGBA）、`scripts/verify-precision.mjs`（信封通过 GenBox 输入校验，停在 provider 授权门槛） | ✅ 已完成 |
| G5d 扩展 | 抠图 checkpoint 流程、音轨混合（amix） | 各自的端到端脚本 | ⬜ 未开始 |
| G6 复用 | 若出现第二个媒体后端，再抽 `dsh-media` Service Definition / Provider / Consumer 三层 | 第二个 provider 无需改工具层 | ⬜ 观察中 |

## 依赖你（或需要账号）的动作

| 动作 | 需要什么 | 现状（2026-10-02） |
|---|---|---|
| ~~建 GitHub 仓库~~ | — | ✅ 已公开，Topics 含 `dsh-plugin` |
| ~~加 `dsh-plugin` topic~~ | — | ✅ 已完成 |
| ~~Discussions 发帖~~ | — | ✅ #8669 / #8672 |
| ~~真实 provider 联调~~ | — | ✅ 四项能力均已实测 |
| **发布 npm 0.1.2** | **你的一次性密码（OTP）** | 包已构建好（34.9 kB / 7 文件 / shasum `382e1325`），`npm publish` 只差 OTP。两种方式见下 |
| 装进 desktop profile（新版） | 你重启 DSH NEXT | 命令与回滚见 docs/install.md |
| 把 GenBox 三个前端修复推上游 | 你同意 | 本地提交 `247f8f8` / `b4feb2d` / `36d9b8a` 已就绪 |

### 发布 0.1.2 的两种方式（都不需要把密钥贴进聊天）

```powershell
# 方式 A：你直接跑，按提示输入认证器上的 6 位数字
cd E:\AI\GenBox-dsh
npm publish --access public --otp=<你的 6 位数字>

# 方式 B：用仓库自带脚本（在终端里安全地输入，不落盘、不进历史）
powershell -File scripts\publish-with-token.ps1 -Execute -NpmOnly
```

如果你在 npm 上建一个 **Granular Access Token**（读写该包、勾选 bypass 2FA），也可以交给我发布——
但请只把它填进上面脚本的交互提示，不要贴进对话里。

## 上游修复台账（GenBox 检出，待 push）

> 这些修复**不在插件仓库内**，而是针对 GenBox 本体（`upstream/GenBox` 检出）。每条都先实测复现、再修、再用真实指针或浏览器断言验收；
> 明细与根因见 [docs/genbox-pitfalls.md](./docs/genbox-pitfalls.md)，自动化断言见 [docs/browser-checks.md](./docs/browser-checks.md)。

| # | 问题 | 状态 | 验收证据 | 提交 |
|---|---|---|---|---|
| 1 | 精准画布右下角抓点**纵向拖动被忽略**（只读 `dx`） | ✅ 已修 | A/B：向下 400→440、向上 400→360；`test_precision_canvas_resize_axis.mjs` | `247f8f8` |
| 2 | `test_precision_protocol_ui.mjs` 沙箱缺依赖（基线就红） | ✅ 已修 | 沙箱补齐后原断言一字不改通过 | `b4feb2d` |
| 3 | 生成页纵向分隔条**完全无反应**（flex 到孙节点） | ✅ 已修 | 拖拽前后 delta 全 0 → 643+250=893 → 683+210=893 | `36d9b8a` |
| 4 | 分隔条只拉伸一侧（下拉留白、上拉裁切） | ✅ 已修 | 总和恒定：893 → 893 → 893 | `dfad9e2` |
| 5 | 分隔条地板值低于样式表（180/200 vs 220/210） | ✅ 已修 | 1280×800 上拉到底停在 220 | `ddebb6c` |
| 6 | 画布钻到状态栏下，抓点**指针不可达** | ✅ 已修 | 上限 760→733；命中 `button#precisionCanvasResizeHandle` | `a6664b5` |
| 7 | 分隔条被 `overflow: auto` 裁到**仅约 4px 可点** | ✅ 已修 | 真实指针拖拽生效（合成事件曾被骗过） | `865ec38` |
| 8 | 窄视口两栏**溢出 118px** | ✅ 已修 | 839 → 534 ≤ 列 721 | `ca319e7` |
| 9 | provider 列宽手柄可点区域仅约 4/8px | 📝 记录不改 | 逐像素扫描 714..717 命中；加 `z-index` 无效 | `aed0145`（记录） |

**两条方法论结论**（写进踩坑清单，避免重复踩）：

1. **合成 `dispatchEvent` 会绕过命中测试**——点不到会伪装成能用。因此浏览器断言一律先 `elementFromPoint()` 命中测试，再发真实指针序列。
2. **`z-index` 不是万能药**：祖先带 `backdrop-filter` 时会自成层叠上下文，子元素提到 `z-index: 30` 也无效（第 6 条）。

**耗时评估**：浏览器套件约 44s（`browser: splitter trades space`），与用户旅程套件（46s）相当，未超出整体量级，
因此**不做快速/完整拆分**——拆分会增加维护面而不解决实际瓶颈。

## 节奏

- 每轮只推进一个阶段，并在同一轮内补齐验证脚本。
- 文档滚动更新（本文件 + PLAN.md 的"进展与实测记录"），不写"计划完成"当作"已完成"。
- 社区反馈优先于功能扩张：先回答 Discussions / Issues，再把高频诉求排进 G4/G5。
