import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { GenBoxClient } from './client.js'
import { Config, type Config as GenBoxConfig } from './config.js'
import { registerDoctorTool } from './tools/doctor.js'
import { registerImageTools } from './tools/image.js'
import { registerImageToolbox } from './tools/image-extra.js'
import { registerMediaTools } from './tools/media.js'
import { registerProviderTools } from './tools/providers.js'
import { registerServerTool } from './tools/server.js'
import { registerTaskTool } from './tools/task.js'
import { registerVideoEditTool } from './tools/video-edit.js'
import { registerVideoTools } from './tools/video.js'
import { registerWorkbenchTool } from './tools/workbench.js'

export const name = 'genbox'

/** The tool registry must be ready before we register anything. */
export const inject = ['tools']

export { Config }
// Re-exported so the annotation helpers can be tested and reused directly.
export { readImageSize, renderAnnotationOverlay, toGenBoxAnnotations } from './annotate.js'
// Exported so the HTTP behaviour (error wording, tolerant polling) is testable directly.
export { GenBoxClient, GenBoxError } from './client.js'
// Exported so server discovery and the stop-safety rule can be tested directly.
export { discoverHome, looksLikeGenBox } from './server.js'

export function apply(ctx: Context, config: GenBoxConfig) {
  const client = new GenBoxClient({
    baseUrl: config.baseUrl,
    // GenBox's own default port is 8891 while this plugin's documented default is 8892, so a
    // fresh install has to survive either. The first URL that answers wins.
    // Tolerate a partial config: callers that build one by hand (tests, tool-reference.mjs)
    // do not run the schema defaults.
    fallbackBaseUrls: (config.baseUrlFallbacks ?? '').split(',').map((url) => url.trim()).filter((url) => url !== ''),
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
  registerServerTool(ctx, client, config)
  registerDoctorTool(ctx, client, config)
  registerImageTools(ctx, client, config)
  registerImageToolbox(ctx, client, config)
  registerVideoTools(ctx, client, config)
  registerTaskTool(ctx, client, config)
  registerVideoEditTool(ctx, config)
  registerMediaTools(ctx, client, config)
  registerWorkbenchTool(ctx, client, config)
}
