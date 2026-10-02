// Confirm what is actually on the registry once a release is published.
//
//   node scripts/verify-published.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const NAME = 'dsh-genbox-plugin'
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function npm(args) {
  try {
    return { ok: true, out: String(execFileSync(NPM, args, { encoding: 'utf8', stdio: 'pipe', shell: true })).trim() }
  } catch (error) {
    const detail = (error.stderr || error.stdout || error.message || '').toString().trim()
    return { ok: false, out: detail.split('\n')[0] }
  }
}

const checks = []
const version = npm(['view', NAME, 'version'])
const published = version.ok && version.out !== ''
checks.push({ label: NAME + ' exists on the registry', ok: published, detail: published ? version.out : 'not published yet' })

if (published) {
  checks.push({ label: 'registry version matches package.json', ok: version.out === pkg.version, detail: version.out + ' vs ' + pkg.version })

  const engines = npm(['view', NAME, 'engines.dsh'])
  checks.push({ label: 'declares engines.dsh', ok: engines.ok && engines.out !== '', detail: engines.out || '(missing)' })

  const keywords = npm(['view', NAME, 'keywords'])
  checks.push({ label: 'dsh-plugin keyword present', ok: keywords.ok && keywords.out.includes('dsh-plugin'), detail: keywords.out.slice(0, 100) })

  const dist = npm(['view', NAME, 'dist.tarball'])
  checks.push({ label: 'dist.tarball advertised', ok: dist.ok && dist.out.startsWith('http'), detail: dist.out })

  const pack = npm(['pack', NAME + '@' + version.out, '--dry-run', '--json'])
  let files = []
  if (pack.ok) {
    const start = pack.out.indexOf('[')
    const end = pack.out.lastIndexOf(']')
    try {
      if (start !== -1 && end > start) files = JSON.parse(pack.out.slice(start, end + 1))[0].files.map((f) => f.path)
    } catch { files = [] }
  }
  const hasLib = files.includes('lib/index.js')
  const hasPatch = files.includes('cordis.patch.yml')
  checks.push({ label: 'published tarball ships lib/index.js + cordis.patch.yml', ok: hasLib && hasPatch, detail: files.join(', ') || pack.out })
}

let failures = 0
for (const check of checks) {
  if (!check.ok) failures += 1
  console.log((check.ok ? '  [ok]   ' : '  [FAIL] ') + check.label + ' -> ' + check.detail)
}
console.log(failures === 0 ? (published ? 'published package verified' : 'nothing published yet') : 'FAILURES: ' + failures)
process.exit(failures === 0 ? 0 : 1)
