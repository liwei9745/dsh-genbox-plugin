// Annotation-based precision editing, end to end.
//
// GenBox only accepts precision_edit for a model whose capability was explicitly
// confirmed by the user, so this script confirms it for the mock provider first,
// then proves that our annotation envelope (overlay + genbox-annotation-v3) is
// accepted and produces an image.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { apply } from '../lib/index.js'

const run = promisify(execFile)
const baseUrl = process.env.GENBOX_BASE_URL ?? 'http://127.0.0.1:8892'
const outDir = resolve(process.env.VERIFY_OUT_DIR ?? '.genbox-out', 'annotate')
mkdirSync(outDir, { recursive: true })

const basePng = join(outDir, 'base.png')
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=1:duration=1', '-frames:v', '1', basePng])

const registered = []
apply(
  { tools: { register: (tool) => registered.push(tool) } },
  {
    baseUrl,
    adminKey: '',
    defaultProviderId: '',
    outputDir: outDir,
    pollIntervalMs: 800,
    taskTimeoutMs: 60000,
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    videoEncoder: '',
  },
)
const edit = registered.find((tool) => tool.name === 'genbox_image_edit')
const exec = { signal: AbortSignal.timeout(60000) }
const checks = []

const annotations = [
  { kind: 'arrow', instruction: 'move the sun up here', x: 40, y: 200, x2: 240, y2: 60 },
  { kind: 'rectangle', instruction: 'remove this bench', x: 120, y: 150, width: 140, height: 60 },
]

// 0. confirm the capability that GenBox demands before it will dispatch the mode
try {
  const grant = await fetch(baseUrl + '/api/providers/mock-openai/precision-capability', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'mock-image-1', enabled: true, confirmed: true }),
  })
  checks.push(['capability confirmed for mock-image-1', grant.ok, grant.ok ? 'enabled' : (await grant.text()).slice(0, 120)])
} catch (error) {
  checks.push(['capability confirmed for mock-image-1', false, String(error).slice(0, 120)])
}

// 1. our own guard: annotations need a local path
try {
  await edit.execute({ prompt: 'x', image: 'data:image/png;base64,AAAA', providers: ['mock-openai'], model: 'mock-image-1', mode: 'precision_edit', annotations }, exec)
  checks.push(['local-path guard', false, 'no error raised'])
} catch (error) {
  checks.push(['local-path guard', error.message.includes('local file path'), error.message.slice(0, 80)])
}

// 2. our own guard: precision_edit needs a model
try {
  await edit.execute({ prompt: 'x', image: basePng, providers: ['mock-openai'], mode: 'precision_edit', annotations }, exec)
  checks.push(['model guard', false, 'no error raised'])
} catch (error) {
  checks.push(['model guard', error.message.includes('needs a model'), error.message.slice(0, 80)])
}

// 3. the real thing
try {
  const result = await edit.execute(
    { prompt: 'clean up the scene', image: basePng, providers: ['mock-openai'], model: 'mock-image-1', mode: 'precision_edit', annotations },
    exec,
  )
  const file = result.images[0]?.file
  const ok = result.status === 'completed' && typeof file === 'string' && existsSync(file) && statSync(file).size > 0
  checks.push(['annotated precision_edit completed', ok, ok ? (file + ' (' + statSync(file).size + 'B)') : JSON.stringify(result).slice(0, 200)])
} catch (error) {
  checks.push(['annotated precision_edit completed', false, error.message.slice(0, 200)])
}

let failures = 0
for (const [label, ok, detail] of checks) {
  if (!ok) failures += 1
  console.log((ok ? '  [ok]   ' : '  [FAIL] ') + label + ' -> ' + detail)
}
console.log(failures === 0 ? 'OK' : 'FAILURES: ' + failures)
process.exit(failures === 0 ? 0 : 1)
