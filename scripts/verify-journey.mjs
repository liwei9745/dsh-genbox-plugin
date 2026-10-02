// One user journey through the tools, in the order a person actually works:
// look at the setup, generate an image, edit it, mark it up, generate a video in the
// background, collect it, cut it with ffmpeg, and list the library.
//
// Every suite next to this one checks a single tool. This one checks the SEAMS:
// does the path one tool returns still work as the input of the next one, do the
// files really exist, and does anything silently overwrite anything else.
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { apply } from '../lib/index.js'

const outDir = resolve(process.env.VERIFY_OUT_DIR ?? '.genbox-out', 'journey')
mkdirSync(outDir, { recursive: true })

const registered = []
apply(
  { tools: { register: (tool) => registered.push(tool) } },
  {
    baseUrl: process.env.GENBOX_BASE_URL ?? 'http://127.0.0.1:8892',
    adminKey: '',
    defaultProviderId: '',
    outputDir: outDir,
    pollIntervalMs: 1000,
    taskTimeoutMs: 180000,
    ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
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
const present = (file) => typeof file === 'string' && existsSync(file) && statSync(file).size > 0
const step = (message) => console.log('  - ' + message)

// 1. the user checks the setup first
const report = await tool('genbox_doctor').execute({}, exec)
check('doctor: the setup is healthy', report.ok === true)
step('doctor ok, ' + report.checks.length + ' checks, ' + report.nextSteps.length + ' next steps')

// 2. which model would we use? (precision_edit needs an explicit model, because
//    GenBox keeps per-provider model settings for that mode)
const providers = await tool('genbox_providers').execute({ enabledOnly: true }, exec)
const imageProvider = (providers.providers ?? []).find((provider) => provider.enabled === true && (provider.type ?? 'image') === 'image')
check('providers: there is an enabled image provider to work with', imageProvider !== undefined)
const model = imageProvider?.model ?? imageProvider?.models?.[0]
step('using provider ' + String(imageProvider?.id) + ' model ' + String(model))

// 3. generate an image
const generated = await tool('genbox_image_generate').execute(
  { prompt: 'a paper boat on a pond, journey step one', providers: ['mock-openai'], size: '512x512' },
  exec,
)
const first = generated.images?.[0]?.file
check('generate: an image landed', generated.status === 'completed' && present(first))
step('generated ' + first)

// 3. edit that image (image-to-image)
const edited = await tool('genbox_image_edit').execute(
  { prompt: 'make it dusk', image: first, mode: 'i2i', providers: ['mock-openai'] },
  exec,
)
const second = edited.images?.[0]?.file
check('edit (i2i): the previous output is a valid input', edited.status === 'completed' && present(second))
check('edit (i2i): the result is a new file, nothing overwritten', second !== first)
step('edited ' + second)

// 4. mark it up and let GenBox apply the instruction on the same canvas
const marked = await tool('genbox_image_edit').execute(
  {
    prompt: 'turn the marked area into a lantern',
    image: second,
    mode: 'precision_edit',
    providers: [imageProvider.id],
    model,
    annotations: [{ kind: 'rectangle', instruction: 'here', x: 60, y: 60, width: 160, height: 120 }],
  },
  exec,
)
const third = marked.images?.[0]?.file
check('precision edit: annotations survive into a real result', marked.status === 'completed' && present(third))
check('precision edit: another new file', third !== second && third !== first)
step('precision edit -> ' + third)

// 5. submit a video in the background and collect it with the task tool
const submitted = await tool('genbox_video_generate').execute(
  { prompt: 'a paper boat drifting, journey step five', provider: 'mock-video', background: true },
  exec,
)
check('video: the call returns a task handle instead of blocking', submitted.background === true && typeof submitted.taskId === 'string')
step('video task ' + submitted.taskId)

// The intended usage: genbox_task reports "still running" until it is not.
async function settle(id, kind) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await tool('genbox_task').execute({ id, kind }, exec)
    if (status.running !== true) return status
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  return undefined
}
const collected = await settle(submitted.taskId, 'video')
const collectedFiles = Array.isArray(collected?.files) ? collected.files : []
const clip = collectedFiles.find((file) => typeof file === 'string' && file.toLowerCase().endsWith('.mp4'))
check('task: the background video is collected to a local file', collected?.status === 'completed' && present(clip))
step('collected ' + JSON.stringify(collectedFiles))

// 6. cut the clip locally - the step that needs no GenBox provider at all
const trimmed = await tool('genbox_video_edit').execute(
  { operation: 'trim', input: clip, startSeconds: 0, endSeconds: 1, outputDir: outDir },
  exec,
)
check('video edit: the collected clip is a valid ffmpeg input', present(trimmed.file) && trimmed.file !== clip)
step('trimmed ' + trimmed.file)

// 7. and finally look at the library
const gallery = await tool('genbox_gallery').execute({ limit: 10, type: 'image' }, exec)
const items = Array.isArray(gallery.items) ? gallery.items : (Array.isArray(gallery.media) ? gallery.media : [])
check('gallery: the library still answers after all of that', items.length > 0)
step('gallery returned ' + items.length + ' image item(s)')

// Every artifact has to be distinct: no tool may quietly clobber another's output.
const artifacts = [first, second, third, clip, trimmed.file].filter((file) => typeof file === 'string')
check('all five artifacts are distinct paths', new Set(artifacts).size === artifacts.length)
check('all five artifacts are still on disk', artifacts.every((file) => present(file)))

let failures = 0
for (const [label, ok] of checks) {
  if (!ok) failures += 1
  console.log((ok ? '  [ok]   ' : '  [FAIL] ') + label)
}
console.log(failures === 0 ? 'OK (' + checks.length + ' checks)' : 'FAILURES: ' + failures)
process.exit(failures === 0 ? 0 : 1)
