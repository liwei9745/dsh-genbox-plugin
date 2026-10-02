// What a freshly installed user meets: a way to reach the GenBox workbench and a
// first-run checklist. Both are agent-callable, so they have to hold their shape.
import { apply } from '../lib/index.js'

const registered = []
apply(
  { tools: { register: (tool) => registered.push(tool) } },
  {
    baseUrl: 'http://127.0.0.1:8892',
    adminKey: '',
    defaultProviderId: '',
    outputDir: process.env.VERIFY_OUT_DIR ?? '.genbox-out',
    pollIntervalMs: 800,
    taskTimeoutMs: 60000,
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    videoEncoder: '',
    nativeJobs: false,
  },
)

const workbench = registered.find((tool) => tool.name === 'genbox_open_workbench')
const doctor = registered.find((tool) => tool.name === 'genbox_doctor')
const exec = { signal: AbortSignal.timeout(60000) }

const checks = []
checks.push(['both onboarding tools are registered', workbench !== undefined && doctor !== undefined])

const root = await workbench.execute({ open: false }, exec)
checks.push(['workbench reports the server as running', root.running === true])
checks.push(['workbench url is the GenBox root', root.url === 'http://127.0.0.1:8892/'])
checks.push(['open=false never launches a browser', root.opened === false])
checks.push(['workbench names the output directory', typeof root.outputDir === 'string' && root.outputDir.length > 0])

const gallery = await workbench.execute({ page: 'gallery', open: false }, exec)
checks.push(['page selection is honoured', gallery.url === 'http://127.0.0.1:8892/gallery/'])

const call = workbench.presentCall({ page: 'settings' })
checks.push(['workbench has a render intent', call?.card === 'generic' && call.title.includes('settings')])

const report = await doctor.execute({}, exec)
checks.push(['doctor returns a next-steps checklist', Array.isArray(report.nextSteps) && report.nextSteps.length >= 3])
checks.push(['the checklist points at the workbench', report.nextSteps.some((step) => step.includes('http://127.0.0.1:8892'))])
checks.push(['the checklist keeps the existing checks', Array.isArray(report.checks) && report.checks.length >= 4])

const rendered = doctor.output.render({}, report)[0].text
checks.push(['doctor renders the checklist', rendered.includes('next steps:') && rendered.includes('genbox_open_workbench')])

let failures = 0
for (const [label, ok] of checks) {
  if (!ok) failures += 1
  console.log((ok ? '  [ok]   ' : '  [FAIL] ') + label)
}
console.log('workbench url:', root.url, '| outputDir:', root.outputDir)
console.log(failures === 0 ? 'OK (' + checks.length + ' checks)' : 'FAILURES: ' + failures)
process.exit(failures === 0 ? 0 : 1)
