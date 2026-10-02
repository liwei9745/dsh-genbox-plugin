import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenBoxClient } from '../client.js'
import { listProviders, type GenBoxProvider } from '../media.js'

function project(provider: GenBoxProvider) {
  return {
    id: provider.id,
    name: provider.name ?? provider.id,
    type: provider.type ?? 'image',
    enabled: provider.enabled === true,
    hasKey: provider.has_key === true,
    model: provider.model ?? '',
    models: provider.models ?? [],
    defaultSize: provider.size ?? '',
    capabilities: provider.capabilities ?? {},
    modelCapabilities: provider.model_capabilities ?? {},
  }
}

export function registerProviderTools(ctx: Context, client: GenBoxClient) {
  ctx.tools.register(defineTool({
    name: 'genbox_providers',
    description:
      'List the providers a local GenBox server has configured (image, video, or LLM), with enabled state, '
      + 'models, and declared capabilities. Call this before generating to choose a provider whose model supports '
      + 'the operation and size you need.',
    parameters: {
      type: {
        type: 'string',
        enum: ['image', 'video', 'llm', 'all'],
        description: "Which provider type to list; defaults to 'all'.",
      },
      enabledOnly: {
        type: 'boolean',
        description: 'Only return providers that are currently enabled (default false).',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const wanted = args.type ?? 'all'
      const enabledOnly = args.enabledOnly === true
      const providers = await listProviders(client, exec.signal)
      const filtered = providers
        .filter((provider) => wanted === 'all' || (provider.type ?? 'image') === wanted)
        .filter((provider) => !enabledOnly || provider.enabled === true)
      return {
        baseUrl: client.baseUrl,
        count: filtered.length,
        providers: filtered.map(project),
      }
    },
  }))
}
