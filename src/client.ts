import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { JsonObject } from './json.js'

export interface GenBoxClientOptions {
  baseUrl: string
  adminKey?: string
  requestTimeoutMs?: number
  /** Base wait before retrying a rate-limited call; doubles per attempt (default 5000 ms). */
  busyRetryDelayMs?: number
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

function clip(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) + '...' : value
}

/**
 * GenBox answers failures with a FastAPI-style body whose human sentence can sit at
 * several depths: `{"detail": "..."}`, `{"detail": {"error": code, "message": text}}`
 * or `{"error": code, "message": text}`. Quote the sentence, not the JSON.
 */
function describeFailure(text: string, limit = 400): string {
  const trimmed = text.trim()
  if (trimmed === '') return '(empty response body)'
  try {
    const body = JSON.parse(trimmed) as unknown
    const detail = (body as { detail?: unknown } | null)?.detail ?? body
    if (typeof detail === 'string' && detail !== '') return clip(detail, limit)
    if (detail !== null && typeof detail === 'object') {
      const record = detail as { message?: unknown; error?: unknown; detail?: unknown; code?: unknown }
      const message = typeof record.message === 'string' ? record.message : undefined
      const code = typeof record.error === 'string'
        ? record.error
        : (typeof record.code === 'string' ? record.code : (typeof record.detail === 'string' ? record.detail : undefined))
      if (message !== undefined && code !== undefined && message !== code) return clip(message + ' (' + code + ')', limit)
      if (message !== undefined) return clip(message, limit)
      if (code !== undefined) return clip(code, limit)
    }
  } catch {
    // Not JSON: fall through to the raw body.
  }
  return clip(trimmed, limit)
}

/** Whether a failed poll is worth retrying (transport hiccup, 5xx, 429 or 408). */
function isRetryable(error: unknown): boolean {
  if (!(error instanceof GenBoxError)) return true
  const status = error.status
  if (status === undefined) return true
  return status >= 500 || status === 429 || status === 408
}

/** Read-only HTTP client for a running GenBox FastAPI server. */
export class GenBoxClient {
  readonly baseUrl: string
  private readonly adminKey: string | undefined
  private readonly requestTimeoutMs: number
  private readonly busyRetryDelayMs: number

  constructor(options: GenBoxClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.adminKey = options.adminKey && options.adminKey.trim() !== '' ? options.adminKey : undefined
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120000
    this.busyRetryDelayMs = options.busyRetryDelayMs ?? 5000
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
    /** Wait out this many "GenBox is busy" answers (HTTP 429) before giving up. */
    busyRetries = 0,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
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
      if (response.ok) return (text ? JSON.parse(text) : null) as T

      // GenBox answers 429 when its generation rate limit is hit (the upstream
      // default is 10 requests per minute per IP, and only /api/generate is
      // throttled). The request was refused, so waiting and asking again cannot
      // duplicate work - and a submit that just fails makes the caller redo
      // everything. The wait doubles per attempt (5s, 10s, 20s by default).
      //
      // Only 429: GenBox reports permanent "this feature is not installed" states
      // (the missing cutout checkpoint) as 503, and waiting on those just delays a
      // message the caller needs now.
      const busy = response.status === 429
      if (busy && attempt < busyRetries) {
        // The upstream limit is per minute (10 generate requests per IP), so a flat
        // short wait rarely clears it: back off further each attempt.
        const waitMs = Math.min(this.busyRetryDelayMs * 2 ** attempt, 30000)
        console.warn('[genbox] GenBox is rate limiting (' + response.status + '), retrying ' + path + ' in ' + waitMs + 'ms')
        await this.sleep(waitMs, signal)
        continue
      }
      throw new GenBoxError(
        'GenBox ' + method + ' ' + path + ' failed (HTTP ' + response.status + '): ' + describeFailure(text)
        + (busy
          ? ' (still rate limited after ' + (attempt + 1) + ' attempt(s): GenBox throttles generations - the upstream'
            + ' default is 10 per minute per IP - so wait a moment or send fewer at once)'
          : ''),
        response.status,
      )
    }
  }

  /** GET /api/status - liveness and configured-provider summary. */
  status(signal?: AbortSignal | undefined): Promise<JsonObject> {
    return this.json<JsonObject>('GET', '/api/status', undefined, signal)
  }

  /** Poll a task endpoint until the predicate accepts the payload. */
  async waitFor<T>(
    path: string,
    isDone: (value: T) => boolean,
    options: {
      intervalMs?: number | undefined
      timeoutMs?: number | undefined
      signal?: AbortSignal | undefined
      /** Consecutive retryable poll failures to absorb before giving up. */
      toleratedFailures?: number | undefined
    } = {},
  ): Promise<T> {
    const intervalMs = options.intervalMs ?? 2000
    const deadline = Date.now() + (options.timeoutMs ?? 900000)
    // A generated clip can take minutes; one dropped poll must not lose the task.
    const tolerated = options.toleratedFailures ?? 5
    let failures = 0
    let lastError: unknown
    for (;;) {
      try {
        const value = await this.json<T>('GET', path, undefined, options.signal)
        failures = 0
        lastError = undefined
        if (isDone(value)) return value
      } catch (error) {
        // Cancellation, timeouts and permanent refusals belong to the caller.
        if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) throw error
        if (!isRetryable(error)) throw error
        failures += 1
        lastError = error
        if (failures > tolerated) throw error
      }
      if (Date.now() > deadline) {
        if (failures > 0 && lastError !== undefined) throw lastError
        throw new GenBoxError('Timed out waiting for ' + path)
      }
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
    if (!response.ok) {
      const detail = describeFailure(await response.text().catch(() => ''), 200)
      throw new GenBoxError('Download failed (HTTP ' + response.status + '): ' + url + ' - ' + detail, response.status)
    }
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, Buffer.from(await response.arrayBuffer()))
    return targetPath
  }
}
