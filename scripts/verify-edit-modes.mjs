// The edit branches of genbox_image_edit: inpaint with a real mask, and the two
// refusals precision_edit has to explain well (missing model, provider without the
// capability). Fixtures are generated here, so the suite does not depend on whatever
// happens to sit in the output directory.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { apply } from '../lib/index.js'

const outDir = resolve(process.env.VERIFY_OUT_DIR ?? '.genbox-out', 'edit-modes')
mkdirSync(outDir, { recursive: true })

const registered = []
apply(
  { tools: { register: (tool) => registered.push(tool) } },
  {
    baseUrl: process.env.GENBOX_BASE_URL ?? 'http://127.0.0.1:8892',
    adminKey: '',
    defaultProviderId: '',
    outputDir: outDir,
    pollIntervalMs: 800,
    taskTimeoutMs: 120000,
    ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
    videoEncoder: '',
    nativeJobs: false,
  },
)

const tool = (name) => registered.find((entry) => entry.name === name)
const exec = { signal: AbortSignal.timeout(120000) }
const checks = []
const check = (label, ok) => checks.push([label, ok])
const present = (file) => typeof file === 'string' && existsSync(file) && statSync(file).size > 0

// A source image and a white mask of the same size, both made locally.
const generated = await tool('genbox_image_generate').execute(
  { prompt: 'a plain grey cube on a wooden table', providers: ['mock-openai'], size: '512x512' },
  exec,
)
const source = generated.images?.[0]?.file
check('fixture: a source image exists', present(source))
const mask = join(outDir, 'mask-white-512.png')
const made = spawnSync(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=white:size=512x512', '-frames:v', '1', mask], { encoding: 'utf8' })
check('fixture: a white mask exists', made.status === 0 && present(mask))

// inpaint with a real mask
const inpaint = await tool('genbox_image_edit').execute(
  { prompt: 'replace the cube with a green sphere', image: source, mask, providers: ['mock-openai'], mode: 'inpaint', size: '512x512' },
  exec,
)
check('inpaint: a mask run completes and produces a file', inpaint.status === 'completed' && present(inpaint.images?.[0]?.file))
console.log('inpaint ->', JSON.stringify(inpaint).slice(0, 160))

// precision_edit without a model: our own, specific refusal
let modelRefusal = ''
try {
  await tool('genbox_image_edit').execute(
    { prompt: 'widen the scene', image: source, providers: ['mock-openai'], mode: 'precision_edit', precisionTargetSize: '768x512' },
    exec,
  )
} catch (error) {
  modelRefusal = error.message
}
check('precision_edit without a model explains what is missing', /needs a model/i.test(modelRefusal))
console.log('precision_edit (no model) ->', modelRefusal.slice(0, 160))

// precision_edit on a provider that does not declare the capability: GenBox refuses,
// and the tool has to say which enabled providers WOULD work.
const providers = await tool('genbox_providers').execute({ enabledOnly: true }, exec)
const all = providers.providers ?? []
const capable = all.filter((provider) => provider.enabled === true && provider.capabilities?.precision_edit === true)
const incapable = all.find((provider) => provider.enabled === true && (provider.type ?? 'image') === 'image' && provider.capabilities?.precision_edit !== true)
if (incapable === undefined) {
  console.log('  [skip] no enabled image provider without precision_edit to probe the refusal with')
} else {
  let refusal = ''
  try {
    await tool('genbox_image_edit').execute(
      {
        prompt: 'change the sky',
        image: source,
        providers: [incapable.id],
        model: incapable.model ?? incapable.models?.[0],
        mode: 'precision_edit',
        annotations: [{ kind: 'rectangle', instruction: 'sky', x: 10, y: 10, width: 60, height: 60 }],
      },
      exec,
    )
  } catch (error) {
    refusal = error.message
  }
  check('precision_edit on an incapable provider fails with GenBox reason', /provider_unsupported/i.test(refusal))
  const named = capable.map((provider) => provider.id)
  check('the refusal names the providers that would work',
    named.length === 0 ? /No enabled provider declares/i.test(refusal) : named.every((id) => refusal.includes(id)))
  console.log('precision_edit (incapable provider) ->', refusal.slice(0, 220))
}

let failures = 0
for (const [label, ok] of checks) {
  if (!ok) failures += 1
  console.log((ok ? '  [ok]   ' : '  [FAIL] ') + label)
}
console.log(failures === 0 ? 'OK (' + checks.length + ' checks)' : 'FAILURES: ' + failures)
process.exit(failures === 0 ? 0 : 1)
