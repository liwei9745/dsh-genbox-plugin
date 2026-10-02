# dsh-genbox-plugin

Bring a local [GenBox](https://github.com/liwei9745/GenBox) media server (FastAPI, multi-provider image and video
generation) into [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) as agent tools: generate images,
edit them, generate video, and cut video locally - plus the media library and prompt assistant.

Design notes live in [PLAN.md](./PLAN.md); install, configuration and troubleshooting in [docs/install.md](./docs/install.md);
the local development environment (including a zero-API-key mock provider) in [docs/local-dev.md](./docs/local-dev.md).

## Shape

```
DSH agent -> dsh-genbox-plugin (TypeScript) --HTTP--> GenBox FastAPI (127.0.0.1:8892) --> providers
```

GenBox is not modified: it already exposes a complete REST API, so this plugin is only a client and GenBox can be
upgraded independently. GenBox is GPL-3.0; this plugin is MIT and contains none of its source.

## Status

| Milestone | What | State |
|---|---|---|
| M0 | GenBox running locally | done - Python 3.11 venv, dev mode on `127.0.0.1:8892` |
| M1 | Plugin skeleton + `genbox_health` | done - builds, loads in a real host, calls `/api/status` |
| M2 | `genbox_image_generate` | done - verified end to end with a mock provider |
| M3 | editing, upscale, variations, cutout | done - i2i, inpaint, upscale and variations verified; cutout reports the missing checkpoint |
| M4 | `genbox_video_generate` | done - verified end to end via a mock Volcengine provider |
| M5 | `genbox_gallery`, `genbox_prompt_optimize` | done |
| M6 | packaging and distribution | done - `pnpm pack` -> `dsh plugin add <tarball>` -> `[genbox] plugin loaded` |
| G5 | local video editing (11 operations) and precision-edit annotations | done - every operation verified |

## Install

Any of these needs a running GenBox (default `http://127.0.0.1:8892`).

### 1. From a tarball (verified)

```powershell
corepack pnpm pack
dsh plugin --profile <profile> add ./dsh-genbox-plugin-0.1.0.tgz
```

Because `package.json` declares `dsh.bundle`, the package name is appended to `dsh.profile.bundles` automatically.
On startup you should see:

```
[genbox] plugin loaded (baseUrl=http://127.0.0.1:8892)
```

### 2. From a local source checkout (development)

```powershell
dsh --profile <profile> --patch E:/AI/GenBox-dsh/dev/overlay.cordis.yml
```

### 3. From npm or GitHub (once published)

```powershell
dsh plugin --profile <profile> add dsh-genbox-plugin
dsh plugin --profile <profile> add github:<you>/GenBox-dsh
```

> The `desktop` profile is owned by the DSH Desktop application; installing into it goes through that app, and it
> takes effect after a restart. Use a separate profile such as `dsh --profile genbox-dev --from-default-profile web`
> while developing.

## Tools

| Tool | Purpose |
|---|---|
| `genbox_doctor` | self-check: reachability, auth mode, provider/key readiness, writable output directory, ffmpeg presence, with fix hints |
| `genbox_health` | is GenBox reachable |
| `genbox_providers` | list providers, models and declared capabilities |
| `genbox_image_generate` | text to image; several providers side by side, multiple images, size and quality |
| `genbox_image_edit` | `i2i`, `inpaint` (white = edit), or `precision_edit` (canvas resize, or annotations: arrow/rectangle/ellipse/brush) |
| `genbox_image_upscale` | local upscale, no API key needed |
| `genbox_image_variations` | image variations |
| `genbox_cutout` | background removal (needs a checkpoint installed on the GenBox host) |
| `genbox_video_generate` | text to video, image to video, first/last keyframes |
| `genbox_video_edit` | local ffmpeg editing: trim, concat, speed, mute, resize, crop, volume, replace_audio, burn_subtitles, to_gif, extract_frame |
| `genbox_task` | check, download or cancel a background job; image and video tools accept `background: true` |
| `genbox_gallery` | browse the media library and copy items locally |
| `genbox_prompt_optimize` | rewrite a rough prompt with GenBox prompt assistant |

Generated media lands in `outputDir` and the absolute paths are returned to the model, which can then open them with
the built-in `read_image` tool.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:8892` | where GenBox listens |
| `adminKey` | empty | `X-Admin-Key` required by GenBox in production mode |
| `defaultProviderId` | empty | provider used when a call does not name one |
| `outputDir` | `.genbox` | where generated media is written |
| `pollIntervalMs` | 2000 | polling interval; video jobs use at least 5s |
| `taskTimeoutMs` | 900000 | per-task deadline |
| `ffmpegPath` / `ffprobePath` | `ffmpeg` / `ffprobe` | binaries used by `genbox_video_edit` |
| `videoEncoder` | empty (auto) | force an encoder, otherwise libx264 -> h264_mf -> libopenh264 -> mpeg4 |

## Development

```sh
corepack enable
pnpm install
pnpm run typecheck
pnpm run build
# GenBox-independent checks (need ffmpeg on PATH)
node scripts/verify-annotate.mjs
node scripts/verify-video-edit.mjs
# checks that need a running GenBox plus the mock providers
node scripts/verify-tools.mjs
node scripts/verify-background.mjs
node scripts/verify-media.mjs
node scripts/verify-precision.mjs
node scripts/verify-doctor.mjs
```

There is also an evidence board that needs no model credentials:

```sh
node scripts/lab.mjs        # http://127.0.0.1:3098/
```

## Publishing checklist

1. `pnpm build` then `pnpm pack`; confirm the tarball contains `lib/`, `cordis.patch.yml` and both READMEs.
2. `pnpm publish`. Users then install prebuilt code, with no build authorisation needed.
3. Add the `dsh-plugin` topic to the GitHub repository (the official discovery mechanism; upstream does not accept
   external pull requests today).
4. Announce it in the DeepSeek Harness GitHub Discussions.

`node scripts/publish.mjs` runs the whole preflight and prints the exact commands.

## License

MIT. GenBox is GPL-3.0: this plugin only calls its public HTTP API and does not link or copy its source.
