// End-to-end check of the GenBox tools against a live GenBox + mock providers.
import { existsSync, statSync } from 'node:fs'
import { apply } from '../lib/index.js'

const registered = []
const ctx = { tools: { register: (tool) => registered.push(tool) } }
const config = {
  baseUrl: process.env.GENBOX_BASE_URL ?? 'http://127.0.0.1:8892',
  adminKey: process.env.GENBOX_ADMIN_KEY ?? '',
  defaultProviderId: '',
  outputDir: process.env.GENBOX_OUT_DIR ?? 'E:/AI/GenBox-dsh/.genbox-out',
  pollIntervalMs: 800,
  taskTimeoutMs: 180000,
}

apply(ctx, config)
console.log('registered:', registered.map((t) => t.name).join(', '))

const tool = (name) => {
  const found = registered.find((t) => t.name === name)
  if (!found) throw new Error('tool not registered: ' + name)
  return found
}
const exec = { signal: AbortSignal.timeout(180000) }
const show = (label, value) => console.log(label + ': ' + JSON.stringify(value))
const size = (file) => (existsSync(file) ? statSync(file).size + 'B' : 'MISSING')

// ---------------------------------------------------------------- health + providers
await tool('genbox_health').execute({}, exec)
const providers = await tool('genbox_providers').execute({ enabledOnly: true }, exec)
show('enabled providers', providers.providers.map((p) => p.id + '(' + p.type + ')'))

// ---------------------------------------------------------------- text to image
const generated = await tool('genbox_image_generate').execute(
  { prompt: 'a red cube on a wooden table', providers: ['mock-openai'], size: '512x512' },
  exec,
)
show('generate', generated)
if (generated.images.length === 0) throw new Error('generation produced no images')
const source = generated.images[0].file
console.log('  file:', size(source))

// ---------------------------------------------------------------- editing
const edited = await tool('genbox_image_edit').execute(
  { prompt: 'repaint it blue', image: source, providers: ['mock-openai'], mode: 'i2i', strength: 0.6 },
  exec,
)
show('edit(i2i)', edited)

// ---------------------------------------------------------------- upscale
const upscaled = await tool('genbox_image_upscale').execute({ image: source, targetWidth: 1024, targetHeight: 1024 }, exec)
show('upscale', upscaled)
console.log('  file:', size(upscaled.file))

// ---------------------------------------------------------------- variations
try {
  const variations = await tool('genbox_image_variations').execute(
    { image: source, provider: 'mock-openai', n: 1, size: '512x512' },
    exec,
  )
  show('variations', variations)
} catch (error) {
  console.log('variations: EXPECTED-FAILURE ' + error.message.slice(0, 160))
}

// ---------------------------------------------------------------- video
const video = await tool('genbox_video_generate').execute(
  { prompt: 'a paper plane gliding', provider: 'mock-video', width: 512, height: 512, durationSeconds: 5, fps: 24 },
  exec,
)
show('video', video)
if (video.file !== undefined) console.log('  file:', size(video.file))

console.log('OK')
