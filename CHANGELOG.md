# Changelog

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
