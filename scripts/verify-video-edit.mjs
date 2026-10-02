// Verify the ffmpeg-backed local video editor against generated test clips.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { apply } from '../lib/index.js'

const run = promisify(execFile)
const outDir = 'E:/AI/GenBox-dsh/.genbox-out/video-edit'
mkdirSync(outDir, { recursive: true })

// This machine's ffmpeg build has no libx264; pick whatever H.264 encoder it ships.
let encoder = 'mpeg4'
const { stdout: encoders } = await run('ffmpeg', ['-hide_banner', '-encoders'])
for (const candidate of ['libx264', 'libopenh264', 'h264_mf']) {
  if (encoders.includes(candidate)) { encoder = candidate; break }
}
console.log('test clips will use encoder:', encoder)

async function makeClip(file, seconds) {
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=' + seconds,
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=' + seconds,
    '-c:v', encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file,
  ])
  return file
}

const clipA = await makeClip(join(outDir, 'clipA.mp4'), 3)
const clipB = await makeClip(join(outDir, 'clipB.mp4'), 2)

const registered = []
apply(
  { tools: { register: (tool) => registered.push(tool) } },
  {
    baseUrl: 'http://127.0.0.1:8892',
    adminKey: '',
    defaultProviderId: '',
    outputDir: outDir,
    pollIntervalMs: 800,
    taskTimeoutMs: 60000,
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    videoEncoder: '',
  },
)

const edit = registered.find((tool) => tool.name === 'genbox_video_edit')
if (!edit) throw new Error('genbox_video_edit was not registered')
const exec = { signal: AbortSignal.timeout(120000) }
const show = async (label, value) => {
  const ok = existsSync(value.file) && statSync(value.file).size > 0
  console.log(label, JSON.stringify(value), ok ? 'FILE-OK' : 'FILE-MISSING')
}

await show('trim:', await edit.execute({ operation: 'trim', input: clipA, startSeconds: 0.5, endSeconds: 2 }, exec))
await show('concat:', await edit.execute({ operation: 'concat', input: clipA, inputs: [clipA, clipB] }, exec))
await show('speed:', await edit.execute({ operation: 'speed', input: clipA, speed: 2 }, exec))
await show('mute:', await edit.execute({ operation: 'mute', input: clipA }, exec))
await show('resize:', await edit.execute({ operation: 'resize', input: clipA, width: 160, height: 120 }, exec))
await show('frame:', await edit.execute({ operation: 'extract_frame', input: clipA, startSeconds: 1 }, exec))
console.log('OK')
