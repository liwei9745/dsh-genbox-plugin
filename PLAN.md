# GenBox × DeepSeek Harness 接入方案与进度

> 设计与进度记录。结论基于 `liwei9745/GenBox`（master, v2.6.x）源码与官方 DSH 插件文档。
> 调研对象已 clone 到 `upstream/GenBox`（只读参考，未修改）。

## 0. 结论（TL;DR）

1. **不需要改 GenBox。** 它是一个单进程 FastAPI 应用，暴露了完整的 HTTP API（117 条路由，覆盖生图、改图、
   视频、媒体库、抠图、超分、provider 管理）。
2. 正确形态是：**写一个 DSH「HTTP 客户端」插件**（TypeScript / Cordis），把 GenBox 的 REST 端点包装成模型
   可调用的工具，并负责轮询长任务、把结果落盘、把图片/视频回传给模型与 UI。
3. **生图 / 改图 / 生视频可直接覆盖**；GenBox 本身没有「改视频」功能，所以本插件用**本地 ffmpeg** 实现了
   11 种视频编辑操作。
4. 开发落地在 `E:\AI\GenBox-dsh`：仓库以**插件包为主**，`upstream/GenBox` 作为参考与联调对象。
5. 许可边界：GenBox 是 **GPL-3.0**，本插件是 **MIT**——只通过 HTTP 调用，不包含其源码。

## 1. 已交付

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | GenBox 本地跑起来 | ✅ Python 3.11 venv + dev 模式 `127.0.0.1:8892`，v2.6.12 |
| M1 | 插件骨架 + `genbox_health` | ✅ 构建、注册、调用通过；已作为 bundle 装进 profile 并启动 |
| M2 | `genbox_image_generate` 文生图 | ✅ 端到端实测（mock provider） |
| M3 | 改图 / 超分 / 变体 / 抠图 | ✅ i2i、inpaint、**精准改图（批注）**、超分、变体实测 |
| M4 | 视频生成 | ✅ 文生 / 图生 / 首尾关键帧，下载到本地 mp4 |
| M5 | 图库 / 提示词优化 / 自检 / provider | ✅ 含图库过滤 |
| M6 | 打包与分发 | ✅ `dsh-genbox-plugin@0.1.0` 已发布到 npm；GitHub 仓库带 `dsh-plugin` topic |
| M7 | 本地视频编辑 | ✅ `genbox_video_edit`：裁剪 / 拼接 / 变速 / 静音 / 缩放 / 裁切 / 音量 / 换音轨 / 烧字幕 / 转 GIF / 抽帧 |
| M8 | 首装引导 | ✅ `genbox_open_workbench` + `genbox_doctor` 的 next-steps 清单 |
| M9 | UI 渲染意图 / 原生后台任务 | ✅ `presentCall` / `presentResult` / `presentationMeta`；`nativeJobs`（默认关闭） |

## 2. 关键设计决定

- **纯 HTTP 客户端，不 vendor GenBox 源码**：两边可独立升级，也避开 GPL 传染。
- **工具粒度按能力划分**（14 个），参数尽量贴近 GenBox 的 REST 字段，减少「插件自己的抽象」带来的理解成本。
- **产出落盘并回传绝对路径**，模型可以直接 `read_image` 看结果，而不是只拿到 URL。
- **长任务两种收取方式**：默认 `background: true` + `genbox_task` 轮询；实验性 `nativeJobs` 接入 DSH 的 `ctx.jobs`
  （默认关闭，避免影响已验证行为）。
- **批注改图自己实现**：用纯 JS 写 PNG 编码器把箭头/方框/椭圆/画笔画成蒙版，不依赖任何图像库。
- **视频编辑走本地 ffmpeg**：不占用 GenBox 的 provider 配额，也不需要 API Key。

## 3. 验证方式（可复现）

- 仓库自带一个**不需要任何 API Key** 的端到端测试台：OpenAI + 火山双协议 mock provider。
- `node scripts/verify-all.mjs` 是唯一入口：11 个套件，缺前置条件会如实 SKIP，最后汇总 PASS/FAIL。
- 每个套件都留真实产物（PNG / MP4）与可复制的命令；CI 跑同一套。
- `node scripts/lab.mjs` 提供一个本地证据看板（工具清单从构建产物解析、素材墙、一键复验、发布状态）。

## 4. 未完成 / 已知限制

- **真实 provider 端到端联调**需要用户自己的 API Key；本机只有 mock provider。
- `nativeJobs` 只做过桩 registry 的单元验证，**未在真实模型会话里验证过**（因此默认关闭）。
- 桌面 profile 的安装需要重启 DSH NEXT；该 profile 由 Electron 应用独占管理，CLI 拒绝写入。
- `presentCall` / `presentResult` 的形状有断言守住，但**内置 Web Client 目前不消费这些渲染意图**。
- 本仓库早期的 PLAN.md 与 docs/local-dev.md 曾被 PowerShell 以非 UTF-8 编码写入而损坏，后续已重写为正确 UTF-8。

## 5. 下一阶段

1. 用真实 provider 跑一遍生图 / 改图 / 生视频，留下真实产物证据。
2. 在桌面 profile 里实机走一遍首装引导（工作台 → 自检 → 生图）。
3. 收社区反馈：工具参数设计、输出结构是否适合程序化调用。
