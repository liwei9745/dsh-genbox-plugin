import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenBoxClient } from '../client.js'
import type { Config } from '../config.js'
import { outputPath, resolveOutputDir, toImageData } from '../media.js'

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'error', 'timeout'])

interface VideoStatus {
  task_id?: string
  status?: string
  progress?: number
  elapsed_seconds?: number
  local_path?: string | null
  video_url_local?: string | null
  video_url?: string | null
  error?: string | null
}

interface NativeJobStartSpec {
  kind: string
  label: string
  owner?: string
  run: () => { done: Promise<unknown>; cancel: (reason: string) => void }
}

interface NativeJobsRegistry {
  start(spec: NativeJobStartSpec): string
}

/** The DSH job registry, when the composed host provides one. */
function nativeJobsRegistry(ctx: Context): NativeJobsRegistry | undefined {
  const candidate = (ctx as unknown as { jobs?: NativeJobsRegistry }).jobs
  return candidate !== undefined && typeof candidate.start === 'function' ? candidate : undefined
}

type VideoOutcome = {
  background: boolean
  taskId: string
  jobId?: string
  status: string
  elapsedSeconds: number
  file?: string
  videoUrl?: string
  error?: string
}

export function registerVideoTools(ctx: Context, client: GenBoxClient, config: Config) {
  ctx.tools.register(defineTool({
    name: 'genbox_video_generate',
    description:
      'Generate a video through a local GenBox server: text-to-video (mode=ti2vid), image-to-video (mode=i2vid with '
      + 'one reference image) or first/last keyframes (mode=keyframes with exactly two images). GenBox keeps working '
      + 'after the request returns, so this polls the task and downloads the finished clip.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'The video prompt.' },
      mode: { type: 'string', enum: ['ti2vid', 'i2vid', 'keyframes'], description: "Generation mode; defaults to 'ti2vid'." },
      images: {
        type: 'array',
        items: { type: 'string' },
        description: 'Reference images (local paths or data URLs). i2vid takes one; keyframes takes two.',
      },
      imageRole: {
        type: 'string',
        enum: ['first_frame', 'last_frame', 'reference', 'first_last'],
        description: 'How the images are used; keyframes implies first_last.',
      },
      provider: { type: 'string', description: 'Video provider id; defaults to the first configured video provider.' },
      model: { type: 'string', description: 'Model id to request.' },
      width: { type: 'number', description: 'Frame width in pixels (GenBox default 1152).' },
      height: { type: 'number', description: 'Frame height in pixels (GenBox default 768).' },
      durationSeconds: { type: 'number', description: 'Requested duration in seconds; GenBox clamps it to the model spec.' },
      fps: { type: 'number', description: 'Frame rate (GenBox default 24).' },
      negativePrompt: { type: 'string', description: 'What to avoid.' },
      seed: { type: 'number', description: 'Deterministic seed when the provider supports it.' },
      outputDir: { type: 'string', description: 'Directory for the downloaded clip. Defaults to the plugin outputDir config.' },
      background: {
        type: 'boolean',
        description: 'Return as soon as GenBox accepts the job instead of waiting for the clip. Poll with genbox_task - recommended for videos.',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const result = value as unknown as VideoOutcome
        if (result.background) {
          const hint = result.jobId !== undefined
            ? 'It is registered as DSH job ' + result.jobId + ' (use job_output / job_kill).'
            : 'It keeps running on the GenBox host; check it with genbox_task (kind="video").'
          return [{
            type: 'text' as const,
            text: 'genbox_video_generate — submitted as task ' + result.taskId + '. ' + hint,
          }]
        }
        const lines = [
          'genbox_video_generate — ' + result.status + ' in ' + result.elapsedSeconds + 's (task ' + result.taskId + ')',
        ]
        if (result.file !== undefined) lines.push('- ' + result.file)
        if (result.error !== undefined) lines.push('- error: ' + result.error)
        return [{ type: 'text' as const, text: lines.join('\n') }]
      },
      presentationMeta: (_args, value) => {
        const result = value as unknown as VideoOutcome
        return { status: result.status, taskId: result.taskId, background: result.background, file: result.file ?? null }
      },
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Generate video (' + String(args.mode ?? 'ti2vid') + '): ' + String(args.prompt).slice(0, 70),
      kind: 'execute',
      rawInput: JSON.stringify({ prompt: args.prompt, provider: args.provider, background: args.background === true }, null, 2),
    }),
    presentResult: (_args, result) => {
      const meta = result.meta as { file?: unknown; status?: unknown; taskId?: unknown } | undefined
      const file = typeof meta?.file === 'string' ? meta.file : ''
      return {
        card: 'generic',
        title: file !== '' ? 'Video written to ' + file : 'Video job ' + String(meta?.status ?? 'finished') + ' (' + String(meta?.taskId ?? '?') + ')',
        ...(file !== '' ? { locations: [{ path: file }] } : {}),
      }
    },
    async execute(args, exec) {
      const mode = args.mode ?? 'ti2vid'
      const body: Record<string, unknown> = { prompt: args.prompt, mode }
      if (args.provider !== undefined && args.provider !== '') body.provider_id = args.provider
      if (args.model !== undefined && args.model !== '') body.model = args.model
      if (typeof args.width === 'number') body.width = args.width
      if (typeof args.height === 'number') body.height = args.height
      if (typeof args.durationSeconds === 'number') body.duration_seconds = args.durationSeconds
      if (typeof args.fps === 'number') {
        body.frame_rate = args.fps
        if (typeof args.durationSeconds === 'number') body.num_frames = Math.round(args.durationSeconds * args.fps)
      }
      if (args.negativePrompt !== undefined && args.negativePrompt !== '') body.negative_prompt = args.negativePrompt
      if (typeof args.seed === 'number') body.seed = args.seed
      if (args.images !== undefined && args.images.length > 0) {
        body.image = await Promise.all(args.images.map((image) => toImageData(image)))
      }
      if (args.imageRole !== undefined) body.image_role = args.imageRole

      // Gemini/Flow2API style providers keep the POST open for up to 300s.
      const created = await client.json<{ task_id?: string; id?: string; status?: string }>(
        'POST',
        '/api/video/generate',
        body,
        exec.signal,
        360000,
        3,
      )
      const taskId = created.task_id ?? created.id
      if (taskId === undefined) {
        throw new Error('GenBox did not return a video task id: ' + JSON.stringify(created).slice(0, 300))
      }

      const directory = resolveOutputDir(config.outputDir, args.outputDir)

      /** Poll the task to its terminal state and fetch the finished clip. */
      const settle = async (signal: AbortSignal | undefined): Promise<VideoOutcome> => {
        const final = await client.waitFor<VideoStatus>(
          '/api/video/status/' + encodeURIComponent(taskId),
          (value) => TERMINAL_STATUSES.has(value.status ?? ''),
          { intervalMs: Math.max(config.pollIntervalMs, 5000), timeoutMs: config.taskTimeoutMs, signal },
        )
        const outcome: VideoOutcome = {
          background: false,
          taskId,
          status: final.status ?? 'unknown',
          elapsedSeconds: final.elapsed_seconds ?? 0,
        }
        if (typeof final.error === 'string' && final.error !== '') outcome.error = final.error
        const localPath = final.local_path
        if (typeof localPath === 'string' && localPath !== '') {
          const file = outputPath(directory, basename(localPath))
          await client.download('/api/video/file/' + encodeURIComponent(basename(localPath)), file, signal)
          outcome.file = file
        } else if (typeof final.video_url === 'string' && final.video_url !== '') {
          outcome.videoUrl = final.video_url
        }
        return outcome
      }

      if (args.background === true) {
        const registry = config.nativeJobs ? nativeJobsRegistry(ctx) : undefined
        if (registry !== undefined) {
          // Hand the waiting to the DSH job registry so it outlives this tool call.
          // The job deliberately ignores exec.signal: the call is over already.
          const owner = (exec as unknown as { agent?: { id?: string } }).agent?.id
          try {
            const jobId = registry.start({
              kind: 'genbox-video',
              label: args.prompt.slice(0, 80),
              ...(owner !== undefined ? { owner } : {}),
              run: () => ({
                done: settle(undefined),
                cancel: () => {
                  void client
                    .json('POST', '/api/video/cancel/' + encodeURIComponent(taskId), undefined, exec.signal)
                    .catch(() => undefined)
                },
              }),
            })
            return { background: true, taskId, jobId, status: 'queued', elapsedSeconds: 0 }
          } catch (error) {
            // The registry refuses when no job controller serves this owner:
            //   "background jobs unavailable: no job controller serves this agent
            //    (load @deepseek-ai/dsh-tool-jobs in its composition)".
            // That must never lose the task - GenBox is already working on it - so
            // fall back to the plain handle and let the caller poll genbox_task.
            console.warn('[genbox] job registry refused the job, using the GenBox task handle instead: ' + (error as Error).message)
          }
        }
        return { background: true, taskId, status: 'queued', elapsedSeconds: 0 }
      }

      return await settle(exec.signal)
    },
  }))
}
