// One command that proves the whole plugin still works.
//
//   node scripts/verify-all.mjs
//
// Suites whose prerequisites are missing (a running GenBox, ffmpeg) are
// reported as SKIP instead of failing, so this also runs in CI.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const GENBOX = process.env.GENBOX_BASE_URL ?? 'http://127.0.0.1:8892'

async function genboxUp() {
  try {
    const response = await fetch(GENBOX + '/api/setup/status', { signal: AbortSignal.timeout(2500) })
    return response.ok
  } catch { return false }
}

/** The DSH desktop installation that carries the plugin market, when there is one. */
function marketApp() {
  const candidates = [
    process.env.DSH_APP_DIR,
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DSH NEXT', 'resources', 'app'),
  ].filter((candidate) => typeof candidate === 'string' && candidate !== '')
  return candidates.find((candidate) => existsSync(join(candidate, 'node_modules', 'dshmarket', 'lib', 'compatibility.js')))
}

/** A profile that already has this plugin installed from npm, when one is configured. */
function installedProfile() {
  const profile = process.env.DSH_PROFILE_DIR
  if (typeof profile !== 'string' || profile === '') return undefined
  return existsSync(join(profile, 'node_modules', 'dsh-genbox-plugin', 'lib', 'index.js')) ? profile : undefined
}

/** Playwright plus a chromium build: the browser measurement needs both. */
function browserUp() {
  try {
    createRequire(import.meta.url).resolve('playwright')
  } catch { return false }
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : undefined,
    process.env.HOME ? join(process.env.HOME, '.cache', 'ms-playwright') : undefined,
  ].filter((root) => typeof root === 'string' && root !== '')
  return roots.some((root) => {
    try {
      return existsSync(root) && readdirSync(root).some((entry) => entry.startsWith('chromium-'))
    } catch { return false }
  })
}

/** Is a zero-cost mock provider enabled? Generation suites must not spend a real key. */
async function mockUp() {
  try {
    const response = await fetch(GENBOX + '/api/providers', { signal: AbortSignal.timeout(2500) })
    const body = await response.json()
    return (body?.providers ?? []).some((provider) => provider.enabled === true && String(provider.id).startsWith('mock'))
  } catch { return false }
}

function ffmpegUp() {
  try {
    const probe = spawnSync(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-version'], { encoding: 'utf8' })
    return probe.status === 0
  } catch { return false }
}

const suites = [
  { name: 'presentation contract', file: 'verify-presentation.mjs', needs: [] },
  { name: 'tool reference matches code', file: 'tool-reference.mjs', needs: [] },
  { name: 'error messages', file: 'verify-errors.mjs', needs: [] },
  { name: 'http robustness', file: 'verify-http-robustness.mjs', needs: [] },
  { name: 'plugin market readiness', file: 'verify-market-readiness.mjs', needs: ['market'] },
  { name: 'installed package matches', file: 'verify-installed-package.mjs', needs: ['installed'] },
  { name: 'plugin load smoke test', file: 'verify-plugin.mjs', needs: ['genbox'] },
  { name: 'onboarding (workbench + doctor)', file: 'verify-onboarding.mjs', needs: ['genbox'] },
  { name: 'annotation overlay', file: 'verify-annotate.mjs', needs: [] },
  { name: 'local video editing', file: 'verify-video-edit.mjs', needs: ['ffmpeg'] },
  { name: 'doctor self-check', file: 'verify-doctor.mjs', needs: ['genbox'] },
  { name: 'image + video tools', file: 'verify-tools.mjs', needs: ['genbox', 'mock'] },
  { name: 'edit modes (inpaint + precision)', file: 'verify-edit-modes.mjs', needs: ['genbox', 'mock'] },
  { name: 'cutout failure surfacing', file: 'verify-cutout.mjs', needs: ['genbox'] },
  { name: 'background jobs', file: 'verify-background.mjs', needs: ['genbox', 'mock'] },
  { name: 'gallery + prompt', file: 'verify-media.mjs', needs: ['genbox'] },
  { name: 'upscale + variation strategies', file: 'verify-image-extras.mjs', needs: ['genbox', 'mock'] },
  { name: 'gallery filters', file: 'verify-gallery-filters.mjs', needs: ['genbox', 'mock'] },
  { name: 'native job registry', file: 'verify-native-jobs.mjs', needs: ['genbox', 'mock'] },
  { name: 'precision annotations', file: 'verify-precision.mjs', needs: ['genbox', 'mock'] },
  { name: 'user journey (generate → edit → video → cut)', file: 'verify-journey.mjs', needs: ['genbox', 'ffmpeg', 'mock'] },
  { name: 'browser: splitter trades space', file: 'browser/measure-splitters.cjs', needs: ['genbox', 'browser'] },
  { name: 'real provider (spends a key)', file: 'verify-real-provider.mjs', needs: ['realprovider'] },
]

const hasGenbox = await genboxUp()
const hasFfmpeg = ffmpegUp()
const hasMock = hasGenbox ? await mockUp() : false
const hasBrowser = browserUp()
const hasMarket = marketApp() !== undefined
const hasInstalled = installedProfile() !== undefined
// Opt-in: only a live key makes this suite meaningful, and it costs money.
const hasRealProvider = typeof process.env.GENBOX_REAL_PROVIDER === 'string' && process.env.GENBOX_REAL_PROVIDER !== ''
console.log(
  'prerequisites: genbox=' + (hasGenbox ? 'up' : 'down')
  + ' ffmpeg=' + (hasFfmpeg ? 'ok' : 'missing')
  + ' mock-provider=' + (hasMock ? 'ok' : 'missing')
  + ' browser=' + (hasBrowser ? 'ok' : 'missing')
  + ' market=' + (hasMarket ? 'ok' : 'missing')
  + ' installed=' + (hasInstalled ? 'ok' : 'set DSH_PROFILE_DIR')
  + ' real-provider=' + (hasRealProvider ? 'ok' : 'off (set GENBOX_REAL_PROVIDER)'),
)

const results = []
for (const suite of suites) {
  const missing = suite.needs.filter((need) => (need === 'genbox' && !hasGenbox)
    || (need === 'ffmpeg' && !hasFfmpeg)
    || (need === 'mock' && !hasMock)
    || (need === 'browser' && !hasBrowser)
    || (need === 'market' && !hasMarket)
    || (need === 'installed' && !hasInstalled)
    || (need === 'realprovider' && !hasRealProvider))
  if (missing.length > 0) {
    results.push({ ...suite, status: 'SKIP', detail: 'needs ' + missing.join(', ') })
    continue
  }
  const started = Date.now()
  const run = spawnSync(process.execPath, [join(import.meta.dirname, suite.file)], { encoding: 'utf8' })
  // The verdict is the last line a suite writes to stdout: stderr can carry
  // warnings (a fallback path, a skipped optional step) that would otherwise
  // become the headline in the summary.
  const lastLine = (text) => {
    const lines = String(text ?? '').trim().split('\n').filter((line) => line.trim() !== '')
    return lines.length > 0 ? lines[lines.length - 1].slice(0, 90) : ''
  }
  const verdict = lastLine(run.stdout) || lastLine(run.stderr) || '(no output)'
  // A failing suite has to explain itself: keep its stderr for the summary.
  const diagnostic = run.status === 0
    ? ''
    : String(run.stderr ?? '').trim().split('\n').filter((line) => line.trim() !== '').slice(-6).join(' | ')
  results.push({ ...suite, status: run.status === 0 ? 'PASS' : 'FAIL', detail: verdict, diagnostic, ms: Date.now() - started })
  process.stdout.write((run.status === 0 ? '.' : 'F'))
}
console.log('')
console.log('')
let failed = 0
const width = Math.max(...results.map((result) => result.name.length))
for (const result of results) {
  if (result.status === 'FAIL') failed += 1
  const pad = ' '.repeat(width - result.name.length)
  const timing = result.ms === undefined ? '' : (' (' + result.ms + 'ms)')
  console.log('  ' + result.status.padEnd(5) + result.name + pad + '  ' + result.detail + timing)
  if (result.diagnostic !== undefined && result.diagnostic !== '') {
    console.log('        why: ' + result.diagnostic.slice(0, 600))
  }
}
console.log('')
console.log(failed === 0 ? 'all runnable suites passed' : failed + ' suite(s) failed')
process.exit(failed === 0 ? 0 : 1)
