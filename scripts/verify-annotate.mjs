// Verify the pure-JS annotation overlay: PNG encoding, size reading, and the
// normalised genbox-annotation-v3 payload.
import { execFile } from 'node:child_process'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { readImageSize, renderAnnotationOverlay, toGenBoxAnnotations } from '../lib/index.js'

const run = promisify(execFile)
const outDir = 'E:/AI/GenBox-dsh/.genbox-out/annotate'
mkdirSync(outDir, { recursive: true })

const width = 320
const height = 240
const basePng = join(outDir, 'base.png')
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=' + width + 'x' + height + ':rate=1:duration=1', '-frames:v', '1', basePng])
console.log('base size read by our own reader:', JSON.stringify(await readImageSize(basePng)))

const annotations = [
  { kind: 'arrow', instruction: 'move the sun here', x: 40, y: 200, x2: 240, y2: 60 },
  { kind: 'rectangle', instruction: 'remove this bench', x: 120, y: 150, width: 140, height: 60 },
  { kind: 'ellipse', instruction: 'make this red', x: 30, y: 30, width: 80, height: 60 },
  { kind: 'brush', instruction: 'extend the path this way', points: [{ x: 10, y: 120 }, { x: 60, y: 140 }, { x: 110, y: 130 }, { x: 160, y: 170 }] },
]

const overlay = renderAnnotationOverlay(width, height, annotations)
const overlayFile = join(outDir, 'overlay.png')
writeFileSync(overlayFile, overlay)
console.log('overlay bytes:', statSync(overlayFile).size)

// ffprobe is an independent judge of whether we produced a real PNG.
const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'json', overlayFile])
const stream = JSON.parse(probe.stdout).streams[0]
console.log('ffprobe on overlay:', JSON.stringify(stream))

const spec = toGenBoxAnnotations(width, height, annotations)
console.log('genbox annotations:', JSON.stringify(spec))

const failures = []
if (stream.width !== width || stream.height !== height) failures.push('overlay size mismatch')
if (stream.pix_fmt !== 'rgba') failures.push('overlay is not rgba: ' + stream.pix_fmt)
if (spec.length !== annotations.length) failures.push('annotation count mismatch')
if (spec[0].x1 !== 40 / width) failures.push('normalisation mismatch')
if (spec[3].points.length !== 4) failures.push('brush points lost')

console.log(failures.length === 0 ? 'OK' : 'FAILURES: ' + failures.join('; '))
process.exit(failures.length === 0 ? 0 : 1)
