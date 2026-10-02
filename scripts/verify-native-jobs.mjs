// The experimental ctx.jobs integration, at three levels of proof:
//
//   1. a stub registry proves the call shape we send;
//   2. the REAL registry from the installed DSH application, with no job controller,
//      proves the tool degrades to the GenBox task handle instead of failing the call
//      (that refusal is real: "no job controller serves this agent");
//   3. the real registry WITH an attached controller proves a real job id, a real
//      registration, settlement and the downloaded file.
//
// Levels 2 and 3 need the DSH application on this machine; they are reported as
// skipped otherwise, and the suite still runs in CI.
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { apply } from '../lib/index.js'

const config = {
  baseUrl: process.env.GENBOX_BASE_URL ?? 'http://127.0.0.1:8892',
  adminKey: '',
  defaultProviderId: '',
  outputDir: process.env.VERIFY_OUT_DIR ?? '.genbox-out/native-jobs',
  pollIntervalMs: 800,
  taskTimeoutMs: 180000,
  ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
  videoEncoder: '',
}

const exec = { signal: AbortSignal.timeout(180000) }
const checks = []
const check = (label, ok) => checks.push([label, ok])

function toolFrom(ctx) {
  const registered = []
  ctx.tools = { register: (tool) => registered.push(tool) }
  apply(ctx, { ...config, nativeJobs: true })
  return registered.find((tool) => tool.name === 'genbox_video_generate')
}

// --- 1. stub registry: the shape we send -------------------------------------
const stubCalls = []
const stubTool = toolFrom({
  jobs: {
    start(spec) {
      stubCalls.push(spec)
      return 'genbox-video-stub-1'
    },
  },
})
const stubResult = await stubTool.execute({ prompt: 'stub registry path', provider: 'mock-video', background: true }, exec)
check('stub: the tool hands the job over and returns its id', stubResult.jobId === 'genbox-video-stub-1' && stubResult.status === 'queued')
check('stub: exactly one registration with our kind', stubCalls.length === 1 && stubCalls[0].kind === 'genbox-video')
check('stub: run() returns { done, cancel }', typeof stubCalls[0].run().cancel === 'function')

// --- real registry from the installed application ----------------------------
function appDir() {
  const candidates = [
    process.env.DSH_APP_DIR,
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DSH NEXT', 'resources', 'app'),
  ].filter((candidate) => typeof candidate === 'string' && candidate !== '')
  return candidates.find((candidate) => existsSync(join(candidate, 'node_modules', '@deepseek-ai', 'dsh-jobs-local', 'lib', 'index.js')))
}

const app = appDir()
if (app === undefined) {
  console.log('  [skip] levels 2-3: no DSH application found (set DSH_APP_DIR)')
} else {
  const url = (relative) => pathToFileURL(join(app, 'node_modules', '@deepseek-ai', relative)).href
  const { Context } = await import(url('cordis/lib/index.js'))
  const jobsLocal = await import(url('dsh-jobs-local/lib/index.js'))

  // 2. no controller attached: the registry refuses, the tool must not.
  const bare = new Context()
  await bare.plugin(jobsLocal.default ?? jobsLocal)
  await new Promise((resolve) => setTimeout(resolve, 300))
  const bareTool = toolFrom(bare)
  let bareResult
  let bareError
  try {
    bareResult = await bareTool.execute({ prompt: 'real registry without a controller', provider: 'mock-video', background: true }, exec)
  } catch (error) {
    bareError = error
  }
  check('real registry, no controller: the call does not throw', bareError === undefined)
  check('real registry, no controller: falls back to the GenBox task handle',
    bareResult !== undefined && bareResult.jobId === undefined && bareResult.background === true && typeof bareResult.taskId === 'string')
  check('real registry, no controller: the registry really did refuse', bare.jobs.servesOwner(undefined) === false)

  // 3. controller attached: a real job, real settlement, real file.
  const wired = new Context()
  await wired.plugin(jobsLocal.default ?? jobsLocal)
  await new Promise((resolve) => setTimeout(resolve, 300))
  wired.jobs.attachController('genbox-verification')
  await new Promise((resolve) => setTimeout(resolve, 100))
  const wiredTool = toolFrom(wired)
  // The registry view carries lifecycle fields, not the promise value, so the
  // artifact is asserted on disk: one new non-empty clip in the output directory.
  mkdirSync(config.outputDir, { recursive: true })
  const filesBefore = new Set(readdirSync(config.outputDir))
  const wiredResult = await wiredTool.execute({ prompt: 'real registry with a controller', provider: 'mock-video', background: true }, exec)
  const jobId = wiredResult.jobId
  check('real registry with a controller: the owner is served', wired.jobs.servesOwner(undefined) === true)
  check('real registry with a controller: a real job id comes back', typeof jobId === 'string' && jobId !== '')
  if (typeof jobId === 'string') {
    const settled = await wired.jobs.wait(jobId, 180000)
    const status = settled?.status ?? settled?.state ?? ''
    const produced = readdirSync(config.outputDir)
      .filter((name) => !filesBefore.has(name))
      .map((name) => join(config.outputDir, name))
      .filter((file) => existsSync(file) && statSync(file).size > 0)
    check('real registry: the job settles as completed', String(status) === 'completed')
    check('real registry: the job wrote a new clip to disk', produced.length > 0)
    console.log('  real job view: ' + JSON.stringify(settled).slice(0, 220))
    console.log('  produced: ' + produced.join(', '))
  }
}

let failures = 0
for (const [label, ok] of checks) {
  if (!ok) failures += 1
  console.log((ok ? '  [ok]   ' : '  [FAIL] ') + label)
}
console.log(failures === 0 ? 'OK (' + checks.length + ' checks)' : 'FAILURES: ' + failures)
process.exit(failures === 0 ? 0 : 1)
