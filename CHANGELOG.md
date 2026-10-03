# Changelog

## 0.1.5

- **生成的图直接出现在对话里**：生图 / 改图 / 超分 / 变体产出的图片会被提交为 DSH 附件，
  工具结果里跟着一个 `type: 'image'` 内容块，所以**不需要再手动 `read_image`** 就能在会话里看到图。
  新增配置 `previewInChat`（默认 true）与 `previewLimit`（默认 4，超出部分仍写盘并回路径）。
  设计上是**尽力而为**：没有挂载附件服务、文件读不出来、或图超过部署上限，都只损失预览，绝不影响已经付费的生成结果。
- 新增套件 `scripts/verify-preview.mjs`（3 项断言：有服务→出图块、无服务→照常出文件、关闭开关→不提交）。

## 0.1.4

- **新工具 `genbox_server`**：在对话里直接**启动 / 停止 / 重启 / 查看**本机 GenBox 服务（action=status|start|stop|restart）。
  启动时自动找安装目录（home 参数 → 插件配置 → GENBOX_HOME → 上次启动记录的路径 → 工作区/家目录常见位置），
  用 checkout 里的 venv 跑 main.py（dev 模式，无需 admin key），并**等到服务真的应答**才返回。
  **停止只杀命令行确实是 GenBox main.py 的进程**——端口上若是别的程序，会拒绝并打印它的命令行，而不是误杀（除非显式 force=true）。
- **端口自动回退（修掉新用户第一次必踩的坑）**：GenBox 本体默认端口是 **8891**（main.py / start.ps1），
  而插件此前默认连 **8892** —— 按 GenBox 自己的文档启动后，插件第一次调用必然 ECONNREFUSED。
  现在客户端按 baseUrl → baseUrlFallbacks（默认 8891）依次探测并记住命中的那个；请求中途连不上会**重新探测一次**，
  服务换端口重启也能自动跟上；全部不通时的报错会**列出试过的每个地址**并指向 genbox_server。
- 新增套件 `scripts/verify-server.mjs`（13 项断言，自带起停、真实进程验证；结束时把服务留在配置端口上）。

## 0.1.3

- **README 图文并茂 + 商店截图**：中英 README 顶部加了工作台总览图、三张**真实产物**（文生图 / 局部重绘 / 变体）
  与精准改图工作台截图；新增 `screenshots.json`（1–8 张，社区目录用它生成 App Store 风格的商品页），
  并把 `assets/` 加进 npm `files`，让 npm 页面的 README 也能渲染出图。
  全部图片来自本会话的真实产出与真实截图，未做后期；单张 ≤ 500 KB，整包约 818 KB。

## 0.1.2 — 2026-10-02

- 新增 `scripts/verify-journey.mjs`（13 项断言）：把一次真实用户旅程串起来跑——自检 → 生图 → 图生图 →
  精准改图（批注）→ 后台生视频 → `genbox_task` 收取 → 本地 ffmpeg 剪辑 → 图库；并断言五个产物路径互不覆盖、
  全部仍在盘上。**套件 19 → 20。**
- **修掉测试台的硬伤**：mock provider 原来返回的是**不可解码的假 MP4**（只有 ftyp/free，没有 moov），
  所以「下载到的视频」从未被真正解码验证过——之前的断言只查了「文件非空」。现在 mock 在启动时用 ffmpeg 生成
  真实的 2 秒片段（ffmpeg 不可用时回退到占位数据并写明原因）。这条是旅程测试抓出来的。
- 修正 `genbox_video_edit` 的工具描述：原来只列了 11 种操作里的 6 种（对照自动生成的 `docs/tools.md` 发现）。
- **修掉一个被合成事件掩盖的真实可用性问题**：生图页那条 12px 纵向分隔条原本挂在会滚动的
  `.generate-preview` 上（`bottom: -6px`），中心与 `top: 5px` 的抓手标记都被 `overflow: auto` 裁掉，
  **真实指针只有顶沿约 4px 能点到**（`elementFromPoint(中心)` 返回 `div#previewPanel`）。已移到面板内（`bottom: 0`）。
  浏览器实测工具改为**真实鼠标序列**（`page.mouse`，此前用合成 `dispatchEvent`，绕过了命中测试），并新增**可达性前置检查**
  与 **768×900 窄视口**：1920×1080 与 1280×800 下真实拖拽都生效（643+250=893 → 683+210=893；363+250=613 → 403+210=613），
  窄视口下该条不参与布局则如实 skip。
- **新发现并如实记录一个未修问题**（踩坑清单第 9 条，中英）：精准改图画布右下角的 44×44 抓点，在
  大画布 + 较矮视口时会落到 App 底部状态栏**下面**——`document.elementFromPoint()` 返回 `div.status-bar`
  而不是抓点。实测 `z-index: 30` 也无解（祖先 `#panelPrecisionEdit` 自带 backdrop-filter，
  本身就是层叠上下文）。浏览器实测工具现在会先做命中测试，报 `the corner grip is covered by div.status-bar`
  并 **skip 而不是假失败**；真正的修法（画布上限扣除状态栏高度 / 工作台不再溢出）已在文档写明。
- **浏览器实测工具进仓**：`scripts/browser/measure-splitters.cjs`（自己发现 chromium，测两种视口），并作为
  `verify-all` 的套件 `browser: splitter trades space`（缺 Playwright 时 SKIP，不拖累 CI）。
  实测：1920×1080 下 643+250=893 → 683+210=893 → 443+450=893；1280×800 下 363+250=613 → 403+210=613 → 220+393=613，
  **总和恒定、相邻面板互换空间**。踩坑清单里原先指向 `.lab/`（被 gitignore，读者拿不到）的路径已修正。
- **新增可复现的验证证据文件**：`docs/verification.md` 由 `node scripts/write-verification.mjs` 跑完
  `verify-all` 后生成，内嵌**该次运行的原始输出**（21 套件全过 + 1 项 opt-in 跳过），并附真实 provider 实测表与
  前端浏览器实测表——任何“已完成”都能顺着这张表复现。同时刷新 `ROADMAP.md` 里过期的状态与
  `依赖你` 清单（只剩 npm 0.1.2 的 OTP、desktop 重启、GenBox 上游 push 三项）。
- **新增「GenBox 集成踩坑清单」**：`docs/genbox-pitfalls.md` / `genbox-pitfalls.en.md`，把本轮实测出的 8 个坑
  （inpaint 声明式门禁、`upscale_to` 的 `int()` 静默降级、变体的遗留协议、429 的每分钟限流、precision_edit 两道门槛、
  以及两个前端拖拽缺陷）连同**根因与源码位置**一并写下来，并总结出两条通用经验。
- **`genbox_image_edit` 也支持 `upscaleTo`**（复用同一归一化）：i2i/inpaint 可生成后放大；
  precision_edit 则给出我们自己的明确拒绝（`precision_upscale_not_allowed`），并提示改用 `genbox_image_upscale`。
- 套件 `verify-image-extras.mjs` 增至 **10 项断言**（新增 i2i 放大与 precision_edit 拒绝）。
- **超分（生成后放大）现在真的生效**：GenBox 用 `int(upscale_to)` 解析目标尺寸，传 `"1024x1024"`
  会抛 `invalid literal for int()` 并**静默保留原图**（实测）。`genbox_image_generate` 现在有
  `upscaleTo` / `upscaleMethod` / `upscaleRatio`，并把 `WxH` 归一化成 GenBox 唯一接受的**长边整数**；
  实测 `upscaleTo: "1024x1024"` 产出 1024×1024 文件（`*_upscaled_1024x1024_orig.png`），此前是 512×512 原样返回。
- **变体不再依赖网关实现遗留协议**：`genbox_image_variations` 新增 `strategy`（`auto`/`native`/`prompt`）。
  native 走 GenBox 代理的 OpenAI 遗留 `/images/variations`，实测你的网关回 `400 Model name not specified`
  （gpt-image 本身也没有 variants API）；`prompt` 用同一底图走 `mode=i2i` + `quantities` 生成 N 个候选，
  任何能改图的 provider 都可用；`auto` 默认先试 native、失败自动降级。
- 新增套件 `verify-image-extras.mjs`（8 项断言：放大归一化 + 两种变体策略 + auto 优先级）。
- **局部重绘（inpaint）现在真的能跑通，并把怎么修写进报错里**：实测把 provider 的 `endpoint_type
  从 `auto` 改成 `openai` 后，用真实 `gpt-image`（`gpt-image-2-vip`）跑通了一次带掩膜的局部重绘：
  62.6s、1024×1024、1,168,239 B，白框内的纸灯笼被换成热气球，湖面与远山保持不变。
  当 provider 声明了 `inpaint_mask` 但传输方式不是 `openai` 时，报错现在会点名是哪个 provider、
  并直接给出要改的字段（`endpoint_type=openai`），不再是死路一条。
- **429 的说明更准确**：错误里现在写明 GenBox 的生成限流（上游默认 **10 次/分钟/IP**，仅 `/api/generate` 受限），
  并说明这是短促重试之后的最终结果——调用方据此决定是等一会儿还是改成批量提交。
- 用户旅程增至 **18 项断言**：新增 `count=2` 的多候选生成（两张不同的图都真落盘）。
- `docs/genbox-api-contract.md` 记下两条实测结论：429 的限流规则；以及 `upscale_to` 放大失败会**静默保留原图**——
  因此插件**故意不暴露**该参数（宁可让 `genbox_image_upscale` 显式报错，也不给模型一个会悄悄缩水的参数）。
- **GenBox 忙时不再直接失败**：真实跑出来的服务端行为——另一张生成还在进行时，GenBox 会对新的提交回
  `HTTP 429`。提交类调用（生图 / 生视频 / 超分 / 变体 / 抠图）现在会**等待并重试**（默认 3 次、每次 3 秒，
  可通过 `busyRetryDelayMs` 调整）；仍然失败时说明忙了多久、试了几次。提交被拒不会产生重复生成。
- `verify-media.mjs` 从「只打印」升级为 7 项断言（图库分页、downloadTo 真的落盘、复制不越界、提示词助手）；
  顺带修掉它在 Windows 上用 `process.exit()` 退出时的崩溃（改用 `process.exitCode`）。
- 排错文档修正两条不准确的说法：inpaint 需要 `inpaint_mask` **且** `endpoint_type=openai`；
  `precision_edit` 并非必须真实 Key（自带 mock provider 就能跑通）。
- `verify-http-robustness.mjs` 增至 17 项断言（新增忙碌重试与预算校验）。
- **inpaint 的提示考虑传输方式**：用真实 provider 试出来的规则——GenBox 要求 inpaint 的 provider 同时满足
  `capabilities.inpaint_mask=true` **和** `endpoint_type=openai`（本例 `gpt-image` 是 `auto`，
  即使声明了 mask 也会被拒）。现在拒绝信息只列**真正可用**的 provider，不再误导。
- `genbox_providers` 输出新增 `endpointType`，模型在动手前就能看出传输方式不匹配。
- `verify-edit-modes.mjs` 增至 9 项断言（含wrong transport的拒绝与可用清单校验）。
- `verify-all.mjs` 在套件失败时额外打印该套件的 stderr，失败原因不用再猜。
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