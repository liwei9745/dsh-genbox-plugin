// The media-library and prompt-assistant tools against a live GenBox, with real
// assertions: a gallery page has items, downloadTo actually copies them to disk,
// and the prompt assistant answers (or says why it could not).
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { apply } from '../lib/index.js'

const outDir = resolve(process.env.VERIFY_OUT_DIR ?? '.genbox-out', 'gallery')
mkdirSync(outDir, { recursive: true })

const registered = []
apply(
  { tools: { register: (tool) => registered.push(tool) } },
  {
    baseUrl: process.env.GENBOX_BASE_URL ?? 'http://127.0.0.1:8892',
    adminKey: '',
    defaultProviderId: '',
    outputDir: outDir,
    pollIntervalMs: 800,
    taskTimeoutMs: 60000,
    ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
    videoEncoder: '',
    nativeJobs: false,
  },
)

const tool = (name) => registered.find((entry) => entry.name === name)
const exec = { signal: AbortSignal.timeout(60000) }
const checks = []
const check = (label, ok) => checks.push([label, ok])

const gallery = await tool('genbox_gallery').execute({ limit: 5, downloadTo: outDir }, exec)
const items = Array.isArray(gallery.items) ? gallery.items : []
check('the gallery answers with a page of items', typeof gallery.total === 'number' && items.length > 0)
check('items carry a type and an id', items.every((item) => typeof item.id === 'string' && item.id !== '' && (item.type === 'image' || item.type === 'video')))
console.log('gallery total:', gallery.total, '| page:', items.length)

// downloadTo has to put bytes on disk, not just report paths.
const copied = items.filter((item) => typeof item.file === 'string' && item.file !== '')
check('downloadTo copied every item it reported', copied.length === items.length)
check('every copied file exists and is not empty', copied.every((item) => existsSync(item.file) && statSync(item.file).size > 0))
const escaped = copied.filter((item) => !resolve(item.file).startsWith(resolve(outDir)))
check('copies land inside the requested directory', escaped.length === 0)
console.log('copied:', copied.map((item) => item.type + ' ' + item.file.split(/[\\/]/).pop()).join(', ') || '(none)')

const optimized = await tool('genbox_prompt_optimize').execute({ prompt: 'a cat on a sofa' }, exec)
const optimizedPrompt = optimized?.optimized ?? optimized?.prompt ?? optimized?.optimized_prompt ?? optimized?.optimizedPrompt
check('the prompt assistant returns a prompt', typeof optimizedPrompt === 'string' && optimizedPrompt.trim() !== '')
check('an absent LLM provider is reported rather than hidden', optimized?.optimizedByLlm === false || optimized?.optimizedByLlm === true)
console.log('optimize:', JSON.stringify(optimized).slice(0, 200))

let failures = 0
for (const [label, ok] of checks) {
  if (!ok) failures += 1
  console.log((ok ? '  [ok]   ' : '  [FAIL] ') + label)
}
console.log(failures === 0 ? 'OK (' + checks.length + ' checks)' : 'FAILURES: ' + failures)
// Exit through the code, not exit(): an explicit process.exit() while the gallery
// copy still holds handles crashed the process on Windows (0xC0000409).
process.exitCode = failures === 0 ? 0 : 1
