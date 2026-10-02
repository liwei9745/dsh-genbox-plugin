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

function ffmpegUp() {
  try {
    const probe = spawnSync(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-version'], { encoding: 'utf8' })
    return probe.status === 0
  } catch { return false }
}

const suites = [
  { name: 'presentation contract', file: 'verify-presentation.mjs', needs: [] },
  { name: 'error messages', file: 'verify-errors.mjs', needs: [] },
  { name: 'onboarding (workbench + doctor)', file: 'verify-onboarding.mjs', needs: ['genbox'] },
  { name: 'annotation overlay', file: 'verify-annotate.mjs', needs: [] },
  { name: 'local video editing', file: 'verify-video-edit.mjs', needs: ['ffmpeg'] },
  { name: 'doctor self-check', file: 'verify-doctor.mjs', needs: ['genbox'] },
  { name: 'image + video tools', file: 'verify-tools.mjs', needs: ['genbox'] },
  { name: 'background jobs', file: 'verify-background.mjs', needs: ['genbox'] },
  { name: 'gallery + prompt', file: 'verify-media.mjs', needs: ['genbox'] },
  { name: 'gallery filters', file: 'verify-gallery-filters.mjs', needs: ['genbox'] },
  { name: 'native job registry', file: 'verify-native-jobs.mjs', needs: ['genbox'] },
  { name: 'precision annotations', file: 'verify-precision.mjs', needs: ['genbox'] },
]

const hasGenbox = await genboxUp()
const hasFfmpeg = ffmpegUp()
console.log('prerequisites: genbox=' + (hasGenbox ? 'up' : 'down') + ' ffmpeg=' + (hasFfmpeg ? 'ok' : 'missing'))

const results = []
for (const suite of suites) {
  const missing = suite.needs.filter((need) => (need === 'genbox' && !hasGenbox) || (need === 'ffmpeg' && !hasFfmpeg))
  if (missing.length > 0) {
    results.push({ ...suite, status: 'SKIP', detail: 'needs ' + missing.join(', ') })
    continue
  }
  const started = Date.now()
  const run = spawnSync(process.execPath, [join(import.meta.dirname, suite.file)], { encoding: 'utf8' })
  const output = (run.stdout ?? '') + (run.stderr ?? '')
  const lines = output.trim().split('\n').filter((line) => line.trim() !== '')
  const verdict = lines.length > 0 ? lines[lines.length - 1].slice(0, 90) : '(no output)'
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
