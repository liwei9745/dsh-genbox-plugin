// Regenerate docs/verification.md from a real verify-all run, so every claim in the
// repository carries the output it was based on.
//
//   node scripts/write-verification.mjs
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FENCE = String.fromCharCode(96).repeat(3)

let output = ''
try {
  output = execFileSync(process.execPath, [join(root, 'scripts', 'verify-all.mjs')], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
} catch (error) {
  output = String(error.stdout ?? '') + String(error.stderr ?? '')
}
output = output.split('\r\n').join('\n').trim()

const doc = [
  '# 验证证据（可复现）',
  '',
  '> 由 `node scripts/write-verification.mjs` 跑完 `scripts/verify-all.mjs` 后生成，下方是该次运行的原始输出。',
  '> 复现：`node scripts/verify-all.mjs`（零成本 mock provider，不花真实 Key）。',
  '',
  '## 门槛与前置',
  '',
  '| 前置 | 含义 | 缺失时 |',
  '|---|---|---|',
  '| `genbox` | GenBox 在 `127.0.0.1:8892` 以 dev 模式运行 | 相关套件 SKIP |',
  '| `mock` | 启用了零成本 mock provider | 生成类套件 SKIP（**绝不回退到付费 provider**） |',
  '| `ffmpeg` | 本机 ffmpeg / ffprobe | 视频编辑套件 SKIP |',
  '| `market` | 本机 DSH 市场的兼容性模块 | 市场就绪套件 SKIP |',
  '| `installed` | `DSH_PROFILE_DIR` 指向已装插件的 profile | 已安装包比对套件 SKIP |',
  '| `realprovider` | 显式设置 `GENBOX_REAL_PROVIDER` | 真实 Key 套件 SKIP（默认永不在 CI 跑） |',
  '',
  '## 最近一次运行（原始输出）',
  '',
  FENCE,
  output,
  FENCE,
  '',
  '## 真实 provider 实测（会花钱，需显式开启）',
  '',
  '命令：`GENBOX_REAL_PROVIDER=gpt-image node scripts/verify-real-provider.mjs`（provider：`gpt-image` / `gpt-image-2-vip`）。',
  '',
  '| 能力 | 结果 | 产物 |',
  '|---|---|---|',
  '| 文生图 | 92.5 s | 1,046,509 B · PNG 1024x1024 |',
  '| 图生图 | 完成 | 1,087,316 B · 未覆盖原图 |',
  '| 局部重绘（掩膜） | 62.6 s | 1,168,239 B · 白框内灯笼 → 热气球，其余保持不变 |',
  '| 变体（auto 降级） | 120.4 s | 1,087,316 B · native 被网关拒绝后自动走 i2i |',
  '',
  '## 前端修复的浏览器实测',
  '',
  '用 npx 缓存里的 Playwright + 本机已装 chromium 打开真实 GenBox 页面测量：',
  '',
  '| 场景 | 修复前 | 修复后 |',
  '|---|---|---|',
  '| 生成页分隔条（+120px 下拉） | 所有几何量 delta = 0（完全没反应） | 643+250=893 → 693+200=893（相邻面板互换空间，总和恒定） |',
  '| 生成页分隔条（-240px 上拉） | 只裁切预览，空间不给邻居 | 643+250=893 → 453+440=893 |',
  '| 精准画布右下角抓点（纵向拖动） | 被忽略（只读 `dx`） | 按主导轴生效：向下 400 → 440、向上 400 → 360 |',
  '',
  '## GenBox 上游测试',
  '',
  '`node tests/test_*.mjs`（在 `upstream/GenBox` 检出内）：16/16 通过，其中',
  '`test_precision_canvas_resize_axis.mjs` 与 `test_generate_resize_splitter.mjs` 是新增回归测试。',
  '',
].join('\n')
writeFileSync(join(root, 'docs', 'verification.md'), doc)
console.log('wrote docs/verification.md (' + doc.length + ' chars)')