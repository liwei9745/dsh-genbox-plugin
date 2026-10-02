// One-command release for dsh-genbox-plugin.
//
//   node scripts/publish.mjs             # preflight only, changes nothing
//   node scripts/publish.mjs --execute   # create the GitHub repo, push, publish to npm
//
// Two credential modes are supported:
//   * gh CLI logged in (gh auth login)  and/or  npm login
//   * plain tokens in the environment:   GH_TOKEN (repo scope) and/or NPM_TOKEN
// The script never stores credentials itself.
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const NAME = 'dsh-genbox-plugin'
const TOPICS = ['dsh-plugin', 'deepseek-harness', 'genbox', 'cordis-plugin', 'image-generation', 'video-generation']
const DESCRIPTION = 'DeepSeek Harness tools for GenBox: image generation/editing and video generation through a local GenBox server.'
const execute = process.argv.includes('--execute')
// Windows ships npm as a .cmd shim, which execFileSync cannot launch without the extension.
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const GH_TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? ''
const NPM_TOKEN = process.env.NPM_TOKEN ?? ''
// Accounts with 2FA enabled must publish with a one-time code unless the token is a
// granular access token that is explicitly allowed to bypass 2FA.
const NPM_OTP = process.env.NPM_OTP ?? ''
const otpArgs = NPM_OTP !== '' ? ['--otp=' + NPM_OTP] : []

function quote(arg) {
  const value = String(arg)
  return /[\s"]/.test(value) ? '"' + value.replace(/"/g, '\\"') + '"' : value
}

function run(command, args) {
  execFileSync(command, args.map(quote), { encoding: 'utf8', stdio: 'inherit', shell: true })
}

/** Run npm publish, turning the common 2FA refusal into a clear next step. */
function npmPublish(args) {
  try {
    run(NPM, args)
  } catch (error) {
    const text = String(error.stderr ?? '') + String(error.stdout ?? '') + String(error.message ?? '')
    if (/E403/.test(text) && /(two-factor|2fa|otp)/i.test(text)) {
      console.error('')
      console.error('npm refused the publish: this account needs a one-time code, or a granular token that is')
      console.error('explicitly allowed to bypass 2FA.')
      console.error('')
      console.error('  retry with a code:   NPM_OTP=<6-digit code> node scripts/publish.mjs --execute')
      console.error('  or let npm prompt:   npm publish --access public')
      console.error('  or use the helper:   powershell -File scripts/publish-with-token.ps1 -Execute')
      console.error('')
      process.exit(1)
    }
    throw error
  }
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
record('origin remote', true, remote.ok ? remote.output : 'not set - the release step adds it')

const pack = tryRun(NPM, ['pack', '--dry-run', '--json'])
let packedFiles = []
if (pack.ok) {
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

const requireGithub = process.argv.includes('--with-github')
const ghVersion = tryRun('gh', ['--version'])
const ghMode = ghVersion.ok ? 'gh CLI' : (GH_TOKEN !== '' ? 'GH_TOKEN' : '')
const githubReady = ghMode !== ''
if (requireGithub) {
  record('GitHub credentials', githubReady, githubReady ? ('via ' + ghMode) : 'run: gh auth login, or set GH_TOKEN')
} else if (!githubReady) {
  console.log('  [skip] GitHub steps skipped: no gh CLI and no GH_TOKEN.')
  console.log('         pass --with-github (after gh auth login / GH_TOKEN) to create the repository and topics.')
}

if (ghVersion.ok) {
  const ghAuth = tryRun('gh', ['auth', 'status'])
  record('gh authenticated', ghAuth.ok, ghAuth.ok ? 'yes' : 'run: gh auth login (or set GH_TOKEN)')
}

const npmAuth = tryRun(NPM, ['whoami'])
const npmMode = npmAuth.ok && npmAuth.output !== '' ? 'npm login (' + npmAuth.output + ')' : (NPM_TOKEN !== '' ? 'NPM_TOKEN' : '')
record('npm credentials', npmMode !== '', npmMode === '' ? 'run: npm login, or set NPM_TOKEN' : ('via ' + npmMode))

// ---------------------------------------------------------------- report
console.log('')
console.log('== ' + NAME + ' @ ' + pkg.version + ' ==')
for (const check of checks) {
  console.log((check.ok ? '  [ok]   ' : '  [BLOCK] ') + check.label + ' -> ' + check.detail)
}

const blockers = checks.filter((check) => !check.ok)

console.log('')
console.log('== plan ==')
console.log('  1. npm pack                                    (verify the tarball again)')
console.log(githubReady ? '  2. create ' + NAME + ' on GitHub, push the current branch' : '  2. (GitHub steps skipped - npm only)')
console.log('     tip: -NpmOnly skips the GitHub prompt in scripts/publish-with-token.ps1')
if (githubReady) console.log('  3. add topics: ' + TOPICS.join(', '))
console.log('  4. npm publish --access public' + (NPM_OTP !== '' ? ' --otp=<from $NPM_OTP>' : (NPM_TOKEN !== '' ? ' (with $NPM_TOKEN)' : '')))
console.log('  5. verify with npm view ' + NAME + ' version and the repository page')
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
const branchName = branch.output

async function releaseWithToken(token) {
  const headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dsh-genbox-plugin-publish',
    'Content-Type': 'application/json',
  }
  const who = await fetch('https://api.github.com/user', { headers })
  if (!who.ok) throw new Error('GitHub token rejected: ' + who.status)
  const owner = (await who.json()).login
  const create = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: NAME, description: DESCRIPTION, private: false, has_issues: true }),
  })
  if (!create.ok && create.status !== 422) {
    throw new Error('repository creation failed: ' + create.status + ' ' + (await create.text()).slice(0, 200))
  }
  const topics = await fetch('https://api.github.com/repos/' + owner + '/' + NAME + '/topics', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ names: TOPICS }),
  })
  if (!topics.ok) throw new Error('topic update failed: ' + topics.status + ' ' + (await topics.text()).slice(0, 200))
  tryRun('git', ['remote', 'remove', 'origin'])
  run('git', ['remote', 'add', 'origin', 'https://github.com/' + owner + '/' + NAME + '.git'])
  run('git', ['push', 'https://x-access-token:' + token + '@github.com/' + owner + '/' + NAME + '.git', 'HEAD:refs/heads/' + branchName])
  return owner
}

console.log('')
let owner = ''
if (!githubReady) {
  console.log('skipping GitHub: no credentials in this shell. Publish to npm now, then re-run with --with-github to create the repository.')
} else {
  // A GitHub hiccup (missing scope, existing repo, network) must not block the npm release.
  try {
    if (GH_TOKEN !== '') {
      owner = await releaseWithToken(GH_TOKEN)
      console.log('repository ready: https://github.com/' + owner + '/' + NAME)
    } else {
      run('gh', ['repo', 'create', NAME, '--public', '--source', '.', '--push', '--description', DESCRIPTION])
      run('gh', ['repo', 'edit', ...TOPICS.flatMap((topic) => ['--add-topic', topic])])
    }
  } catch (error) {
    console.error('GitHub step failed, continuing with the npm release: ' + String(error.message).split('\n')[0])
  }
}

if (NPM_TOKEN !== '') {
  const rcFile = join(tmpdir(), 'dsh-publish-npmrc-' + Date.now())
  writeFileSync(rcFile, '//registry.npmjs.org/:_authToken=' + NPM_TOKEN + '\n', { encoding: 'utf8', mode: 0o600 })
  try {
    npmPublish(['publish', '--access', 'public', '--userconfig', rcFile, ...otpArgs])
  } finally {
    rmSync(rcFile, { force: true })
  }
} else {
  npmPublish(['publish', '--access', 'public', ...otpArgs])
}

console.log('')
console.log('published. verify with:')
console.log('  npm view ' + NAME + ' version')
console.log('  the repository Topics should list dsh-plugin')
