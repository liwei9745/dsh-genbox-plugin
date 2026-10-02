# 验证证据（可复现）

> 本文件随 `node scripts/verify-all.mjs` 的原始输出生成：复现命令相同，零成本 mock provider，不花真实 Key。

## 门槛与前置

| 前置 | 含义 | 缺失时 |
|---|---|---|
| `genbox` | GenBox 在 `127.0.0.1:8892` 以 dev 模式运行 | 相关套件 SKIP |
| `mock` | 启用了零成本 mock provider | 生成类套件 SKIP（**绝不回退到付费 provider**） |
| `ffmpeg` | 本机 ffmpeg / ffprobe | 视频编辑套件 SKIP |
| `market` | 本机 DSH 市场的兼容性模块 | 市场就绪套件 SKIP |
| `installed` | 已装到某个 profile | 已安装包比对套件 SKIP |
| `realprovider` | 显式设置 `GENBOX_REAL_PROVIDER` | 真实 Key 套件 SKIP（默认永不在 CI 跑） |

## 最近一次运行（原始输出）

```
prerequisites: genbox=up ffmpeg=ok mock-provider=ok market=ok installed=ok real-provider=off (set GENBOX_REAL_PROVIDER)
.....................

  PASS presentation contract                         OK (12 checks) (206ms)
  PASS tool reference matches code                   OK (14 tools documented) (201ms)
  PASS error messages                                OK (6 checks) (189ms)
  PASS http robustness                               OK (17 checks) (519ms)
  PASS plugin market readiness                       OK (4 checks) (304ms)
  PASS installed package matches                     OK (4 checks) (229ms)
  PASS plugin load smoke test                        render -> [{"type":"text","text":"{\n  \"gpt-image\": {\n    \"configured\": true,\n    \" (213ms)
  PASS onboarding (workbench + doctor)               OK (11 checks) (352ms)
  PASS annotation overlay                            OK (267ms)
  PASS local video editing                           OK (11/11) (3408ms)
  PASS doctor self-check                             OK (426ms)
  PASS image + video tools                           OK (17275ms)
  PASS edit modes (inpaint + precision)              OK (9 checks) (3138ms)
  PASS cutout failure surfacing                      cutout surfaced failure: GenBox POST /api/image-tools/cutout failed (HTTP 503): 尚未安装本地抠图模型 (227ms)
  PASS background jobs                               OK (15447ms)
  PASS gallery + prompt                              OK (7 checks) (502ms)
  PASS upscale + variation strategies                OK (10 checks) (39926ms)
  PASS gallery filters                               OK (7 checks, fixture zebracrossingmur51m9z) (21604ms)
  PASS native job registry                           OK (10 checks) (16223ms)
  PASS precision annotations                         OK (18043ms)
  PASS user journey (generate → edit → video → cut)  OK (18 checks) (45166ms)
  SKIP real provider (spends a key)                  needs realprovider

all runnable suites passed
```

## 真实 provider 实测（会花钱，需显式开启）

命令：`GENBOX_REAL_PROVIDER=gpt-image node scripts/verify-real-provider.mjs`（provider：`gpt-image` / `gpt-image-2-vip`）。

| 能力 | 结果 | 产物 |
|---|---|---|
| 文生图 | 92.5 s | 1,046,509 B · PNG 1024x1024 |
| 图生图 | 完成 | 1,087,316 B · 未覆盖原图 |
| 局部重绘（掩膜） | 62.6 s | 1,168,239 B · 白框内灯笼 → 热气球，其余保持不变 |
| 变体（auto 降级） | 120.4 s | 1,087,316 B · native 被网关拒绝后自动走 i2i |

## 前端修复的浏览器实测

用 npx 缓存里的 Playwright + 本机已装 chromium 打开真实 GenBox 页面测量：

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 生成页纵向分隔条（`#resizeBottom`，+120px 下拉） | 所有几何量 delta = 0（完全没反应） | `#creatorCanvasRow` 643 → 683px（钳制后不溢出）；-120px 时 643 → 523px |
| 精准画布右下角抓点（纵向拖动） | 被忽略（只读 `dx`） | 按主导轴生效：向下 400 → 440、向上 400 → 360 |

## GenBox 上游测试

`node tests/test_*.mjs`（在 `upstream/GenBox` 检出内）：16/16 通过，其中
`test_precision_canvas_resize_axis.mjs` 与 `test_generate_resize_splitter.mjs` 是新增回归测试。
