# 与 GenBox 集成的踩坑清单

> 下面每一条都是**实测**得到，附根因（GenBox 源码位置）与可复现命令。
> 不管你是用这个插件、还是自己接 GenBox，都能省下一轮排查。
> 前置：GenBox 以开发模式跑在 `127.0.0.1:8892`（`APP_MODE=dev`，无需 `X-Admin-Key`）。

## 速查表

| # | 现象 | 根因 | 应对 |
|---|---|---|---|
| 1 | `inpaint_provider_unsupported` | GenBox 的**声明式**门禁要求 `endpoint_type == 'openai'`（`main.py:1504-1510`） | 把该 provider 的 `endpoint_type` 从 `auto` 改成 `openai` |
| 2 | `upscale_to` 传 `"1024x1024"` **静默保留原图** | `_do_local_upscale` 用 `int(target_size)`（`main.py:3572`），异常被 `except` 吞掉（`main.py:4633-4635`） | 只传**长边整数**；插件已把 `WxH` 归一化 |
| 3 | `image_variation_upstream_error` | native 变体代理 OpenAI **遗留** `/images/variations` 多部分协议（`main.py:4875-4920`） | 用 `mode=i2i` + `quantities` 生成候选（插件 `strategy=prompt/auto`） |
| 4 | HTTP 429 `请求过于频繁` | 只有 `/api/generate` 限流，默认 **10 次/分钟/IP** | 退避重试；批量提交用 `background: true` |
| 5 | `precision_upscale_not_allowed` | precision_edit 不接受生成后放大（`main.py:1350-1355`） | 生成后单独调 `/api/images/upscale` |
| 6 | 精准改图被拒 | 需要 `capabilities.precision_edit` **且**模型级声明（`main.py:1521, 2737`） | 看 `model_capabilities` / `precision_size_catalog` |
| 7 | 前端：画布右下角抓点纵向拖动无效 | 手柄是 44×44 的 `nwse` 角抓点，处理器却只读 `dx` | 按主导轴取 delta（本仓库 GenBox 检出已修 `a714b1e`） |
| 8 | 前端：生成页纵向分隔条**完全没反应** | `startResize(e,'bottom')` 去 flex 孙节点 `.generate-preview` | 改为尺寸 `#creatorCanvasRow` + 显式 `height`（已修 `36d9b8a`） |

---

## 1. 局部重绘：门禁是"声明式"的，不是能力检测

GenBox 不看 `auto` 运行时解析出什么协议，只看字段字面值：

```python
# main.py:1504-1510
endpoint_type = str(getattr(provider, "endpoint_type", "auto") or "auto").strip().lower()
if endpoint_type != "openai":
    unsupported.append({"id": provider_id, "reason": "explicit_openai_required"})
```

所以一个**本来就是 OpenAI 兼容**、但字段写着 `auto` 的 provider 会被拒——生成状态里的
`request_contract.protocol` 明明显示 `openai`。修法（一个字段，行为中性）：

```powershell
# GUI：GenBox → 设置 → 该 provider → endpoint_type 改成 openai
# 命令行：改 storage/providers.json 后热加载
curl -X POST http://127.0.0.1:8892/api/providers/reload
```

实测（`gpt-image` / `gpt-image-2-vip`，1024×1024 底图 + 白框掩膜）：`completed`、62.6s、1,168,239 B。

## 2. `upscale_to`：传 "WxH" 会静默失败

```
upscale_to=1024x1024 → ⚠ 放大失败(保留原图): invalid literal for int() with base 10: '1024x1024'
upscale_to=1024      → ✔ 放大完成
```

**它不报错、照样返回 `completed`**，只是产物还是原尺寸——这类"静默降级"比抛错危险得多。
插件在 `genbox_image_generate` / `genbox_image_edit` 里把 `WxH` 归一化成 `max(W,H)` 再发。

## 3. 变体：网关多半没有遗留协议

```json
{"detail":{"code":"image_variation_upstream_error",
           "upstream_error":"端点 1 [HTTP 400]: {"error":{"message":"Model name not specified..."}}"}}
```

OpenAI 的 `/images/variations` 是 DALL·E-2 时代的东西，`gpt-image` 系列没有这个 API，很多中转网关也不实现。
替代方案：同一底图走 `/api/generate` 的 `mode=i2i` + `quantities`（1–10）生成 N 个候选。

## 4. 429 是"每分钟"级别的

`/api/generate` 默认 10 次/分钟/IP。连跑几次生成就会撞上——**重试间隔必须递增**，
固定等 3 秒往往等不到窗口滑过去。插件用 5s/10s/20s 退避，仍然失败时把这条规则写进错误里。

## 5-6. 精准改图的两道门槛

`precision_edit` 需要 provider 的 `capabilities.precision_edit` 与模型级声明同时成立；
且**不接受** `upscale_to`（"precision_edit does not accept generic post-generation upscaling"）。
想放大就生成完再调 `/api/images/upscale`（本地 Lanczos，实测 1024→2048 仅 0.8s，不花 Key）。

## 7-8. 两个前端拖拽缺陷（本仓库 GenBox 检出已修）

- 精准改图画布的**右下角抓点**是 `44x44` + `cursor: nwse-resize`（承诺角拖拽），
  但 `continuePrecisionCanvasResize` 只读 `dx`，纵向拖动被整个丢弃。
  修法：`Math.abs(dx) >= Math.abs(dy) ? dx : dy`。
- 生成页的**纵向分隔条**（实时预览 / 任务监视器之间）`startResize(e,'bottom')` 去 flex
  `.generate-preview`——那是 flex 容器的**孙节点**，真正该动的是 `#creatorCanvasRow`。
  实测修复前拖拽前后**所有几何量 delta 全为 0**。

---

## 复现这些结论的最小手段

不需要真实 Key：仓库自带零成本 mock provider，`node scripts/verify-all.mjs` 会跑完 21 个套件。
真实 provider 联调（会花钱）单独走 `GENBOX_REAL_PROVIDER=gpt-image node scripts/verify-real-provider.mjs`。

前端两条可以用无头 Chromium 直接量：

```powershell
# scripts/browser/measure-splitters.cjs 会自己找 chromium；Playwright 需要可解析
# （没装就把它指向 npx 缓存里的副本）
$env:NODE_PATH = "$env:LOCALAPPDATA\npm-cache\_npx\<hash>\node_modules"
node scripts\browser\measure-splitters.cjs
```

实测输出（两种视口都验证"相邻面板互换空间"）：

```
1920x1080: baseline 643+250=893 | +120 -> 683+210=893 | -240 -> 443+450=893
1280x800 : baseline 363+250=613 | +120 -> 403+210=613 | -240 -> 220+393=613
OK
```

最后一行就是第 7 条的自动化对照：精准改图工作台底部的竖条**只改高度、不改宽度**（h +120、w 0）。
它需要一张本地图片，可用 `PROBE_IMAGE=<png 路径>` 指定，否则自动取 `.genbox-out` 下最新的 png。

## 9. 精准改图画布右下角抓点被状态栏吞掉（**已修**）

**现象**：大画布 + 较矮视口时，画布右下角那个 44×44 的 `nwse` 抓点落在 App 底部状态栏**下面**——
`document.elementFromPoint()` 返回 `div.status-bar`，pointer 事件永远到不了抓点。

**根因**：画布高度上限是**按视口估算**的（`viewportHeight - 120`，见 `precisionCanvasResizeLimits`），
没有扣除状态栏，也没有参考画布自己的顶边；而精准改图模式下工作台允许溢出，于是它就真的钻了下去。

**`z-index` 不能修**（这条也实测过）：抓点的祖先 `#panelPrecisionEdit` 带 `backdrop-filter`，
它自己就是层叠上下文，在根上下文里按 DOM 顺序排在状态栏之前；把抓点提到 `z-index: 30` 也无效。

**修法**：新增 `precisionCanvasAvailableHeight(shell)`——量画布顶边到状态栏顶边的真实距离，
用它作为 `maxHeight`（仍钳在 240–760）。实测 1920×1080：

```
画布 760 → 733（高度上限改为实测可用空间）
抓点下沿 1049  vs  状态栏顶 1050
document.elementFromPoint(抓点中心) -> button#precisionCanvasResizeHandle
```

`scripts/browser/measure-splitters.cjs` 现在就断言这件事（`precision corner grip is reachable`），
而不是像之前那样报 `covered by div.status-bar` 后跳过。
