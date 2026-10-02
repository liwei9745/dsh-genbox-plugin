// Will the DSH plugin market accept this package?
//
// The market does not just look at npm metadata: it derives a host-compatibility
// verdict from the manifest and runs a host-contract preflight over the profile it
// is about to install into. This script runs the market's OWN modules against this
// repository's package.json, so the answer is the one the market would give.
//
//   node scripts/verify-market-readiness.mjs
//   DSH_APP_DIR=<dsh app dir> DSH_PROFILE_DIR=<profile dir> node scripts/verify-market-readiness.mjs
//
// Exits 0 with "SKIP" when no DSH installation is present (CI), so it can be part
// of the regular suite.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function appDir() {
  const candidates = [
    process.env.DSH_APP_DIR,
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DSH NEXT', 'resources', 'app'),
    join(process.env.PROGRAMFILES ?? '', 'DSH NEXT', 'resources', 'app'),
    '/Applications/DSH NEXT.app/Contents/Resources/app',
  ].filter((candidate) => candidate !== '' && candidate !== undefined)
  return candidates.find((candidate) => existsSync(join(candidate, 'node_modules', 'dshmarket', 'lib', 'compatibility.js')))
}

const app = appDir()
if (app === undefined) {
  console.log('SKIP no DSH installation with dshmarket found (set DSH_APP_DIR)')
  process.exit(0)
}

const checks = []
const fail = (label, detail) => checks.push({ ok: false, label, detail })
const pass = (label, detail) => checks.push({ ok: true, label, detail })

// 1. The market refuses a bundle without a patch file, because the profile would
//    fail to boot: "bundle declares no dsh.bundle.patch".
const patchPath = pkg.dsh?.bundle?.patch
pass('declares dsh.bundle.patch', String(patchPath))
if (patchPath !== undefined) {
  const resolved = new URL('../' + String(patchPath).replace(/^\.\//, ''), import.meta.url)
  if (existsSync(resolved)) pass('the declared patch file exists', String(patchPath))
  else fail('the declared patch file exists', String(patchPath) + ' is missing')
} else {
  fail('declares dsh.bundle.patch', 'missing - the market would refuse the bundle')
}

// 2. Discovery-time host compatibility, computed by the market's own module.
const discovery = await import('file:///' + join(app, 'node_modules', 'dshmarket', 'lib', 'discovery-compatibility.js').replace(/\\/g, '/'))
const hostManifest = JSON.parse(readFileSync(join(app, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'))
const hostPackages = new Set(readdirSync(join(app, 'node_modules', '@deepseek-ai')))
const facts = discovery.manifestFacts(pkg)
const verdict = discovery.deriveHostCompatibility(facts, hostManifest.version, hostPackages)
const verdictDetail = 'host ' + hostManifest.version + ' -> ' + verdict.status + ' (requirement ' + String(verdict.requirement) + ')'
if (verdict.status === 'incompatible') fail('host compatibility', verdictDetail)
else pass('host compatibility', verdictDetail)

// 3. The install-time host-contract preflight over a profile that already has the
//    plugin installed from npm.
const profile = process.env.DSH_PROFILE_DIR
if (profile === undefined || !existsSync(profile)) {
  pass('profile preflight', 'skipped (set DSH_PROFILE_DIR to a profile with the plugin installed)')
} else {
  const compatibility = await import('file:///' + join(app, 'node_modules', 'dshmarket', 'lib', 'compatibility.js').replace(/\\/g, '/'))
  const assessment = await compatibility.assessCompatibility(profile, {})
  const detail = 'risks=' + assessment.risks.length + ' warnings=' + assessment.warnings.length + ' duplicates=' + assessment.duplicateNames.length
  if (assessment.risks.length > 0) fail('profile preflight', detail + ' :: ' + JSON.stringify(assessment.risks).slice(0, 300))
  else pass('profile preflight', detail)
}

let failures = 0
for (const check of checks) {
  if (!check.ok) failures += 1
  console.log((check.ok ? '  [ok]   ' : '  [FAIL] ') + check.label + ': ' + check.detail)
}
console.log('market app: ' + app)
console.log(failures === 0 ? 'OK (' + checks.length + ' checks)' : 'FAILURES: ' + failures)
process.exit(failures === 0 ? 0 : 1)
