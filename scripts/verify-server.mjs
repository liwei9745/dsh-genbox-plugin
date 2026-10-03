// genbox_server: does it really start, stop, restart and inspect the local GenBox server -
// and does the HTTP client find a server that listens on a different port than the configured
// one? Both were first-run failures: GenBox's own default port is 8891 while the plugin's
// documented default is 8892, and nothing could start the server from the chat window.
//
// Self-provisioning: it starts the servers it needs and leaves one running on the configured
// port, so run it after the suites that need a server, not before.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { apply, Config, GenBoxClient, GenBoxError, discoverHome, looksLikeGenBox } from '../lib/index.js'

const CHECKOUT = process.env.GENBOX_TEST_HOME ?? ''
const found = await discoverHome({ configured: CHECKOUT, env: process.env, cwd: process.cwd() })
if (found === null) {
  console.log('SKIP verify-server: no GenBox checkout found (set GENBOX_TEST_HOME to the directory holding main.py)')
  process.exit(0)
}

const tools = new Map()
apply({ tools: { register: (definition) => tools.set(definition.name, definition) } }, Config({}))
const server = tools.get('genbox_server')
assert.ok(server, 'genbox_server must be registered')
const call = (args) => server.execute(args, { signal: undefined })

const results = []
const check = async (name, fn) => {
  try { await fn(); results.push('  [ok]   ' + name) }
  catch (error) { results.push('  [FAIL] ' + name + ' - ' + String(error.message).slice(0, 220)) }
}

await check('the stop-safety rule only accepts a GenBox main.py process', async () => {
  assert.equal(looksLikeGenBox('C:\\py\\python.exe main.py'), true)
  assert.equal(looksLikeGenBox('python main.py'), true)
  assert.equal(looksLikeGenBox('node -e "http.createServer().listen(8899)"'), false)
  assert.equal(looksLikeGenBox('node main.py-runner.js'), false)
  assert.equal(looksLikeGenBox(null), false)
})

await check('discovery reports nothing when no checkout is anywhere near', async () => {
  assert.equal(await discoverHome({ configured: '', env: {}, cwd: tmpdir() }), null)
})

await check('start launches the checkout and waits until it answers', async () => {
  const started = await call({ action: 'start', port: 8891, home: found.path })
  assert.equal(started.running, true, 'expected a running server: ' + started.message)
  assert.ok(typeof started.pid === 'number' && started.pid > 0)
  assert.ok(String(started.home).toLowerCase().includes('genbox'), 'home should be the checkout, got ' + String(started.home))
})

// The fallback check is only meaningful while 8892 is empty: with a server there the client
// would rightly prefer the configured URL.
await call({ action: 'stop', port: 8892 })

await check('the client finds GenBox on 8891 when it is configured for 8892', async () => {
  const client = new GenBoxClient({ baseUrl: 'http://127.0.0.1:8892', fallbackBaseUrls: ['http://127.0.0.1:8891'] })
  await client.status()
  assert.equal(client.baseUrl, 'http://127.0.0.1:8891')
  assert.equal(client.usingFallback, true)
  assert.equal(client.configuredBaseUrl, 'http://127.0.0.1:8892')
})

await check('a request after the resolution does not probe again', async () => {
  const client = new GenBoxClient({ baseUrl: 'http://127.0.0.1:8892', fallbackBaseUrls: ['http://127.0.0.1:8891'] })
  await client.status()
  const resolved = client.baseUrl
  await client.status()
  assert.equal(client.baseUrl, resolved)
})

await check('the unreachable error names every URL it tried', async () => {
  const client = new GenBoxClient({ baseUrl: 'http://127.0.0.1:8893', fallbackBaseUrls: ['http://127.0.0.1:9999'] })
  await assert.rejects(
    () => client.status(),
    (error) => {
      assert.ok(error instanceof GenBoxError)
      assert.match(error.message, /8893/)
      assert.match(error.message, /9999/)
      assert.match(error.message, /genbox_server/, 'the message should point at the server tool')
      return true
    },
  )
})

await check('status finds the server through its port, with the pid', async () => {
  const status = await call({ action: 'status', port: 8891 })
  assert.equal(status.running, true, 'expected 8891 to answer: ' + status.message)
  assert.ok(typeof status.pid === 'number' && status.pid > 0)
})

await check('stop terminates the GenBox process it found', async () => {
  const stopped = await call({ action: 'stop', port: 8891 })
  assert.equal(stopped.running, false, 'expected it to stop: ' + stopped.message)
  assert.equal((await call({ action: 'status', port: 8891 })).running, false)
})

await check('start works on the port the plugin is configured for (8892)', async () => {
  const started = await call({ action: 'start', port: 8892, home: found.path })
  assert.equal(started.running, true, 'expected a running server: ' + started.message)
})

await check('a checkout this machine started before is found again without being told', async () => {
  const record = JSON.parse(await readFile(homedir() + '\\.dsh\\genbox-server.json', 'utf8'))
  const again = await discoverHome({ configured: '', env: {}, cwd: tmpdir(), recorded: record.home })
  assert.ok(again !== null, 'the recorded checkout should be rediscovered')
  assert.equal(again.path.replace(/\\\\/g, '/').toLowerCase(), String(record.home).replace(/\\\\/g, '/').toLowerCase())
})

await check('restart replaces the running server with a new process', async () => {
  const before = await call({ action: 'status', port: 8892 })
  const restarted = await call({ action: 'restart', port: 8892, home: found.path })
  assert.equal(restarted.running, true, 'expected a running server: ' + restarted.message)
  assert.ok(restarted.pid !== before.pid, 'restart should produce a new pid (' + String(before.pid) + ' -> ' + String(restarted.pid) + ')')
})

await check('a non-GenBox process on the port is refused, not killed', async () => {
  const dummy = spawn(process.execPath, ['-e', "require('http').createServer((q,s)=>s.end('x')).listen(8899)"], { detached: true, stdio: 'ignore' })
  dummy.unref()
  await new Promise((done) => setTimeout(done, 1500))
  const refused = await call({ action: 'stop', port: 8899 })
  assert.equal(refused.ok, false, 'must refuse: ' + refused.message)
  assert.match(refused.message, /Refusing to stop pid/)
  assert.equal((await call({ action: 'status', port: 8899 })).running, true, 'the unrelated process must still be serving')
  try { process.kill(dummy.pid, 'SIGKILL') } catch { /* already gone */ }
})

await check('the server is left running on the configured port for the suites after this one', async () => {
  assert.equal((await call({ action: 'status', port: 8892 })).running, true)
})

console.log(results.join('\n'))
const failed = results.filter((line) => line.includes('[FAIL]')).length
console.log(failed === 0 ? 'OK (' + results.length + ' checks)' : 'FAILED (' + failed + ' of ' + results.length + ')')
process.exitCode = failed === 0 ? 0 : 1
