import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { GenBoxClient } from './client.js'
import type { JsonObject } from './json.js'

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** Resolve the directory generated media is written to. */
export function resolveOutputDir(configured: string, override?: string | undefined): string {
  const value = override && override.trim() !== '' ? override : configured
  return isAbsolute(value) ? value : resolve(process.cwd(), value)
}

/** GenBox serves gallery images by basename, not by path. */
export function galleryFilename(localPath: string): string {
  return basename(localPath)
}

/**
 * GenBox accepts base64 or a data URL for image inputs. Local files are read
 * from disk; anything already in data-URL form is passed through untouched.
 */
export async function toImageData(source: string): Promise<string> {
  const trimmed = source.trim()
  if (trimmed.startsWith('data:')) return trimmed
  const dot = trimmed.lastIndexOf('.')
  const extension = dot === -1 ? '' : trimmed.slice(dot).toLowerCase()
  const mediaType = IMAGE_MEDIA_TYPES[extension]
  if (mediaType === undefined) {
    throw new Error(
      'Unsupported image input ' + JSON.stringify(trimmed) + ': expected a png/jpeg/webp/gif path or a data URL.',
    )
  }
  const path = isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed)
  const bytes = await readFile(path)
  return 'data:' + mediaType + ';base64,' + bytes.toString('base64')
}

/** Decode a base64 data URL (or bare base64) into a file. */
export async function writeDataUrl(dataUrl: string, targetPath: string): Promise<string> {
  const comma = dataUrl.indexOf(',')
  const payload = comma === -1 ? dataUrl : dataUrl.slice(comma + 1)
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, Buffer.from(payload, 'base64'))
  return targetPath
}

/** Deterministic, sortable file name for a generated artifact. */
export function outputFileName(prefix: string, extension: string, label?: string | undefined): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const suffix = label === undefined ? '' : '_' + label.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40)
  return prefix + '_' + stamp + suffix + extension
}

/** Join an output directory with a generated file name. */
export function outputPath(directory: string, fileName: string): string {
  return join(directory, fileName)
}

/** Shape of one provider returned by GET /api/providers. */
export interface GenBoxProvider {
  id: string
  name?: string
  type?: string
  enabled?: boolean
  has_key?: boolean
  model?: string
  models?: string[]
  size?: string
  quality?: string
  capabilities?: Record<string, boolean>
  model_capabilities?: JsonObject
  /** Transport GenBox will use: 'openai' matters for mask inpaint, 'auto' does not qualify. */
  endpoint_type?: string
}

export async function listProviders(client: GenBoxClient, signal?: AbortSignal | undefined): Promise<GenBoxProvider[]> {
  const response = await client.json<{ providers?: GenBoxProvider[] }>('GET', '/api/providers', undefined, signal)
  return response.providers ?? []
}
