// One command that proves the whole plugin still works.
//
//   node scripts/verify-all.mjs
//
// Suites whose prerequisites are missing (a running GenBox, ffmpeg) are
// reported as SKIP instead of failing, so this also runs in CI.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
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
  { name: 'image + video tools', file: 'verify-tools.mjs', needs: ['genbox'] },
  { name: 'edit modes (inpaint + precision)', file: 'verify-edit-modes.mjs', needs: ['genbox'] },
  { name: 'cutout failure surfacing', file: 'verify-cutout.mjs', needs: ['genbox'] },
  { name: 'background jobs', file: 'verify-background.mjs', needs: ['genbox'] },
  { name: 'gallery + prompt', file: 'verify-media.mjs', needs: ['genbox'] },
  { name: 'gallery filters', file: 'verify-gallery-filters.mjs', needs: ['genbox'] },
  { name: 'native job registry', file: 'verify-native-jobs.mjs', needs: ['genbox'] },
  { name: 'precision annotations', file: 'verify-precision.mjs', needs: ['genbox'] },
]

const hasGenbox = await genboxUp()
const hasFfmpeg = ffmpegUp()
const hasMarket = marketApp() !== undefined
const hasInstalled = installedProfile() !== undefined
console.log(
  'prerequisites: genbox=' + (hasGenbox ? 'up' : 'down')
  + ' ffmpeg=' + (hasFfmpeg ? 'ok' : 'missing')
  + ' market=' + (hasMarket ? 'ok' : 'missing')
  + ' installed=' + (hasInstalled ? 'ok' : 'set DSH_PROFILE_DIR'),
)

const results = []
for (const suite of suites) {
  const missing = suite.needs.filter((need) => (need === 'genbox' && !hasGenbox)
    || (need === 'ffmpeg' && !hasFfmpeg)
    || (need === 'market' && !hasMarket)
    || (need === 'installed' && !hasInstalled))
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
  results.push({ ...suite, status: run.status === 0 ? 'PASS' : 'FAIL', detail: verdict, ms: Date.now() - started })
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
}
console.log('')
console.log(failed === 0 ? 'all runnable suites passed' : failed + ' suite(s) failed')
process.exit(failed === 0 ? 0 : 1)
