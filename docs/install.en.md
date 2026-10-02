# Install, configure and troubleshoot

Everything here is verified on Windows with Node 24 and pnpm 12, from the repository at
`E:\AI\GenBox-dsh`. GenBox itself must be running (default `http://127.0.0.1:8892`).

## 0. Prerequisites

| Need | Why |
|---|---|
| A running GenBox | the plugin is only a client; see [local-dev.md](./local-dev.md) to start it from source |
| At least one enabled provider | image, video and edit calls need one; `genbox_image_upscale` does not |
| `dsh` on PATH | the launcher that boots a profile |
| a real `pnpm` on PATH | `dsh plugin` forwards to pnpm; corepack alone is not enough (see troubleshooting 1) |

## 1. Install

### Option A - tarball (verified)

```powershell
cd E:\AI\GenBox-dsh
corepack pnpm install
corepack pnpm run build
corepack pnpm pack                              # dsh-genbox-plugin-0.1.0.tgz
dsh plugin --profile genbox-dev add ./dsh-genbox-plugin-0.1.0.tgz
```

### Option B - source overlay (fastest while developing)

```powershell
dsh --profile genbox-dev --patch E:/AI/GenBox-dsh/dev/overlay.cordis.yml
```

### Option C - npm package (after a release)

```powershell
dsh plugin --profile genbox-dev add dsh-genbox-plugin
```

### Create a separate profile first

```powershell
dsh --profile genbox-dev --from-default-profile web
```

> The `desktop` profile belongs to the DSH Desktop application: the CLI refuses to touch it
> (`profile "desktop" is managed exclusively by the Electron application`). Install into that one from the
> application itself - its plugin market installs npm packages and refuses to run while any agent session is live.

## 2. Verify the install

```powershell
# the composed tree should show the plugin layer
dsh --profile genbox-dev --dump-config | Select-String genbox

# boot once; this line proves the host imported and applied the plugin
dsh --profile genbox-dev --port 3099 --no-open
#   [genbox] plugin loaded (baseUrl=http://127.0.0.1:8892)
#   dsh web: http://127.0.0.1:3099/?token=...
```

`dsh plugin add` writes the package into the profile manifest for you:

```json
{
  "dependencies": { "dsh-genbox-plugin": "file:E:/AI/GenBox-dsh/dsh-genbox-plugin-0.1.0.tgz" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-genbox-plugin"] } }
}
```

## 3. Using it

The plugin registers 13 tools (see the README table). Typical asks:

- "Draw a shiba inu in the snow with GenBox, 1024x1024" -> `genbox_image_generate`
- "Swap the background of this image for a beach" -> `genbox_image_edit` (`i2i`, or `inpaint` with a mask)
- "Mark this area and widen the canvas" -> `genbox_image_edit` with `annotations` (precision edit)
- "Make a five second sunset clip" -> `genbox_video_generate`
- "Trim this clip and burn in the subtitles" -> `genbox_video_edit` (local ffmpeg, no API key)

Generated media lands in `outputDir` and the tool returns absolute paths, so the model can open them with the
built-in `read_image`. Long jobs are best started with `background: true` and collected with `genbox_task`.

## 4. Configuration

Override the bundle row from the profile patch layer (`$DSH_HOME/profiles/<name>/cordis.patch.yml`):

```yaml
- id: genbox
  name: dsh-genbox-plugin
  config:
    baseUrl: 'http://127.0.0.1:8892'
    adminKey: ''            # required when GenBox runs with APP_MODE=prod
    outputDir: 'E:/AI/GenBox-output'
    pollIntervalMs: 2000
    taskTimeoutMs: 900000
    nativeJobs: false       # experimental: hand background video jobs to DSH ctx.jobs
```

A patch replaces the whole `config` of that row, so restate every key you want to keep.

## 5. Troubleshooting

### 1) `dsh plugin` cannot find pnpm

It forwards to a real pnpm. Put a shim on PATH if only corepack is installed:

```text
C:\Users\<you>\AppData\Roaming\npm\pnpm.cmd
@echo off
corepack pnpm %*
```

### 2) Every generation fails with an invalid-port error

GenBox uses httpx, and the host exports a `NO_PROXY` containing a bracketed IPv6 entry; httpx 0.28 raises while
*building* the client, so no outbound request ever starts. Drop the bracketed entries from a `sitecustomize.py`
inside the GenBox venv - see [local-dev.md](./local-dev.md).

### 3) `no image model available` / `no video generation model`

No enabled provider with an API key. Run `genbox_providers` (or `genbox_doctor`) and configure one in the GenBox UI.

### 4) `inpaint_provider_unsupported`

GenBox requires the provider to declare `capabilities.inpaint_mask = true`. That is GenBox policy, not a plugin bug.

### 5) `precision_edit_provider_unsupported`

Precision editing needs a model whose capability you confirmed explicitly. See [precision-edit.md](./precision-edit.md).

### 6) `cutout_model_missing`

The released GenBox does not ship an ONNX cutout checkpoint; an operator has to install one that passes its checks.

### 7) Nothing happens after installing into the desktop profile

The Desktop reads its profile at startup, so restart DSH NEXT. Verify first in a separate CLI profile.

### 8) `pnpm run build` fails with an access-denied error

The build output directory occasionally ends up owned by another account, so `--clean` cannot delete its files.
Rebuild through the wrapper: `powershell -File .\scripts\rebuild.ps1`.

### 7b) `pnpm run build` fails with an access-denied error

The output directory ended up owned by another account. Move it aside and rebuild; the leftovers need an
administrator shell to delete. Details in [local-dev.md](./local-dev.md).

### 9) A tool reports `GenBox is not answering at http://127.0.0.1:8892`

GenBox is not running, or `baseUrl` points at the wrong port. Start GenBox (section 2 of
[local-dev.md](./local-dev.md)), then confirm the workbench URL opens with `genbox_open_workbench`;
`genbox_doctor` walks the whole chain item by item.

### 10) `npm publish` returns 403 about two-factor authentication

Publishing with 2FA enabled needs a one-time code: `npm publish --otp=<code>`, or a granular access token that is
allowed to bypass 2FA.

## 6. Uninstall

```powershell
dsh plugin --profile genbox-dev remove dsh-genbox-plugin
```