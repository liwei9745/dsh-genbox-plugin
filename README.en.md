# dsh-genbox-plugin

[![npm](https://img.shields.io/npm/v/dsh-genbox-plugin)](https://www.npmjs.com/package/dsh-genbox-plugin)
[![CI](https://github.com/liwei9745/dsh-genbox-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/liwei9745/dsh-genbox-plugin/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/dsh-genbox-plugin)](./LICENSE)

Bring a local [GenBox](https://github.com/liwei9745/GenBox) media server (FastAPI, multi-provider image and video
generation) into [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) as agent tools: generate images,
edit them, generate video, and cut video locally - plus the media library and prompt assistant.

A parameter reference for every tool lives in [docs/tools.md](./docs/tools.md) (**generated from the code**, so it
cannot drift). Measured integration pitfalls, with root causes and source locations, are in
[docs/genbox-pitfalls.en.md](./docs/genbox-pitfalls.en.md), and the browser reachability coverage matrix in
[docs/browser-checks.en.md](./docs/browser-checks.en.md).
### Verification and evidence (three entry points)

| What you want | Where | One command |
|---|---|---|
| Is it working right now? | [docs/verification.md](./docs/verification.md) - a real run's **raw output**, 22 suites | `node scripts/verify-all.mjs` |
| Can the UI really be clicked and dragged? | [docs/browser-checks.md](./docs/browser-checks.md) - reachability matrix, 6 assertions | `node scripts/browser/measure-splitters.cjs` |
| What will bite me when integrating GenBox? | [docs/genbox-pitfalls.md](./docs/genbox-pitfalls.md) - 10 findings with source locations | - |
| What did we change in GenBox itself? | the upstream fix ledger in [ROADMAP.md](./ROADMAP.md) | - |

> Every suite runs against the **zero-cost mock provider** by default; real-provider work is the
> explicit `GENBOX_REAL_PROVIDER=...` opt-in and never spends a key implicitly.
> When a prerequisite is missing (GenBox, ffmpeg, Playwright, an installed profile) the suite
> **skips and says how to provide it** instead of pretending to pass.

Design notes live in [PLAN.md](./PLAN.md); the internal layout and how to add a tool in
[docs/architecture.md](./docs/architecture.md); install, configuration and troubleshooting in [docs/install.md](./docs/install.md)
(English: [docs/install.en.md](./docs/install.en.md)); the local development environment (including a zero-API-key mock
provider) in [docs/local-dev.md](./docs/local-dev.md) (Chinese); the release process in [docs/releasing.md](./docs/releasing.md).

## Quick start (30 seconds)

Three steps after installing - the agent can do all of them for you:

1. **Open the workbench**: ask the agent to "open the GenBox workbench" (it calls `genbox_open_workbench`),
   or open **http://127.0.0.1:8892/** yourself. Providers, API keys and settings live in that UI.
2. **Self-check**: "run the GenBox doctor" (`genbox_doctor`) - it lists what is missing and a next-steps checklist.
3. **Use it**: just say "draw a shiba inu in the snow with GenBox".

> When GenBox is not running, step 1 says so explicitly and points at the start command in [docs/local-dev.md](./docs/local-dev.md).

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
| M7 | published to npm | done - `dsh-genbox-plugin@0.1.1`, smoke-tested by generating an image with the npm-installed copy |
| M8 | plugin-market readiness | done - checked with the market's own modules: bundle patch present, host compatible, profile preflight 0 risks |
| M9 | **real provider end to end** | done - live `gpt-image` run: 844 KB PNG 1024x1024 text-to-image (50s) plus a real image-to-image edit |
| M10 | acceptance journey | done - `verify-journey.mjs`, 17 checks from doctor through generate/edit/annotate/video/cancel/ffmpeg/gallery |

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

### 3. From npm (published)

```powershell
# 0.1.0 is on npm; this installs prebuilt code with no build authorisation
dsh plugin --profile <profile> add dsh-genbox-plugin

dsh --profile <profile> --dump-config | Select-String genbox   # confirm the plugin layer
```

> The `desktop` profile is owned by the DSH Desktop application; installing into it goes through that app, and it
> takes effect after a restart. Use a separate profile such as `dsh --profile genbox-dev --from-default-profile web`
> while developing.

## Tools

| Tool | Purpose |
|---|---|
| `genbox_doctor` | self-check: reachability, auth mode, provider/key readiness, writable output directory, ffmpeg presence, with fix hints |
| `genbox_open_workbench` | Print/open the GenBox workbench (the first thing to do after installing) |
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
| `genbox_gallery` | browse the media library and copy items locally; filter by `type`, `model`, `query` or `since` |
| `genbox_prompt_optimize` | rewrite a rough prompt with GenBox prompt assistant |

Generated media lands in `outputDir` and the absolute paths are returned to the model, which can then open them with
the built-in `read_image` tool.

## Rendering (UI cards)

The media tools implement `presentCall`, `presentResult` and `output.presentationMeta`:
the finished card is rebuilt from the **persisted meta** (safe on replay) and lists the produced files in `locations`.

> To be honest: **the built-in DSH Web Client does not consume these render intents yet**, so nothing looks different there
> (it falls back to a generic card). Clients that implement the contract will render them. The shapes are pinned by the
> 12 assertions in `scripts/verify-presentation.mjs`.

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
| `nativeJobs` | false | experimental: hand background video jobs to DSH `ctx.jobs`, see [docs/native-jobs.md](./docs/native-jobs.md) |

## Development

```sh
corepack enable
pnpm install
pnpm run typecheck
pnpm run build
# one runner for every suite; anything missing is reported as SKIP
node scripts/verify-all.mjs
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
   **With 2FA enabled npm demands a one-time code**: `pnpm publish --otp=<code>`, or use a granular token that is allowed to bypass 2FA.
   Afterwards run `node scripts/verify-published.mjs` to read back the version, `engines.dsh`, keywords and tarball contents.
3. Add the `dsh-plugin` topic to the GitHub repository (the official discovery mechanism; upstream does not accept
   external pull requests today).
4. Announce it in the DeepSeek Harness GitHub Discussions.

`node scripts/publish.mjs` runs the whole preflight and prints the exact commands.

## License

MIT. GenBox is GPL-3.0: this plugin only calls its public HTTP API and does not link or copy its source.