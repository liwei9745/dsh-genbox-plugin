import Schema from '@deepseek-ai/schemastery'

/** User-supplied configuration for the GenBox integration. */
export interface Config {
  /** Base URL of a running GenBox server. */
  baseUrl: string
  /**
   * Comma-separated URLs to try when `baseUrl` does not answer. The default covers GenBox's own
   * default port, so a fresh install works whether the server was started by start.ps1 (8891) or
   * the plugin's documented dev command (8892).
   */
  baseUrlFallbacks: string
  /** Path to the GenBox checkout (the directory holding main.py) that genbox_server starts. Empty = auto-detect. */
  home: string
  /** How long genbox_server waits for a freshly started server to answer (ms). */
  serverWaitMs: number
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
  /** Experimental: hand background video jobs to the DSH job registry (ctx.jobs) instead of plain polling. */
  nativeJobs: boolean
  /**
   * Show generated images inside the conversation by committing them as DSH attachments.
   * Off = the tools report file paths only. Has no effect where no attachment service is mounted.
   */
  previewInChat: boolean
  /** How many images per call are attached for display (the rest are still written to disk). */
  previewLimit: number
}

export const Config: Schema<Config> = Schema.object({
  baseUrl: Schema.string().default('http://127.0.0.1:8892'),
  baseUrlFallbacks: Schema.string().default('http://127.0.0.1:8891'),
  home: Schema.string().default(''),
  serverWaitMs: Schema.number().default(45000),
  adminKey: Schema.string().default(''),
  defaultProviderId: Schema.string().default(''),
  outputDir: Schema.string().default('.genbox'),
  pollIntervalMs: Schema.number().default(2000),
  taskTimeoutMs: Schema.number().default(900000),
  ffmpegPath: Schema.string().default('ffmpeg'),
  ffprobePath: Schema.string().default('ffprobe'),
  videoEncoder: Schema.string().default(''),
  nativeJobs: Schema.boolean().default(false),
  previewInChat: Schema.boolean().default(true),
  previewLimit: Schema.number().default(4),
})
