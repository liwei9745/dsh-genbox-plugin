// GenBox's cutout tool needs an ONNX checkpoint that ships separately; this
// probe checks that the plugin surfaces the host's reason instead of hanging.
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

const outDir = 'E:/AI/GenBox-dsh/.genbox-out'
const source = join(outDir, readdirSync(outDir).find((name) => name.startsWith('mock-openai_')))
const cutout = registered.find((tool) => tool.name === 'genbox_cutout')

try {
  const result = await cutout.execute({ image: source }, { signal: AbortSignal.timeout(60000) })
  console.log('cutout OK', JSON.stringify(result))
} catch (error) {
  console.log('cutout surfaced failure:', error.message.slice(0, 300))
}
