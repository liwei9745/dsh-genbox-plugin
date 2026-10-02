import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenBoxClient } from '../client.js'
import type { Config } from '../config.js'
import { galleryFilename, listProviders, resolveOutputDir, toImageData } from '../media.js'

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])

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
  generationId: string
  status: string
  elapsedSeconds: number
  images: ImageOutcome[]
  failures: ImageFailure[]
}

/** Pick the providers a request should target. */
async function resolveTargets(
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

/** Submit a generation and wait for its terminal state. */
async function runGeneration(
  client: GenBoxClient,
  config: Config,
  body: Record<string, unknown>,
  outputDir: string,
  signal: AbortSignal | undefined,
): Promise<ImageBatch> {
  const created = await client.json<{ generation_id?: string }>('POST', '/api/generate', body, signal)
  const generationId = created.generation_id
  if (generationId === undefined) {
    throw new Error('GenBox did not return a generation_id: ' + JSON.stringify(created))
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
    generationId,
    status: final.status ?? 'unknown',
    elapsedSeconds: final.elapsed_seconds ?? 0,
    images,
    failures,
  }
}

function renderBatch(headline: string, value: ImageBatch) {
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
    },
    output: { schema: BATCH_SCHEMA, render: (_args, value) => renderBatch('genbox_image_generate', value as ImageBatch) },
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
      return await runGeneration(
        client,
        config,
        body,
        resolveOutputDir(config.outputDir, args.outputDir),
        exec.signal,
      )
    },
  }))

  // ---------------------------------------------------------------- image editing
  ctx.tools.register(defineTool({
    name: 'genbox_image_edit',
    description:
      'Edit an existing image through a local GenBox server. mode=i2i re-renders the whole image from the reference '
      + 'plus a prompt; mode=inpaint repaints only the white area of a mask; mode=precision_edit keeps the original '
      + 'canvas and applies an instruction (resize mode requires precisionTargetSize).',
    parameters: {
      prompt: { type: 'string', required: true, description: 'What to change.' },
      image: { type: 'string', required: true, description: 'Source image: a local png/jpeg/webp path or a data URL.' },
      mode: { type: 'string', enum: ['i2i', 'inpaint', 'precision_edit'], description: "Editing mode; defaults to 'i2i'." },
      mask: { type: 'string', description: 'Required for inpaint: png/webp mask path or data URL, same size as the source. White is edited.' },
      providers: { type: 'array', items: { type: 'string' }, description: 'Provider ids to use. Defaults to every enabled image provider.' },
      model: { type: 'string', description: 'Model id to request. Must belong to the selected provider.' },
      size: { type: 'string', description: "Target canvas for i2i/inpaint, such as '1024x1024'." },
      strength: { type: 'number', description: 'i2i transformation strength (0-1); GenBox defaults to 0.55.' },
      precisionTargetSize: { type: 'string', description: "precision_edit only: target canvas 'WIDTHxHEIGHT' required by resize mode." },
      precisionOutputSizePolicy: { type: 'string', enum: ['strict', 'fit_crop'], description: "precision_edit resize output policy; defaults to 'strict'." },
      outputDir: { type: 'string', description: 'Directory for the downloaded results. Defaults to the plugin outputDir config.' },
    },
    output: { schema: BATCH_SCHEMA, render: (_args, value) => renderBatch('genbox_image_edit', value as ImageBatch) },
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
      body.image_data = await toImageData(args.image)

      if (mode === 'i2i') {
        if (args.size !== undefined && args.size !== '') body.size = args.size
        if (typeof args.strength === 'number') body.strength = args.strength
      } else if (mode === 'inpaint') {
        if (args.mask === undefined || args.mask.trim() === '') {
          throw new Error('mode=inpaint requires a mask image path or data URL.')
        }
        body.mask_data = await toImageData(args.mask)
        body.mask_contract = 'genbox-edit-white-v1'
        if (args.size !== undefined && args.size !== '') body.size = args.size
      } else {
        if (args.precisionTargetSize === undefined || args.precisionTargetSize.trim() === '') {
          throw new Error(
            "mode=precision_edit without annotations requires precisionTargetSize, for example '1536x1024'.",
          )
        }
        body.precision_size_mode = 'resize'
        body.precision_target_size = args.precisionTargetSize
        body.precision_output_size_policy = args.precisionOutputSizePolicy ?? 'strict'
        body.precision_strategy = 'standard'
      }

      return await runGeneration(
        client,
        config,
        body,
        resolveOutputDir(config.outputDir, args.outputDir),
        exec.signal,
      )
    },
  }))
}
