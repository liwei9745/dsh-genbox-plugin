// The most common first-run failure is that GenBox is not running. The message a
// tool throws has to say that, and a cancellation must stay a cancellation.
import { apply } from '../lib/index.js'

const registered = []
apply(
  { tools: { register: (tool) => registered.push(tool) } },
  {
    // Port 1 is reserved and nothing listens there: an immediate ECONNREFUSED.
    baseUrl: 'http://127.0.0.1:1',
    adminKey: '',
    defaultProviderId: '',
    outputDir: process.env.VERIFY_OUT_DIR ?? '.genbox-out',
    pollIntervalMs: 800,
    taskTimeoutMs: 5000,
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    videoEncoder: '',
    nativeJobs: false,
  },
)

const health = registered.find((tool) => tool.name === 'genbox_health')
const checks = []
checks.push(['the health tool is registered', health !== undefined])

let message = ''
try {
  await health.execute({}, { signal: AbortSignal.timeout(20000) })
} catch (error) {
  message = error instanceof Error ? error.message : String(error)
}
console.log('message:', message)
checks.push(['an unreachable server names the base url', message.includes('http://127.0.0.1:1')])
checks.push(['an unreachable server says it is not answering', /not answering/i.test(message)])
checks.push(['an unreachable server points at the doctor', message.includes('genbox_doctor')])
checks.push(['the raw transport error is not left bare', !/^fetch failed$/i.test(message)])

// A cancelled call is the caller's business: it must not be rewritten as a
// reachability problem (the harness relies on seeing the abort).
let aborted = false
const controller = new AbortController()
controller.abort()
try {
  await health.execute({}, { signal: controller.signal })
} catch (error) {
  const text = error instanceof Error ? error.message : String(error)
  aborted = !/not answering/i.test(text)
}
checks.push(['an abort is not reported as unreachable', aborted])

let failures = 0
for (const [label, ok] of checks) {
  if (!ok) failures += 1
  console.log((ok ? '  [ok]   ' : '  [FAIL] ') + label)
}
console.log(failures === 0 ? 'OK (' + checks.length + ' checks)' : 'FAILURES: ' + failures)
process.exit(failures === 0 ? 0 : 1)
