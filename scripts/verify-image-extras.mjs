// genbox_image_generate's upscaleTo and genbox_image_variations' two strategies.
// GenBox parses upscale_to with int(), so a "WxH" value used to crash the upscaler and
// silently keep the original size; the tool now reduces it to the longest edge.
import { existsSync, statSync } from 'node:fs'
import { apply, readImageSize } from '../lib/index.js'

const registered = []
apply(
  { tools: { register: (tool) => registered.push(tool) } },
  {
    baseUrl: process.env.GENBOX_BASE_URL ?? 'http://127.0.0.1:8892',
    adminKey: '',
    defaultProviderId: '',
    outputDir: process.env.VERIFY_OUT_DIR ?? '.genbox-out/image-extras',
    pollIntervalMs: 800,
    taskTimeoutMs: 120000,
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    videoEncoder: '',
  },
)

const tool = (name) => registered.find((entry) => entry.name === name)
const exec = { signal: AbortSignal.timeout(120000) }
const checks = []
const check = (label, ok) => checks.push([label, ok])
const present = (file) => typeof file === 'string' && existsSync(file) && statSync(file).size > 0
const dimensions = async (file) => {
  const size = await readImageSize(file)
  return size.width + 'x' + size.height
}

const providersTool = await tool('genbox_providers').execute({ enabledOnly: true }, exec)
const imageProviders = (providersTool.providers ?? []).filter((provider) => (provider.type ?? 'image') === 'image')
const mock = imageProviders.find((provider) => String(provider.id).startsWith('mock'))
if (mock === undefined) {
  console.log('SKIP no enabled mock image provider: this suite never spends a real key '
    + '(enable mock-openai in GenBox, docs/local-dev.md section 4)')
  process.exit(0)
}

// 1. A "WxH" upscale target has to reach GenBox as its longest edge.
const boxed = await tool('genbox_image_generate').execute(
  { prompt: 'an upscale target written as WxH', providers: [mock.id], size: '512x512', upscaleTo: '1024x1024' },
  exec,
)
const boxedFile = boxed.images?.[0]?.file
check('upscaleTo "WxH" completes and produces a file', boxed.status === 'completed' && present(boxedFile))
check('the WxH target really grew the image to 1024x1024', present(boxedFile) && (await dimensions(boxedFile)) === '1024x1024')
console.log('upscaleTo=1024x1024 ->', boxed.status, boxedFile, present(boxedFile) ? await dimensions(boxedFile) : '')

// 2. A bare integer keeps working.
const bare = await tool('genbox_image_generate').execute(
  { prompt: 'an upscale target written as an integer', providers: [mock.id], size: '512x512', upscaleTo: '1024' },
  exec,
)
const bareFile = bare.images?.[0]?.file
check('upscaleTo "1024" grew the image to 1024x1024', present(bareFile) && (await dimensions(bareFile)) === '1024x1024')

// 3. Prompt variations: N candidates repainted through mode=i2i.
const promptVariations = await tool('genbox_image_variations').execute(
  { image: boxedFile, provider: mock.id, strategy: 'prompt', n: 2 },
  exec,
)
const promptFiles = promptVariations.files ?? []
check('prompt variations return two distinct files',
  promptFiles.length === 2 && promptFiles.every(present) && new Set(promptFiles).size === 2)
check('prompt variations report their strategy', promptVariations.strategy === 'prompt')
console.log('variations prompt n=2 ->', promptFiles.length, 'files')

// 4. Native variations still work where the gateway implements the legacy contract.
const nativeVariations = await tool('genbox_image_variations').execute(
  { image: boxedFile, provider: mock.id, strategy: 'native', n: 1 },
  exec,
)
check('native variations still return a file', (nativeVariations.files ?? []).every(present) && nativeVariations.files.length >= 1)
check('native variations report their strategy', nativeVariations.strategy === 'native')

// 5. auto prefers the native path when it is available.
const autoVariations = await tool('genbox_image_variations').execute(
  { image: boxedFile, provider: mock.id, strategy: 'auto', n: 1 },
  exec,
)
check('auto picks native when the provider supports it', autoVariations.strategy === 'native' && (autoVariations.files ?? []).length >= 1)
console.log('variations auto ->', autoVariations.strategy)

// 6. An edit honours the same upscale target.
const edited = await tool('genbox_image_edit').execute(
  {
    prompt: 'make it dusk, then grow it',
    image: bareFile,
    mode: 'i2i',
    providers: [mock.id],
    size: '512x512',
    upscaleTo: '1024x1024',
  },
  exec,
)
const editedFile = edited.images?.[0]?.file
check('an i2i edit honours the WxH upscale target',
  edited.status === 'completed' && present(editedFile) && (await dimensions(editedFile)) === '1024x1024')
console.log('edit upscaleTo=1024x1024 ->', edited.status, present(editedFile) ? await dimensions(editedFile) : '(no file)')

// 7. precision_edit refuses it with our own reason instead of a raw GenBox 422.
let precisionRefusal = ''
try {
  await tool('genbox_image_edit').execute(
    {
      prompt: 'widen the scene',
      image: bareFile,
      mode: 'precision_edit',
      precisionTargetSize: '768x512',
      upscaleTo: '1024',
      providers: [mock.id],
    },
    exec,
  )
} catch (error) {
  precisionRefusal = error instanceof Error ? error.message : String(error)
}
check('precision_edit refuses upscaleTo with our own reason',
  /precision_upscale_not_allowed/.test(precisionRefusal) && /genbox_image_upscale/.test(precisionRefusal))
console.log('precision_edit + upscaleTo ->', precisionRefusal.slice(0, 140))

let failures = 0
for (const [label, ok] of checks) {
  if (!ok) failures += 1
  console.log((ok ? '  [ok]   ' : '  [FAIL] ') + label)
}
console.log(failures === 0 ? 'OK (' + checks.length + ' checks)' : 'FAILURES: ' + failures)
process.exitCode = failures === 0 ? 0 : 1
