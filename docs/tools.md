# Tool reference

> Generated from the registered tool definitions by `node scripts/tool-reference.mjs --write`.
> `node scripts/tool-reference.mjs` fails when this file and the code disagree, so it cannot drift.

**14 tools.** Every one of them talks to a local GenBox server over HTTP.

| Tool | What it is for | Parameters |
|---|---|---|
| [`genbox_cutout`](#genbox_cutout) | Remove the background from an image with GenBox's local cutout tool and return the transparent PNG path | 3 |
| [`genbox_doctor`](#genbox_doctor) | Self-check the local GenBox setup: server reachability, authentication mode, provider and API-key readiness, ffmpeg availability and output-directory writability | 1 |
| [`genbox_gallery`](#genbox_gallery) | List the most recent items in the GenBox media library (images and videos, newest first) and optionally copy them to a local directory | 6 |
| [`genbox_health`](#genbox_health) | Check whether the local GenBox server is reachable and report its runtime status | 0 |
| [`genbox_image_edit`](#genbox_image_edit) | Edit an existing image through a local GenBox server | 17 |
| [`genbox_image_generate`](#genbox_image_generate) | Generate images from a text prompt through a local GenBox server | 12 |
| [`genbox_image_upscale`](#genbox_image_upscale) | Upscale an image locally through GenBox (Lanczos/Bicubic/Nearest) | 5 |
| [`genbox_image_variations`](#genbox_image_variations) | Ask a GenBox image provider for visual variations of an existing image | 7 |
| [`genbox_open_workbench`](#genbox_open_workbench) | Open the local GenBox workbench (its own web UI) and report whether the server answers | 2 |
| [`genbox_prompt_optimize`](#genbox_prompt_optimize) | Rewrite a rough image prompt into a richer one with GenBox's configured prompt-assistant LLM | 2 |
| [`genbox_providers`](#genbox_providers) | List the providers a local GenBox server has configured (image, video, or LLM), with enabled state, models, declared capabilities and transport (endpointType) | 2 |
| [`genbox_task`](#genbox_task) | Check or cancel a GenBox job | 4 |
| [`genbox_video_edit`](#genbox_video_edit) | Edit a local video with ffmpeg - no GenBox server or API key needed | 15 |
| [`genbox_video_generate`](#genbox_video_generate) | Generate a video through a local GenBox server: text-to-video (mode=ti2vid), image-to-video (mode=i2vid with one reference image) or first/last keyframes (mode=keyframes with exactly two images) | 14 |

## genbox_cutout

```
Remove the background from an image with GenBox's local cutout tool and return the transparent PNG path. Requires an installed cutout checkpoint on the GenBox host; the call fails with the host's reason otherwise.
```

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `image` | string | yes | Source image: a local png/jpeg/webp path or a data URL. |
| `adapter` | string | no | Force a specific GenBox cutout adapter id. |
| `outputDir` | string | no | Directory for the result. Defaults to the plugin outputDir config. |

## genbox_doctor

```
Self-check the local GenBox setup: server reachability, authentication mode, provider and API-key readiness, ffmpeg availability and output-directory writability. Run this first when another GenBox tool fails - it says what to fix instead of leaving you with a raw HTTP error.
```

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `showProviders` | boolean | no | Also report how many providers are enabled and which ones lack keys. |

## genbox_gallery

```
List the most recent items in the GenBox media library (images and videos, newest first) and optionally copy them to a local directory. GenBox has no paging, so only the newest entries are reachable.
```

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `limit` | number | no | How many recent items to return (GenBox default 50). |
| `type` | one of: `image` | `video` | `all` | no | Filter by media type; defaults to 'all'. |
| `downloadTo` | string | no | When set, copy every matching item into this directory (relative paths resolve against the session workspace). |
| `query` | string | no | Case-insensitive substring match over the prompt, model and file name. |
| `model` | string | no | Only return items whose recorded model field equals this value. GenBox records the provider id here, not the model name. |
| `since` | string | no | Only return items created at or after this date, for example 2026-10-01 or 2026-10-01T12:00:00. |

## genbox_health

```
Check whether the local GenBox server is reachable and report its runtime status.
```

Takes no parameters.

## genbox_image_edit

```
Edit an existing image through a local GenBox server. mode=i2i re-renders the whole image from the reference plus a prompt; mode=inpaint repaints only the white area of a mask; mode=precision_edit keeps the original canvas and applies an instruction (resize mode requires precisionTargetSize). inpaint needs a provider whose inpaint_mask capability is enabled, precision_edit one whose precision_edit is; genbox_providers lists both, and this tool names the usable providers when GenBox refuses the mode.
```

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `prompt` | string | yes | What to change. |
| `image` | string | yes | Source image: a local png/jpeg/webp path or a data URL. |
| `mode` | one of: `i2i` | `inpaint` | `precision_edit` | no | Editing mode; defaults to 'i2i'. |
| `mask` | string | no | Required for inpaint: png/webp mask path or data URL, same size as the source. White is edited. |
| `referenceImages` | array of string | no | i2i only: extra reference images (local paths or data URLs) to blend with "image", which stays the first/base one. GenBox receives them as image_data_list and requires its first entry to equal the base image. |
| `providers` | array of string | no | Provider ids to use. Defaults to every enabled image provider. |
| `model` | string | no | Model id to request. Must belong to the selected provider. |
| `size` | string | no | Target canvas for i2i/inpaint, such as '1024x1024'. |
| `strength` | number | no | i2i transformation strength (0-1); GenBox defaults to 0.55. |
| `upscaleTo` | string | no | i2i/inpaint only: grow the finished image on the GenBox host, e.g. '2048' or '2048x1536' (reduced to its longest edge, which is what GenBox actually parses). precision_edit refuses this - upscale its result with genbox_image_upscale instead. |
| `upscaleMethod` | one of: `lanczos3` | `bicubic` | `nearest` | no | Resampling for upscaleTo; defaults to 'lanczos3'. |
| `upscaleRatio` | string | no | Aspect ratio for upscaleTo such as '16:9', or 'original' (default). |
| `precisionTargetSize` | string | no | precision_edit only: target canvas 'WIDTHxHEIGHT' required by resize mode. |
| `precisionOutputSizePolicy` | one of: `strict` | `fit_crop` | no | precision_edit resize output policy; defaults to 'strict'. |
| `annotations` | array of object | no | precision_edit: what to change and where, in source-image pixels. Each entry is drawn as a numbered marker on the overlay GenBox receives. |
| `outputDir` | string | no | Directory for the downloaded results. Defaults to the plugin outputDir config. |
| `background` | boolean | no | Return as soon as GenBox accepts the job instead of waiting for the result. Poll with genbox_task. |

Declares a UI render intent (`presentCall` / `presentResult`).

## genbox_image_generate

```
Generate images from a text prompt through a local GenBox server. GenBox fans the same prompt out to one or more configured providers, so several models can be compared in one call. Images are downloaded next to the session and the returned file paths can be shown with read_image.
```

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `prompt` | string | yes | The image prompt. |
| `providers` | array of string | no | Provider ids to use. Defaults to every enabled image provider. |
| `model` | string | no | Model id to request. Must belong to the selected provider. |
| `size` | string | no | Canvas size such as '1024x1024'. Defaults to the provider's own size. |
| `quality` | string | no | Quality tier such as 'high' or 'standard'. |
| `count` | number | no | Images per provider (1-10). Defaults to 1. |
| `enhancePrompt` | boolean | no | Ask the configured LLM provider to rewrite the prompt first. |
| `outputDir` | string | no | Directory for the downloaded images. Defaults to the plugin outputDir config. |
| `upscaleTo` | string | no | Grow the finished image on the GenBox host before returning: '2048' or '2048x1536' (only the longest edge matters - GenBox parses it as an integer, so a WxH string is reduced to its longest edge here). Requires GenBox to have Pillow available, which the packaged builds do. |
| `upscaleMethod` | one of: `lanczos3` | `bicubic` | `nearest` | no | Resampling for upscaleTo; defaults to 'lanczos3'. |
| `upscaleRatio` | string | no | Aspect ratio for upscaleTo such as '16:9', or 'original' (default) to keep the source ratio. |
| `background` | boolean | no | Return as soon as GenBox accepts the job instead of waiting for the images. Poll with genbox_task. |

Declares a UI render intent (`presentCall` / `presentResult`).

## genbox_image_upscale

```
Upscale an image locally through GenBox (Lanczos/Bicubic/Nearest). Runs on the GenBox host, needs no provider API key, and returns the path of the upscaled PNG.
```

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `image` | string | yes | Source image: a local png/jpeg/webp path or a data URL. |
| `targetWidth` | number | no | Target width in pixels (default 2048). |
| `targetHeight` | number | no | Target height in pixels (default 2048). |
| `method` | one of: `lanczos3` | `bicubic` | `nearest` | no | Resampling method; defaults to 'lanczos3'. |
| `outputDir` | string | no | Directory for the result. Defaults to the plugin outputDir config. |

## genbox_image_variations

```
Ask a GenBox image provider for visual variations of an existing image. GenBox's native path proxies the legacy OpenAI /images/variations contract, which some gateways and the gpt-image family do not implement; with strategy="auto" the tool then repaints candidates from the same source through mode=i2i, so variations work with any provider that can edit.
```

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `image` | string | yes | Source image: a local png/jpeg/webp path or a data URL. |
| `provider` | string | no | Provider id to use; defaults to the first enabled image provider. |
| `model` | string | no | Model id to request. |
| `size` | string | no | Canvas size such as '1024x1024'. |
| `n` | number | no | How many variations (1-4 on the native path, up to 10 on the prompt path). |
| `strategy` | one of: `auto` | `native` | `prompt` | no | How to make the variations. 'native' posts to GenBox's OpenAI /images/variations proxy; 'prompt' repaints candidates from the same source with mode=i2i, which works with any provider that can edit; 'auto' (default) tries native first and falls back to prompt when the gateway does not implement it. |
| `outputDir` | string | no | Directory for the results. Defaults to the plugin outputDir config. |

## genbox_open_workbench

```
Open the local GenBox workbench (its own web UI) and report whether the server answers. Call this once right after the plugin is installed, and whenever the user asks where to configure providers, API keys or settings, or where to browse generated media: the tools below only drive GenBox over HTTP, while the workbench is the human-facing UI.
```

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `page` | string | no | Optional section to open: 'gallery', 'settings', 'providers' or 'tasks'. |
| `open` | boolean | no | Launch the browser (default false - it only reports the URL). |

Declares a UI render intent (`presentCall` / `presentResult`).

## genbox_prompt_optimize

```
Rewrite a rough image prompt into a richer one with GenBox's configured prompt-assistant LLM. When no LLM provider is configured GenBox returns the original text unchanged and sets optimizedByLlm=false.
```

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `prompt` | string | yes | The rough prompt to improve. |
| `provider` | string | no | LLM provider id to use; defaults to the configured one. |

## genbox_providers

```
List the providers a local GenBox server has configured (image, video, or LLM), with enabled state, models, declared capabilities and transport (endpointType). Call this before generating to choose a provider whose model supports the operation and size you need; note that mask inpaint needs an enabled provider with endpointType=openai as well as capabilities.inpaint_mask.
```

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `type` | one of: `image` | `video` | `llm` | `all` | no | Which provider type to list; defaults to 'all'. |
| `enabledOnly` | boolean | no | Only return providers that are currently enabled (default false). |

## genbox_task

```
Check or cancel a GenBox job. Use it for jobs that were submitted with background=true from genbox_image_generate, genbox_image_edit or genbox_video_generate. Once the job has finished this downloads its results next to the session and returns their local paths.
```

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | The generation id or video task id returned by the submit call. |
| `kind` | one of: `image` | `video` | no | Job kind; defaults to 'video'. |
| `cancel` | boolean | no | Request cancellation instead of reading status. |
| `outputDir` | string | no | Directory for downloaded results. Defaults to the plugin outputDir config. |

## genbox_video_edit

```
Edit a local video with ffmpeg - no GenBox server or API key needed. Operations: trim (cut a range), concat (join clips in order), speed (time stretch), mute (drop the audio track), resize (re-encode to a canvas), crop (cut a rectangle out), volume (audio gain), replace_audio (swap the audio track), burn_subtitles (render an .srt/.ass onto the picture), to_gif (animated GIF) and extract_frame (write one frame as PNG). GenBox itself cannot edit video, so this fills that gap locally.
```

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `operation` | one of: `trim` | `concat` | `speed` | `mute` | `resize` | `crop` | `volume` | `replace_audio` | `burn_subtitles` | `to_gif` | `extract_frame` | yes | Which edit to perform. |
| `input` | string | yes | Input video path (for concat: the first clip). |
| `inputs` | array of string | no | concat only: the full ordered list of clips to join (overrides input). |
| `startSeconds` | number | no | trim/extract_frame: start offset in seconds (default 0). |
| `endSeconds` | number | no | trim: end offset in seconds. |
| `speed` | number | no | speed: factor between 0.5 and 2.0 (1 keeps the original pace). |
| `width` | number | no | resize: target width in pixels. |
| `height` | number | no | resize/crop/to_gif: target height (crop requires it; to_gif derives it). |
| `x` | number | no | crop: left offset in pixels (default 0). |
| `y` | number | no | crop: top offset in pixels (default 0). |
| `fps` | number | no | to_gif: frames per second for the GIF (default 12). |
| `volume` | number | no | volume: audio gain factor, for example 0.5 or 2. |
| `audio` | string | no | replace_audio: audio file whose track replaces the video audio. |
| `subtitles` | string | no | burn_subtitles: path to an .srt/.ass file to render onto the video. |
| `outputDir` | string | no | Directory for the result. Defaults to the plugin outputDir config. |

Declares a UI render intent (`presentCall` / `presentResult`).

## genbox_video_generate

```
Generate a video through a local GenBox server: text-to-video (mode=ti2vid), image-to-video (mode=i2vid with one reference image) or first/last keyframes (mode=keyframes with exactly two images). GenBox keeps working after the request returns, so this polls the task and downloads the finished clip.
```

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `prompt` | string | yes | The video prompt. |
| `mode` | one of: `ti2vid` | `i2vid` | `keyframes` | no | Generation mode; defaults to 'ti2vid'. |
| `images` | array of string | no | Reference images (local paths or data URLs). i2vid takes one; keyframes takes two. |
| `imageRole` | one of: `first_frame` | `last_frame` | `reference` | `first_last` | no | How the images are used; keyframes implies first_last. |
| `provider` | string | no | Video provider id; defaults to the first configured video provider. |
| `model` | string | no | Model id to request. |
| `width` | number | no | Frame width in pixels (GenBox default 1152). |
| `height` | number | no | Frame height in pixels (GenBox default 768). |
| `durationSeconds` | number | no | Requested duration in seconds; GenBox clamps it to the model spec. |
| `fps` | number | no | Frame rate (GenBox default 24). |
| `negativePrompt` | string | no | What to avoid. |
| `seed` | number | no | Deterministic seed when the provider supports it. |
| `outputDir` | string | no | Directory for the downloaded clip. Defaults to the plugin outputDir config. |
| `background` | boolean | no | Return as soon as GenBox accepts the job instead of waiting for the clip. Poll with genbox_task - recommended for videos. |

Declares a UI render intent (`presentCall` / `presentResult`).
