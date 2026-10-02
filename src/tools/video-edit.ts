import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Config } from '../config.js'
import { outputFileName, outputPath, resolveOutputDir } from '../media.js'

const run = promisify(execFile)

async function ffmpegRun(bin: string, args: string[], signal?: AbortSignal | undefined): Promise<void> {
  try {
    await run(bin, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      maxBuffer: 64 * 1024 * 1024,
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (error) {
    const found = error as { stderr?: string; message?: string }
    const detail = found.stderr ?? found.message ?? String(error)
    throw new Error('ffmpeg failed: ' + detail.slice(-600).trim())
  }
}

interface MediaInfo {
  durationSeconds: number
  width: number
  height: number
  hasAudio: boolean
}

async function probe(ffprobe: string, file: string, signal?: AbortSignal | undefined): Promise<MediaInfo> {
  const { stdout } = await run(
    ffprobe,
    ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,duration', '-show_entries', 'format=duration', '-of', 'json', file],
    { maxBuffer: 8 * 1024 * 1024, ...(signal === undefined ? {} : { signal }) },
  )
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>
    format?: { duration?: string }
  }
  const streams = parsed.streams ?? []
  const video = streams.find((stream) => stream.codec_type === 'video')
  const raw = Number(parsed.format?.duration ?? video?.duration ?? 0)
  return {
    durationSeconds: Number.isFinite(raw) ? Math.round(raw * 100) / 100 : 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
  }
}

const ENCODER_CANDIDATES = ['libx264', 'h264_mf', 'libopenh264', 'mpeg4']
const encoderCache = new Map<string, string>()

/** Pick the best available H.264 encoder; ffmpeg builds differ a lot. */
async function pickVideoEncoder(ffmpegPath: string, signal?: AbortSignal | undefined): Promise<string> {
  const cached = encoderCache.get(ffmpegPath)
  if (cached !== undefined) return cached
  let encoder = 'mpeg4'
  try {
    const { stdout } = await run(ffmpegPath, ['-hide_banner', '-encoders'], {
      maxBuffer: 8 * 1024 * 1024,
      ...(signal === undefined ? {} : { signal }),
    })
    for (const candidate of ENCODER_CANDIDATES) {
      if (stdout.includes(candidate)) {
        encoder = candidate
        break
      }
    }
  } catch {
    // keep the mpeg4 fallback
  }
  encoderCache.set(ffmpegPath, encoder)
  return encoder
}

type VideoEditResult = {
  file: string
  operation: string
  width: number
  height: number
  durationSeconds: number
  sizeBytes: number
}
export function registerVideoEditTool(ctx: Context, config: Config) {
  ctx.tools.register(defineTool({
    name: 'genbox_video_edit',
    description:
      'Edit a local video with ffmpeg - no GenBox server or API key needed. Operations: trim (cut a range), concat '
      + '(join clips in order), speed (time stretch), mute (drop the audio track), resize (re-encode to a canvas), '
      + 'extract_frame (write one frame as PNG). GenBox itself cannot edit video, so this fills that gap locally.',
    parameters: {
      operation: {
        type: 'string',
        enum: ['trim', 'concat', 'speed', 'mute', 'resize', 'extract_frame'],
        required: true,
        description: 'Which edit to perform.',
      },
      input: { type: 'string', required: true, description: 'Input video path (for concat: the first clip).' },
      inputs: {
        type: 'array',
        items: { type: 'string' },
        description: 'concat only: the full ordered list of clips to join (overrides input).',
      },
      startSeconds: { type: 'number', description: 'trim/extract_frame: start offset in seconds (default 0).' },
      endSeconds: { type: 'number', description: 'trim: end offset in seconds.' },
      speed: { type: 'number', description: 'speed: factor between 0.5 and 2.0 (1 keeps the original pace).' },
      width: { type: 'number', description: 'resize: target width in pixels.' },
      height: { type: 'number', description: 'resize: target height in pixels.' },
      outputDir: { type: 'string', description: 'Directory for the result. Defaults to the plugin outputDir config.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const result = value as unknown as VideoEditResult
        return [{
          type: 'text' as const,
          text: 'genbox_video_edit(' + result.operation + ') -> ' + result.file
            + ' (' + result.width + 'x' + result.height + ', ' + result.durationSeconds + 's, ' + result.sizeBytes + 'B)',
        }]
      },
    },
    async execute(args, exec) {
      const signal = exec.signal
      const directory = resolveOutputDir(config.outputDir, args.outputDir)
      const operation = args.operation
      const encoder = config.videoEncoder.trim() !== ''
        ? config.videoEncoder.trim()
        : await pickVideoEncoder(config.ffmpegPath, signal)
      const videoCodecArgs = encoder === 'libx264'
        ? ['-c:v', 'libx264', '-preset', 'veryfast']
        : ['-c:v', encoder]
      let target = ''
      let ffmpegArgs: string[] = []
      let scratchDir = ''

      if (operation === 'trim') {
        target = outputPath(directory, outputFileName('edit_trim', '.mp4'))
        if (typeof args.startSeconds === 'number') ffmpegArgs.push('-ss', String(args.startSeconds))
        ffmpegArgs.push('-i', args.input)
        if (typeof args.endSeconds === 'number') {
          const start = typeof args.startSeconds === 'number' ? args.startSeconds : 0
          ffmpegArgs.push('-t', String(Math.max(0, args.endSeconds - start)))
        }
        ffmpegArgs.push(...videoCodecArgs, '-c:a', 'aac', '-movflags', '+faststart', target)
      } else if (operation === 'concat') {
        const clips = args.inputs !== undefined && args.inputs.length > 0 ? args.inputs : [args.input]
        if (clips.length < 2) throw new Error('operation=concat needs at least two clips in inputs.')
        const scratch = await mkdtemp(join(tmpdir(), 'genbox-concat-'))
        scratchDir = scratch
        const listFile = join(scratch, 'clips.txt')
        const slash = String.fromCharCode(92)
        // ffmpeg's concat demuxer wants  file '<path>'  - double quotes are not accepted.
        const entries = clips.map((clip) => "file '" + clip.split(slash).join('/') + "'")
        await writeFile(listFile, entries.join(String.fromCharCode(10)) + String.fromCharCode(10), 'utf8')
        target = outputPath(directory, outputFileName('edit_concat', '.mp4'))
        ffmpegArgs = ['-f', 'concat', '-safe', '0', '-i', listFile, ...videoCodecArgs, '-c:a', 'aac', '-movflags', '+faststart', target]
      } else if (operation === 'speed') {
        const speed = typeof args.speed === 'number' ? args.speed : 1
        if (speed < 0.5 || speed > 2) throw new Error('operation=speed supports a factor between 0.5 and 2.0.')
        const info = await probe(config.ffprobePath, args.input, signal)
        target = outputPath(directory, outputFileName('edit_speed', '.mp4'))
        const filter = info.hasAudio
          ? '[0:v]setpts=PTS/' + speed + '[v];[0:a]atempo=' + speed + '[a]'
          : '[0:v]setpts=PTS/' + speed + '[v]'
        ffmpegArgs = ['-i', args.input, '-filter_complex', filter, '-map', '[v]']
        if (info.hasAudio) ffmpegArgs.push('-map', '[a]', '-c:a', 'aac')
        ffmpegArgs.push(...videoCodecArgs, '-movflags', '+faststart', target)
      } else if (operation === 'mute') {
        target = outputPath(directory, outputFileName('edit_mute', '.mp4'))
        ffmpegArgs = ['-i', args.input, '-an', '-c:v', 'copy', target]
      } else if (operation === 'resize') {
        if (typeof args.width !== 'number' || typeof args.height !== 'number') {
          throw new Error('operation=resize needs both width and height.')
        }
        target = outputPath(directory, outputFileName('edit_resize', '.mp4'))
        ffmpegArgs = ['-i', args.input, '-vf', 'scale=' + args.width + ':' + args.height, ...videoCodecArgs, '-c:a', 'copy', target]
      } else if (operation === 'extract_frame') {
        target = outputPath(directory, outputFileName('edit_frame', '.png'))
        if (typeof args.startSeconds === 'number') ffmpegArgs.push('-ss', String(args.startSeconds))
        ffmpegArgs.push('-i', args.input, '-frames:v', '1', target)
      } else {
        throw new Error('Unsupported operation: ' + String(operation))
      }

      try {
        await ffmpegRun(config.ffmpegPath, ffmpegArgs, signal)
      } finally {
        if (scratchDir !== '') await rm(scratchDir, { recursive: true, force: true })
      }
      const stats = await stat(target)
      const info = operation === 'extract_frame'
        ? { width: 0, height: 0, durationSeconds: 0, hasAudio: false }
        : await probe(config.ffprobePath, target, signal)
      return {
        file: target,
        operation,
        width: info.width,
        height: info.height,
        durationSeconds: info.durationSeconds,
        sizeBytes: stats.size,
      }
    },
  }))
}
