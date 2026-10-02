// genbox_gallery filters: type / model / query / since must narrow the result set
// consistently against the live GenBox media library.
import { apply } from '../lib/index.js'

const registered = []
apply(
  { tools: { register: (tool) => registered.push(tool) } },
  {
    baseUrl: process.env.GENBOX_BASE_URL ?? 'http://127.0.0.1:8892',
    adminKey: '',
    defaultProviderId: '',
    outputDir: process.env.VERIFY_OUT_DIR ?? '.genbox-out',
    pollIntervalMs: 800,
    taskTimeoutMs: 60000,
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    videoEncoder: '',
  },
)
const gallery = registered.find((tool) => tool.name === 'genbox_gallery')
const exec = { signal: AbortSignal.timeout(60000) }
const call = (args) => gallery.execute({ limit: 50, ...args }, exec)

const all = await call({})
const images = await call({ type: 'image' })
const videos = await call({ type: 'video' })
const byModel = await call({ model: 'mock-openai' })
const byQuery = await call({ query: 'red_cube' })
const future = await call({ since: '2999-01-01' })
const past = await call({ since: '2000-01-01' })

console.log('all:', all.total, '| images:', images.total, '| videos:', videos.total)
console.log('model=mock-openai:', byModel.total, '| query=red_cube:', byQuery.total)
console.log('since=2999:', future.total, '| since=2000:', past.total)

const checks = []
checks.push(['library is not empty', all.total > 0])
checks.push(['type filter partitions the set', images.total + videos.total === all.total])
checks.push(['every video item is a video', videos.items.every((item) => item.type === 'video')])
checks.push(['model filter is exact and non-empty', byModel.total > 0
  && byModel.items.every((item) => (item.model ?? '').toLowerCase() === 'mock-openai')])
checks.push(['query narrows and matches', byQuery.total > 0 && byQuery.total <= all.total
  && byQuery.items.every((item) => JSON.stringify(item).toLowerCase().includes('red_cube'))])
checks.push(['future date returns nothing', future.total === 0])
checks.push(['historical date returns everything', past.total === all.total])

let failures = 0
for (const [label, ok] of checks) {
  if (!ok) failures += 1
  console.log((ok ? '  [ok]   ' : '  [FAIL] ') + label)
}
console.log(failures === 0 ? 'OK' : 'FAILURES: ' + failures)
process.exit(failures === 0 ? 0 : 1)
