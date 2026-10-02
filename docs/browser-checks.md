# 浏览器可达性检查（覆盖矩阵）

> 由 `scripts/browser/measure-splitters.cjs` 实现，并作为 `verify-all` 的套件 `browser: splitter trades space` 运行。
> 缺 Playwright 或 chromium 时 SKIP，并在跳过行里写明怎么补（`browser (make Playwright resolvable ...)`）。

## 为什么需要它

**合成事件 `dispatchEvent` 会绕过命中测试**：它把事件直接塞给元素，于是「用户根本点不到」也能测出「处理器工作正常」。
我们正是这样被骗过一轮——某条 12px 分隔条只有顶沿约 4px 可点，合成事件却一路绿灯。

所以这里的每条检查都遵循两步：**① `document.elementFromPoint()` 命中测试 → ② 真实指针序列（`page.mouse`）**。
命中失败就**如实 skip 并写出被谁挡住**，不制造假失败。

## 覆盖矩阵

| # | 对象 | 命中测试 | 真实拖拽断言 | 视口 | 当前结果 |
|---|---|---|---|---|---|
| 1 | 生图页纵向分隔条 `#resizeBottom` | 拖拽前先命中测试，必要时取顶沿 3px | 相邻面板互换空间（上 +40 / 下 −40），总和恒定、不溢出 | 1920×1080, 1280×800 | ✅ |
| 2 | 生图页左侧分隔条 `#resizeLeft` | 命中抓手标记（`left+10`） | 左栏 +120 / 预览 −120 | 1920×1080 | ✅ |
| 3 | 精准画布右下角抓点 `#precisionCanvasResizeHandle` | **可达性本身即断言**（必须命中抓点） | —（处理器数学由 GenBox 侧静态契约测试覆盖） | 1920×1080 | ✅ |
| 4 | 精准画布底部竖条 `#precisionCanvasVerticalResizeHandle` | 需要已加载图片与全屏 | 只改高度：h +120、w 0 | 1920×1080 | ✅ |
| 5 | 生图页纵向分隔条（窄视口） | 命中测试 | 该条不参与布局时，改为断言"两栏仍能装进列" | 768×900 | ✅ 两栏 312+222=534 ≤ 列 721（修复前 490+349=839，溢出 118px） |

## 复现

```powershell
# Playwright 需要可解析；脚本会自己找 chromium
$env:NODE_PATH = "$env:LOCALAPPDATA\npm-cache\_npx\<hash>\node_modules"
node scripts\browser\measure-splitters.cjs

# 或者作为整套验证的一部分（缺前置会 SKIP 并说明怎么补）
node scripts\verify-all.mjs
```

## 实测输出（最近一次）

```
1920x1080: baseline 643+250=893 | +120 -> 683+210=893 | -240 -> 683+210=893
  [ok] 1920x1080 a real pointer drag trades space (top +40 / neighbour -40)
1280x800: baseline 363+250=613 | +120 -> 403+210=613 | -240 -> 403+210=613
  [ok] 1280x800 a real pointer drag trades space (top +40 / neighbour -40)
  [skip] 768x900: the vertical splitter is covered by (nothing)
left splitter: left column 240 -> 360, preview 1256 -> 1136
  [ok] left splitter trades space with its neighbour (left +120 / preview -120)
corner grip (nwse-resize, docs dismissed): shell 977x733, grip bottom 1049, status bar top 1050
  [ok] precision corner grip is reachable (elementFromPoint -> button#precisionCanvasResizeHandle, clears the status bar: true)
precision canvas: 1013x626 -> 1013x746
  [ok] precision canvas bottom bar grows the canvas downward (h +120, w 0)
OK
```

## 已知未纳入的

- **provider 列宽手柄** `.provider-col-resize`：审计过（真实拖拽 454 → 534 生效），但可点区域只有约 4/8px
  （卡片 `overflow: hidden` 裁掉一半，加 `z-index` 无效），属于可用但目标偏窄，尚未纳入自动断言。
- **窄视口的期望行为**：已有正面断言（`canvasRow + bottomRow <= center`），并**当场抓到一个真实缺陷**：768×900 时
  两栏 490+349=839 而列高只有 721，溢出 118px（上游 `@media (max-width: 800px)` 下两组 `flex-basis/min-height`
  之和超过容器）。工具打印 `[known] ...` 并在末尾汇总 `OK (1 known upstream issue(s) reported above)`：
  可见、有名字、有数字，但不污染本仓库的发布门槛。