// genbox_doctor: must pass against a healthy setup and detect a broken one.
import { apply } from '../lib/index.js'

function load(config) {
  const registered = []
  apply({ tools: { register: (tool) => registered.push(tool) } }, config)
  return registered.find((tool) => tool.name === 'genbox_doctor')
}

const healthyConfig = {
  baseUrl: 'http://127.0.0.1:8892',
  adminKey: '',
  defaultProviderId: '',
  outputDir: 'E:/AI/GenBox-dsh/.genbox-out',
  pollIntervalMs: 800,
  taskTimeoutMs: 60000,
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  videoEncoder: '',
}

const exec = { signal: AbortSignal.timeout(60000) }

const healthy = await load(healthyConfig).execute({ showProviders: true }, exec)
console.log('--- healthy setup ---')
console.log(load(healthyConfig).output.render({}, healthy)[0].text)

const broken = await load({ ...healthyConfig, baseUrl: 'http://127.0.0.1:9' }).execute({}, exec)
console.log('--- broken setup ---')
console.log(load(healthyConfig).output.render({}, broken)[0].text)

const failures = []
if (healthy.ok !== true) failures.push('healthy setup reported a blocking problem')
if (broken.ok !== false) failures.push('broken setup was not detected')
if (!broken.checks.some((check) => check.name === 'GenBox reachable' && check.status === 'fail')) failures.push('missing reachability failure')
if (!healthy.checks.some((check) => check.name === 'ffmpeg' && check.status === 'ok')) failures.push('ffmpeg not detected')

console.log(failures.length === 0 ? 'OK' : 'FAILURES: ' + failures.join('; '))
process.exit(failures.length === 0 ? 0 : 1)
