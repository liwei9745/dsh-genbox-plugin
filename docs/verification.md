# 验证证据（可复现）

> 由 `node scripts/write-verification.mjs` 跑完 `scripts/verify-all.mjs` 后生成，下方是该次运行的原始输出。
> 复现：`node scripts/verify-all.mjs`（零成本 mock provider，不花真实 Key）。

## 门槛与前置

| 前置 | 含义 | 缺失时 |
|---|---|---|
| `genbox` | GenBox 在 `127.0.0.1:8892` 以 dev 模式运行 | 相关套件 SKIP |
| `mock` | 启用了零成本 mock provider | 生成类套件 SKIP（**绝不回退到付费 provider**） |
| `ffmpeg` | 本机 ffmpeg / ffprobe | 视频编辑套件 SKIP |
| `market` | 本机 DSH 市场的兼容性模块 | 市场就绪套件 SKIP |
| `installed` | `DSH_PROFILE_DIR` 指向已装插件的 profile | 已安装包比对套件 SKIP |
| `realprovider` | 显式设置 `GENBOX_REAL_PROVIDER` | 真实 Key 套件 SKIP（默认永不在 CI 跑） |

## 最近一次运行（原始输出）

```
prerequisites: genbox=up ffmpeg=ok mock-provider=ok browser=ok market=ok installed=ok real-provider=off (set GENBOX_REAL_PROVIDER)
.......................

  PASS presentation contract                         OK (12 checks) (173ms)
  PASS tool reference matches code                   OK (15 tools documented) (172ms)
  PASS error messages                                OK (6 checks) (185ms)
  PASS http robustness                               OK (17 checks) (488ms)
  PASS plugin market readiness                       OK (4 checks) (312ms)
  PASS installed package matches                     OK (4 checks) (213ms)
  PASS plugin load smoke test                        render -> [{"type":"text","text":"{\n  \"gpt-image\": {\n    \"configured\": true,\n    \" (249ms)
  PASS onboarding (workbench + doctor)               OK (11 checks) (322ms)
  PASS annotation overlay                            OK (204ms)
  PASS local video editing                           OK (11/11) (3240ms)
  PASS doctor self-check                             OK (413ms)
  PASS image + video tools                           OK (22267ms)
  PASS edit modes (inpaint + precision)              OK (9 checks) (3749ms)
  PASS cutout failure surfacing                      cutout surfaced failure: GenBox POST /api/image-tools/cutout failed (HTTP 503): 尚未安装本地抠图模型 (263ms)
  PASS background jobs                               OK (18340ms)
  PASS gallery + prompt                              OK (7 checks) (510ms)
  PASS upscale + variation strategies                OK (10 checks) (19660ms)
  PASS gallery filters                               OK (7 checks, fixture zebracrossingmusnitxk) (52670ms)
  PASS native job registry                           OK (10 checks) (16158ms)
  PASS precision annotations                         OK (30712ms)
  PASS user journey (generate → edit → video → cut)  OK (18 checks) (57133ms)
  PASS browser: splitter trades space                OK (43303ms)
  PASS server control + port fallback                OK (13 checks) (28122ms)
  SKIP real provider (spends a key)                  realprovider (set GENBOX_REAL_PROVIDER=<provider id>; this suite spends a real key)

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
| 生成页分隔条 1920x1080（+120px / -240px） | 所有几何量 delta = 0（完全没反应） | 643+250=893 → 683+210=893 → 443+450=893 |
| 生成页分隔条 1280x800（+120px / -240px） | 同上 | 363+250=613 → 403+210=613 → 220+393=613 |
| 精准画布右下角抓点（纵向拖动） | 被忽略（只读 `dx`） | 按主导轴生效：向下 400 → 440、向上 400 → 360 |
| 精准画布底部竖条（纵向拖动） | — | 1013x626 → 1013x746（h +120、w 0，只改高度） |
| 精准画布右下角抓点可达性 | 命中 `div.status-bar`（画布钻到状态栏下面） | 命中 `button#precisionCanvasResizeHandle`；画布上限 760 → 733，抓点下沿 1049 vs 状态栏顶 1050 |
| 生成页纵向分隔条可达性 | 中心/抓手标记落在 `overflow: auto` 裁剪死区，仅顶沿约 4px 可点 | 移到面板内（`bottom: 0`），真实指针拖拽生效 |
| 生成页左侧分隔条 | — | 真实指针：左栏 240 → 360、预览 1256 → 1136（健康） |

上面两条由 `scripts/browser/measure-splitters.cjs` 复现（自己找 chromium；Playwright 需可解析），
它同时是 `verify-all` 里名为 `browser: splitter trades space` 的套件。

## GenBox 上游测试

`node tests/test_*.mjs`（在 `upstream/GenBox` 检出内）：16/16 通过，其中
`test_precision_canvas_resize_axis.mjs` 与 `test_generate_resize_splitter.mjs` 是新增回归测试。
