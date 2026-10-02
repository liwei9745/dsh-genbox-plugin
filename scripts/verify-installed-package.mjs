// Release check: does the package installed in a profile expose exactly what this
// repository builds? Catches a stale profile copy, a wrong "files" list, or a build
// that regressed between the local lib/ and the published tarball.
//
//   DSH_PROFILE_DIR=C:\Users\<you>\.dsh\profiles\<profile> node scripts/verify-installed-package.mjs
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const profile = process.env.DSH_PROFILE_DIR
if (profile === undefined || profile.trim() === '') {
  console.log('SKIP set DSH_PROFILE_DIR to a profile that has dsh-genbox-plugin installed')
  process.exit(0)
}

const installedDir = join(resolve(profile), 'node_modules', 'dsh-genbox-plugin')
if (!existsSync(installedDir)) {
  console.log('SKIP ' + installedDir + ' does not exist')
  process.exit(0)
}

const config = {
  baseUrl: process.env.GENBOX_BASE_URL ?? 'http://127.0.0.1:8892',
  adminKey: '',
  defaultProviderId: '',
  outputDir: process.env.VERIFY_OUT_DIR ?? '.genbox-out',
  pollIntervalMs: 1000,
  taskTimeoutMs: 60000,
  ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
  videoEncoder: '',
  nativeJobs: false,
}

/** Register a build into a stub host and return the tool names it exposes. */
async function toolNamesOf(entry) {
  const module = await import(pathToFileURL(entry).href)
  const registered = []
  module.apply({ tools: { register: (tool) => registered.push(tool.name) } }, config)
  return registered.sort()
}

const installed = await toolNamesOf(join(installedDir, 'lib', 'index.js'))
const local = await toolNamesOf(resolve(import.meta.dirname, '..', 'lib', 'index.js'))
const installedVersion = JSON.parse(readFileSync(join(installedDir, 'package.json'), 'utf8')).version

const checks = []
checks.push(['the installed build registers tools', installed.length > 0])
checks.push(['installed and local tool sets match', installed.join(',') === local.join(',')])
checks.push(['the onboarding tool ships', installed.includes('genbox_open_workbench')])
checks.push(['the local build registers the same count', installed.length === local.length])

console.log('installed version: ' + installedVersion + ' (' + installed.length + ' tools)')
console.log('  ' + installed.join(', '))
if (installed.join(',') !== local.join(',')) {
  const missing = local.filter((name) => !installed.includes(name))
  const extra = installed.filter((name) => !local.includes(name))
  console.log('  only in the repo build: ' + (missing.join(', ') || '(none)'))
  console.log('  only in the installed one: ' + (extra.join(', ') || '(none)'))
}

let failures = 0
for (const [label, ok] of checks) {
  if (!ok) failures += 1
  console.log((ok ? '  [ok]   ' : '  [FAIL] ') + label)
}
console.log(failures === 0 ? 'OK (' + checks.length + ' checks)' : 'FAILURES: ' + failures)
process.exit(failures === 0 ? 0 : 1)
