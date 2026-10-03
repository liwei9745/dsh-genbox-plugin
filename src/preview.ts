import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { JsonObject } from './json.js'

/** Image media types DSH accepts for an inline image block. */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** Extension -> media type, for the files this plugin writes. */
const MEDIA_TYPES: Record<string, ImageMediaType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** The slice of DSH's attachment service this plugin uses. */
interface AttachmentService {
  saveImage(input: { data: Buffer; mediaType: ImageMediaType; name?: string }): Promise<JsonObject>
}

/**
 * The attachment service, when the deployment mounts one. Without it a tool can still
 * produce files - it just cannot hand the chat an image to display.
 */
export function attachmentsOf(ctx: Context): AttachmentService | undefined {
  // Partial test contexts register tools without the service lookup the runtime provides.
  if (typeof ctx.get !== 'function') return undefined
  return ctx.get('attachments') as AttachmentService | undefined
}

/**
 * Commit generated images as DSH attachments so the conversation can render them inline
 * instead of only printing a path.
 *
 * Best effort by design: this runs after the files are already on disk, so a missing
 * service, an unreadable file or an image over the deployment's size limit costs the
 * preview and nothing else - the generation the user paid for still returns normally.
 */
export async function previewRefs(ctx: Context, files: string[], limit: number): Promise<JsonObject[]> {
  const attachments = attachmentsOf(ctx)
  if (attachments === undefined || !Number.isFinite(limit) || limit <= 0) return []
  const refs: JsonObject[] = []
  for (const file of files.slice(0, Math.floor(limit))) {
    const mediaType = MEDIA_TYPES[extname(file).toLowerCase()]
    if (mediaType === undefined) continue
    try {
      const data = await readFile(file)
      refs.push(await attachments.saveImage({ data, mediaType, name: basename(file) }))
    } catch {
      // Preview only: the file is on disk and its path is already in the result.
    }
  }
  return refs
}

/** The image blocks a render function appends after its text summary. */
export function previewBlocks(value: unknown): Array<{ type: 'image'; attachment: JsonObject }> {
  const refs = (value as { previews?: JsonObject[] } | null)?.previews
  if (!Array.isArray(refs)) return []
  return refs.map((attachment) => ({ type: 'image' as const, attachment }))
}
