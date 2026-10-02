// Verify the non-blocking submit path: background=true returns at once, and
// genbox_task later collects the finished result.
import { existsSync, statSync } from 'node:fs'
import { apply } from '../lib/index.js'

const registered = []
apply(
  { tools: { register: (tool) => registered.push(tool) } },
  {
    baseUrl: 'http://127.0.0.1:8892',
    adminKey: '',
    defaultProviderId: '',
    outputDir: 'E:/AI/GenBox-dsh/.genbox-out',
    pollIntervalMs: 800,
    taskTimeoutMs: 180000,
  },
)

const tool = (name) => registered.find((entry) => entry.name === name)
const exec = { signal: AbortSignal.timeout(180000) }
const size = (file) => (existsSync(file) ? statSync(file).size + 'B' : 'MISSING')

async function settle(id, kind, label) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await tool('genbox_task').execute({ id, kind }, exec)
    if (!status.running) {
      console.log(label + ' settled:', status.status, status.files.map(size).join(',') || '(no files)', status.error ?? '')
      return status
    }
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  console.log(label + ' never settled')
  return undefined
}

// ---- image, submitted in the background -------------------------------------
const t0 = Date.now()
const imageJob = await tool('genbox_image_generate').execute(
  { prompt: 'a brass compass on a map', providers: ['mock-openai'], size: '512x512', background: true },
  exec,
)
console.log('image submit returned in', Date.now() - t0, 'ms ->', JSON.stringify(imageJob))
const imageFinal = await settle(imageJob.generationId, 'image', 'image')
if (imageFinal === undefined || imageFinal.files.length === 0) throw new Error('background image produced no file')

// ---- video, submitted in the background -------------------------------------
const videoJob = await tool('genbox_video_generate').execute(
  { prompt: 'smoke rising from a chimney', provider: 'mock-video', width: 512, height: 512, background: true },
  exec,
)
console.log('video submit ->', JSON.stringify(videoJob))
const videoFinal = await settle(videoJob.taskId, 'video', 'video')
if (videoFinal === undefined || videoFinal.files.length === 0) throw new Error('background video produced no file')

console.log('OK')
