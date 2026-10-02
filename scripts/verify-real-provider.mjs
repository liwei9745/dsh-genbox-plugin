// The one check that spends real money: generate, edit and (when the provider
// declares the capability) inpaint with a live provider.
//
//   GENBOX_REAL_PROVIDER=gpt-image GENBOX_REAL_SIZE=1024x1024 node scripts/verify-real-provider.mjs
//   GENBOX_REAL_STEPS=generate,edit         # narrow it down; every step is capped by capability
//
// It is deliberately opt-in and never runs in CI: with the variable unset it skips.
// Everything else in the repository proves the plumbing against the zero-key mock.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { apply, readImageSize } from '../lib/index.js'

const provider = process.env.GENBOX_REAL_PROVIDER
if (provider === undefined || provider.trim() === '') {
  console.log('SKIP set GENBOX_REAL_PROVIDER=<provider id> to spend a real generation (e.g. gpt-image)')
  process.exit(0)
}
const size = process.env.GENBOX_REAL_SIZE ?? '1024x1024'
const wanted = new Set((process.env.GENBOX_REAL_STEPS ?? 'generate,edit,inpaint,variations').split(',').map((step) => step.trim()))
const outDir = resolve(process.env.VERIFY_OUT_DIR ?? '.genbox-out', 'real-provider')
const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg'

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
    ffmpegPath: ffmpeg,
    ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
    videoEncoder: '',
    nativeJobs: false,
  },
)
const tool = (name) => {
  const found = registered.find((entry) => entry.name === name)
  if (found === undefined) throw new Error('tool not registered: ' + name)
  return found
}
const exec = { signal: AbortSignal.timeout(300000) }
const checks = []
const check = (label, ok) => checks.push([label, ok])
const step = (message) => console.log('  - ' + message)
const present = (file) => typeof file === 'string' && existsSync(file) && statSync(file).size > 0

function magic(file) {
  const head = readFileSync(file).subarray(0, 8)
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (head[0] === 0xff && head[1] === 0xd8) return 'jpeg'
  if (head.subarray(0, 3).toString('ascii') === 'GIF') return 'gif'
  if (head.subarray(0, 4).toString('ascii') === 'RIFF') return 'webp'
  return 'unknown'
}

// What may this provider actually do? Never assume.
const providers = await tool('genbox_providers').execute({ enabledOnly: true }, exec)
const info = (providers.providers ?? []).find((entry) => entry.id === provider)
check('the configured provider is enabled and has a key', info?.enabled === true && info?.hasKey === true)
step('provider ' + provider + ' capabilities ' + JSON.stringify(info?.capabilities ?? {}))

let first
let second
let third

if (wanted.has('generate')) {
  const started = Date.now()
  const generated = await tool('genbox_image_generate').execute(
    { prompt: 'a red paper lantern floating over a misty lake at dusk, photographic', providers: [provider], size },
    exec,
  )
  first = generated.images?.[0]?.file
  check('real text-to-image produced a file', generated.status === 'completed' && present(first))
  check('the response names the real provider', generated.images?.[0]?.providerId === provider)
  if (present(first)) {
    const format = magic(first)
    const dimensions = await readImageSize(first)
    check('the artifact is a real image container', format !== 'unknown')
    check('the image parses with our own reader', dimensions.width > 0 && dimensions.height > 0)
    step('generated ' + first + ' (' + statSync(first).size + 'B, ' + format + ' ' + dimensions.width + 'x' + dimensions.height + ', ' + ((Date.now() - started) / 1000).toFixed(1) + 's)')
  }
}

if (wanted.has('edit')) {
  if (!present(first)) {
    step('edit skipped: no source image from the generate step')
  } else {
    const edited = await tool('genbox_image_edit').execute(
      { prompt: 'repaint it as a snowy morning', image: first, mode: 'i2i', providers: [provider] },
      exec,
    )
    second = edited.images?.[0]?.file
    check('real image-to-image produced a second file', edited.status === 'completed' && present(second))
    check('the edit did not overwrite the original', second !== first)
    if (present(second)) step('edited    ' + second + ' (' + statSync(second).size + 'B, ' + magic(second) + ')')
  }
}

if (wanted.has('inpaint')) {
  // GenBox needs BOTH the declared capability and the OpenAI transport; a provider
  // on endpoint_type=auto is refused even when it declares inpaint_mask.
  if (info?.capabilities?.inpaint_mask !== true) {
    step('inpaint skipped: ' + provider + ' does not declare inpaint_mask')
  } else if (info?.endpointType !== 'openai') {
    step('inpaint skipped: ' + provider + ' runs on endpoint_type=' + String(info?.endpointType || 'unknown')
      + ', and GenBox only inpaints through endpoint_type=openai')
  } else if (!present(first)) {
    step('inpaint skipped: no source image')
  } else {
    const source = await readImageSize(first)
    const mask = join(outDir, 'mask-white-' + source.width + 'x' + source.height + '.png')
    const made = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=white:size=' + source.width + 'x' + source.height, '-frames:v', '1', mask], { encoding: 'utf8' })
    check('a mask of the source size was built locally', made.status === 0 && present(mask))
    if (present(mask)) {
      const inpainted = await tool('genbox_image_edit').execute(
        { prompt: 'replace the lantern with a paper crane', image: first, mask, mode: 'inpaint', providers: [provider], size: source.width + 'x' + source.height },
        exec,
      )
      third = inpainted.images?.[0]?.file
      check('real inpaint with a mask produced a third file', inpainted.status === 'completed' && present(third))
      check('the inpaint did not overwrite the earlier files', third !== first && third !== second)
      if (present(third)) step('inpainted ' + third + ' (' + statSync(third).size + 'B, ' + magic(third) + ')')
    }
  }
}

if (wanted.has('variations')) {
  if (!present(first)) {
    step('variations skipped: no source image from the generate step')
  } else {
    const started = Date.now()
    let variations
    try {
      variations = await tool('genbox_image_variations').execute(
        { image: first, provider, strategy: 'auto', n: 1 },
        exec,
      )
    } catch (error) {
      step('variations failed: ' + (error instanceof Error ? error.message : String(error)).slice(0, 180))
    }
    if (variations !== undefined) {
      const files = variations.files ?? []
      check('real variations produced a file', files.some(present))
      // 'auto' tries GenBox's legacy /images/variations proxy first and falls back to
      // repainting through mode=i2i, so either strategy is a legitimate outcome.
      check('the variation result names the strategy it used',
        variations.strategy === 'native' || variations.strategy === 'prompt')
      step('variations via ' + variations.strategy + ' -> ' + String(files[0] ?? '(none)')
        + ' (' + statSync(files[0]).size + 'B, ' + ((Date.now() - started) / 1000).toFixed(1) + 's)')
    }
  }
}

let failures = 0
for (const [label, ok] of checks) {
  if (!ok) failures += 1
  console.log((ok ? '  [ok]   ' : '  [FAIL] ') + label)
}
console.log(failures === 0 ? 'OK (' + checks.length + ' checks, provider ' + provider + ')' : 'FAILURES: ' + failures)
process.exit(failures === 0 ? 0 : 1)
