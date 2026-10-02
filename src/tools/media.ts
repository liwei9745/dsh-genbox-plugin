import { basename, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenBoxClient } from '../client.js'
import type { Config } from '../config.js'
import { resolveOutputDir } from '../media.js'

interface RawGalleryItem {
  id?: string
  type?: string
  model?: string
  prompt?: string
  local_path?: string | null
  created_at?: string
  duration?: number | null
  file_size?: number | null
}

type GalleryEntry = {
  id: string
  type: string
  model?: string
  prompt?: string
  createdAt?: string
  durationSeconds?: number
  fileSize?: number
  file?: string
}

type GalleryResult = {
  total: number
  items: GalleryEntry[]
}

type OptimizeResult = {
  original: string
  optimized: string
  optimizedByLlm: boolean
  provider: string
  error?: string
}

export function registerMediaTools(ctx: Context, client: GenBoxClient, config: Config) {
  ctx.tools.register(defineTool({
    name: 'genbox_gallery',
    description:
      'List the most recent items in the GenBox media library (images and videos, newest first) and optionally copy '
      + 'them to a local directory. GenBox has no paging, so only the newest entries are reachable.',
    parameters: {
      limit: { type: 'number', description: 'How many recent items to return (GenBox default 50).' },
      type: { type: 'string', enum: ['image', 'video', 'all'], description: "Filter by media type; defaults to 'all'." },
      downloadTo: {
        type: 'string',
        description: 'When set, copy every matching item into this directory (relative paths resolve against the session workspace).',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const result = value as unknown as GalleryResult
        const lines = ['genbox_gallery — ' + result.total + ' item(s)']
        for (const item of result.items) {
          const parts = [item.type, item.id]
          if (item.model !== undefined && item.model !== '') parts.push(item.model)
          if (item.file !== undefined) parts.push('-> ' + item.file)
          lines.push('- ' + parts.join(' | '))
          if (item.prompt !== undefined && item.prompt !== '') lines.push('    ' + item.prompt.slice(0, 120))
        }
        return [{ type: 'text' as const, text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 20
      const response = await client.json<{ items?: RawGalleryItem[] }>(
        'GET',
        '/api/gallery?limit=' + String(limit),
        undefined,
        exec.signal,
      )
      const wanted = args.type ?? 'all'
      const raw = (response.items ?? []).filter((item) => wanted === 'all' || (item.type ?? 'image') === wanted)
      const directory = args.downloadTo !== undefined && args.downloadTo !== ''
        ? resolveOutputDir(config.outputDir, args.downloadTo)
        : undefined

      const items: GalleryEntry[] = []
      for (const raw_item of raw) {
        const entry: GalleryEntry = { id: raw_item.id ?? '', type: raw_item.type ?? 'image' }
        if (raw_item.model !== undefined && raw_item.model !== '') entry.model = raw_item.model
        if (raw_item.prompt !== undefined && raw_item.prompt !== '') entry.prompt = raw_item.prompt
        if (raw_item.created_at !== undefined) entry.createdAt = raw_item.created_at
        if (typeof raw_item.duration === 'number') entry.durationSeconds = raw_item.duration
        if (typeof raw_item.file_size === 'number') entry.fileSize = raw_item.file_size
        const localPath = raw_item.local_path
        if (directory !== undefined && typeof localPath === 'string' && localPath !== '') {
          const filename = basename(localPath)
          const route = entry.type === 'video' ? '/api/video/file/' : '/api/gallery/image/'
          const target = join(directory, filename)
          await client.download(route + encodeURIComponent(filename), target, exec.signal)
          entry.file = target
        }
        items.push(entry)
      }
      return { total: items.length, items }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'genbox_prompt_optimize',
    description:
      "Rewrite a rough image prompt into a richer one with GenBox's configured prompt-assistant LLM. When no LLM "
      + 'provider is configured GenBox returns the original text unchanged and sets optimizedByLlm=false.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'The rough prompt to improve.' },
      provider: { type: 'string', description: 'LLM provider id to use; defaults to the configured one.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const result = value as unknown as OptimizeResult
        return [{
          type: 'text' as const,
          text: (result.optimizedByLlm ? 'optimized by ' + result.provider : 'NOT optimized (no LLM provider)')
            + ':\n' + result.optimized
            + (result.error === undefined ? '' : '\n(error: ' + result.error + ')'),
        }]
      },
    },
    async execute(args, exec) {
      const body: Record<string, unknown> = { prompt: args.prompt }
      if (args.provider !== undefined && args.provider !== '') body.llm_provider_id = args.provider
      const response = await client.json<{
        original?: string
        optimized?: string
        optimized_by_llm?: boolean
        provider?: string
        error?: string | null
      }>('POST', '/api/llm/optimize', body, exec.signal)
      const result: OptimizeResult = {
        original: response.original ?? args.prompt,
        optimized: response.optimized ?? args.prompt,
        optimizedByLlm: response.optimized_by_llm === true,
        provider: response.provider ?? '',
      }
      if (typeof response.error === 'string' && response.error !== '') result.error = response.error
      return result
    },
  }))
}
