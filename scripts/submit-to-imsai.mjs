// Submit this plugin to imsai-sh/awesome-deepseek-harness-plugins (the '1024 Store' list).
//
//   node scripts/submit-to-imsai.mjs            # dry run
//   node scripts/submit-to-imsai.mjs --execute  # fork + branch + entry + pull request
//
// Their rule: exactly one new file under catalog/plugins/, named <owner>--<repo>.json, and
// nothing else in the pull request. The gate reads the target repository, finds a package.json
// with a non-empty dsh.bundle.patch, and confirms the patch path is committed at that revision.
import { execFileSync } from 'node:child_process'

const UPSTREAM = 'imsai-sh/awesome-deepseek-harness-plugins'
const PLUGIN_REPO = 'liwei9745/dsh-genbox-plugin'
const ENTRY = 'liwei9745--dsh-genbox-plugin.json'
const execute = process.argv.includes('--execute')
const entry = {
  $schema: '../schema/plugin.schema.json',
  id: PLUGIN_REPO,
  name: 'dsh-genbox-plugin',
  repository: 'https://github.com/' + PLUGIN_REPO,
  category: 'tools',
  description: {
    en: 'Adds GenBox image generation, editing, inpainting, upscaling and video tools to the agent, with a zero-key mock provider for tests.',
    zh: '把 GenBox 的生图、改图、局部重绘、超分与视频能力接入 agent，并附带零 Key 的 mock provider 供测试。',
  },
  added: '2026-10-03',
}

const token = (() => {
  const out = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' })
  const found = (out.match(/^password=(.+)$/m) ?? [])[1]
  if (!found) throw new Error('no GitHub token available')
  return found
})()

const api = async (path, options = {}) => {
  const response = await fetch('https://api.github.com' + path, {
    ...options,
    headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'dsh', Accept: 'application/vnd.github+json', ...(options.headers ?? {}) },
  })
  const text = await response.text()
  return { status: response.status, json: text === '' ? null : JSON.parse(text) }
}

const upstream = await api('/repos/' + UPSTREAM)
if (upstream.status !== 200) throw new Error('cannot read ' + UPSTREAM)
const defaultBranch = upstream.json.default_branch
const existing = await api('/repos/' + UPSTREAM + '/contents/catalog/plugins/' + ENTRY)
console.log((existing.status === 404 ? '  [ok]   ' : '  [FAIL] ') + ENTRY + ' is not already in the catalog on ' + defaultBranch)

const plugin = await api('/repos/' + PLUGIN_REPO)
const ageHours = (Date.now() - new Date(plugin.json.created_at).getTime()) / 3600000
console.log('  plugin repo is ' + ageHours.toFixed(1) + 'h old; stars ' + plugin.json.stargazers_count)
const body = JSON.stringify(entry, null, 2) + '\n'
const problems = []
if (Object.keys(entry).length !== 7) problems.push('the entry carries ' + Object.keys(entry).length + ' fields, not the 7 the schema shows')
if (!entry.description.en.endsWith('.')) problems.push('description.en must end with a period')
if (existing.status !== 404) problems.push(ENTRY + ' already exists upstream')
console.log(problems.length === 0 ? '  [ok]   entry shape matches their schema' : problems.map((p) => '  [FAIL] ' + p).join('\n'))

if (problems.length > 0) { console.log('refusing to submit'); process.exit(execute ? 1 : 0) }
if (!execute) { console.log('dry run complete: ready. Re-run with --execute.'); process.exit(0) }

const me = (await api('/user')).json.login
await api('/repos/' + UPSTREAM + '/forks', { method: 'POST', body: JSON.stringify({ default_branch_only: true }) })
const forkName = UPSTREAM.split('/')[1]
let ready = false
for (let attempt = 0; attempt < 20 && !ready; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 3000))
  ready = (await api('/repos/' + me + '/' + forkName)).status === 200
}
if (!ready) throw new Error('the fork did not appear in time')
console.log('forked as ' + me + '/' + forkName)

const branch = 'add/' + ENTRY.replace(/\.json$/, '')
const base = await api('/repos/' + me + '/' + forkName + '/git/ref/heads/' + defaultBranch)
await api('/repos/' + me + '/' + forkName + '/git/refs', { method: 'POST', body: JSON.stringify({ ref: 'refs/heads/' + branch, sha: base.json.object.sha }) })
const written = await api('/repos/' + me + '/' + forkName + '/contents/catalog/plugins/' + ENTRY, {
  method: 'PUT',
  body: JSON.stringify({ message: 'Add ' + PLUGIN_REPO, content: Buffer.from(body, 'utf8').toString('base64'), branch }),
})
if (written.status !== 201) throw new Error('cannot write the entry: HTTP ' + written.status + ' ' + JSON.stringify(written.json).slice(0, 200))
const pr = await api('/repos/' + UPSTREAM + '/pulls', {
  method: 'POST',
  body: JSON.stringify({
    title: 'Add ' + PLUGIN_REPO,
    head: me + ':' + branch,
    base: defaultBranch,
    body: ['Adds one catalogue entry: `catalog/plugins/' + ENTRY + '`, and nothing else.', '', 'The plugin declares a non-empty `dsh.bundle.patch` (`./cordis.patch.yml`, committed at the same revision) and is published to npm as `dsh-genbox-plugin`, so the store install command resolves.', '', 'It ships a zero-key mock provider, so the whole tool chain can be exercised without any API key.'].join('\n'),
  }),
})
if (pr.status !== 201) throw new Error('cannot open the pull request: HTTP ' + pr.status + ' ' + JSON.stringify(pr.json).slice(0, 300))
console.log('pull request: ' + pr.json.html_url)