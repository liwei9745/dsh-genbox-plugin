// Local smoke test: load the built plugin with a stub context and call the tool
// against a running GenBox server. Not part of the shipped package.
import { apply } from '../lib/index.js'

const registered = []
const ctx = { tools: { register: (tool) => registered.push(tool) } }

const config = {
  baseUrl: process.env.GENBOX_BASE_URL ?? 'http://127.0.0.1:8892',
  adminKey: process.env.GENBOX_ADMIN_KEY ?? '',
  defaultProviderId: '',
  outputDir: '.genbox',
  pollIntervalMs: 2000,
  taskTimeoutMs: 900000,
}

apply(ctx, config)
console.log('registered:', registered.map((t) => t.name).join(', '))

const health = registered.find((t) => t.name === 'genbox_health')
if (!health) throw new Error('genbox_health was not registered')

const value = await health.execute({}, { signal: AbortSignal.timeout(10000) })
console.log('execute -> keys:', Object.keys(value).join(', '))
console.log('execute -> gpt-image:', JSON.stringify(value['gpt-image']))
const rendered = health.output.render({}, value)
console.log('render ->', JSON.stringify(rendered).slice(0, 160))
