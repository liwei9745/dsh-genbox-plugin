// The render-intent contract: every media tool must expose presentCall /
// presentResult / output.presentationMeta, and the result card must rebuild from
// the PERSISTED meta (that is what a replay sees), not from the live value.
import { apply } from '../lib/index.js'

const registered = []
apply(
  { tools: { register: (tool) => registered.push(tool) } },
  {
    baseUrl: 'http://127.0.0.1:8892',
    adminKey: '',
    defaultProviderId: '',
    outputDir: process.env.VERIFY_OUT_DIR ?? '.genbox-out',
    pollIntervalMs: 800,
    taskTimeoutMs: 60000,
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    videoEncoder: '',
    nativeJobs: false,
  },
)

const cases = [
  {
    name: 'genbox_image_generate',
    args: { prompt: 'a red cube', providers: ['mock-openai'], size: '512x512' },
    value: {
      background: false,
      generationId: 'gen_1',
      status: 'completed',
      elapsedSeconds: 1,
      images: [{ providerId: 'mock-openai', model: 'mock-image-1', file: 'E:/out/a.png' }],
      failures: [],
    },
    expectFile: 'E:/out/a.png',
  },
  {
    name: 'genbox_image_edit',
    // Args must satisfy the tool's own schema: dsh-tools soft-validates before it
    // calls the presentation hooks and falls back to a generic card otherwise.
    args: {
      prompt: 'make it blue',
      image: 'E:/in.png',
      mode: 'i2i',
      annotations: [{ kind: 'arrow', instruction: 'move the sun up', x: 10, y: 20, x2: 30, y2: 40 }],
    },
    value: {
      background: false,
      generationId: 'gen_2',
      status: 'completed',
      elapsedSeconds: 1,
      images: [{ providerId: 'mock-openai', model: 'mock-image-1', file: 'E:/out/b.png' }],
      failures: [],
    },
    expectFile: 'E:/out/b.png',
  },
  {
    name: 'genbox_video_generate',
    args: { prompt: 'a paper plane', mode: 'ti2vid' },
    value: { background: false, taskId: 'task_1', status: 'completed', elapsedSeconds: 3, file: 'E:/out/v.mp4' },
    expectFile: 'E:/out/v.mp4',
  },
  {
    name: 'genbox_video_edit',
    args: { operation: 'trim', input: 'E:/in.mp4' },
    value: { file: 'E:/out/e.mp4', operation: 'trim', width: 320, height: 240, durationSeconds: 1, sizeBytes: 100 },
    expectFile: 'E:/out/e.mp4',
  },
]

const checks = []
for (const item of cases) {
  const tool = registered.find((entry) => entry.name === item.name)
  if (tool === undefined) {
    checks.push([item.name + ' is registered', false])
    continue
  }

  const call = tool.presentCall?.(item.args)
  checks.push([item.name + ' presentCall returns a generic card', call !== undefined && call.card === 'generic' && typeof call.title === 'string' && call.title.length > 0])

  const meta = tool.output?.presentationMeta?.(item.args, item.value)
  checks.push([item.name + ' presentationMeta returns an object', meta !== null && typeof meta === 'object' && JSON.stringify(meta).length < 2000])

  const result = tool.presentResult?.(item.args, { content: [], isError: false, meta })
  const locations = result?.locations ?? []
  const pointsAtFile = locations.some((entry) => entry.path === item.expectFile)
  checks.push([item.name + ' presentResult rebuilds the file from persisted meta', result !== undefined && result.card === 'generic' && pointsAtFile])
}

let failures = 0
for (const [label, ok] of checks) {
  if (!ok) failures += 1
  console.log((ok ? '  [ok]   ' : '  [FAIL] ') + label)
}
console.log(failures === 0 ? 'OK (' + checks.length + ' checks)' : 'FAILURES: ' + failures)
process.exit(failures === 0 ? 0 : 1)
