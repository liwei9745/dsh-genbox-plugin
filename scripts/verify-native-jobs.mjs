// Unit-level check of the experimental ctx.jobs integration.
//
// The DSH job registry contract was read from the reference implementation
// (dsh-tool-bash): registry.start({ kind, label, owner?, run }) returns a job id,
// and run() must return { done: Promise, cancel(reason) }. This test drives the
// plugin with a stub registry, so it verifies OUR call shape - not a live host.
import { existsSync, statSync } from 'node:fs'
import { apply } from '../lib/index.js'

const config = {
  baseUrl: process.env.GENBOX_BASE_URL ?? 'http://127.0.0.1:8892',
  adminKey: '',
  defaultProviderId: '',
  outputDir: process.env.VERIFY_OUT_DIR ?? '.genbox-out',
  pollIntervalMs: 800,
  taskTimeoutMs: 180000,
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  videoEncoder: '',
}

function load(nativeJobs) {
  const registered = []
  const calls = []
  const jobs = {
    start(spec) {
      calls.push(spec)
      return 'genbox-video-1'
    },
  }
  apply({ tools: { register: (tool) => registered.push(tool) }, jobs }, { ...config, nativeJobs })
  return { tool: registered.find((entry) => entry.name === 'genbox_video_generate'), calls }
}

const checks = []
const exec = { signal: AbortSignal.timeout(180000) }

// 1. disabled: plain polling handle, registry untouched
const off = load(false)
const offResult = await off.tool.execute({ prompt: 'plain path', provider: 'mock-video', background: true }, exec)
checks.push(['nativeJobs=false leaves ctx.jobs alone', off.calls.length === 0])
checks.push(['nativeJobs=false returns a GenBox task id', typeof offResult.taskId === 'string' && offResult.taskId !== '' && offResult.jobId === undefined])

// 2. enabled: the job goes to the registry
const on = load(true)
const started = Date.now()
const onResult = await on.tool.execute({ prompt: 'registry path', provider: 'mock-video', background: true }, exec)
// Assert on the state instead of a stopwatch: wall-clock thresholds turned this
// into a flake when the mock provider serialises two video tasks in a row.
checks.push(['returns immediately with a DSH job id', onResult.jobId === 'genbox-video-1' && onResult.status === 'queued'])
console.log('  (the open call returned in ' + (Date.now() - started) + 'ms)')
checks.push(['registers exactly one job', on.calls.length === 1])
const spec = on.calls[0]
checks.push(['job kind is genbox-video', spec !== undefined && spec.kind === 'genbox-video'])
checks.push(['job carries a label', spec !== undefined && typeof spec.label === 'string' && spec.label.length > 0])
checks.push(['no owner when the execution has no agent', spec !== undefined && spec.owner === undefined])

const handle = spec.run()
checks.push(['run() returns { done, cancel }', typeof handle.cancel === 'function' && typeof handle.done?.then === 'function'])
const settled = await handle.done
checks.push([
  'the job settles on its own and downloads the clip',
  settled?.file !== undefined && existsSync(settled.file) && statSync(settled.file).size > 0,
])
console.log('job outcome:', JSON.stringify(settled))

let failures = 0
for (const [label, ok] of checks) {
  if (!ok) failures += 1
  console.log((ok ? '  [ok]   ' : '  [FAIL] ') + label)
}
console.log(failures === 0 ? 'OK' : 'FAILURES: ' + failures)
process.exit(failures === 0 ? 0 : 1)
