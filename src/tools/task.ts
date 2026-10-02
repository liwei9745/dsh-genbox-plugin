import { basename, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenBoxClient } from '../client.js'
import type { Config } from '../config.js'
import { galleryFilename, resolveOutputDir } from '../media.js'

const IMAGE_TERMINAL = new Set(['completed', 'failed', 'cancelled'])
const VIDEO_TERMINAL = new Set(['completed', 'failed', 'cancelled', 'error', 'timeout'])

interface ImageStatus {
  status?: string
  progress?: number
  elapsed_seconds?: number
  results?: Record<string, { success?: boolean; local_path?: string | null; error?: string | null; model?: string }>
}

interface VideoStatus {
  status?: string
  progress?: number
  elapsed_seconds?: number
  local_path?: string | null
  video_url_local?: string | null
  error?: string | null
}

type TaskResult = {
  id: string
  kind: string
  status: string
  progress: number
  elapsedSeconds: number
  running: boolean
  files: string[]
  failures: string[]
  error?: string
}

function baseResult(id: string, kind: string, status: string): TaskResult {
  return { id, kind, status, progress: 0, elapsedSeconds: 0, running: false, files: [], failures: [] }
}

export function registerTaskTool(ctx: Context, client: GenBoxClient, config: Config) {
  ctx.tools.register(defineTool({
    name: 'genbox_task',
    description:
      'Check or cancel a GenBox job. Use it for jobs that were submitted with background=true from '
      + 'genbox_image_generate, genbox_image_edit or genbox_video_generate. Once the job has finished this downloads '
      + 'its results next to the session and returns their local paths.',
    parameters: {
      id: { type: 'string', required: true, description: 'The generation id or video task id returned by the submit call.' },
      kind: { type: 'string', enum: ['image', 'video'], description: "Job kind; defaults to 'video'." },
      cancel: { type: 'boolean', description: 'Request cancellation instead of reading status.' },
      outputDir: { type: 'string', description: 'Directory for downloaded results. Defaults to the plugin outputDir config.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const result = value as unknown as TaskResult
        const lines = [
          'genbox_task ' + result.kind + ' ' + result.id + ' — ' + result.status
            + ' (' + result.progress + '%, ' + result.elapsedSeconds + 's)',
        ]
        for (const file of result.files) lines.push('- ' + file)
        for (const failure of result.failures) lines.push('- FAILED: ' + failure)
        if (result.error !== undefined) lines.push('- error: ' + result.error)
        if (result.running) lines.push('Still running; call genbox_task again in a moment.')
        return [{ type: 'text' as const, text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const kind = args.kind ?? 'video'
      const id = args.id
      const directory = resolveOutputDir(config.outputDir, args.outputDir)

      if (args.cancel === true) {
        const cancelPath = kind === 'image' ? '/api/generate/cancel/' : '/api/video/cancel/'
        const response = await client.json<{ status?: string }>(
          'POST',
          cancelPath + encodeURIComponent(id),
          undefined,
          exec.signal,
        )
        return baseResult(id, kind, response.status ?? 'cancelled')
      }

      if (kind === 'image') {
        const status = await client.json<ImageStatus>(
          'GET',
          '/api/generate/status/' + encodeURIComponent(id),
          undefined,
          exec.signal,
        )
        const result = baseResult(id, kind, status.status ?? 'unknown')
        result.progress = status.progress ?? 0
        result.elapsedSeconds = status.elapsed_seconds ?? 0
        result.running = !IMAGE_TERMINAL.has(result.status)
        if (!result.running) {
          for (const [providerId, entry] of Object.entries(status.results ?? {})) {
            const localPath = entry.local_path
            if (entry.success === true && typeof localPath === 'string' && localPath !== '') {
              const filename = galleryFilename(localPath)
              const target = join(directory, filename)
              await client.download('/api/gallery/image/' + encodeURIComponent(filename), target, exec.signal)
              result.files.push(target)
            } else {
              result.failures.push(providerId + ': ' + (entry.error ?? 'failed without an error message'))
            }
          }
        }
        return result
      }

      const status = await client.json<VideoStatus>(
        'GET',
        '/api/video/status/' + encodeURIComponent(id),
        undefined,
        exec.signal,
      )
      const result = baseResult(id, kind, status.status ?? 'unknown')
      result.progress = status.progress ?? 0
      result.elapsedSeconds = status.elapsed_seconds ?? 0
      result.running = !VIDEO_TERMINAL.has(result.status)
      if (typeof status.error === 'string' && status.error !== '') result.error = status.error
      const localPath = status.local_path
      if (typeof localPath === 'string' && localPath !== '') {
        const filename = basename(localPath)
        const target = join(directory, filename)
        await client.download('/api/video/file/' + encodeURIComponent(filename), target, exec.signal)
        result.files.push(target)
      }
      return result
    },
  }))
}
