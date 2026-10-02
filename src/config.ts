import Schema from '@deepseek-ai/schemastery'

/** User-supplied configuration for the GenBox integration. */
export interface Config {
  /** Base URL of a running GenBox server. */
  baseUrl: string
  /** Administrator key required by GenBox in production mode (APP_MODE=prod). */
  adminKey: string
  /** Provider id used when a tool call does not name one explicitly. */
  defaultProviderId: string
  /** Directory that generated media is written to (relative paths resolve against the session workspace). */
  outputDir: string
  /** Delay between two status polls of a long-running GenBox task. */
  pollIntervalMs: number
  /** Deadline for a single GenBox task before the tool gives up. */
  taskTimeoutMs: number
  /** ffmpeg executable used by the local video editor (a name on PATH or an absolute path). */
  ffmpegPath: string
  /** ffprobe executable used to inspect media before and after editing. */
  ffprobePath: string
  /** Force an ffmpeg video encoder ('' = auto-detect from libx264/h264_mf/libopenh264/mpeg4). */
  videoEncoder: string
}

export const Config: Schema<Config> = Schema.object({
  baseUrl: Schema.string().default('http://127.0.0.1:8892'),
  adminKey: Schema.string().default(''),
  defaultProviderId: Schema.string().default(''),
  outputDir: Schema.string().default('.genbox'),
  pollIntervalMs: Schema.number().default(2000),
  taskTimeoutMs: Schema.number().default(900000),
  ffmpegPath: Schema.string().default('ffmpeg'),
  ffprobePath: Schema.string().default('ffprobe'),
  videoEncoder: Schema.string().default(''),
})
