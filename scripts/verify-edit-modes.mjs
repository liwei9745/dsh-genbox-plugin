// Check the inpaint and precision_edit branches of genbox_image_edit.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
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
const outDir = 'E:/AI/GenBox-dsh/.genbox-out'
const source = join(outDir, readdirSync(outDir).find((name) => name.startsWith('mock-openai_') && name.includes('red_cube')))
const mask = join(outDir, 'mask_white_512.png')

try {
  const inpaint = await tool('genbox_image_edit').execute(
    { prompt: 'replace the cube with a green sphere', image: source, mask, providers: ['mock-openai'], mode: 'inpaint', size: '512x512' },
    exec,
  )
  console.log('inpaint:', JSON.stringify(inpaint))
} catch (error) {
  console.log('inpaint surfaced failure:', error.message.slice(0, 220))
}

try {
  const precision = await tool('genbox_image_edit').execute(
    { prompt: 'widen the scene', image: source, providers: ['mock-openai'], mode: 'precision_edit', precisionTargetSize: '768x512' },
    exec,
  )
  console.log('precision_edit:', JSON.stringify(precision))
} catch (error) {
  console.log('precision_edit surfaced failure:', error.message.slice(0, 220))
}
