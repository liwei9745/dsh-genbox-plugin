// Verify the pure-JS annotation overlay: PNG encoding, size reading, and the
// normalised genbox-annotation-v3 payload.
//
// Deliberately dependency-free: the encoder and the reader under test are both
// ours, so the PNG container is checked at byte level against the spec, and
// ffprobe is only used as an extra judge when the machine happens to have one.
// (It used to shell out to ffmpeg for the base image, which made CI fail on a
// runner without ffmpeg.)
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readImageSize, renderAnnotationOverlay, toGenBoxAnnotations } from '../lib/index.js'

const outDir = resolve(process.env.VERIFY_OUT_DIR ?? '.genbox-out', 'annotate')
mkdirSync(outDir, { recursive: true })

const width = 320
const height = 240

// An empty annotation list still has to produce a valid PNG of the right size.
const base = renderAnnotationOverlay(width, height, [])
const basePng = join(outDir, 'base.png')
writeFileSync(basePng, base)

const annotations = [
  { kind: 'arrow', instruction: 'move the sun here', x: 40, y: 200, x2: 240, y2: 60 },
  { kind: 'rectangle', instruction: 'remove this bench', x: 120, y: 150, width: 140, height: 60 },
  { kind: 'ellipse', instruction: 'make this red', x: 30, y: 30, width: 80, height: 60 },
  { kind: 'brush', instruction: 'extend the path this way', points: [{ x: 10, y: 120 }, { x: 60, y: 140 }, { x: 110, y: 130 }, { x: 160, y: 170 }] },
]

const overlay = renderAnnotationOverlay(width, height, annotations)
const overlayFile = join(outDir, 'overlay.png')
writeFileSync(overlayFile, overlay)

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Read the PNG container fields straight out of the bytes. */
function header(buffer) {
  return {
    signature: buffer.subarray(0, 8).equals(PNG_SIGNATURE),
    firstChunk: buffer.subarray(12, 16).toString('ascii'),
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
  }
}

const baseHeader = header(base)
const overlayHeader = header(overlay)
const baseSize = await readImageSize(basePng)
const overlaySize = await readImageSize(overlayFile)
const spec = toGenBoxAnnotations(width, height, annotations)

console.log('overlay header:', JSON.stringify(overlayHeader))
console.log('overlay bytes:', statSync(overlayFile).size)
console.log('genbox annotations:', JSON.stringify(spec))

let probed
const probe = spawnSync(
  process.env.FFPROBE_PATH ?? 'ffprobe',
  ['-v', 'error', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'json', overlayFile],
  { encoding: 'utf8' },
)
if (probe.status === 0 && typeof probe.stdout === 'string' && probe.stdout.trim() !== '') {
  probed = JSON.parse(probe.stdout).streams[0]
  console.log('ffprobe:', JSON.stringify(probed))
} else {
  console.log('ffprobe: unavailable, relying on the byte-level container checks')
}

const failures = []
if (!baseHeader.signature || !overlayHeader.signature) failures.push('missing PNG signature')
if (overlayHeader.firstChunk !== 'IHDR') failures.push('first chunk is ' + overlayHeader.firstChunk)
if (overlayHeader.width !== width || overlayHeader.height !== height) failures.push('IHDR size mismatch')
if (overlayHeader.colorType !== 6) failures.push('colour type is not RGBA (6): ' + overlayHeader.colorType)
if (overlay.length <= 8) failures.push('overlay carries no image data')
if (baseSize.width !== width || baseSize.height !== height) failures.push('our reader disagrees on the base size')
if (overlaySize.width !== width || overlaySize.height !== height) failures.push('our reader disagrees on the overlay size')
if (probed !== undefined && (probed.width !== width || probed.height !== height || probed.pix_fmt !== 'rgba')) failures.push('ffprobe disagrees with our encoder')
if (spec.length !== annotations.length) failures.push('annotation count mismatch')
if (spec[0].x1 !== 40 / width) failures.push('normalisation mismatch')
if (spec[3].points.length !== 4) failures.push('brush points lost')

console.log(failures.length === 0 ? 'OK' : 'FAILURES: ' + failures.join('; '))
process.exit(failures.length === 0 ? 0 : 1)
