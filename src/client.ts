import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { JsonObject } from './json.js'

export interface GenBoxClientOptions {
  baseUrl: string
  adminKey?: string
  requestTimeoutMs?: number
  /** Base wait before retrying a rate-limited call; doubles per attempt (default 5000 ms). */
  busyRetryDelayMs?: number
  /**
   * Extra URLs to try when the configured one does not answer. GenBox's own default port is
   * 8891 while this plugin's default is 8892, so without this a fresh install fails its very
   * first call for no better reason than a port mismatch.
   */
  fallbackBaseUrls?: string[]
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
function transportError(baseUrl: string, path: string, error: unknown, tried: string[] = []): GenBoxError {
  const cause = (error as { cause?: { code?: unknown } }).cause
  const code = typeof cause?.code === 'string' ? cause.code : (typeof (error as { code?: unknown }).code === 'string' ? String((error as { code?: unknown }).code) : '')
  const raw = error instanceof Error ? error.message : String(error)
  const unreachable = code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ECONNRESET' || /fetch failed/i.test(raw)
  if (!unreachable) return new GenBoxError('GenBox request ' + path + ' failed: ' + raw)
  const others = tried.filter((url) => url !== baseUrl)
  const alsoTried = others.length > 0 ? ' Nothing answered there either (also tried ' + others.join(', ') + ').' : ''
  return new GenBoxError(
    'GenBox is not answering at ' + baseUrl + ' (' + path + (code === '' ? '' : ', ' + code) + ').' + alsoTried + ' '
    + 'Start it with genbox_server (action=status to check, action=start to launch), or point the '
    + 'plugin baseUrl at the port it actually listens on; genbox_doctor checks the whole setup.',
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

/** How long a single reachability probe may take while locating the server. */
const LOCATE_TIMEOUT_MS = 2500

/** Trim the trailing slashes a hand-written URL tends to carry. */
function stripSlashes(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** Read-only HTTP client for a running GenBox FastAPI server. */
export class GenBoxClient {
  /** The URL configuration asked for; `baseUrl` reports where the server was actually found. */
  readonly configuredBaseUrl: string
  /** Every URL worth trying, configured one first, without duplicates. */
  readonly candidates: string[]
  private resolvedBaseUrl: string
  private located = false
  private readonly adminKey: string | undefined
  private readonly requestTimeoutMs: number
  private readonly busyRetryDelayMs: number

  constructor(options: GenBoxClientOptions) {
    this.configuredBaseUrl = stripSlashes(options.baseUrl)
    this.resolvedBaseUrl = this.configuredBaseUrl
    const extra = (options.fallbackBaseUrls ?? []).map(stripSlashes)
    this.candidates = [this.configuredBaseUrl, ...extra].filter((url, index, all) => url !== '' && all.indexOf(url) === index)
    this.adminKey = options.adminKey && options.adminKey.trim() !== '' ? options.adminKey : undefined
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120000
    this.busyRetryDelayMs = options.busyRetryDelayMs ?? 5000
  }

  /** Where GenBox actually answers: the configured URL, or the first fallback that does. */
  get baseUrl(): string {
    return this.resolvedBaseUrl
  }

  /** True once something other than the configured URL answered. */
  get usingFallback(): boolean {
    return this.resolvedBaseUrl !== this.configuredBaseUrl
  }

  /** Forget the resolved URL so the next request probes the candidates again. */
  forgetLocation(): void {
    this.located = false
    this.resolvedBaseUrl = this.configuredBaseUrl
  }

  /**
   * Probe the configured URL and then each fallback, and remember the first that answers.
   * Cached until a request fails to connect, which invalidates it so the next call probes
   * again - a GenBox restarted on another port is picked up without a plugin reload.
   */
  async locate(signal?: AbortSignal | undefined): Promise<string> {
    for (const candidate of this.candidates) {
      try {
        const response = await fetch(candidate + '/api/setup/status', { signal: this.signal(signal, LOCATE_TIMEOUT_MS) })
        if (response.ok) {
          this.resolvedBaseUrl = candidate
          this.located = true
          return candidate
        }
      } catch {
        // Not this one; try the next candidate.
      }
    }
    // Nothing answered. Blame the configured URL and stop probing on every call.
    this.resolvedBaseUrl = this.configuredBaseUrl
    this.located = true
    return this.resolvedBaseUrl
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
      if (!this.located) await this.locate(signal)
      const attempted = this.resolvedBaseUrl
      let response: Response
      try {
        response = await fetch(attempted + path, init)
      } catch (error) {
        // A cancellation or a timeout is about this call, not about reachability.
        if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) throw error
        // GenBox may have started - or been restarted on another port - since we last looked.
        this.located = false
        const relocated = await this.locate(signal)
        if (relocated === attempted) throw transportError(attempted, path, error, this.candidates)
        try {
          response = await fetch(relocated + path, init)
        } catch (retryError) {
          if (retryError instanceof Error && (retryError.name === 'AbortError' || retryError.name === 'TimeoutError')) throw retryError
          throw transportError(relocated, path, retryError, this.candidates)
        }
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
    if (!this.located) await this.locate(signal)
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
      throw transportError(this.baseUrl, url, error, this.candidates)
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
