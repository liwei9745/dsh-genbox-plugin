import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenBoxClient } from '../client.js'
import type { Config } from '../config.js'
import { listProviders, resolveOutputDir } from '../media.js'

const run = promisify(execFile)

type DoctorStatus = 'ok' | 'warn' | 'fail'

type DoctorCheck = {
  name: string
  status: DoctorStatus
  detail: string
  hint?: string
}

type DoctorReport = {
  ok: boolean
  baseUrl: string
  checks: DoctorCheck[]
  /** What a freshly installed user should do next. */
  nextSteps: string[]
}

function entry(name: string, status: DoctorStatus, detail: string, hint?: string): DoctorCheck {
  const record: DoctorCheck = { name, status, detail }
  if (hint !== undefined) record.hint = hint
  return record
}

function shorten(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) + '...' : value
}

export function registerDoctorTool(ctx: Context, client: GenBoxClient, config: Config) {
  ctx.tools.register(defineTool({
    name: 'genbox_doctor',
    description:
      'Self-check the local GenBox setup: server reachability, authentication mode, provider and API-key readiness, '
      + 'ffmpeg availability and output-directory writability. Run this first when another GenBox tool fails - it says '
      + 'what to fix instead of leaving you with a raw HTTP error.',
    parameters: {
      showProviders: { type: 'boolean', description: 'Also report how many providers are enabled and which ones lack keys.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const report = value as unknown as DoctorReport
        const label = (status: DoctorStatus) => status === 'ok' ? '  [ok]  ' : status === 'warn' ? ' [warn] ' : ' [fail] '
        const lines = ['genbox_doctor -> ' + (report.ok ? 'no blocking problems' : 'blocking problem found') + ' (' + report.baseUrl + ')']
        for (const check of report.checks) {
          lines.push(label(check.status) + ' ' + check.name + ': ' + check.detail)
          if (check.hint !== undefined) lines.push('          fix: ' + check.hint)
        }
        if (report.nextSteps.length > 0) {
          lines.push('')
          lines.push('next steps:')
          for (const step of report.nextSteps) lines.push('  - ' + step)
        }
        return [{ type: 'text' as const, text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const checks: DoctorCheck[] = []

      let setup: Record<string, unknown> | undefined
      try {
        setup = await client.json<Record<string, unknown>>('GET', '/api/setup/status', undefined, exec.signal)
        checks.push(entry('GenBox reachable', 'ok', 'GET /api/setup/status answered'))
      } catch (error) {
        // The client already reports unreachable hosts as a sentence naming the URL;
        // do not wrap that in another "cannot reach <url> (" prefix.
        const reason = (error as Error).message
        checks.push(entry(
          'GenBox reachable',
          'fail',
          /not answering/i.test(reason) ? reason : 'cannot reach ' + client.baseUrl + ' (' + shorten(reason, 120) + ')',
          'Start GenBox (https://github.com/liwei9745/GenBox) and point baseUrl at the port it listens on; '
          + 'section 2 of docs/local-dev.md has the start command.',
        ))
      }

      if (setup !== undefined) {
        const appMode = String(setup.app_mode ?? 'unknown')
        if (setup.auth_required === true) {
          checks.push(config.adminKey.trim() === ''
            ? entry('Authentication', 'fail', 'server runs in ' + appMode + ' mode and requires X-Admin-Key, but adminKey is empty', 'Set adminKey in the plugin config, or start GenBox with APP_MODE=dev.')
            : entry('Authentication', 'ok', 'production mode with an adminKey configured'))
        } else {
          checks.push(entry('Authentication', 'ok', 'development mode, no admin key required'))
        }
      }

      try {
        const runtime = await client.json<Record<string, unknown>>('GET', '/api/runtime/status', undefined, exec.signal)
        checks.push(entry('Runtime', 'ok', 'GenBox v' + String(runtime.version ?? '?') + ' running in ' + String(runtime.mode ?? '?') + ' mode'))
      } catch {
        checks.push(entry('Runtime', 'warn', '/api/runtime/status is hidden outside development mode'))
      }

      try {
        const providers = await listProviders(client, exec.signal)
        const enabled = providers.filter((provider) => provider.enabled === true)
        const ready = enabled.filter((provider) => provider.has_key === true)
        const imageReady = ready.filter((provider) => (provider.type ?? 'image') === 'image')
        const videoReady = ready.filter((provider) => provider.type === 'video')
        if (enabled.length === 0) {
          checks.push(entry('Providers', 'fail', 'no provider is enabled', 'Enable a provider in the GenBox UI (' + config.baseUrl.replace(/\/+$/, '') + ') and give it an API key.'))
        } else {
          const summary = enabled.length + ' enabled, ' + ready.length + ' with a key (' + imageReady.length + ' image, ' + videoReady.length + ' video)'
          checks.push(imageReady.length === 0
            ? entry('Providers', 'warn', summary + ' - no image provider is usable', 'Image generation and editing need an enabled image provider with an API key.')
            : entry('Providers', 'ok', summary))
          const keyless = enabled.filter((provider) => provider.has_key !== true).map((provider) => provider.id)
          if (keyless.length > 0) {
            checks.push(entry('Providers without a key', 'warn', keyless.join(', '), 'Add their API keys or disable them: GenBox treats them as unusable.'))
          }
          if (args.showProviders === true) {
            checks.push(entry('Provider ids', 'ok', providers.map((provider) => provider.id + (provider.enabled === true ? '' : ' (disabled)')).join(', ')))
          }
        }
      } catch (error) {
        checks.push(entry('Providers', 'fail', shorten((error as Error).message, 160), 'Check that the GenBox provider configuration is readable.'))
      }

      const directory = resolveOutputDir(config.outputDir)
      try {
        await mkdir(directory, { recursive: true })
        const probeFile = join(directory, '.genbox-doctor-probe')
        await writeFile(probeFile, 'ok', 'utf8')
        await rm(probeFile, { force: true })
        checks.push(entry('Output directory', 'ok', directory + ' is writable'))
      } catch (error) {
        checks.push(entry('Output directory', 'fail', shorten((error as Error).message, 140), 'Point outputDir at a writable path in the plugin config.'))
      }

      const binaries: Array<[string, string]> = [['ffmpeg', config.ffmpegPath], ['ffprobe', config.ffprobePath]]
      for (const [label, binary] of binaries) {
        try {
          const result = await run(binary, ['-version'], { maxBuffer: 1024 * 1024 })
          const first = String(result.stdout).split('\n')[0] ?? ''
          checks.push(entry(label, 'ok', shorten(first, 80)))
        } catch {
          checks.push(entry(label, 'warn', 'not found: ' + binary, 'genbox_video_edit needs it; install ffmpeg or set ' + label + 'Path in the plugin config.'))
        }
      }

      const workbench = client.baseUrl.replace(/\/+$/, '') + '/'
      const report: DoctorReport = {
        ok: checks.every((check) => check.status !== 'fail'),
        baseUrl: client.baseUrl,
        checks,
        nextSteps: [
          'Open the workbench to configure providers and API keys: ' + workbench + ' (genbox_open_workbench can launch it)',
          'Then ask for something concrete, for example "draw a shiba inu in the snow with GenBox".',
          'Browse what was produced with genbox_gallery; start long jobs with background=true and collect them with genbox_task.',
        ],
      }
      return report
    },
  }))
}
