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
const generate = registered.find((tool) => tool.name === 'genbox_image_generate')
const providers = registered.find((tool) => tool.name === 'genbox_providers')
const exec = { signal: AbortSignal.timeout(120000) }
const call = (args) => gallery.execute({ limit: 50, ...args }, exec)

// The filter checks need a fixture they own: an earlier version queried a hardcoded
// token from an old run, which ages out of the "most recent 50" window and turned the
// check into a false failure.
const enabled = (await providers.execute({ enabledOnly: true }, exec)).providers ?? []
const imageProvider = enabled.find((provider) => (provider.type ?? 'image') === 'image' && String(provider.id).startsWith('mock'))
if (imageProvider === undefined) {
  console.log('SKIP no enabled mock image provider: this suite never spends a real key '
    + '(enable mock-openai in GenBox, docs/local-dev.md section 4)')
  process.exit(0)
}
const token = 'zebracrossing' + Date.now().toString(36)
const fixture = await generate.execute(
  { prompt: 'a ' + token + ' crossing a river at dawn', providers: [imageProvider.id], size: '512x512' },
  exec,
)
if (fixture.status !== 'completed') {
  console.log('SKIP could not build the gallery fixture (' + JSON.stringify(fixture).slice(0, 160) + ')')
  process.exit(0)
}
const providerModel = fixture.images?.[0]?.providerId ?? imageProvider.id

const all = await call({})
const images = await call({ type: 'image' })
const videos = await call({ type: 'video' })
const byModel = await call({ model: providerModel })
const byQuery = await call({ query: token })
const future = await call({ since: '2999-01-01' })
const past = await call({ since: '2000-01-01' })

console.log('all:', all.total, '| images:', images.total, '| videos:', videos.total)
console.log('model=' + providerModel + ':', byModel.total, '| query=' + token + ':', byQuery.total)
console.log('since=2999:', future.total, '| since=2000:', past.total)

const checks = []
checks.push(['library is not empty', all.total > 0])
checks.push(['type filter partitions the set', images.total + videos.total === all.total])
checks.push(['every video item is a video', videos.items.every((item) => item.type === 'video')])
checks.push(['model filter is exact and non-empty', byModel.total > 0
  && byModel.items.every((item) => (item.model ?? '').toLowerCase() === providerModel.toLowerCase())])
checks.push(['query narrows and matches', byQuery.total > 0 && byQuery.total <= all.total
  && byQuery.items.every((item) => JSON.stringify(item).toLowerCase().includes(token))])
checks.push(['future date returns nothing', future.total === 0])
checks.push(['historical date returns everything', past.total === all.total])

let failures = 0
for (const [label, ok] of checks) {
  if (!ok) failures += 1
  console.log((ok ? '  [ok]   ' : '  [FAIL] ') + label)
}
console.log(failures === 0 ? 'OK (' + checks.length + ' checks, fixture ' + token + ')' : 'FAILURES: ' + failures)
process.exitCode = failures === 0 ? 0 : 1
