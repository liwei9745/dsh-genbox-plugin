// Keep docs/tools.md in step with the code: the reference is generated from the
// registered tool definitions, so it cannot describe a parameter that no longer
// exists (or miss one that was just added).
//
//   node scripts/tool-reference.mjs           # check (used by verify-all)
//   node scripts/tool-reference.mjs --write   # regenerate docs/tools.md
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

const target = join(import.meta.dirname, '..', 'docs', 'tools.md')
const write = process.argv.includes('--write')

const registered = []
apply(
  { tools: { register: (tool) => registered.push(tool) } },
  {
    baseUrl: 'http://127.0.0.1:8892',
    adminKey: '',
    defaultProviderId: '',
    outputDir: '.genbox',
    pollIntervalMs: 2000,
    taskTimeoutMs: 900000,
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    videoEncoder: '',
    nativeJobs: false,
  },
)

const TICK = String.fromCharCode(96)

function describeType(schema) {
  if (schema === undefined) return '?'
  if (Array.isArray(schema.enum)) return 'one of: ' + schema.enum.map((value) => TICK + value + TICK).join(' | ')
  if (schema.type === 'array') return 'array of ' + (schema.items?.type ?? 'values')
  return String(schema.type ?? 'value')
}

const tools = registered
  .map((tool) => ({
    name: tool.name,
    description: String(tool.description ?? '').replace(/\s+/g, ' ').trim(),
    properties: tool.parameters?.properties ?? {},
    required: new Set(tool.parameters?.required ?? []),
    present: typeof tool.presentCall === 'function' && typeof tool.presentResult === 'function',
  }))
  .sort((left, right) => left.name.localeCompare(right.name))

const lines = []
lines.push('# Tool reference')
lines.push('')
lines.push('> Generated from the registered tool definitions by ' + TICK + 'node scripts/tool-reference.mjs --write' + TICK + '.')
lines.push('> ' + TICK + 'node scripts/tool-reference.mjs' + TICK + ' fails when this file and the code disagree, so it cannot drift.')
lines.push('')
lines.push('**' + tools.length + ' tools.** Every one of them talks to a local GenBox server over HTTP.')
lines.push('')
lines.push('| Tool | What it is for | Parameters |')
lines.push('|---|---|---|')
for (const tool of tools) {
  const summary = tool.description.split('. ')[0].replace(/\.$/, '')
  const count = Object.keys(tool.properties).length
  lines.push('| [' + TICK + tool.name + TICK + '](#' + tool.name + ') | ' + summary + ' | ' + count + ' |')
}
lines.push('')
for (const tool of tools) {
  lines.push('## ' + tool.name)
  lines.push('')
  lines.push('```')
  lines.push(tool.description)
  lines.push('```')
  lines.push('')
  const names = Object.keys(tool.properties)
  if (names.length === 0) {
    lines.push('Takes no parameters.')
  } else {
    lines.push('| Parameter | Type | Required | Meaning |')
    lines.push('|---|---|---|---|')
    for (const name of names) {
      const schema = tool.properties[name]
      const meaning = String(schema?.description ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
      lines.push('| ' + TICK + name + TICK + ' | ' + describeType(schema) + ' | ' + (tool.required.has(name) ? 'yes' : 'no') + ' | ' + meaning + ' |')
    }
  }
  lines.push('')
  if (tool.present) lines.push('Declares a UI render intent (' + TICK + 'presentCall' + TICK + ' / ' + TICK + 'presentResult' + TICK + ').')
  lines.push('')
}
const generated = lines.join('\n').replace(/\n{3,}/g, '\n\n')

if (write) {
  writeFileSync(target, generated, 'utf8')
  console.log('wrote ' + target + ' (' + tools.length + ' tools, ' + generated.length + ' chars)')
  process.exit(0)
}

let current = ''
try {
  current = readFileSync(target, 'utf8')
} catch {
  console.log('docs/tools.md is missing - run: node scripts/tool-reference.mjs --write')
  process.exit(1)
}
if (current !== generated) {
  console.log('docs/tools.md is out of date with the registered tools - run: node scripts/tool-reference.mjs --write')
  process.exit(1)
}
console.log('OK (' + tools.length + ' tools documented)')
process.exit(0)
