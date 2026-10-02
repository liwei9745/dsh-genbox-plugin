// Verify the ffmpeg-backed local video editor against generated test clips.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { apply } from '../lib/index.js'

const run = promisify(execFile)
// Portable output location so this script also runs in CI.
const outDir = resolve(process.env.VERIFY_OUT_DIR ?? '.genbox-out', 'video-edit')
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

// fixtures for the audio / subtitle operations
const toneFile = join(outDir, 'tone.m4a')
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2', '-c:a', 'aac', toneFile])
const srtFile = join(outDir, 'captions.srt')
writeFileSync(srtFile, '1\n00:00:00,000 --> 00:00:01,500\nhello from genbox\n\n2\n00:00:01,500 --> 00:00:03,000\nsecond line\n', 'utf8')

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
const exec = { signal: AbortSignal.timeout(180000) }
let failures = 0
const show = async (label, value) => {
  const ok = existsSync(value.file) && statSync(value.file).size > 0
  if (!ok) failures += 1
  console.log(label, JSON.stringify(value), ok ? 'FILE-OK' : 'FILE-MISSING')
}

await show('trim:', await edit.execute({ operation: 'trim', input: clipA, startSeconds: 0.5, endSeconds: 2 }, exec))
await show('concat:', await edit.execute({ operation: 'concat', input: clipA, inputs: [clipA, clipB] }, exec))
await show('speed:', await edit.execute({ operation: 'speed', input: clipA, speed: 2 }, exec))
await show('mute:', await edit.execute({ operation: 'mute', input: clipA }, exec))
await show('resize:', await edit.execute({ operation: 'resize', input: clipA, width: 160, height: 120 }, exec))
await show('crop:', await edit.execute({ operation: 'crop', input: clipA, width: 160, height: 120, x: 20, y: 20 }, exec))
await show('volume:', await edit.execute({ operation: 'volume', input: clipA, volume: 0.5 }, exec))
await show('replace_audio:', await edit.execute({ operation: 'replace_audio', input: clipA, audio: toneFile }, exec))
await show('burn_subtitles:', await edit.execute({ operation: 'burn_subtitles', input: clipA, subtitles: srtFile }, exec))
await show('to_gif:', await edit.execute({ operation: 'to_gif', input: clipA, width: 160, fps: 10, startSeconds: 0, endSeconds: 1.5 }, exec))
await show('frame:', await edit.execute({ operation: 'extract_frame', input: clipA, startSeconds: 1 }, exec))

console.log(failures === 0 ? 'OK (11/11)' : 'FAILURES: ' + failures)
process.exit(failures === 0 ? 0 : 1)
