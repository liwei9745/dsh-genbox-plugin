import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenBoxClient } from '../client.js'
import type { Config } from '../config.js'
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
}

type VariationResult = {
  files: string[]
  providerId: string
  model: string
}

type CutoutResult = {
  file: string
  width: number
  height: number
  adapter: string
  galleryUrl: string
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
        }]
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
      }
    },
  }))

  // --------------------------------------------------------------- variations
  ctx.tools.register(defineTool({
    name: 'genbox_image_variations',
    description:
      'Ask a GenBox image provider for visual variations of an existing image. This is synchronous and requires a '
      + 'configured provider with an API key.',
    parameters: {
      image: { type: 'string', required: true, description: 'Source image: a local png/jpeg/webp path or a data URL.' },
      provider: { type: 'string', description: 'Provider id to use; defaults to the first enabled image provider.' },
      model: { type: 'string', description: 'Model id to request.' },
      size: { type: 'string', description: "Canvas size such as '1024x1024'." },
      n: { type: 'number', description: 'How many variations (1-4, default 1).' },
      outputDir: { type: 'string', description: 'Directory for the results. Defaults to the plugin outputDir config.' },
    },
    output: {
      schema: OBJECT_SCHEMA,
      render: (_args, value) => {
        const result = value as unknown as VariationResult
        const lines = ['genbox_image_variations — ' + result.files.length + ' image(s) from ' + result.providerId]
        for (const file of result.files) lines.push('- ' + file)
        return [{ type: 'text' as const, text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
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
      return { files, providerId: response.provider_id ?? '', model: response.model ?? '' }
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
      }
    },
  }))
}
