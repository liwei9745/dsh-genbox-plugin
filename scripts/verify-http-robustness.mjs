// The HTTP layer against a deliberately hostile local server:
//   - GenBox failure bodies come in several shapes; the message must quote the
//     human sentence, not dump JSON;
//   - a poll that drops once (5xx, 429, socket) must not lose a multi-minute job;
//   - a permanent refusal (4xx) must fail immediately instead of retrying.
import { createServer } from 'node:http'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { GenBoxClient, GenBoxError } from '../lib/index.js'

const hits = new Map()
const bump = (path) => {
  const next = (hits.get(path) ?? 0) + 1
  hits.set(path, next)
  return next
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const server = createServer((request, response) => {
  const path = (request.url ?? '/').split('?')[0]
  const count = bump(path)
  if (path === '/bad-request') {
    response.writeHead(400, JSON_HEADERS)
    response.end(JSON.stringify({ detail: { error: 'precision_edit_output_size_mismatch', message: 'output must be exactly 320x240' } }))
    return
  }
  if (path === '/plain-detail') {
    response.writeHead(409, JSON_HEADERS)
    response.end(JSON.stringify({ detail: 'no image provider is enabled' }))
    return
  }
  if (path === '/flaky') {
    // Two upstream failures, then the terminal state.
    if (count <= 2) {
      response.writeHead(500, JSON_HEADERS)
      response.end(JSON.stringify({ detail: { message: 'upstream exploded' } }))
      return
    }
    response.writeHead(200, JSON_HEADERS)
    response.end(JSON.stringify({ status: 'completed', elapsed_seconds: 3 }))
    return
  }
  if (path === '/always-500') {
    response.writeHead(500, JSON_HEADERS)
    response.end(JSON.stringify({ detail: 'still broken' }))
    return
  }
  if (path === '/no-such-task') {
    response.writeHead(404, JSON_HEADERS)
    response.end(JSON.stringify({ detail: 'task not found' }))
    return
  }
  if (path.startsWith('/api/video/file/')) {
    response.writeHead(404, JSON_HEADERS)
    response.end(JSON.stringify({ detail: 'clip expired' }))
    return
  }
  response.writeHead(200, JSON_HEADERS)
  response.end('{}')
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const client = new GenBoxClient({ baseUrl: 'http://127.0.0.1:' + port, requestTimeoutMs: 5000 })

const checks = []
const check = (label, ok) => checks.push([label, ok])
const failure = async (path) => {
  try {
    await client.json('POST', path, { probe: true })
    return undefined
  } catch (error) {
    return error
  }
}

// 1. error wording
const structured = await failure('/bad-request')
check('structured detail yields the human sentence', structured instanceof GenBoxError
  && structured.message.includes('output must be exactly 320x240')
  && structured.message.includes('precision_edit_output_size_mismatch'))
check('structured detail does not dump raw JSON', structured !== undefined && !structured.message.includes('{"detail"'))
check('the HTTP status survives on the error', structured?.status === 400)

const plain = await failure('/plain-detail')
check('a string detail is quoted verbatim', plain instanceof GenBoxError && plain.message.includes('no image provider is enabled'))

// 2. tolerant polling
const recovered = await client.waitFor('/flaky', (value) => value.status === 'completed', { intervalMs: 20, timeoutMs: 5000 })
check('two dropped polls are absorbed and the task still completes', recovered.status === 'completed')
check('the flaky endpoint was polled exactly three times', hits.get('/flaky') === 3)

const bounded = await (async () => {
  try {
    await client.waitFor('/always-500', () => false, { intervalMs: 10, timeoutMs: 5000, toleratedFailures: 2 })
    return undefined
  } catch (error) {
    return error
  }
})()
check('a permanently failing poll gives up with the HTTP reason', bounded instanceof GenBoxError
  && bounded.status === 500 && bounded.message.includes('still broken'))
check('the give-up happened after the tolerated budget', (hits.get('/always-500') ?? 0) === 3)

// 3. permanent refusals are not retried
const refused = await (async () => {
  try {
    await client.waitFor('/no-such-task', () => false, { intervalMs: 10, timeoutMs: 5000 })
    return undefined
  } catch (error) {
    return error
  }
})()
check('a 404 fails immediately instead of retrying', refused instanceof GenBoxError && refused.status === 404 && hits.get('/no-such-task') === 1)

// 4. cancellation still surfaces as a cancellation
const controller = new AbortController()
const aborting = (async () => {
  setTimeout(() => controller.abort(), 60)
  try {
    await client.waitFor('/always-500', () => false, { intervalMs: 30, timeoutMs: 5000, signal: controller.signal, toleratedFailures: 50 })
    return undefined
  } catch (error) {
    return error
  }
})()
const cancelled = await aborting
check('an aborted poll is not reported as a GenBox failure', cancelled !== undefined && !(cancelled instanceof GenBoxError))

// 5. download failures quote the body too
const target = join(process.env.VERIFY_OUT_DIR ?? '.genbox-out', 'never-written.bin')
rmSync(target, { force: true })
const downloadError = await client.download('/api/video/file/missing.mp4', target).then(() => undefined, (error) => error)
check('a failed download names the URL and the reason', downloadError instanceof GenBoxError
  && downloadError.message.includes('missing.mp4') && downloadError.message.includes('clip expired'))
check('a failed download writes nothing', !existsSync(target))

server.close()

let failures = 0
for (const [label, ok] of checks) {
  if (!ok) failures += 1
  console.log((ok ? '  [ok]   ' : '  [FAIL] ') + label)
}
console.log(failures === 0 ? 'OK (' + checks.length + ' checks)' : 'FAILURES: ' + failures)
process.exit(failures === 0 ? 0 : 1)
