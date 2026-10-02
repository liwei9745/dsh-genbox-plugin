// One-command release for dsh-genbox-plugin.
//
//   node scripts/publish.mjs             # preflight only, changes nothing
//   node scripts/publish.mjs --execute   # create the GitHub repo, push, publish to npm
//
// The script never stores credentials; it uses whatever 'gh' and 'npm' are
// already logged in with.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const NAME = 'dsh-genbox-plugin'
const TOPICS = ['dsh-plugin', 'deepseek-harness', 'genbox', 'cordis-plugin', 'image-generation', 'video-generation']
const DESCRIPTION = 'DeepSeek Harness tools for GenBox: image generation/editing and video generation through a local GenBox server.'
const execute = process.argv.includes('--execute')
// Windows ships npm as a .cmd shim, which execFileSync cannot launch without the extension.
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'

// Node refuses to spawn .cmd shims without a shell, so every call goes through one.
function quote(arg) {
  const value = String(arg)
  return /[\s"]/.test(value) ? '"' + value.replace(/"/g, '\\"') + '"' : value
}

function run(command, args) {
  execFileSync(command, args.map(quote), { encoding: 'utf8', stdio: 'inherit', shell: true })
}

function tryRun(command, args) {
  try {
    return { ok: true, unusable: false, output: String(execFileSync(command, args.map(quote), { encoding: 'utf8', stdio: 'pipe', shell: true })).trim() }
  } catch (error) {
    const code = error.code ?? ''
    const stdout = error.stdout ? String(error.stdout).trim() : ''
    const stderr = error.stderr ? String(error.stderr).trim() : ''
    const unusable = code === 'ENOENT' || code === 'EINVAL' || code === 'EPERM'
    return { ok: false, unusable, code, output: (stderr || stdout || String(error.message)).split('\n')[0] }
  }
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const checks = []
const record = (label, ok, detail) => checks.push({ label, ok, detail })

// ---------------------------------------------------------------- preflight
const gitStatus = tryRun('git', ['status', '--porcelain'])
record('git working tree clean', gitStatus.ok && gitStatus.output === '', gitStatus.output === '' ? 'clean' : (gitStatus.output || 'not a repository'))

const branch = tryRun('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
record('on a branch', branch.ok, branch.output)

const remote = tryRun('git', ['remote', 'get-url', 'origin'])
record('origin remote', true, remote.ok ? remote.output : 'not set - gh repo create will add it')

const pack = tryRun(NPM, ['pack', '--dry-run', '--json'])
let packedFiles = []
if (pack.ok) {
  // 'prepare' may print build output before the JSON payload; keep the last JSON array.
  const start = pack.output.indexOf('[')
  const end = pack.output.lastIndexOf(']')
  try {
    if (start !== -1 && end > start) packedFiles = JSON.parse(pack.output.slice(start, end + 1))[0].files.map((f) => f.path)
  } catch { packedFiles = [] }
}
const hasLib = packedFiles.includes('lib/index.js')
const hasPatch = packedFiles.includes('cordis.patch.yml')
record('tarball contains lib/index.js + cordis.patch.yml', hasLib && hasPatch, packedFiles.join(', ') || pack.output)

const npmName = tryRun(NPM, ['view', NAME, 'version'])
record(
  'npm name is still free',
  !npmName.ok && !npmName.unusable,
  npmName.ok ? ('taken: ' + npmName.output) : (npmName.unusable ? ('npm unusable: ' + npmName.output) : '404 as expected'),
)

const ghVersion = tryRun('gh', ['--version'])
record('gh installed', ghVersion.ok, ghVersion.ok ? ghVersion.output.split('\n')[0] : 'install: winget install GitHub.cli')

const ghAuth = ghVersion.ok ? tryRun('gh', ['auth', 'status']) : { ok: false, output: 'gh missing' }
record('gh authenticated', ghAuth.ok, ghAuth.ok ? 'yes' : 'run: gh auth login')

const npmAuth = tryRun(NPM, ['whoami'])
record('npm authenticated', npmAuth.ok && npmAuth.output !== '', npmAuth.ok ? npmAuth.output : 'run: npm login (or set NPM_TOKEN)')

// ---------------------------------------------------------------- report
console.log('')
console.log('== ' + NAME + ' @ ' + pkg.version + ' ==')
for (const check of checks) {
  console.log((check.ok ? '  [ok]   ' : '  [BLOCK] ') + check.label + ' -> ' + check.detail)
}

const blockers = checks.filter((check) => !check.ok)
const repo = 'https://github.com/<owner>/' + NAME

console.log('')
console.log('== plan ==')
console.log('  1. npm pack                                    (verify the tarball again)')
console.log('  2. gh repo create <owner>/' + NAME + ' --public --source . --push')
console.log('  3. gh repo edit --add-topic ' + TOPICS.join(' --add-topic '))
console.log('  4. npm publish --access public')
console.log('  5. npm view ' + NAME + ' version   and   gh repo view --json url,repositoryTopics')
console.log('')
console.log('  posts to write by hand afterwards:')
console.log('    - DSH Discussions: docs/community/discussions-post.md')
console.log('    - tutorial/blog:  docs/community/tutorial.zh.md')

if (!execute) {
  console.log('')
  console.log(blockers.length === 0
    ? 'preflight clean. re-run with --execute to publish.'
    : 'dry run only; ' + blockers.length + ' blocker(s) above. re-run with --execute once they are cleared.')
  process.exit(0)
}

if (blockers.length > 0) {
  console.error('refusing to publish: clear the blockers first.')
  process.exit(1)
}

// ---------------------------------------------------------------- execute
console.log('')
run('gh', ['repo', 'create', NAME, '--public', '--source', '.', '--push', '--description', DESCRIPTION])
run('gh', ['repo', 'edit', ...TOPICS.flatMap((topic) => ['--add-topic', topic])])
run(NPM, ['publish', '--access', 'public'])
console.log('')
console.log('published. verify with:')
console.log('  npm view ' + NAME + ' version')
console.log('  gh repo view --json url,repositoryTopics')
