# Changelog

## 0.1.2 — 2026-10-02

- 新增 `scripts/verify-journey.mjs`（13 项断言）：把一次真实用户旅程串起来跑——自检 → 生图 → 图生图 →
  精准改图（批注）→ 后台生视频 → `genbox_task` 收取 → 本地 ffmpeg 剪辑 → 图库；并断言五个产物路径互不覆盖、
  全部仍在盘上。**套件 19 → 20。**
- **修掉测试台的硬伤**：mock provider 原来返回的是**不可解码的假 MP4**（只有 ftyp/free，没有 moov），
  所以「下载到的视频」从未被真正解码验证过——之前的断言只查了「文件非空」。现在 mock 在启动时用 ffmpeg 生成
  真实的 2 秒片段（ffmpeg 不可用时回退到占位数据并写明原因）。这条是旅程测试抓出来的。
- 修正 `genbox_video_edit` 的工具描述：原来只列了 11 种操作里的 6 种（对照自动生成的 `docs/tools.md` 发现）。
- **能力拒绝给出可用清单**：GenBox 拒绝 `precision_edit`/`inpaint`（provider 没声明对应能力）时，
  工具会把失败原因**和当前已启用、确实支持该能力的 provider id 一起说出来**，而不是只丢一个 422；
  `genbox_image_edit` 的描述也补上了这个前提。
- `verify-edit-modes.mjs` 从「只打印不判定」升级为 6 项断言的真实套件（自造素材与白色蒙版、
  inpaint 真跑、缺 model 的拒绝、能力不足时的拒绝并点名可用 provider）。
- 新增 `scripts/verify-real-provider.mjs`：**唯一一条花真钱**的验证（默认 SKIP，需要显式给 `GENBOX_REAL_PROVIDER`），
  做一次真文生图 + 一次真图生图并校验产物是真实图片容器。已用本机配置的 `gpt-image/gpt-image-2-vip` 实跑通过。
- 用户旅程套件升级到 17 项断言：新增**取消路径**（提交后台任务 → 取消 → 6 秒后仍是 cancelled 且不产文件），
  并且**按能力挑 provider 且优先用 mock**——本机启用真实 provider 后它不会偷偷花你的钱。
- 新增 [docs/tools.md](./docs/tools.md)：**由已注册的工具定义自动生成**的参数速查；`node scripts/tool-reference.mjs`
  在文件与代码不一致时失败（已纳入套件），所以文档不会漂移。
- **套件补齐到 19 个**：把三个一直没接进 `verify-all` 的脚本（`verify-plugin` 最小加载、
  `verify-edit-modes` inpaint/精准改图、`verify-cutout` 失败透出）正式纳入，不再默默腐烂。
- 新增 [docs/architecture.md](./docs/architecture.md)：模块职责、一次调用的生命周期、bundle 补丁机制、
  加新工具的步骤与验证阶梯。
- **更抗抖的轮询**：视频任务动辄几分钟，轮询期间掉一次（5xx / 429 / 408 / 网络抖动）不再让整个工具调用失败——
  连续失败超过预算（默认 5 次）才放弃；**永久性拒绝（4xx）仍然立即失败**，取消语义不变。
- **报错引用人话**：GenBox 的失败体有 `{"detail": "..."}`、`{"detail": {"error": code, "message": text}}`
  等多种形状，现在引用其中的那句话（必要时附上错误码），不再把原始 JSON 整块丢给模型；下载失败也会带出原因。
- 新增 `scripts/verify-http-robustness.mjs`（12 项断言，用本地敌意服务器驱动）：错误措辞、丢包重试、
  永久拒绝不重试、取消语义、下载失败不落文件。
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