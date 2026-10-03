import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenBoxClient } from '../client.js'
import type { Config } from '../config.js'
import type { JsonObject } from '../json.js'
import { previewBlocks, previewRefs } from '../preview.js'
import { resolveTargets, runGeneration } from './image.js'
import {
  galleryFilename,
  outputFileName,
  outputPath,
  resolveOutputDir,
  toImageData,
  writeDataUrl,
} from '../media.js'

type UpscaleResult = {
  file: string
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  previews?: JsonObject[]
}

type VariationResult = {
  files: string[]
  providerId: string
  model: string
  strategy?: string
  previews?: JsonObject[]
}

type CutoutResult = {
  file: string
  width: number
  height: number
  adapter: string
  galleryUrl: string
  previews?: JsonObject[]
}

const OBJECT_SCHEMA = { type: 'object', additionalProperties: true } as const

export function registerImageToolbox(ctx: Context, client: GenBoxClient, config: Config) {
  // ------------------------------------------------------------------ upscale
  ctx.tools.register(defineTool({
    name: 'genbox_image_upscale',
    description:
      'Upscale an image locally through GenBox (Lanczos/Bicubic/Nearest). Runs on the GenBox host, needs no provider '
      + 'API key, and returns the path of the upscaled PNG.',
    parameters: {
      image: { type: 'string', required: true, description: 'Source image: a local png/jpeg/webp path or a data URL.' },
      targetWidth: { type: 'number', description: 'Target width in pixels (default 2048).' },
      targetHeight: { type: 'number', description: 'Target height in pixels (default 2048).' },
      method: { type: 'string', enum: ['lanczos3', 'bicubic', 'nearest'], description: "Resampling method; defaults to 'lanczos3'." },
      outputDir: { type: 'string', description: 'Directory for the result. Defaults to the plugin outputDir config.' },
    },
    output: {
      schema: OBJECT_SCHEMA,
      render: (_args, value) => {
        const result = value as unknown as UpscaleResult
        return [{
          type: 'text' as const,
          text: 'genbox_image_upscale -> ' + result.file
            + ' (' + result.originalWidth + 'x' + result.originalHeight + ' => ' + result.width + 'x' + result.height + ')',
        }, ...previewBlocks(result)]
      },
    },
    async execute(args, exec) {
      const body: Record<string, unknown> = { image_data: await toImageData(args.image) }
      if (typeof args.targetWidth === 'number') body.target_width = args.targetWidth
      if (typeof args.targetHeight === 'number') body.target_height = args.targetHeight
      if (args.method !== undefined) body.method = args.method
      const response = await client.json<{
        success?: boolean
        b64_json?: string
        width?: number
        height?: number
        original_width?: number
        original_height?: number
        message?: string
      }>('POST', '/api/images/upscale', body, exec.signal, undefined, 2)
      if (response.b64_json === undefined || response.success === false) {
        throw new Error('GenBox upscale failed: ' + (response.message ?? 'no image data returned'))
      }
      const file = outputPath(resolveOutputDir(config.outputDir, args.outputDir), outputFileName('genbox_upscale', '.png'))
      await writeDataUrl(response.b64_json, file)
      return {
        file,
        width: response.width ?? 0,
        height: response.height ?? 0,
        originalWidth: response.original_width ?? 0,
        originalHeight: response.original_height ?? 0,
        previews: config.previewInChat === false ? [] : await previewRefs(ctx, [file], config.previewLimit),
      }
    },
  }))

  // --------------------------------------------------------------- variations
  // GenBox proxies the legacy OpenAI /images/variations contract straight to the
  // provider. Many gateways (and the gpt-image family) do not implement it, so the
  // prompt strategy repaints candidates from the same source through mode=i2i.
  type VariationArgs = {
    image: string
    provider?: string
    model?: string
    size?: string
    n?: number
    strategy?: string
    outputDir?: string
  }
  type VariationExec = { signal?: AbortSignal | undefined }

  async function nativeVariations(args: VariationArgs, exec: VariationExec) {
    const body: Record<string, unknown> = { image_data: await toImageData(args.image) }
    if (args.provider !== undefined) body.provider_id = args.provider
    if (args.model !== undefined) body.model = args.model
    if (args.size !== undefined) body.size = args.size
    if (typeof args.n === 'number') body.n = args.n
    const response = await client.json<{
      success?: boolean
      images?: Array<{ b64_json?: string; local_path?: string | null }>
      provider_id?: string
      model?: string
    }>('POST', '/api/images/variations', body, exec.signal, undefined, 2)
    const directory = resolveOutputDir(config.outputDir, args.outputDir)
    const files: string[] = []
    let index = 0
    for (const image of response.images ?? []) {
      index += 1
      const file = outputPath(directory, outputFileName('genbox_variation_' + index, '.png'))
      if (typeof image.b64_json === 'string' && image.b64_json !== '') {
        await writeDataUrl(image.b64_json, file)
        files.push(file)
      } else if (typeof image.local_path === 'string' && image.local_path !== '') {
        const filename = galleryFilename(image.local_path)
        await client.download('/api/gallery/image/' + encodeURIComponent(filename), file, exec.signal)
        files.push(file)
      }
    }
    if (files.length === 0) throw new Error('GenBox returned no variations: ' + JSON.stringify(response).slice(0, 300))
    return { files, providerId: response.provider_id ?? '', model: response.model ?? '', strategy: 'native' }
  }

  async function promptVariations(args: VariationArgs, exec: VariationExec) {
    const targets = await resolveTargets(
      client,
      config,
      args.provider === undefined ? undefined : [args.provider],
      args.model,
      exec.signal,
    )
    if (targets.length === 0) {
      throw new Error('No enabled GenBox image provider is available for prompt variations.')
    }
    const count = typeof args.n === 'number' && args.n > 1 ? Math.min(Math.round(args.n), 10) : 1
    const body: Record<string, unknown> = {
      prompt: 'Create a variation of this image: keep the subject and the overall composition, '
        + 'and change the details, lighting, colour palette and camera angle.',
      mode: 'i2i',
      image_data: await toImageData(args.image),
      providers: targets,
    }
    if (args.size !== undefined && args.size !== '') body.size = args.size
    if (args.model !== undefined && args.model.trim() !== '') {
      const settings: Record<string, Record<string, unknown>> = {}
      for (const id of targets) settings[id] = { model: args.model }
      body.provider_settings = settings
    }
    if (count > 1) {
      const quantities: Record<string, number> = {}
      for (const id of targets) quantities[id] = count
      body.quantities = quantities
    }
    const batch = await runGeneration(
      ctx,
      client,
      config,
      body,
      resolveOutputDir(config.outputDir, args.outputDir),
      exec.signal,
      false,
    )
    const files = batch.images.map((image) => image.file)
    if (files.length === 0) {
      throw new Error('Prompt variations produced no images: ' + JSON.stringify(batch.failures).slice(0, 300))
    }
    return {
      files,
      providerId: batch.images[0]?.providerId ?? targets[0] ?? '',
      model: args.model ?? '',
      strategy: 'prompt',
    }
  }

  ctx.tools.register(defineTool({
    name: 'genbox_image_variations',
    description:
      'Ask a GenBox image provider for visual variations of an existing image. '
      + 'GenBox\'s native path proxies the legacy OpenAI /images/variations contract, which some gateways and the '
      + 'gpt-image family do not implement; with strategy="auto" the tool then repaints candidates from the same '
      + 'source through mode=i2i, so variations work with any provider that can edit.',
    parameters: {
      image: { type: 'string', required: true, description: 'Source image: a local png/jpeg/webp path or a data URL.' },
      provider: { type: 'string', description: 'Provider id to use; defaults to the first enabled image provider.' },
      model: { type: 'string', description: 'Model id to request.' },
      size: { type: 'string', description: "Canvas size such as '1024x1024'." },
      n: { type: 'number', description: 'How many variations (1-4 on the native path, up to 10 on the prompt path).' },
      strategy: {
        type: 'string',
        enum: ['auto', 'native', 'prompt'],
        description: "How to make the variations. 'native' posts to GenBox's OpenAI /images/variations proxy; "
          + "'prompt' repaints candidates from the same source with mode=i2i, which works with any provider that can "
          + "edit; 'auto' (default) tries native first and falls back to prompt when the gateway does not implement it.",
      },
      outputDir: { type: 'string', description: 'Directory for the results. Defaults to the plugin outputDir config.' },
    },
    output: {
      schema: OBJECT_SCHEMA,
      render: (_args, value) => {
        const result = value as unknown as VariationResult
        const lines = ['genbox_image_variations — ' + result.files.length + ' image(s) from ' + result.providerId
          + (result.strategy !== undefined ? ' via ' + result.strategy : '')]
        for (const file of result.files) lines.push('- ' + file)
        return [{ type: 'text' as const, text: lines.join('\n') }, ...previewBlocks(result)]
      },
    },
    async execute(args, exec) {
      const strategy = args.strategy ?? 'auto'
      const withPreviews = async (result: VariationResult): Promise<VariationResult> => ({
        ...result,
        previews: config.previewInChat === false ? [] : await previewRefs(ctx, result.files, config.previewLimit),
      })
      if (strategy !== 'prompt') {
        try {
          return await withPreviews(await nativeVariations(args, exec))
        } catch (error) {
          if (strategy === 'native') throw error
          const reason = error instanceof Error ? error.message : String(error)
          console.warn('[genbox] /api/images/variations failed, falling back to prompt variations: ' + reason.slice(0, 160))
        }
      }
      return await promptVariations(args, exec)
    },
  }))

  // ------------------------------------------------------------------- cutout
  ctx.tools.register(defineTool({
    name: 'genbox_cutout',
    description:
      'Remove the background from an image with GenBox\'s local cutout tool and return the transparent PNG path. '
      + 'Requires an installed cutout checkpoint on the GenBox host; the call fails with the host\'s reason otherwise.',
    parameters: {
      image: { type: 'string', required: true, description: 'Source image: a local png/jpeg/webp path or a data URL.' },
      adapter: { type: 'string', description: "Force a specific GenBox cutout adapter id." },
      outputDir: { type: 'string', description: 'Directory for the result. Defaults to the plugin outputDir config.' },
    },
    output: {
      schema: OBJECT_SCHEMA,
      render: (_args, value) => {
        const result = value as unknown as CutoutResult
        return [{
          type: 'text' as const,
          text: 'genbox_cutout -> ' + result.file + ' (' + result.width + 'x' + result.height + ', adapter ' + result.adapter + ')',
        }]
      },
    },
    async execute(args, exec) {
      const body: Record<string, unknown> = {
        contract: 'genbox-cutout-v1',
        image_data: await toImageData(args.image),
      }
      if (args.adapter !== undefined) body.adapter = args.adapter
      const response = await client.json<{
        success?: boolean
        image_data?: string
        width?: number
        height?: number
        adapter?: string
        gallery_url?: string
      }>('POST', '/api/image-tools/cutout', body, exec.signal, undefined, 2)
      if (typeof response.image_data !== 'string' || response.image_data === '') {
        throw new Error('GenBox cutout returned no image: ' + JSON.stringify(response).slice(0, 300))
      }
      const file = outputPath(resolveOutputDir(config.outputDir, args.outputDir), outputFileName('genbox_cutout', '.png'))
      await writeDataUrl(response.image_data, file)
      return {
        file,
        width: response.width ?? 0,
        height: response.height ?? 0,
        adapter: response.adapter ?? '',
        galleryUrl: response.gallery_url ?? '',
        previews: config.previewInChat === false ? [] : await previewRefs(ctx, [file], config.previewLimit),
      }
    },
  }))
}
