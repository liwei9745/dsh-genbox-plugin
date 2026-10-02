import { readFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) c = (CRC_TABLE[(c ^ (buffer[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

/** Minimal 8-bit RGBA PNG encoder (no native dependency). */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1)
    raw[rowStart] = 0
    for (let x = 0; x < stride; x += 1) raw[rowStart + 1 + x] = rgba[y * stride + x] ?? 0
  }
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

export interface PixelAnnotation {
  kind: 'arrow' | 'rectangle' | 'ellipse' | 'brush'
  instruction: string
  x?: number | undefined
  y?: number | undefined
  x2?: number | undefined
  y2?: number | undefined
  width?: number | undefined
  height?: number | undefined
  points?: Array<{ x: number; y: number }> | undefined
}

type Canvas = { width: number; height: number; data: Uint8Array }
type Colour = [number, number, number, number]

const SHAPE: Colour = [255, 59, 48, 235]
const LABEL_BG: Colour = [255, 59, 48, 255]
const LABEL_FG: Colour = [255, 255, 255, 255]

function put(canvas: Canvas, x: number, y: number, colour: Colour): void {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return
  const index = (y * canvas.width + x) * 4
  const alpha = colour[3] / 255
  for (let k = 0; k < 3; k += 1) {
    const base = canvas.data[index + k] ?? 0
    canvas.data[index + k] = Math.round(base * (1 - alpha) + (colour[k] ?? 0) * alpha)
  }
  canvas.data[index + 3] = Math.max(canvas.data[index + 3] ?? 0, colour[3])
}

function disc(canvas: Canvas, cx: number, cy: number, radius: number, colour: Colour): void {
  const r = Math.max(1, Math.round(radius))
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      if (dx * dx + dy * dy <= r * r) put(canvas, Math.round(cx) + dx, Math.round(cy) + dy, colour)
    }
  }
}

function stroke(canvas: Canvas, x1: number, y1: number, x2: number, y2: number, thickness: number, colour: Colour): void {
  const steps = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1)))
  for (let s = 0; s <= steps; s += 1) {
    disc(canvas, x1 + ((x2 - x1) * s) / steps, y1 + ((y2 - y1) * s) / steps, thickness / 2, colour)
  }
}

function strokeRect(canvas: Canvas, x: number, y: number, w: number, h: number, thickness: number, colour: Colour): void {
  stroke(canvas, x, y, x + w, y, thickness, colour)
  stroke(canvas, x + w, y, x + w, y + h, thickness, colour)
  stroke(canvas, x + w, y + h, x, y + h, thickness, colour)
  stroke(canvas, x, y + h, x, y, thickness, colour)
}

function strokeEllipse(canvas: Canvas, x: number, y: number, w: number, h: number, thickness: number, colour: Colour): void {
  const cx = x + w / 2
  const cy = y + h / 2
  const rx = w / 2
  const ry = h / 2
  const steps = Math.max(48, Math.round((rx + ry) * 2))
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * Math.PI * 2
    disc(canvas, cx + Math.cos(t) * rx, cy + Math.sin(t) * ry, thickness / 2, colour)
  }
}

const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111']

function drawDigits(canvas: Canvas, x: number, y: number, value: number, scale: number, colour: Colour): void {
  let cursor = x
  for (const character of String(value)) {
    const glyph = DIGITS[Number(character)] ?? DIGITS[0] ?? ''
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        if (glyph[row * 3 + column] !== '1') continue
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) put(canvas, cursor + column * scale + sx, y + row * scale + sy, colour)
        }
      }
    }
    cursor += 4 * scale
  }
}

function badge(canvas: Canvas, x: number, y: number, label: number, scale: number): void {
  const size = 5 * scale + 3
  for (let dy = 0; dy < size; dy += 1) {
    for (let dx = 0; dx < size; dx += 1) put(canvas, Math.round(x) + dx, Math.round(y) + dy, LABEL_BG)
  }
  drawDigits(canvas, Math.round(x) + scale, Math.round(y) + scale, label, scale, LABEL_FG)
}

/** Draw the annotation overlay GenBox expects next to precision_edit requests. */
export function renderAnnotationOverlay(width: number, height: number, annotations: PixelAnnotation[]): Buffer {
  const canvas: Canvas = { width, height, data: new Uint8Array(width * height * 4) }
  const thickness = Math.max(2, Math.round(Math.min(width, height) / 120))
  const scale = Math.max(2, Math.round(Math.min(width, height) / 240))
  annotations.forEach((annotation, index) => {
    const label = index + 1
    if (annotation.kind === 'arrow') {
      const x1 = annotation.x ?? 0
      const y1 = annotation.y ?? 0
      const x2 = annotation.x2 ?? 0
      const y2 = annotation.y2 ?? 0
      stroke(canvas, x1, y1, x2, y2, thickness, SHAPE)
      const angle = Math.atan2(y2 - y1, x2 - x1)
      const head = Math.max(12, thickness * 5)
      stroke(canvas, x2, y2, x2 - head * Math.cos(angle - 0.5), y2 - head * Math.sin(angle - 0.5), thickness, SHAPE)
      stroke(canvas, x2, y2, x2 - head * Math.cos(angle + 0.5), y2 - head * Math.sin(angle + 0.5), thickness, SHAPE)
      badge(canvas, x1 + thickness, y1 + thickness, label, scale)
      return
    }
    if (annotation.kind === 'rectangle') {
      const x = annotation.x ?? 0
      const y = annotation.y ?? 0
      const w = annotation.width ?? 0
      const h = annotation.height ?? 0
      strokeRect(canvas, x, y, w, h, thickness, SHAPE)
      badge(canvas, x + thickness, y + thickness, label, scale)
      return
    }
    if (annotation.kind === 'ellipse') {
      const x = annotation.x ?? 0
      const y = annotation.y ?? 0
      const w = annotation.width ?? 0
      const h = annotation.height ?? 0
      strokeEllipse(canvas, x, y, w, h, thickness, SHAPE)
      badge(canvas, x + thickness, y + thickness, label, scale)
      return
    }
    const points = annotation.points ?? []
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1]
      const b = points[i]
      if (a === undefined || b === undefined) continue
      stroke(canvas, a.x, a.y, b.x, b.y, thickness, SHAPE)
    }
    if (points[0] !== undefined) badge(canvas, points[0].x + thickness, points[0].y + thickness, label, scale)
  })
  return encodePng(width, height, canvas.data)
}

export type GenBoxAnnotationSpec = { [key: string]: unknown }

/** Convert pixel annotations into GenBox's normalised genbox-annotation-v3 payload. */
export function toGenBoxAnnotations(width: number, height: number, annotations: PixelAnnotation[]): GenBoxAnnotationSpec[] {
  if (annotations.length === 0) throw new Error('precision_edit with annotations needs at least one annotation')
  if (annotations.length > 100) throw new Error('GenBox accepts at most 100 annotations, got ' + annotations.length)
  const clamp = (value: number): number => Math.min(1, Math.max(0, value))
  const nx = (value: number): number => clamp(value / width)
  const ny = (value: number): number => clamp(value / height)
  let textBudget = 0
  return annotations.map((annotation, index) => {
    const label = index + 1
    const instruction = annotation.instruction.trim()
    if (instruction === '') throw new Error('annotation ' + label + ' needs a non-empty instruction')
    textBudget += instruction.length
    if (textBudget > 4000) throw new Error('annotation text exceeds 4000 characters in total')
    if (annotation.kind === 'arrow') {
      const x1 = nx(annotation.x ?? 0)
      const y1 = ny(annotation.y ?? 0)
      const x2 = nx(annotation.x2 ?? 0)
      const y2 = ny(annotation.y2 ?? 0)
      if (x1 === x2 && y1 === y2) throw new Error('annotation ' + label + ': arrow endpoints must differ')
      return { type: 'arrow', label, instruction, x1, y1, x2, y2 }
    }
    if (annotation.kind === 'brush') {
      const points = annotation.points ?? []
      if (points.length < 2 || points.length > 1024) throw new Error('annotation ' + label + ': brush needs 2-1024 points')
      return { type: 'brush', label, instruction, points: points.map((point) => ({ x: nx(point.x), y: ny(point.y) })) }
    }
    const x = nx(annotation.x ?? 0)
    const y = ny(annotation.y ?? 0)
    const w = nx(annotation.width ?? 0)
    const h = ny(annotation.height ?? 0)
    if (w <= 0 || h <= 0) throw new Error('annotation ' + label + ': ' + annotation.kind + ' needs a positive size')
    return { type: annotation.kind, label, instruction, x, y, width: w, height: h }
  })
}

/** Read the pixel size of a PNG/JPEG/GIF file without any native dependency. */
export async function readImageSize(file: string): Promise<{ width: number; height: number }> {
  const buffer = await readFile(file)
  if (buffer.length > 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer.length > 10 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
  }
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = buffer[offset + 1] ?? 0
      const length = buffer.readUInt16BE(offset + 2)
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
      }
      if (length <= 0) break
      offset += 2 + length
    }
  }
  throw new Error('cannot read the pixel size of ' + file + ': supported formats are PNG, JPEG and GIF')
}
