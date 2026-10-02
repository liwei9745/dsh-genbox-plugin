# 精准改图（precision_edit）的三道门

GenBox 的 `precision_edit` 是本插件里**唯一需要用户显式授权**的模式。这份文档说明它到底要求什么，以及怎么把授权打开——包括用本地 mock provider 做完整演练。

## 三道门，按顺序校验

| 门 | 要求 | 不满足时的报错 |
|---|---|---|
| 1. provider | provider 已启用、有 API Key、`endpoint_type` 是 `openai` 或原生 Gemini | `precision_edit_provider_unsupported` |
| 2. **模型能力授权** | `extra.model_capabilities[model].precision_edit = true`，且**由用户显式确认**（`confirmed: true`）生成 | 同上 |
| 3. 尺寸策略 | `strict` 下模型返回的像素必须等于目标尺寸；`preserve` 时目标就是底图尺寸 | `precision_edit_output_size_mismatch` |

第 1、3 门是配置与行为问题；**第 2 门是 GenBox 刻意设置的授权门槛**——它不接受"目录里碰巧有个像样的模型名"，必须由人确认。

## 怎么开第 2 门

在 GenBox 界面里找到该 provider 的模型能力确认入口，或者直接在 API 上确认：

```powershell
$body = @{ model = '<model-id>'; enabled = $true; confirmed = $true } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://127.0.0.1:8892/api/providers/<provider-id>/precision-capability' -Method POST -Body $body -ContentType 'application/json'
```

注意：

- `confirmed: true` 必须有，缺了报 `precision_confirmation_required`。
- `model` 必须属于该 provider，否则 `precision_model_invalid`。
- 想放宽尺寸用 `size`（确切的 `WIDTHxHEIGHT`）或 `flexible_sizes`；只改这两个而不 `enabled` 会被拒。
- 走"别名/协议覆盖"路径的模型由 `POST /api/providers/{id}/precision-protocol` 管理，两者不要混用。

## 第 3 门：尺寸策略

- `preserve`：不动画布，结果必须**等于底图尺寸**。
- `resize`：请求 `precision_target_size`；`precision_output_size_policy=strict` 时结果必须精确等于该尺寸，用 `fit_crop` 才允许本地裁切适配。

所以"模型返回的几何尺寸不对"不是授权问题，而是**这个端点不支持你要的尺寸**——换成模型声明过的尺寸，或显式选 `fit_crop`。

## 插件侧做了什么

`genbox_image_edit(mode="precision_edit")` 有两条路：

1. **不带批注**：必须给 `precisionTargetSize`，走 `resize`；适合扩画布/改画幅。
2. **带批注**：给 `annotations`（箭头 / 方框 / 椭圆 / 画笔，坐标用**像素**），插件会：
   - 读底图真实尺寸（纯 JS 解析 PNG/JPEG/GIF 头，不依赖外部工具）；
   - 用纯 JS PNG 编码器画一张**与底图同尺寸**的叠加图（含编号角标）；
   - 组装 GenBox 要的三件套：`annotation_image_data` + `annotation_contract=genbox-annotation-v3` + `annotations`（0~1 归一化）；
   - 按 v3 契约校验（≤100 条、brush 2~1024 点、文本总量 ≤4000、箭头端点不可重合、矩形/椭圆必须正尺寸）。

`precision_edit` 还必须给 `model`——GenBox 这个模式要求 per-provider 的模型设置。

## 本地怎么验证（不需要真 Key）

```powershell
python scripts/mock-openai-image.py     # 假图床：/images/edits 返回与输入同尺寸的 PNG
node scripts/verify-precision.mjs       # 脚本先确认 mock 模型的能力，再走完整链路
```

期望输出：

```
  [ok]   capability confirmed for mock-image-1 -> enabled
  [ok]   local-path guard
  [ok]   model guard
  [ok]   annotated precision_edit completed -> ...png (885B)
OK
```

这也是 [scripts/verify-all.mjs](../scripts/verify-all.mjs) 里的一个套件。