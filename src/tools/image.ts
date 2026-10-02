import { mkdir } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { readImageSize, renderAnnotationOverlay, toGenBoxAnnotations, type PixelAnnotation } from '../annotate.js'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenBoxClient } from '../client.js'
import type { Config } from '../config.js'
import { galleryFilename, listProviders, resolveOutputDir, toImageData } from '../media.js'

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])

/**
 * GenBox refuses an edit when the chosen provider never declared the capability the
 * mode needs ("precision_edit_provider_unsupported", "inpaint_provider_unsupported").
 * Naming the enabled providers that WOULD work saves the caller a guessing round.
 */
async function explainProviderUnsupported(
  error: unknown,
  client: GenBoxClient,
  mode: string,
  signal?: AbortSignal | undefined,
): Promise<unknown> {
  const message = error instanceof Error ? error.message : String(error)
  if (!/provider_unsupported/i.test(message)) return error
  const capability = mode === 'inpaint' ? 'inpaint_mask' : 'precision_edit'
  try {
    const providers = await listProviders(client, signal)
    const capable = providers
      .filter((provider) => provider.enabled === true
        && provider.capabilities?.[capability] === true
        // GenBox's own wording: "inpaint requires an enabled image provider with
        // endpoint_type=openai and capabilities.inpaint_mask=true" - a provider on
        // the 'auto' transport does not qualify, even when it declares the mask.
        && (mode !== 'inpaint' || provider.endpoint_type === 'openai'))
      .map((provider) => provider.id)
    // GenBox refuses the mode outright when a provider declares the capability but
    // runs on another transport. Naming that provider plus the one field to change
    // turns a dead end into a fix - measured against a live gpt-image provider, where
    // endpoint_type=auto -> openai was the whole difference.
    const fixable = mode === 'inpaint'
      ? providers.filter((provider) => provider.enabled === true
        && provider.capabilities?.inpaint_mask === true
        && provider.endpoint_type !== 'openai')
        .map((provider) => provider.id)
      : []
    const condition = mode === 'inpaint' ? 'inpaint_mask and endpoint_type=openai' : capability
    const fixHint = fixable.length > 0
      ? ' ' + fixable.join(', ') + (fixable.length === 1 ? ' declares ' : ' declare ') + capability
        + (fixable.length === 1 ? ' but runs on' : ' but run on') + ' a non-openai transport, which GenBox refuses'
        + ' for this mode; setting endpoint_type=openai on ' + (fixable.length === 1 ? 'that provider' : 'those providers')
        + ' unlocks it.'
      : ''
    const capableHint = capable.length > 0
      ? ' Enabled providers with ' + condition + ': ' + capable.join(', ') + '.'
      : ' No enabled provider currently qualifies.'
    return new Error(message + fixHint + capableHint)
  } catch {
    return error
  }
}

interface GenerationResult {
  success?: boolean
  local_path?: string | null
  error?: string | null
  error_code?: string | null
  model?: string
}

interface GenerateStatus {
  generation_id?: string
  status?: string
  elapsed_seconds?: number
  results?: Record<string, GenerationResult>
  enhanced_prompt?: string | null
  llm_error?: string | null
}

type ImageOutcome = {
  providerId: string
  model: string
  file: string
}

type ImageFailure = {
  providerId: string
  model: string
  error: string
}

type ImageBatch = {
  background: boolean
  generationId: string
  status: string
  elapsedSeconds: number
  images: ImageOutcome[]
  failures: ImageFailure[]
}

/** Pick the providers a request should target. */
export async function resolveTargets(
  client: GenBoxClient,
  config: Config,
  requested: string[] | undefined,
  model: string | undefined,
  signal: AbortSignal | undefined,
): Promise<string[]> {
  if (requested !== undefined && requested.length > 0) return requested
  if (config.defaultProviderId.trim() !== '') return [config.defaultProviderId]
  const providers = await listProviders(client, signal)
  const enabled = providers.filter((provider) => (provider.type ?? 'image') === 'image' && provider.enabled === true)
  if (model !== undefined && model.trim() !== '') {
    const matching = enabled.filter((provider) => provider.model === model || (provider.models ?? []).includes(model))
    if (matching.length > 0) return matching.map((provider) => provider.id)
  }
  return enabled.map((provider) => provider.id)
}

function providerSettings(ids: string[], model: string | undefined): Record<string, Record<string, unknown>> {
  const settings: Record<string, Record<string, unknown>> = {}
  if (model === undefined || model.trim() === '') return settings
  for (const id of ids) settings[id] = { model }
  return settings
}

/**
 * GenBox parses upscale_to with int(), so a "WxH" string makes it throw
 * (measured: "invalid literal for int() with base 10: '1024x1024'") and the
 * generation silently keeps the original size. Only the longest edge is accepted.
 */
export function normalizeUpscaleTarget(value: string): string {
  const match = /^\s*(\d+)\s*(?:[x×*]\s*(\d+))?\s*$/.exec(value)
  if (match === null) return value.trim()
  const first = Number(match[1])
  const second = match[2] === undefined ? first : Number(match[2])
  return String(Math.max(first, second))
}

/** Submit a generation and wait for its terminal state. */
export async function runGeneration(
  client: GenBoxClient,
  config: Config,
  body: Record<string, unknown>,
  outputDir: string,
  signal: AbortSignal | undefined,
  background: boolean,
): Promise<ImageBatch> {
  // 3 extra attempts: GenBox answers 429 while one of its own generations is in flight.
  const created = await client.json<{ generation_id?: string }>('POST', '/api/generate', body, signal, undefined, 3)
  const generationId = created.generation_id
  if (generationId === undefined) {
    throw new Error('GenBox did not return a generation_id: ' + JSON.stringify(created))
  }

  if (background) {
    return { background: true, generationId, status: 'queued', elapsedSeconds: 0, images: [], failures: [] }
  }

  const final = await client.waitFor<GenerateStatus>(
    '/api/generate/status/' + encodeURIComponent(generationId),
    (value) => TERMINAL_STATUSES.has(value.status ?? ''),
    { intervalMs: config.pollIntervalMs, timeoutMs: config.taskTimeoutMs, signal },
  )

  await mkdir(outputDir, { recursive: true })
  const images: ImageOutcome[] = []
  const failures: ImageFailure[] = []
  for (const [providerId, result] of Object.entries(final.results ?? {})) {
    const model = result.model ?? providerId
    const localPath = result.local_path
    if (result.success === true && typeof localPath === 'string' && localPath !== '') {
      const filename = galleryFilename(localPath)
      const target = join(outputDir, filename)
      await client.download('/api/gallery/image/' + encodeURIComponent(filename), target, signal)
      images.push({ providerId, model, file: target })
    } else {
      failures.push({
        providerId,
        model,
        error: result.error ?? 'Generation failed without an error message.',
      })
    }
  }
  return {
    background: false,
    generationId,
    status: final.status ?? 'unknown',
    elapsedSeconds: final.elapsed_seconds ?? 0,
    images,
    failures,
  }
}

/** Persisted facts a replay can rebuild the result card from. */
function batchMeta(value: unknown) {
  const batch = value as ImageBatch
  return {
    status: batch.status,
    generationId: batch.generationId,
    files: batch.images.map((image) => image.file),
  }
}

function batchLocations(meta: unknown) {
  const files = (meta as { files?: unknown }).files
  return Array.isArray(files)
    ? files.filter((file): file is string => typeof file === 'string').map((path) => ({ path }))
    : []
}

function renderBatch(headline: string, value: ImageBatch) {
  if (value.background) {
    return [{
      type: 'text' as const,
      text: headline + ' — submitted as generation ' + value.generationId
        + '. It keeps running on the GenBox host; check it with genbox_task (kind="image").',
    }]
  }
  const lines = [headline + ' — ' + value.status + ' in ' + value.elapsedSeconds + 's (generation ' + value.generationId + ')']
  for (const image of value.images) {
    lines.push('- ' + image.providerId + ' [' + image.model + '] -> ' + image.file)
  }
  for (const failure of value.failures) {
    lines.push('- FAILED ' + failure.providerId + ' [' + failure.model + ']: ' + failure.error)
  }
  if (value.images.length === 0) {
    lines.push('No images were produced.')
  } else {
    lines.push('Call read_image on a path above to look at a generated image.')
  }
  return [{ type: 'text' as const, text: lines.join('\n') }]
}

const BATCH_SCHEMA = { type: 'object', additionalProperties: true } as const

export function registerImageTools(ctx: Context, client: GenBoxClient, config: Config) {
  // ---------------------------------------------------------------- text to image
  ctx.tools.register(defineTool({
    name: 'genbox_image_generate',
    description:
      'Generate images from a text prompt through a local GenBox server. GenBox fans the same prompt out to one or '
      + 'more configured providers, so several models can be compared in one call. Images are downloaded next to the '
      + 'session and the returned file paths can be shown with read_image.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'The image prompt.' },
      providers: { type: 'array', items: { type: 'string' }, description: 'Provider ids to use. Defaults to every enabled image provider.' },
      model: { type: 'string', description: 'Model id to request. Must belong to the selected provider.' },
      size: { type: 'string', description: "Canvas size such as '1024x1024'. Defaults to the provider's own size." },
      quality: { type: 'string', description: "Quality tier such as 'high' or 'standard'." },
      count: { type: 'number', description: 'Images per provider (1-10). Defaults to 1.' },
      enhancePrompt: { type: 'boolean', description: 'Ask the configured LLM provider to rewrite the prompt first.' },
      outputDir: { type: 'string', description: 'Directory for the downloaded images. Defaults to the plugin outputDir config.' },
      upscaleTo: {
        type: 'string',
        description: "Grow the finished image on the GenBox host before returning: '2048' or '2048x1536' "
          + '(only the longest edge matters - GenBox parses it as an integer, so a WxH string is reduced to its '
          + 'longest edge here). Requires GenBox to have Pillow available, which the packaged builds do.',
      },
      upscaleMethod: { type: 'string', enum: ['lanczos3', 'bicubic', 'nearest'], description: "Resampling for upscaleTo; defaults to 'lanczos3'." },
      upscaleRatio: { type: 'string', description: "Aspect ratio for upscaleTo such as '16:9', or 'original' (default) to keep the source ratio." },
      background: {
        type: 'boolean',
        description: 'Return as soon as GenBox accepts the job instead of waiting for the images. Poll with genbox_task.',
      },
    },
    output: {
      schema: BATCH_SCHEMA,
      render: (_args, value) => renderBatch('genbox_image_generate', value as ImageBatch),
      presentationMeta: (_args, value) => batchMeta(value),
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Generate images: ' + String(args.prompt).slice(0, 80),
      kind: 'execute',
      rawInput: JSON.stringify({ prompt: args.prompt, providers: args.providers, size: args.size, count: args.count }, null, 2),
    }),
    presentResult: (_args, result) => {
      const locations = batchLocations(result.meta)
      return {
        card: 'generic',
        title: locations.length > 0
          ? 'Generated ' + locations.length + ' image(s)'
          : 'GenBox generation ' + String((result.meta as { status?: unknown } | undefined)?.status ?? 'finished'),
        ...(locations.length > 0 ? { locations } : {}),
      }
    },
    async execute(args, exec) {
      const targets = await resolveTargets(client, config, args.providers, args.model, exec.signal)
      if (targets.length === 0) {
        throw new Error(
          'No enabled GenBox image provider is available. Configure a provider in GenBox and give it an API key first.',
        )
      }
      const body: Record<string, unknown> = { prompt: args.prompt, mode: 't2i' }
      if (args.providers !== undefined && args.providers.length > 0) body.providers = args.providers
      if (args.size !== undefined && args.size !== '') body.size = args.size
      if (args.quality !== undefined && args.quality !== '') body.quality = args.quality
      if (args.enhancePrompt === true) body.enhance_prompt = true
      const settings = providerSettings(targets, args.model)
      if (Object.keys(settings).length > 0) body.provider_settings = settings
      if (typeof args.count === 'number' && args.count > 1) {
        const quantities: Record<string, number> = {}
        for (const id of targets) quantities[id] = args.count
        body.quantities = quantities
      }
      if (args.upscaleTo !== undefined && args.upscaleTo.trim() !== '') {
        body.upscale_to = normalizeUpscaleTarget(args.upscaleTo)
        if (args.upscaleMethod !== undefined) body.upscale_method = args.upscaleMethod
        if (args.upscaleRatio !== undefined && args.upscaleRatio !== '') body.upscale_ratio = args.upscaleRatio
      }
      return await runGeneration(
        client,
        config,
        body,
        resolveOutputDir(config.outputDir, args.outputDir),
        exec.signal,
        args.background === true,
      )
    },
  }))

  // ---------------------------------------------------------------- image editing
  ctx.tools.register(defineTool({
    name: 'genbox_image_edit',
    description:
      'Edit an existing image through a local GenBox server. mode=i2i re-renders the whole image from the reference '
      + 'plus a prompt; mode=inpaint repaints only the white area of a mask; mode=precision_edit keeps the original '
      + 'canvas and applies an instruction (resize mode requires precisionTargetSize). inpaint needs a provider whose '
      + 'inpaint_mask capability is enabled, precision_edit one whose precision_edit is; genbox_providers lists both, '
      + 'and this tool names the usable providers when GenBox refuses the mode.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'What to change.' },
      image: { type: 'string', required: true, description: 'Source image: a local png/jpeg/webp path or a data URL.' },
      mode: { type: 'string', enum: ['i2i', 'inpaint', 'precision_edit'], description: "Editing mode; defaults to 'i2i'." },
      mask: { type: 'string', description: 'Required for inpaint: png/webp mask path or data URL, same size as the source. White is edited.' },
      referenceImages: {
        type: 'array',
        items: { type: 'string' },
        description: 'i2i only: extra reference images (local paths or data URLs) to blend with "image", which stays the first/base one. '
          + 'GenBox receives them as image_data_list and requires its first entry to equal the base image.',
      },
      providers: { type: 'array', items: { type: 'string' }, description: 'Provider ids to use. Defaults to every enabled image provider.' },
      model: { type: 'string', description: 'Model id to request. Must belong to the selected provider.' },
      size: { type: 'string', description: "Target canvas for i2i/inpaint, such as '1024x1024'." },
      strength: { type: 'number', description: 'i2i transformation strength (0-1); GenBox defaults to 0.55.' },
      upscaleTo: {
        type: 'string',
        description: "i2i/inpaint only: grow the finished image on the GenBox host, e.g. '2048' or '2048x1536' "
          + '(reduced to its longest edge, which is what GenBox actually parses). precision_edit refuses this - '
          + 'upscale its result with genbox_image_upscale instead.',
      },
      upscaleMethod: { type: 'string', enum: ['lanczos3', 'bicubic', 'nearest'], description: "Resampling for upscaleTo; defaults to 'lanczos3'." },
      upscaleRatio: { type: 'string', description: "Aspect ratio for upscaleTo such as '16:9', or 'original' (default)." },
      precisionTargetSize: { type: 'string', description: "precision_edit only: target canvas 'WIDTHxHEIGHT' required by resize mode." },
      precisionOutputSizePolicy: { type: 'string', enum: ['strict', 'fit_crop'], description: "precision_edit resize output policy; defaults to 'strict'." },
      annotations: {
        type: 'array',
        description: 'precision_edit: what to change and where, in source-image pixels. Each entry is drawn as a numbered marker on the overlay GenBox receives.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['arrow', 'rectangle', 'ellipse', 'brush'], required: true },
            instruction: { type: 'string', required: true },
            x: { type: 'number' },
            y: { type: 'number' },
            x2: { type: 'number' },
            y2: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            points: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: { x: { type: 'number', required: true }, y: { type: 'number', required: true } },
              },
            },
          },
        },
      },
      outputDir: { type: 'string', description: 'Directory for the downloaded results. Defaults to the plugin outputDir config.' },
      background: {
        type: 'boolean',
        description: 'Return as soon as GenBox accepts the job instead of waiting for the result. Poll with genbox_task.',
      },
    },
    output: {
      schema: BATCH_SCHEMA,
      render: (_args, value) => renderBatch('genbox_image_edit', value as ImageBatch),
      presentationMeta: (_args, value) => batchMeta(value),
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Edit image (' + String(args.mode ?? 'i2i') + '): ' + String(args.prompt).slice(0, 70),
      kind: 'execute',
      rawInput: JSON.stringify({ image: args.image, mode: args.mode, annotations: args.annotations?.length ?? 0 }, null, 2),
    }),
    presentResult: (_args, result) => {
      const locations = batchLocations(result.meta)
      return {
        card: 'generic',
        title: locations.length > 0
          ? 'Edited image written to ' + locations.length + ' file(s)'
          : 'GenBox edit ' + String((result.meta as { status?: unknown } | undefined)?.status ?? 'finished'),
        ...(locations.length > 0 ? { locations } : {}),
      }
    },
    async execute(args, exec) {
      const mode = args.mode ?? 'i2i'
      const targets = await resolveTargets(client, config, args.providers, args.model, exec.signal)
      if (targets.length === 0) {
        throw new Error(
          'No enabled GenBox image provider is available. Configure a provider in GenBox and give it an API key first.',
        )
      }
      const body: Record<string, unknown> = { prompt: args.prompt, mode }
      if (args.providers !== undefined && args.providers.length > 0) body.providers = args.providers
      const settings = providerSettings(targets, args.model)
      if (Object.keys(settings).length > 0) body.provider_settings = settings
      if (mode !== 'i2i' && (args.referenceImages ?? []).some((value) => value.trim() !== '')) {
        throw new Error('referenceImages is only for mode=i2i: GenBox takes extra references through image_data_list, '
          + 'which inpaint (single image + mask) and precision_edit (single canvas) reject.')
      }
      if (args.upscaleTo !== undefined && args.upscaleTo.trim() !== '') {
        if (mode === 'precision_edit') {
          throw new Error('precision_edit refuses post-generation upscaling (precision_upscale_not_allowed): '
            + 'generate first, then call genbox_image_upscale on the result.')
        }
        body.upscale_to = normalizeUpscaleTarget(args.upscaleTo)
        if (args.upscaleMethod !== undefined) body.upscale_method = args.upscaleMethod
        if (args.upscaleRatio !== undefined && args.upscaleRatio !== '') body.upscale_ratio = args.upscaleRatio
      }
      if (mode !== 'i2i') body.image_data = await toImageData(args.image)

      if (mode === 'i2i') {
        if (args.size !== undefined && args.size !== '') body.size = args.size
        if (typeof args.strength === 'number') body.strength = args.strength
        const extra = (args.referenceImages ?? []).filter((value) => value.trim() !== '')
        if (extra.length > 0) {
          // GenBox validates that image_data_list[0] equals image_data, so the base
          // image leads the list.
          const list = await Promise.all([args.image, ...extra].map((value) => toImageData(value)))
          body.image_data = list[0]
          body.image_data_list = list
        } else {
          body.image_data = await toImageData(args.image)
        }
      } else if (mode === 'inpaint') {
        if (args.mask === undefined || args.mask.trim() === '') {
          throw new Error('mode=inpaint requires a mask image path or data URL.')
        }
        body.mask_data = await toImageData(args.mask)
        body.mask_contract = 'genbox-edit-white-v1'
        if (args.size !== undefined && args.size !== '') body.size = args.size
      } else {
        // GenBox requires an explicit per-provider model for precision_edit.
        if (args.model === undefined || args.model.trim() === '') {
          throw new Error(
            'mode=precision_edit needs a model, because GenBox requires per-provider model settings for this mode.',
          )
        }
        const marked = (args.annotations ?? []) as unknown as PixelAnnotation[]
        body.precision_strategy = 'standard'
        if (marked.length === 0) {
          if (args.precisionTargetSize === undefined || args.precisionTargetSize.trim() === '') {
            throw new Error(
              "mode=precision_edit without annotations requires precisionTargetSize, for example '1536x1024'.",
            )
          }
          body.precision_size_mode = 'resize'
          body.precision_target_size = args.precisionTargetSize
          body.precision_output_size_policy = args.precisionOutputSizePolicy ?? 'strict'
        } else {
          if (args.image.startsWith('data:')) {
            throw new Error(
              'mode=precision_edit with annotations needs the image to be a local file path, because the overlay '
              + 'must match the source pixel size exactly.',
            )
          }
          const sourcePath = isAbsolute(args.image) ? args.image : resolve(process.cwd(), args.image)
          const size = await readImageSize(sourcePath)
          const overlay = renderAnnotationOverlay(size.width, size.height, marked)
          body.annotation_image_data = 'data:image/png;base64,' + overlay.toString('base64')
          body.annotation_contract = 'genbox-annotation-v3'
          body.annotations = toGenBoxAnnotations(size.width, size.height, marked)
          if (args.precisionTargetSize !== undefined && args.precisionTargetSize.trim() !== '') {
            body.precision_size_mode = 'resize'
            body.precision_target_size = args.precisionTargetSize
            body.precision_output_size_policy = args.precisionOutputSizePolicy ?? 'strict'
          } else {
            body.precision_size_mode = 'preserve'
          }
        }
      }

      try {
        return await runGeneration(
          client,
          config,
          body,
          resolveOutputDir(config.outputDir, args.outputDir),
          exec.signal,
          args.background === true,
        )
      } catch (error) {
        throw await explainProviderUnsupported(error, client, mode, exec.signal)
      }
    },
  }))
}
