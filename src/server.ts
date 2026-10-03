import { execFile } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** What a started server left behind, so a later call can stop or restart it. */
export interface ServerRecord {
  pid: number
  port: number
  home: string
  python: string
  startedAt: string
}

/** A GenBox checkout the plugin could start. */
export interface GenBoxHome {
  path: string
  python: string
  /** Where the path came from, for the report ('config', 'GENBOX_HOME', 'sibling', ...). */
  source: string
}

/** Central state file: one server per machine, independent of the session workspace. */
export function stateFile(home: string = homedir()): string {
  return join(home, '.dsh', 'genbox-server.json')
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return process.platform === 'win32' && (await exists(path))
  }
}

/** The interpreter that runs main.py: the checkout's venv when it has one, else python on PATH. */
export async function pythonFor(home: string): Promise<string> {
  const candidates = process.platform === 'win32'
    ? [join(home, '.venv', 'Scripts', 'python.exe'), join(home, 'venv', 'Scripts', 'python.exe')]
    : [join(home, '.venv', 'bin', 'python'), join(home, 'venv', 'bin', 'python')]
  for (const candidate of candidates) {
    if (await executable(candidate)) return candidate
  }
  return process.platform === 'win32' ? 'python' : 'python3'
}

/** Is this directory a GenBox checkout we could start? */
export async function isGenBoxCheckout(dir: string): Promise<boolean> {
  return await exists(join(dir, 'main.py'))
}

/**
 * Find a GenBox checkout, in the order a user would expect: an explicit path, the
 * configured one, GENBOX_HOME, then the places a checkout usually sits relative to the
 * session workspace and the user's home directory.
 */
export async function discoverHome(options: {
  explicit?: string | undefined
  configured?: string | undefined
  env?: NodeJS.ProcessEnv | undefined
  cwd?: string | undefined
  /** The checkout a previous genbox_server start used; still valid when main.py is there. */
  recorded?: string | undefined
}): Promise<GenBoxHome | null> {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const decided: Array<[string, string | undefined]> = [
    ['the "home" argument', options.explicit],
    ['the configured home', options.configured],
    ['GENBOX_HOME', env.GENBOX_HOME],
  ]
  const candidateDirs: Array<[string, string]> = []
  for (const [source, value] of decided) {
    if (typeof value === 'string' && value.trim() !== '') {
      const dir = isAbsolute(value) ? value : resolve(cwd, value)
      candidateDirs.push([source, dir])
    }
  }
  // A checkout this machine started before is the best guess after the explicit settings:
  // the DSH session workspace is rarely where the user keeps GenBox.
  if (typeof options.recorded === 'string' && options.recorded.trim() !== '') {
    candidateDirs.push(['a previous start', options.recorded])
  }
  for (const [source, dir] of [
    ['a sibling directory', join(cwd, 'GenBox')],
    ['upstream/GenBox', join(cwd, 'upstream', 'GenBox')],
    ['../GenBox', resolve(cwd, '..', 'GenBox')],
    ['../upstream/GenBox', resolve(cwd, '..', 'upstream', 'GenBox')],
    ['the home directory', join(homedir(), 'GenBox')],
  ] as Array<[string, string]>) {
    candidateDirs.push([source, dir])
  }
  for (const [source, dir] of candidateDirs) {
    if (await isGenBoxCheckout(dir)) return { path: dir, python: await pythonFor(dir), source }
  }
  return null
}

/**
 * Decide whether a process is safe to stop: it must be running GenBox's entry point.
 *
 * Deliberately strict. Stopping a process is the one destructive thing this plugin does,
 * and "something is listening on 8892" is not evidence that it is GenBox.
 */
export function looksLikeGenBox(commandLine: string | null): boolean {
  if (commandLine === null || commandLine.trim() === '') return false
  const text = commandLine.replace(/\\/g, '\\')
  if (!/main\.py(\s|$|")/.test(text)) return false
  // A node process that merely mentions main.py in an argument is not the server.
  return !/\bnode(\.exe)?\b/i.test(text)
}

/** PIDs listening on a local port. Windows uses Get-NetTCPConnection, POSIX lsof. */
export async function listenersOnPort(port: number): Promise<number[]> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Get-NetTCPConnection -State Listen -LocalPort ' + port + ' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique',
      ])
      return stdout.split(/\r?\n/).map((line) => Number.parseInt(line.trim(), 10)).filter((pid) => Number.isInteger(pid) && pid > 0)
    }
    const { stdout } = await run('lsof', ['-ti', 'tcp:' + port])
    return stdout.split(/\r?\n/).map((line) => Number.parseInt(line.trim(), 10)).filter((pid) => Number.isInteger(pid) && pid > 0)
  } catch {
    return []
  }
}

/** The full command line of a process, or null when it cannot be read. */
export async function commandLineOf(pid: number): Promise<string | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        '(Get-CimInstance Win32_Process -Filter "ProcessId=' + pid + '").CommandLine',
      ])
      const line = stdout.trim()
      return line === '' ? null : line
    }
    const { stdout } = await run('ps', ['-o', 'command=', '-p', String(pid)])
    const line = stdout.trim()
    return line === '' ? null : line
  } catch {
    return null
  }
}

/** Is the process still there? Signal 0 only probes. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Terminate a process tree. The caller has already checked what it is. */
export async function killPid(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await run('taskkill', ['/PID', String(pid), '/T', '/F']).catch(() => undefined)
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isAlive(pid)) return
    await new Promise((done) => setTimeout(done, 250))
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Already gone.
  }
}

export async function readRecord(file: string): Promise<ServerRecord | null> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as ServerRecord
    return typeof parsed?.pid === 'number' ? parsed : null
  } catch {
    return null
  }
}

export async function writeRecord(file: string, record: ServerRecord): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, JSON.stringify(record, null, 2) + '\n')
}
