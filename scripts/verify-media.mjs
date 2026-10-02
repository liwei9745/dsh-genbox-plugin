// Check the media-library and prompt-assistant tools against a live GenBox.
import { existsSync } from 'node:fs'
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
    taskTimeoutMs: 60000,
  },
)

const tool = (name) => registered.find((entry) => entry.name === name)
const exec = { signal: AbortSignal.timeout(60000) }

const gallery = await tool('genbox_gallery').execute(
  { limit: 5, downloadTo: 'E:/AI/GenBox-dsh/.genbox-out/gallery' },
  exec,
)
console.log('gallery total:', gallery.total)
for (const item of gallery.items) {
  console.log(' -', item.type, item.id, item.file !== undefined ? (existsSync(item.file) ? 'copied' : 'MISSING') : '(not copied)')
}

const optimized = await tool('genbox_prompt_optimize').execute({ prompt: 'a cat on a sofa' }, exec)
console.log('optimize:', JSON.stringify(optimized))
console.log('OK')
