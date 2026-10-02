# 待发帖：DeepSeek Harness Discussions

> 帖子正文草稿。发帖需要你自己的 GitHub 账号登录（我这边没有凭据）。
> 建议发在 Discussions 的 "Show and tell" / "Ideas" 分类，如果分类不存在就发在最贴近的一类。

---

## 标题

**[dsh-plugin] GenBox 接入：让 agent 直接生图、改图、生视频**

## 正文

把本地开源的 [GenBox](https://github.com/liwei9745/GenBox)（FastAPI 媒体生成工作台，支持 GPT-Image / Gemini /
Qwen / 火山等多家 provider）做成了一个 DSH 插件 `dsh-genbox-plugin`，装进任意 profile 之后，agent 就多了 10 个工具：

- `genbox_image_generate`（文生图，可多 provider 并排对比）、`genbox_image_edit`（图生图 / 局部重绘 / 精准改图）
- `genbox_image_upscale`、`genbox_image_variations`、`genbox_cutout`
- `genbox_video_generate`（文生视频 / 图生视频 / 首尾关键帧）
- `genbox_gallery`、`genbox_prompt_optimize`、`genbox_providers`、`genbox_health`

设计上刻意做成**纯 HTTP 客户端**：GenBox 自己已经有完整的 REST API，所以插件不碰它的源码，GenBox 可以独立升级。
生成的图片/视频会落到配置目录并把路径返回给模型，模型可以直接用 `read_image` 看结果。

为什么可能对别人有用：

1. 想给 DSH 接图像/视频生成，但不想被某一家 provider 绑死——GenBox 那层负责多 provider 与轮换。
2. 想找一个可抄的"最小可验证插件"范例：仓库里带一个**不用任何 API Key** 的端到端测试台
   （一个 OpenAI/火山双协议 mock provider），`node scripts/verify-tools.mjs` 就能把
   "插件 → GenBox → provider → 图库 → 插件下载"整条链路跑完。

仓库（MIT，已打 `dsh-plugin` topic）：https://github.com/liwei9745/dsh-genbox-plugin

欢迎拍砖，尤其是：工具的参数设计、输出值的结构（是否适合程序化调用）、以及 DSH 侧有没有更地道的做法。

## 附：英文摘要（可选，若分类以英文讨论为主）

`dsh-genbox-plugin` brings a local [GenBox](https://github.com/liwei9745/GenBox) server into DeepSeek Harness as 10
tools (text-to-image, image editing/inpaint/precision edit, upscale, variations, cutout, text/image/keyframe-to-video,
media library, prompt optimization). It is a pure HTTP client - GenBox keeps its own REST surface and can be upgraded
independently. The repo ships a zero-API-key end-to-end test harness (a mock OpenAI/Volcengine provider) so you can
verify the whole chain locally with one command.
