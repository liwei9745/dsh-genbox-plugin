// Submit this plugin to the DSH community catalog (awesome-dsh-plugin).
//
//   node scripts/submit-to-catalog.mjs            # dry run: checks every precondition
//   node scripts/submit-to-catalog.mjs --execute  # fork + branch + file + pull request
//
// The catalog is what the in-app market (dsh-market) renders: its `dsh-plugin-catalog`
// npm package carries plugins.json, refreshed daily, and this repository feeds it. The
// guide asks for exactly one YAML file per plugin; nothing else is needed.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const UPSTREAM = 'awesome-dsh-plugin/awesome-dsh-plugin'
const PLUGIN_REPO = 'liwei9745/dsh-genbox-plugin'
const ENTRY = 'liwei9745__dsh-genbox-plugin.yml'
const MIN_AGE_MS = 24 * 60 * 60 * 1000
const execute = process.argv.includes('--execute')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entryBody = readFileSync(join(root, 'scripts', 'catalog-submission', ENTRY), 'utf8')

const token = (() => {
  const out = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' })
  const found = (out.match(/^password=(.+)$/m) ?? [])[1]
  if (!found) throw new Error('no GitHub token available (git credential fill returned none)')
  return found
})()

const api = async (path, options = {}) => {
  const response = await fetch('https://api.github.com' + path, {
    ...options,
    headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'dsh', Accept: 'application/vnd.github+json', ...(options.headers ?? {}) },
  })
  const text = await response.text()
  const json = text === '' ? null : JSON.parse(text)
  return { status: response.status, json }
}

// 1. The catalog's own bar: the repository must be at least one day old.
const repo = await api('/repos/' + PLUGIN_REPO)
if (repo.status !== 200) throw new Error('cannot read ' + PLUGIN_REPO + ': HTTP ' + repo.status)
const createdAt = new Date(repo.json.created_at)
const eligibleAt = new Date(createdAt.getTime() + MIN_AGE_MS)
const ageLabel = ((Date.now() - createdAt.getTime()) / 3600000).toFixed(1) + 'h'
console.log('plugin repo created ' + createdAt.toISOString() + ' (' + ageLabel + ' old)')
const ageOk = Date.now() >= eligibleAt.getTime()
console.log((ageOk ? '  [ok]   ' : '  [wait] ') + 'the catalog requires a 1-day-old repository'
  + (ageOk ? '' : ' - eligible from ' + eligibleAt.toISOString() + ' (' + eligibleAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + ')'))

// 2. A dsh.bundle manifest has to exist in the published package.json.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const bundleOk = pkg.dsh !== undefined && pkg.dsh.bundle !== undefined
console.log((bundleOk ? '  [ok]   ' : '  [FAIL] ') + 'package.json declares dsh.bundle (their CI fetch #2)')
const repositoryOk = String(pkg.repository?.url ?? '').includes(PLUGIN_REPO)
console.log((repositoryOk ? '  [ok]   ' : '  [FAIL] ') + 'package.json repository points at the listed repo (links npm downloads)')

// 3. The entry itself: required fields and the trailing period their linter expects.
const hasUrl = entryBody.includes('url: https://github.com/' + PLUGIN_REPO)
const hasName = entryBody.includes('name: ' + PLUGIN_REPO)
const hasCategory = /^category: [a-z]+$/m.test(entryBody)
const hasEnglish = /^\s*en: .+\.$/m.test(entryBody)
for (const [label, ok] of [['url matches the repository', hasUrl], ['name is owner/repo', hasName], ['category present', hasCategory], ['description.en ends with a period', hasEnglish]]) {
  console.log((ok ? '  [ok]   ' : '  [FAIL] ') + label)
}

const ready = ageOk && bundleOk && repositoryOk && hasUrl && hasName && hasCategory && hasEnglish
if (!ready) {
  console.log('')
  console.log(execute ? 'refusing to submit: a precondition above is not met' : 'dry run complete - not ready to submit yet')
  process.exit(execute ? 1 : 0)
}
if (!execute) {
  console.log('')
  console.log('dry run complete: everything passes. Re-run with --execute to open the pull request.')
  process.exit(0)
}

// 4. Fork, branch, file, pull request.
const me = (await api('/user')).json.login
const upstream = await api('/repos/' + UPSTREAM)
const defaultBranch = upstream.json.default_branch
console.log('forking ' + UPSTREAM + ' as ' + me + ' ...')
await api('/repos/' + UPSTREAM + '/forks', { method: 'POST', body: JSON.stringify({ default_branch_only: true }) })
let forkReady = false
for (let attempt = 0; attempt < 20 && !forkReady; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 3000))
  const fork = await api('/repos/' + me + '/awesome-dsh-plugin')
  forkReady = fork.status === 200
}
if (!forkReady) throw new Error('the fork did not appear in time')

const branch = 'add/' + ENTRY.replace(/\.yml$/, '')
const base = await api('/repos/' + me + '/awesome-dsh-plugin/git/ref/heads/' + defaultBranch)
const created = await api('/repos/' + me + '/awesome-dsh-plugin/git/refs', {
  method: 'POST',
  body: JSON.stringify({ ref: 'refs/heads/' + branch, sha: base.json.object.sha }),
})
if (created.status !== 201 && created.status !== 422) throw new Error('cannot create the branch: HTTP ' + created.status)
const written = await api('/repos/' + me + '/awesome-dsh-plugin/contents/data/plugins/' + ENTRY, {
  method: 'PUT',
  body: JSON.stringify({ message: 'Add ' + PLUGIN_REPO, content: Buffer.from(entryBody, 'utf8').toString('base64'), branch }),
})
if (written.status !== 201) throw new Error('cannot write the entry: HTTP ' + written.status + ' ' + JSON.stringify(written.json).slice(0, 200))
const pr = await api('/repos/' + UPSTREAM + '/pulls', {
  method: 'POST',
  body: JSON.stringify({
    title: 'Add ' + PLUGIN_REPO,
    head: me + ':' + branch,
    base: defaultBranch,
    body: ['Adds one entry file: `data/plugins/' + ENTRY + '`.', '', 'The plugin declares `dsh.bundle` in its package.json, is published to npm as `dsh-genbox-plugin` (repository field points back here), and ships a zero-key test bench so the whole tool chain can be exercised without any API key.'].join('\n'),
  }),
})
if (pr.status !== 201) throw new Error('cannot open the pull request: HTTP ' + pr.status + ' ' + JSON.stringify(pr.json).slice(0, 300))
console.log('pull request: ' + pr.json.html_url)