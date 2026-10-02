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

type VideoOutcome = {
  background: boolean
  taskId: string
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
          return [{
            type: 'text' as const,
            text: 'genbox_video_generate — submitted as task ' + result.taskId
              + '. It keeps running on the GenBox host; check it with genbox_task (kind="video").',
          }]
        }
        const lines = [
          'genbox_video_generate — ' + result.status + ' in ' + result.elapsedSeconds + 's (task ' + result.taskId + ')',
        ]
        if (result.file !== undefined) lines.push('- ' + result.file)
        if (result.error !== undefined) lines.push('- error: ' + result.error)
        return [{ type: 'text' as const, text: lines.join('\n') }]
      },
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
      )
      const taskId = created.task_id ?? created.id
      if (taskId === undefined) {
        throw new Error('GenBox did not return a video task id: ' + JSON.stringify(created).slice(0, 300))
      }

      if (args.background === true) {
        return { background: true, taskId, status: 'queued', elapsedSeconds: 0 }
      }

      const final = await client.waitFor<VideoStatus>(
        '/api/video/status/' + encodeURIComponent(taskId),
        (value) => TERMINAL_STATUSES.has(value.status ?? ''),
        { intervalMs: Math.max(config.pollIntervalMs, 5000), timeoutMs: config.taskTimeoutMs, signal: exec.signal },
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
        const file = outputPath(resolveOutputDir(config.outputDir, args.outputDir), basename(localPath))
        await client.download('/api/video/file/' + encodeURIComponent(basename(localPath)), file, exec.signal)
        outcome.file = file
      } else if (typeof final.video_url === 'string' && final.video_url !== '') {
        outcome.videoUrl = final.video_url
      }
      return outcome
    },
  }))
}
