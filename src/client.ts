import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { JsonObject } from './json.js'

export interface GenBoxClientOptions {
  baseUrl: string
  adminKey?: string
  requestTimeoutMs?: number
}

/** A GenBox HTTP failure (non-2xx response or a broken payload). */
export class GenBoxError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'GenBoxError'
    this.status = status
  }
}

/**
 * Turn a transport failure into something the user can act on. The most common
 * first-run failure by far is "GenBox is not running", and a bare "fetch failed"
 * tells nobody what to do about it.
 */
function transportError(baseUrl: string, path: string, error: unknown): GenBoxError {
  const cause = (error as { cause?: { code?: unknown } }).cause
  const code = typeof cause?.code === 'string' ? cause.code : (typeof (error as { code?: unknown }).code === 'string' ? String((error as { code?: unknown }).code) : '')
  const raw = error instanceof Error ? error.message : String(error)
  const unreachable = code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ECONNRESET' || /fetch failed/i.test(raw)
  if (!unreachable) return new GenBoxError('GenBox request ' + path + ' failed: ' + raw)
  return new GenBoxError(
    'GenBox is not answering at ' + baseUrl + ' (' + path + (code === '' ? '' : ', ' + code) + '). '
    + 'Start the GenBox server, or point the plugin baseUrl at the port it actually listens on. '
    + 'genbox_open_workbench reports the workbench URL and genbox_doctor checks the whole setup.',
  )
}

/** Read-only HTTP client for a running GenBox FastAPI server. */
export class GenBoxClient {
  readonly baseUrl: string
  private readonly adminKey: string | undefined
  private readonly requestTimeoutMs: number

  constructor(options: GenBoxClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.adminKey = options.adminKey && options.adminKey.trim() !== '' ? options.adminKey : undefined
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120000
  }

  private headers(json: boolean): Headers {
    const headers = new Headers()
    if (json) headers.set('Content-Type', 'application/json')
    if (this.adminKey) headers.set('X-Admin-Key', this.adminKey)
    return headers
  }

  private signal(signal: AbortSignal | undefined, timeoutMs?: number | undefined): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs ?? this.requestTimeoutMs)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  async json<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal | undefined,
    timeoutMs?: number | undefined,
  ): Promise<T> {
    const init: RequestInit = {
      method,
      headers: this.headers(body !== undefined),
      signal: this.signal(signal, timeoutMs),
    }
    if (body !== undefined) init.body = JSON.stringify(body)
    let response: Response
    try {
      response = await fetch(this.baseUrl + path, init)
    } catch (error) {
      // A cancellation or a timeout is about this call, not about reachability.
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) throw error
      throw transportError(this.baseUrl, path, error)
    }
    const text = await response.text()
    if (!response.ok) {
      throw new GenBoxError(
        'GenBox ' + method + ' ' + path + ' failed (HTTP ' + response.status + '): ' + text.slice(0, 500),
        response.status,
      )
    }
    return (text ? JSON.parse(text) : null) as T
  }

  /** GET /api/status - liveness and configured-provider summary. */
  status(signal?: AbortSignal | undefined): Promise<JsonObject> {
    return this.json<JsonObject>('GET', '/api/status', undefined, signal)
  }

  /** Poll a task endpoint until the predicate accepts the payload. */
  async waitFor<T>(
    path: string,
    isDone: (value: T) => boolean,
    options: { intervalMs?: number | undefined; timeoutMs?: number | undefined; signal?: AbortSignal | undefined } = {},
  ): Promise<T> {
    const intervalMs = options.intervalMs ?? 2000
    const deadline = Date.now() + (options.timeoutMs ?? 900000)
    for (;;) {
      const value = await this.json<T>('GET', path, undefined, options.signal)
      if (isDone(value)) return value
      if (Date.now() > deadline) throw new GenBoxError('Timed out waiting for ' + path)
      await this.sleep(intervalMs, options.signal)
    }
  }

  private sleep(ms: number, signal?: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      if (signal?.aborted === true) onAbort()
      else signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  /** Download a media URL (or an absolute GenBox path) into a local file. */
  async download(urlOrPath: string, targetPath: string, signal?: AbortSignal | undefined): Promise<string> {
    const url = /^https?:/i.test(urlOrPath)
      ? urlOrPath
      : this.baseUrl + (urlOrPath.startsWith('/') ? urlOrPath : '/' + urlOrPath)
    const init: RequestInit = { headers: this.headers(false) }
    if (signal !== undefined) init.signal = signal
    let response: Response
    try {
      response = await fetch(url, init)
    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) throw error
      throw transportError(this.baseUrl, url, error)
    }
    if (!response.ok) throw new GenBoxError('Download failed (HTTP ' + response.status + '): ' + url, response.status)
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, Buffer.from(await response.arrayBuffer()))
    return targetPath
  }
}
