# Changelog

## Unreleased

- **修复**：`nativeJobs` 打开时，如果宿主组合里没有 job 控制器（注册表会以
  "no job controller serves this agent" 拒绝），`genbox_video_generate({background:true})` 原本会整个失败；
  现在回退到普通的 GenBox 任务句柄，任务不会丢。
- `scripts/verify-native-jobs.mjs` 升级为**三层验证**（桩 + 真实 `dsh-jobs-local` 注册表的拒绝路径与
  带控制器路径），10 项断言全过；真实 job 会结算为 `completed` 并把视频落盘。
- `genbox_doctor` 的「连不上」提示补上 GenBox 上游地址，并去掉重复的 URL 前缀。
- 新增 `docs/releasing.md`：把两轮真实发布的操作顺序、期望输出与踩过的坑固化下来。

## 0.1.1 — 2026-10-02

首装引导与更友好的失败信息。

新增：

- `genbox_open_workbench`：报告/打开 GenBox 工作台，装完插件后的第一步；GenBox 没在跑时明确说明。
- `genbox_doctor` 现在返回 `nextSteps` 清单（打开工作台 → 说一句具体需求 → 用 `genbox_gallery` 收结果）。
- `genbox_video_edit`：11 种本地 ffmpeg 剪辑（裁剪 / 拼接 / 变速 / 静音 / 缩放 / 裁切 / 音量 / 换音轨 / 烧字幕 / 转 GIF / 抽帧）。
- `genbox_image_edit` 的 `annotations` 精准改图（箭头 / 方框 / 椭圆 / 画笔，插件自己合成蒙版）。
- `genbox_task` 后台任务收取；`genbox_gallery` 支持 `type` / `model` / `query` / `since` 过滤。

改进：

- 连不上 GenBox 时的报错改成可执行的一句话，并指向 `genbox_open_workbench` / `genbox_doctor`；取消（abort）仍原样抛出。
- 媒体工具实现 `presentCall` / `presentResult` / `presentationMeta`（结果卡片从持久化 meta 重建）。
- 实验性 `nativeJobs` 配置：后台视频任务交给 DSH 的 `ctx.jobs`（默认关闭）。

工程：

- 验证套件 11 个，`node scripts/verify-all.mjs` 一条命令跑完；CI（GitHub Actions）全绿。
- `scripts/rebuild.ps1`：绕开本机偶发的"构建目录被系统收走权限"问题。
## 0.1.0

首个版本。把本地 [GenBox](https://github.com/liwei9745/GenBox) 媒体工作台接入 DeepSeek Harness。

工具：

- `genbox_health` / `genbox_providers`：连通性与能力发现
- `genbox_image_generate`：文生图，多 provider 并排、多张、尺寸/质量、提示词增强
- `genbox_image_edit`：`i2i` / `inpaint`（白=编辑）/ `precision_edit`（resize 画布）
- `genbox_image_upscale` / `genbox_image_variations` / `genbox_cutout`
- `genbox_video_generate`：文生视频 / 图生视频 / 首尾关键帧
- `genbox_gallery` / `genbox_prompt_optimize`

说明：

- 只通过 HTTP 调用 GenBox 的公开 API，不修改也不链接 GenBox（GPL-3.0）。
- 生成的媒体落到配置的 `outputDir`，把绝对路径返回给模型，可用 `read_image` 查看。