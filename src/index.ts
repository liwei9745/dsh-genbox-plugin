import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { GenBoxClient } from './client.js'
import { Config, type Config as GenBoxConfig } from './config.js'
import { registerImageTools } from './tools/image.js'
import { registerImageToolbox } from './tools/image-extra.js'
import { registerMediaTools } from './tools/media.js'
import { registerProviderTools } from './tools/providers.js'
import { registerTaskTool } from './tools/task.js'
import { registerVideoTools } from './tools/video.js'

export const name = 'genbox'

/** The tool registry must be ready before we register anything. */
export const inject = ['tools']

export { Config }

export function apply(ctx: Context, config: GenBoxConfig) {
  const client = new GenBoxClient({
    baseUrl: config.baseUrl,
    adminKey: config.adminKey,
    requestTimeoutMs: 120000,
  })

  ctx.tools.register(defineTool({
    name: 'genbox_health',
    description: 'Check whether the local GenBox server is reachable and report its runtime status.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec) {
      return await client.status(exec.signal)
    },
  }))

  console.log('[genbox] plugin loaded (baseUrl=' + client.baseUrl + ')')

  registerProviderTools(ctx, client)
  registerImageTools(ctx, client, config)
  registerImageToolbox(ctx, client, config)
  registerVideoTools(ctx, client, config)
  registerTaskTool(ctx, client, config)
  registerMediaTools(ctx, client, config)
}
