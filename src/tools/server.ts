import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenBoxClient } from '../client.js'
import type { Config } from '../config.js'
import {
  commandLineOf,
  discoverHome,
  isAlive,
  killPid,
  listenersOnPort,
  looksLikeGenBox,
  readRecord,
  stateFile,
  writeRecord,
} from '../server.js'

type Action = 'status' | 'start' | 'stop' | 'restart'

type ServerResult = {
  action: Action
  ok: boolean
  running: boolean
  url: string
  port: number
  pid: number | null
  home: string | null
  python: string | null
  message: string
  triedPorts: string[]
}

/** The port the client is actually talking to, so start/stop act on the same server. */
function portOf(client: GenBoxClient): number {
  try {
    const parsed = new URL(client.baseUrl)
    if (parsed.port !== '') return Number.parseInt(parsed.port, 10)
    return parsed.protocol === 'https:' ? 443 : 80
  } catch {
    return 8892
  }
}

/** Ask a specific port whether GenBox is already there. */
async function answers(port: number, timeoutMs = 2500): Promise<boolean> {
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/api/setup/status', { signal: AbortSignal.timeout(timeoutMs) })
    return response.ok
  } catch {
    return false
  }
}

async function waitForPort(port: number, deadlineMs: number): Promise<boolean> {
  const started = Date.now()
  for (;;) {
    if (await answers(port)) return true
    if (Date.now() - started >= deadlineMs) return false
    await new Promise((done) => setTimeout(done, 1000))
  }
}

/**
 * Manage the GenBox server the other tools talk to. GenBox is a separate FastAPI process;
 * without this the user has to find a terminal, remember the virtualenv path and the port
 * before any image tool can work.
 */
export function registerServerTool(ctx: Context, client: GenBoxClient, config: Config) {
  ctx.tools.register(defineTool({
    name: 'genbox_server',
    description:
      'Start, stop, restart or inspect the local GenBox server that every other genbox_* tool talks to. Use action=status '
      + 'to see whether it is running and on which port and PID; action=start to launch it from the GenBox checkout on this '
      + 'machine (dev mode, so no admin key is needed); action=stop to shut that server down; action=restart to do both. '
      + 'Stopping only ever kills a process whose command line runs GenBox main.py, so an unrelated program on the same port '
      + 'is reported instead of terminated.',
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'start', 'stop', 'restart'], description: 'What to do.' },
      port: { type: 'number', description: 'Port to start/stop on. Defaults to the port the plugin is connected to (usually 8892).' },
      home: { type: 'string', description: 'Path to a GenBox checkout (the directory holding main.py). Defaults to the configured home, GENBOX_HOME, or the usual places near the workspace.' },
      wait: { type: 'boolean', description: 'For start/restart: wait until the server answers before returning (default true).' },
      force: { type: 'boolean', description: 'For stop: kill the process holding the port even when its command line does not look like GenBox. Off by default.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const result = value as unknown as ServerResult
        const lines = ['genbox_server ' + result.action + ' -> ' + (result.running ? 'running' : 'not running') + ' (' + result.url + ')']
        if (result.pid !== null) lines.push('- pid ' + result.pid + (result.home === null ? '' : ' from ' + result.home))
        lines.push('- ' + result.message)
        if (!result.running && result.action !== 'stop') lines.push('- ports tried: ' + result.triedPorts.join(', '))
        return [{ type: 'text' as const, text: lines.join('\n') }]
      },
      presentationMeta: (_args, value) => {
        const result = value as unknown as ServerResult
        return { running: result.running, pid: result.pid, url: result.url }
      },
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'GenBox server: ' + String(args.action ?? 'status'),
      kind: 'execute',
    }),
    presentResult: (_args, result) => {
      const meta = result.meta as { running?: unknown; pid?: unknown } | undefined
      return {
        card: 'generic',
        title: meta?.running === true ? 'GenBox server is up' + (typeof meta.pid === 'number' ? ' (pid ' + meta.pid + ')' : '') : 'GenBox server is not running',
      }
    },
    async execute(args, exec) {
      const action = String(args.action ?? 'status').toLowerCase() as Action
      const port = typeof args.port === 'number' && Number.isInteger(args.port) && args.port > 0 ? args.port : portOf(client)
      const wait = args.wait !== false
      const record = await readRecord(stateFile())
      const base: Omit<ServerResult, 'running' | 'message'> = {
        action,
        ok: true,
        url: 'http://127.0.0.1:' + port,
        port,
        pid: null,
        home: record?.home ?? null,
        python: record?.python ?? null,
        triedPorts: client.candidates,
      }

      /** Which process is serving the port right now, and is it one we may stop? */
      const occupant = async (): Promise<{ pid: number; commandLine: string | null; safe: boolean } | null> => {
        const pids = await listenersOnPort(port)
        if (pids.length === 0) return null
        const pid = pids[0] as number
        const commandLine = await commandLineOf(pid)
        return { pid, commandLine, safe: looksLikeGenBox(commandLine) }
      }

      const runningNow = async (): Promise<boolean> => answers(port)

      if (action === 'status') {
        const running = await runningNow()
        if (!running) {
          return { ...base, running: false, message: 'Nothing is listening on port ' + port + '. Start it with action=start.' }
        }
        const holder = await occupant()
        return {
          ...base,
          running: true,
          pid: holder?.pid ?? (record !== null && isAlive(record.pid) ? record.pid : null),
          message: holder !== null && !holder.safe
            ? 'Port ' + port + ' answers, but the process holding it does not look like GenBox: ' + String(holder.commandLine ?? '(command line unreadable)')
            : 'GenBox answers on port ' + port + '.',
        }
      }

      if (action === 'stop' || action === 'restart') {
        if (!(await runningNow())) {
          if (action === 'stop') {
            client.forgetLocation()
            return { ...base, running: false, message: 'GenBox is not running on port ' + port + '; nothing to stop.' }
          }
        } else {
          const holder = await occupant()
          if (holder === null) {
            return { ...base, ok: false, running: true, message: 'Port ' + port + ' answers but no listening process could be identified; refusing to guess.' }
          }
          if (!holder.safe && args.force !== true) {
            return {
              ...base,
              ok: false,
              running: true,
              pid: holder.pid,
              message: 'Refusing to stop pid ' + holder.pid + ': its command line is not a GenBox main.py (' + String(holder.commandLine ?? 'unreadable') + '). Pass force=true if you are sure.',
            }
          }
          await killPid(holder.pid)
          for (let attempt = 0; attempt < 20 && (await runningNow()); attempt += 1) {
            await new Promise((done) => setTimeout(done, 500))
          }
          client.forgetLocation()
          if (action === 'stop') {
            const stillRunning = await runningNow()
            return {
              ...base,
              ok: !stillRunning,
              running: stillRunning,
              pid: holder.pid,
              message: stillRunning
                ? 'Asked pid ' + holder.pid + ' to stop, but port ' + port + ' still answers.'
                : 'Stopped GenBox (pid ' + holder.pid + ') on port ' + port + '.',
            }
          }
        }
      }

      if (action === 'start' || action === 'restart') {
        if (await runningNow()) {
          client.forgetLocation()
          return { ...base, running: true, message: 'GenBox already answers on port ' + port + '; nothing to start.' }
        }
        const home = await discoverHome({ explicit: args.home, configured: config.home ?? '', cwd: process.cwd(), recorded: record?.home })
        if (home === null) {
          return {
            ...base,
            ok: false,
            running: false,
            message: 'No GenBox checkout found. Pass home=<path to the directory holding main.py>, set GENBOX_HOME, or set the plugin home config. Searched: the home argument, the plugin config, GENBOX_HOME, the path a previous start used, ./GenBox, ./upstream/GenBox, ../GenBox, ../upstream/GenBox and ~/GenBox.',
          }
        }
        const child = spawn(home.python, ['main.py'], {
          cwd: home.path,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: {
            ...process.env,
            APP_MODE: 'dev',
            GENBOX_PORT: String(port),
            GENBOX_NO_BROWSER: '1',
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
          },
        })
        child.unref()
        const pid = child.pid ?? null
        if (pid !== null) {
          await writeRecord(stateFile(), { pid, port, home: home.path, python: home.python, startedAt: new Date().toISOString() })
        }
        client.forgetLocation()
        const waitMs = typeof config.serverWaitMs === 'number' && config.serverWaitMs > 0 ? config.serverWaitMs : 45000
        const up = wait ? await waitForPort(port, waitMs) : false
        return {
          ...base,
          ok: pid !== null && (wait ? up : true),
          running: wait ? up : false,
          pid,
          home: home.path,
          python: home.python,
          message: wait
            ? (up
              ? 'Started GenBox from ' + home.path + ' (' + home.source + ') with ' + home.python + '; it answers on port ' + port + '.'
              : 'Launched ' + home.python + ' main.py in ' + home.path + ' (pid ' + String(pid) + '), but port ' + port + ' did not answer within ' + waitMs + ' ms. Check the checkout runs by hand, or raise serverWaitMs.')
            : 'Launched GenBox from ' + home.path + ' (pid ' + String(pid) + '); pass wait=true to block until it answers.',
        }
      }

      return { ...base, ok: false, running: false, message: 'Unknown action "' + String(action) + '".' }
    },
  }))
}
