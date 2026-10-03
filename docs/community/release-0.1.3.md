# dsh-genbox-plugin 0.1.3 — 图文发布说明

> 这份文档同时是社区公告（DSH Discussions #8669）的仓库版本。
> 公告帖：https://github.com/deepseek-ai/deepseek-harness/discussions/8669#discussioncomment-18733221

![GenBox 工作台：左侧选模型、中间实时预览、右侧创作工具](../assets/screenshots/01-genbox-generate.png)

**一句话**：把**你自己机器上**的 [GenBox](https://github.com/liwei9745/GenBox)（本地 FastAPI 多 provider 媒体工作台）交给 agent ——
生图、改图、局部重绘、超分、变体、生视频、本地 ffmpeg 剪辑，产物全部落到本地文件后把路径交回模型。

## 真实产物（不是示意图，未做后期）

| 文生图 | 局部重绘（**只有白框内**变化） | 变体（同底图重画） |
|---|---|---|
| ![文生图](../assets/screenshots/03-result-t2i.jpg) | ![局部重绘](../assets/screenshots/04-result-inpaint.jpg) | ![变体](../assets/screenshots/05-result-variation.jpg) |

精准改图：左侧画布手绘批注，右侧实时预览（批注会被转成打码叠加图交给 GenBox）：

![精准改图工作台](../assets/screenshots/02-genbox-precision.png)

## 这一版做了什么

- **README 图文并茂**：中英双语，顶部工作台总览 + 三张真实产物对比 + 精准改图截图；
  截图随包装进 npm（整包 818 KB / 12 文件），所以 **npm 页面也能显示图**。
- **`screenshots.json`**：让本插件在插件市场拥有 App Store 风格的详情页截图（目录每日构建直接读仓库，无需再提 PR）。
- **429 不再直接失败**：GenBox 默认对 `/api/generate` 限流 10 次/分钟/IP，提交类调用按 5s/10s/20s 退避重试，仍失败则把规则写进错误消息。
- **错误消息说人话**：引上游 `detail`/`message`，不再丢一段 JSON。
- **局部重绘**：provider 声明了 `inpaint_mask` 却不是 `openai` 传输时，**直接点名是哪个 provider、该改哪个字段**。
- **超分**：`upscaleTo` 把 `WxH` 归一化成 GenBox 唯一接受的长边整数（此前传 `1024x1024` 会**静默保留原图**）。
- **变体**：`strategy=auto/native/prompt`，网关不支持遗留协议时自动降级为同底图 i2i 候选。
- **多参考图**：`genbox_image_edit` 支持 `referenceImages`（走 `image_data_list`）。

## 安装 / 更新

```sh
dsh plugin --profile web add dsh-genbox-plugin
```

> **desktop profile（桌面端）不能用 CLI**：会明确拒绝
> `profile "desktop" is managed exclusively by the Electron application`。
> 请在**插件市场里点「安装/更新」**，然后**重启 DSH NEXT**（桌面端只在启动时读 profile）。

## 配套：GenBox 本体 10 项前端修复

都是「拖不动 / 点不到」的实测修复：**https://github.com/liwei9745/GenBox/pull/16**（检查全绿，等合并）。
纵向分隔条现在真的能拖且相邻面板互换空间；抓点不再被状态栏吞；≤800px 不再溢出 118px；生成按钮常驻可见；并补上 Ctrl/Cmd+Enter 生图。

## 验证入口

| 想看什么 | 去哪 | 一键复跑 |
|---|---|---|
| 现在通不通 | [docs/verification.md](../docs/verification.md) | `node scripts/verify-all.mjs` |
| 前端能否点/拖 | [docs/browser-checks.md](../docs/browser-checks.md) | `node scripts/browser/measure-splitters.cjs` |
| 接 GenBox 的坑 | [docs/genbox-pitfalls.md](../docs/genbox-pitfalls.md) | — |

仓库：https://github.com/liwei9745/dsh-genbox-plugin · npm：https://www.npmjs.com/package/dsh-genbox-plugin