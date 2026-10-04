import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenBoxClient } from '../client.js'
import type { Config } from '../config.js'
import { resolveOutputDir } from '../media.js'

type WorkbenchResult = {
  url: string
  running: boolean
  opened: boolean
  outputDir: string
  hint: string
}

/** The platform command that hands a URL to the default browser. */
function opener(url: string): { command: string; args: string[] } {
  if (process.platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] }
  if (process.platform === 'darwin') return { command: 'open', args: [url] }
  return { command: 'xdg-open', args: [url] }
}

/**
 * Onboarding tool: GenBox has its own UI, and that UI is where providers, API keys
 * and settings live. This tells the user where it is, and can bring it up.
 */
export function registerWorkbenchTool(ctx: Context, client: GenBoxClient, config: Config) {
  ctx.tools.register(defineTool({
    name: 'genbox_open_workbench',
    description:
      'Open the local GenBox workbench (its own web UI) and report whether the server answers. Call this once right after '
      + 'the plugin is installed, and whenever the user asks where to configure providers, API keys or settings, or where to '
      + 'browse generated media: the tools below only drive GenBox over HTTP, while the workbench is the human-facing UI. '
      + 'On the DSH desktop app the same UI also runs inside the right sidebar (Ctrl+Shift+G, or the GenBox tab).',
    parameters: {
      page: { type: 'string', description: "Optional section to open: 'gallery', 'settings', 'providers' or 'tasks'." },
      open: { type: 'boolean', description: 'Launch the browser (default false - it only reports the URL).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const result = value as unknown as WorkbenchResult
        const lines = [
          'genbox_open_workbench — ' + (result.running ? 'GenBox is running' : 'GenBox did not answer') + ': ' + result.url,
        ]
        lines.push(result.opened ? '- opened in your default browser' : '- pass open=true to launch it')
        lines.push('- inside DSH NEXT: Ctrl+Shift+G (or the sidebar GenBox tab) embeds this URL in the app - no browser needed')
        lines.push('- ' + result.hint)
        return [{ type: 'text' as const, text: lines.join('\n') }]
      },
      presentationMeta: (_args, value) => {
        const result = value as unknown as WorkbenchResult
        return { url: result.url, running: result.running }
      },
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Open the GenBox workbench' + (typeof args.page === 'string' && args.page !== '' ? ' (' + args.page + ')' : ''),
      kind: 'execute',
    }),
    presentResult: (_args, result) => {
      const meta = result.meta as { url?: unknown; running?: unknown } | undefined
      return {
        card: 'generic',
        title: meta?.running === true ? 'GenBox workbench is up' : 'GenBox did not answer',
      }
    },
    async execute(args, exec) {
      const base = client.baseUrl.replace(/\/+$/, '')
      const page = typeof args.page === 'string' ? args.page.replace(/^\/+/, '').replace(/\/+$/, '') : ''
      const url = base + '/' + (page === '' ? '' : page + '/')

      let running = false
      try {
        await client.json('GET', '/api/setup/status', undefined, exec.signal)
        running = true
      } catch {
        running = false
      }

      let opened = false
      if (args.open === true && running) {
        const { command, args: commandArgs } = opener(url)
        try {
          spawn(command, commandArgs, { detached: true, stdio: 'ignore' }).unref()
          opened = true
        } catch {
          opened = false
        }
      }

      const directory = resolveOutputDir(config.outputDir)
      return {
        url,
        running,
        opened,
        outputDir: directory,
        hint: running
          ? 'Providers, API keys and settings live on that page; generated media is written to ' + directory + '.'
          : 'Start GenBox first (it must listen on ' + base + '), then open the URL again.',
      }
    },
  }))
}
