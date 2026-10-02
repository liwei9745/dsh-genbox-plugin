// The one check that spends real money: generate and edit with a live provider.
//
//   GENBOX_REAL_PROVIDER=gpt-image GENBOX_REAL_SIZE=1024x1024 node scripts/verify-real-provider.mjs
//
// It is deliberately opt-in and never runs in CI: with the variable unset it skips.
// Everything else in the repository proves the plumbing against the zero-key mock.
import { readFileSync } from 'node:fs'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { apply, readImageSize } from '../lib/index.js'

const provider = process.env.GENBOX_REAL_PROVIDER
if (provider === undefined || provider.trim() === '') {
  console.log('SKIP set GENBOX_REAL_PROVIDER=<provider id> to spend a real generation (e.g. gpt-image)')
  process.exit(0)
}
const size = process.env.GENBOX_REAL_SIZE ?? '1024x1024'
const outDir = resolve(process.env.VERIFY_OUT_DIR ?? '.genbox-out', 'real-provider')

const registered = []
apply(
  { tools: { register: (tool) => registered.push(tool) } },
  {
    baseUrl: process.env.GENBOX_BASE_URL ?? 'http://127.0.0.1:8892',
    adminKey: '',
    defaultProviderId: '',
    outputDir: outDir,
    pollIntervalMs: 2000,
    taskTimeoutMs: 300000,
    ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
    videoEncoder: '',
    nativeJobs: false,
  },
)
const tool = (name) => registered.find((entry) => entry.name === name)
const exec = { signal: AbortSignal.timeout(300000) }

function magic(file) {
  const head = readFileSync(file).subarray(0, 8)
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (head[0] === 0xff && head[1] === 0xd8) return 'jpeg'
  if (head.subarray(0, 3).toString('ascii') === 'GIF') return 'gif'
  if (head.subarray(0, 4).toString('ascii') === 'RIFF') return 'webp'
  return 'unknown'
}

const checks = []
const check = (label, ok) => checks.push([label, ok])

const started = Date.now()
const generated = await tool('genbox_image_generate').execute(
  { prompt: 'a red paper lantern floating over a misty lake at dusk, photographic', providers: [provider], size },
  exec,
)
const first = generated.images?.[0]?.file
const firstOk = typeof first === 'string' && existsSync(first) && statSync(first).size > 0
check('real text-to-image produced a file', generated.status === 'completed' && firstOk)
check('the response names the real provider', generated.images?.[0]?.providerId === provider)
if (firstOk) {
  const format = magic(first)
  const dimensions = await readImageSize(first)
  check('the artifact is a real image container', format !== 'unknown')
  check('the image parses with our own reader', dimensions.width > 0 && dimensions.height > 0)
  console.log('generated: ' + first + ' (' + statSync(first).size + 'B, ' + format + ' ' + dimensions.width + 'x' + dimensions.height + ', ' + ((Date.now() - started) / 1000).toFixed(1) + 's)')
}

// A real edit costs a second generation; keep it to one image-to-image pass.
const edited = await tool('genbox_image_edit').execute(
  { prompt: 'repaint it as a snowy morning', image: first, mode: 'i2i', providers: [provider] },
  exec,
)
const second = edited.images?.[0]?.file
const secondOk = typeof second === 'string' && existsSync(second) && statSync(second).size > 0
check('real image-to-image produced a second file', edited.status === 'completed' && secondOk)
check('the edit did not overwrite the original', second !== first)
if (secondOk) {
  console.log('edited:    ' + second + ' (' + statSync(second).size + 'B, ' + magic(second) + ')')
}

let failures = 0
for (const [label, ok] of checks) {
  if (!ok) failures += 1
  console.log((ok ? '  [ok]   ' : '  [FAIL] ') + label)
}
console.log(failures === 0 ? 'OK (' + checks.length + ' checks, provider ' + provider + ')' : 'FAILURES: ' + failures)
process.exit(failures === 0 ? 0 : 1)
