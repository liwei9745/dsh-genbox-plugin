# dsh-genbox-plugin

[![npm](https://img.shields.io/npm/v/dsh-genbox-plugin)](https://www.npmjs.com/package/dsh-genbox-plugin)
[![CI](https://github.com/liwei9745/dsh-genbox-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/liwei9745/dsh-genbox-plugin/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/dsh-genbox-plugin)](./LICENSE)

把 [GenBox](https://github.com/liwei9745/GenBox)（本地 FastAPI 媒体生成工作台）接入
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的插件 bundle，让 DSH 里的 agent
能直接生图、改图、生视频、改视频（再生成式）并取回媒体库素材。

**English: [README.en.md](./README.en.md)**

全部工具的参数速查见 [docs/tools.md](./docs/tools.md)（**由代码自动生成**，不会和实现漂移）；
与 GenBox 集成的**实测踩坑清单**（含根因与源码位置）见 [docs/genbox-pitfalls.md](./docs/genbox-pitfalls.md)；
前端**可达性检查覆盖矩阵**（为什么必须"先命中测试再发真实指针"）见 [docs/browser-checks.md](./docs/browser-checks.md)。
### 验证与证据（三条入口）

| 想看什么 | 去哪 | 一键复跑 |
|---|---|---|
| 现在到底通不通 | [docs/verification.md](./docs/verification.md)（内嵌一次真实运行的**原始输出**，22 个套件） | `node scripts/verify-all.mjs` |
| 前端交互是否真的能点/能拖 | [docs/browser-checks.md](./docs/browser-checks.md)（可达性覆盖矩阵，6 项断言） | `node scripts/browser/measure-splitters.cjs` |
| 接 GenBox 会踩哪些坑 | [docs/genbox-pitfalls.md](./docs/genbox-pitfalls.md)（10 条，含根因源码位置） | — |
| 我们改过 GenBox 本体什么 | [ROADMAP.md](./ROADMAP.md) 的「上游修复台账」 | — |

> 全部套件默认跑**零成本 mock provider**；真实 provider 联调是显式的 `GENBOX_REAL_PROVIDER=...`，绝不隐式花钱。
> 缺前置（GenBox / ffmpeg / Playwright / 已装 profile）时套件会 **SKIP 并写明怎么补**，不会假装通过。
调研结论与设计见 [PLAN.md](./PLAN.md)；**内部结构与如何加工具**见 [docs/architecture.md](./docs/architecture.md)；
安装、配置与排错见 [docs/install.md](./docs/install.md)；本机联调环境（含免 Key 的 mock provider）见
[docs/local-dev.md](./docs/local-dev.md)；发布流程见 [docs/releasing.md](./docs/releasing.md)。

## 30 秒上手

装完之后三步（也可以直接让 agent 替你做）：

1. **打开工作台**：对 agent 说「打开 GenBox 工作台」（它会调 `genbox_open_workbench`），
   或自己用浏览器打开 **http://127.0.0.1:8892/** —— provider、API Key、设置都在这个界面里。
2. **自检**：「跑一下 GenBox 自检」（`genbox_doctor`）—— 它会逐项告诉你还缺什么，并给出下一步清单。
3. **开始用**：直接说「用 GenBox 画一只在雪地里的柴犬」。

> GenBox 没在跑时，第 1 步会明确告诉你它没应答，并指向 [docs/local-dev.md](./docs/local-dev.md) 的启动命令。

## 形态

```
DSH agent → dsh-genbox-plugin (TypeScript) ──HTTP──▶ GenBox FastAPI (127.0.0.1:8892) ──▶ providers
```

不修改 GenBox 本体：它本身已有 117 条 REST 路由，本插件只是调用方，因此 GenBox 可以独立升级。
GenBox 是 GPL-3.0，本插件是 MIT——只通过 HTTP 调用，不含其源码。

## 证据看板（不需要模型凭据）

`sh
node scripts/lab.mjs        # http://127.0.0.1:3098/
`

打开后可以看到：GenBox 连接状态与 provider、插件注册的工具清单（从构建产物里解析，不会撒谎）、
GenBox 图库素材、本地产物缩略图，以及每条复现命令。

三个端口别搞混：

| 端口 | 是什么 |
|---|---|
| 3098 | **证据看板**（本插件自带，只读，无需凭据） |
| 3099 | DSH 会话页（agent 聊天；需要模型凭据） |
| 8892 | **GenBox 自己的工作台**（画图、看图库、配 provider） |

## 状态

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | GenBox 本地跑起来 | ✅ Python 3.11 venv + dev 模式 `127.0.0.1:8892`，v2.6.12 |
| M1 | 插件骨架 + `genbox_health` | ✅ 构建、注册、调用通过；已作为 bundle 装进 profile 并启动 |
| M2 | `genbox_image_generate` 文生图 | ✅ 端到端实测（mock provider） |
| M3 | 改图 / 超分 / 变体 / 抠图 | ✅ i2i、inpaint、超分、变体端到端实测；抠图缺 checkpoint 时报 `cutout_model_missing` |
| M4 | `genbox_video_generate` 视频 | ✅ 端到端实测（mock volcengine provider，下载到本地 mp4） |
| M5 | `genbox_gallery` / 提示词优化 | ✅ 图库列出并复制；无 LLM provider 时返回原文回退 |
| M6 | 打包与分发 | ✅ `pnpm pack` → `dsh plugin add <tarball>` → 启动打印 `[genbox] plugin loaded` |
| M7 | 发布到 npm | ✅ `dsh-genbox-plugin@0.1.0`，并已用**从 npm 安装的那份产物**实跑生图 |
| M8 | 插件市场就绪性 | ✅ 用**市场自己的模块**验证：`dsh.bundle.patch` 就位、host 兼容（0.2.0-rc.2 → compatible）、profile 预检 0 risks |
| M9 | **真实 provider 端到端** | ✅ 用本机 `gpt-image`（model `gpt-image-2-vip`）实跑：真文生图 844KB PNG 1024×1024（50s）+ 真 i2i 改图 1.25MB；6 项断言全过 |
| M10 | 验收旅程 | ✅ `verify-journey.mjs` 17 项断言：自检 → 生图 → 图生图 → 精准改图 → 后台生视频 → 收取 → **取消** → 本地剪辑 → 图库 |

## 安装

三种方式任选其一，都要求 GenBox 已在本机运行（默认 `http://127.0.0.1:8892`）。

### 1. 从 tarball（已实测）

```powershell
corepack pnpm pack                                  # 产出 dsh-genbox-plugin-0.1.0.tgz
dsh plugin --profile <profile> add ./dsh-genbox-plugin-0.1.0.tgz
```

因为 `package.json` 声明了 `dsh.bundle`，`dsh plugin` 会自动把 `dsh-genbox-plugin` 追加进
`dsh.profile.bundles`。启动时会打印：

```
[genbox] plugin loaded (baseUrl=http://127.0.0.1:8892)
```

### 2. 从本地源码（开发用）

```powershell
dsh --profile <profile> --patch E:/AI/GenBox-dsh/dev/overlay.cordis.yml
```

### 3. 从 npm 安装（**已发布**）

```powershell
# 0.1.0 已在 npm 上，装的是预构建产物，不需要任何构建授权
dsh plugin --profile <profile> add dsh-genbox-plugin

dsh --profile <profile> --dump-config | Select-String genbox   # 确认插件层已生效
```

> 装进 `desktop` profile 后需要重启 DSH NEXT 才生效。建议先用独立 profile
> （`dsh --profile genbox-dev --from-default-profile web`）验证。

## 工具

| 工具 | 作用 |
|---|---|
| `genbox_doctor` | **自检**：可达性、认证模式、provider/Key 就绪、输出目录可写、ffmpeg 是否可用，并给出修复建议 |
| `genbox_open_workbench` | 打印/打开 GenBox 工作台（首装后的第一步） |
| `genbox_health` | 探测 GenBox 是否在线 |
| `genbox_providers` | 列出 provider / 模型 / 能力（调用前先查能力） |
| `genbox_image_generate` | 文生图，可多 provider 并排、多张、指定尺寸质量 |
| `genbox_image_edit` | 改图：`i2i` / `inpaint`（白=编辑）/ `precision_edit`（画布 resize，或带批注：箭头/方框/椭圆/画笔） |
| `genbox_image_upscale` | 本地超分（不需要 API Key） |
| `genbox_image_variations` | 生成变体 |
| `genbox_cutout` | 抠图（需要 GenBox 侧安装 checkpoint） |
| `genbox_video_generate` | 文生视频 / 图生视频 / 首尾关键帧；改视频用 `i2vid` 或 `keyframes` 再生成 |
| `genbox_task` | 查询/取消后台任务。生图/生视频都支持 `background: true` 立即返回，再用它收取结果 |
| `genbox_video_edit` | 本地 ffmpeg 剪辑：trim / concat / speed / mute / resize / crop / volume / replace_audio / burn_subtitles / to_gif / extract_frame（不需要 GenBox、不需要 Key） |
| `genbox_gallery` | 媒体库检索并复制到本地；支持 `type/model/query/since` 过滤（无需分页，GenBox 只给最近 N 条） |
| `genbox_prompt_optimize` | 提示词优化 |

生成的图片/视频会落到 `outputDir`（默认 `.genbox`）下并把绝对路径返回给模型；模型可以直接用
DSH 内置的 `read_image` 看图。

## 呈现（UI 卡片）

媒体类工具都实现了 `presentCall` / `presentResult` 与 `output.presentationMeta`：
结果卡片从**持久化的 meta** 重建（回放安全），并把产出文件放进 `locations` 供编辑器跟随。

> 实话实说：**DSH 内置 Web Client 目前不消费这些渲染意图**，所以在当前界面里看不到差别（回退为通用卡片）；
> 支持该契约的客户端才会把它渲染成卡片。形状由 `scripts/verify-presentation.mjs` 的 12 项断言守住。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:8892` | GenBox 服务地址 |
| `adminKey` | 空 | prod 模式所需的 `X-Admin-Key`（dev 模式不需要） |
| `defaultProviderId` | 空 | 未显式指定时使用的 provider |
| `outputDir` | `.genbox` | 生成媒体落盘目录（相对路径按会话工作目录解析） |
| `pollIntervalMs` | 2000 | 轮询间隔；视频任务会提升到至少 5s |
| `taskTimeoutMs` | 900000 | 单任务超时 |
| `ffmpegPath` | `ffmpeg` | 本地视频编辑用的 ffmpeg |
| `ffprobePath` | `ffprobe` | 媒体探测用的 ffprobe |
| `videoEncoder` | 空（自动） | 强制视频编码器；空则按 libx264 → h264_mf → libopenh264 → mpeg4 自动选 |
| `nativeJobs` | false | 实验性：后台视频任务交给 DSH 的 `ctx.jobs`，见 [docs/native-jobs.md](./docs/native-jobs.md) |

## 开发

```sh
corepack enable        # 本机若没有全局 pnpm
pnpm install
pnpm run typecheck
pnpm run build         # tsdown -> lib/index.js
node scripts/verify-all.mjs     # 一条命令跑完所有验证（缺前置的会自动 SKIP）
node scripts/verify-tools.mjs   # 端到端（需 GenBox + mock provider 已启动）
```

## 发布清单

1. `pnpm build` 后 `pnpm pack`，确认 tarball 内含 `lib/`、`cordis.patch.yml`、`README.md`。
2. 发 npm：`pnpm publish`。用户 `dsh plugin add dsh-genbox-plugin` 装到的是预构建产物，不需要构建授权。
   **账号开了 2FA 时必须带一次性验证码**：`pnpm publish --otp=<code>`，或改用允许绕过 2FA 的 granular token。
   发完用 `node scripts/verify-published.mjs` 回读校验（版本号、engines.dsh、关键字、tarball 内容）。
3. GitHub 仓库 About → Topics 加 `dsh-plugin`（官方指定的社区发现方式；官方当前不接受外部 PR）。
4. 到 DSH 的 GitHub Discussions 发帖介绍。

## 许可

插件 MIT。GenBox 为 GPL-3.0：本插件只通过 HTTP 调用其公开 API，不链接、不拷贝其源码。
`upstream/GenBox` 仅作本地参考与联调，已被 gitignore。
长任务建议用 `background: true` 提交（实测生图 85ms 返回），再让模型用 `genbox_task` 取结果；视频尤其如此。