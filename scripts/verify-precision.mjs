// Precision-edit annotations: GenBox gates this mode behind a verified edit model,
// which the local mock cannot claim. What we CAN prove is that our envelope passes
// GenBox's input contract and only then hits the provider-authorisation gate.
import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { apply } from '../lib/index.js'

const run = promisify(execFile)
const outDir = 'E:/AI/GenBox-dsh/.genbox-out/annotate'
mkdirSync(outDir, { recursive: true })
const basePng = join(outDir, 'base.png')
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=1:duration=1', '-frames:v', '1', basePng])

const registered = []
apply(
  { tools: { register: (tool) => registered.push(tool) } },
  {
    baseUrl: 'http://127.0.0.1:8892',
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

const annotations = [
  { kind: 'arrow', instruction: 'move the sun up here', x: 40, y: 200, x2: 240, y2: 60 },
  { kind: 'rectangle', instruction: 'remove this bench', x: 120, y: 150, width: 140, height: 60 },
]

const checks = []

// 1. our own guard: annotations need a local path
try {
  await edit.execute({ prompt: 'x', image: 'data:image/png;base64,AAAA', providers: ['mock-openai'], model: 'mock-image-1', mode: 'precision_edit', annotations }, exec)
  checks.push(['local-path guard', false, 'no error raised'])
} catch (error) {
  checks.push(['local-path guard', error.message.includes('local file path'), error.message.slice(0, 90)])
}

// 2. our own guard: precision_edit needs a model
try {
  await edit.execute({ prompt: 'x', image: basePng, providers: ['mock-openai'], mode: 'precision_edit', annotations }, exec)
  checks.push(['model guard', false, 'no error raised'])
} catch (error) {
  checks.push(['model guard', error.message.includes('needs a model'), error.message.slice(0, 90)])
}

// 3. the real request: the envelope must survive GenBox validation and stop at the provider gate
try {
  const result = await edit.execute(
    { prompt: 'clean up the scene', image: basePng, providers: ['mock-openai'], model: 'mock-image-1', mode: 'precision_edit', annotations },
    exec,
  )
  checks.push(['genbox accepted the envelope', true, 'completed: ' + JSON.stringify(result).slice(0, 80)])
} catch (error) {
  const message = error.message
  const providerGate = message.includes('precision_edit_provider_unsupported')
  const contractError = message.includes('annotation') || message.includes('precision_resize') || message.includes('unknown_field')
  checks.push([
    'envelope passed GenBox input validation, stopped at provider gate',
    providerGate && !contractError,
    (providerGate ? 'provider gate: ' : contractError ? 'CONTRACT ERROR: ' : 'other error: ') + message.slice(0, 170),
  ])
}

let failures = 0
for (const [label, ok, detail] of checks) {
  if (!ok) failures += 1
  console.log((ok ? '  [ok]   ' : '  [FAIL] ') + label + ' -> ' + detail)
}
console.log(failures === 0 ? 'OK' : 'FAILURES: ' + failures)
process.exit(failures === 0 ? 0 : 1)
