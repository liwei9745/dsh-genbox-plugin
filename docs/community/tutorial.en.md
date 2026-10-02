# Tutorial: turn GenBox into a media backend for your DSH agent

> Draft for a blog post, a GitHub Discussion or a dev.to / Medium article. Trim as needed.

Goal: your DeepSeek Harness agent can "draw a picture", "edit this image" or "generate a five second clip", while the
heavy lifting stays in [GenBox](https://github.com/liwei9745/GenBox), the local open-source FastAPI media workbench you
already run.

## 0. Why a plugin instead of prompting the model to curl things

A DSH plugin is just a TypeScript module exporting `apply(ctx)`. Through `ctx.tools.register` you turn a capability into
a tool the model can call, and you get argument validation, typed return values, error handling and (later) UI cards and
background jobs for free. Compared with asking the model to shell out to `curl`, the plugin is the supported surface.

## 1. Get GenBox running

```powershell
cd <genbox checkout>
uv venv --python 3.11 .venv        # do not use 3.14: the pinned deps have no wheels there yet
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
$env:APP_MODE='dev'; $env:GENBOX_PORT='8892'
.\.venv\Scripts\python.exe main.py
```

With `APP_MODE=dev` GenBox needs no `X-Admin-Key` and binds to `127.0.0.1` only. Open `http://127.0.0.1:8892` and
configure the providers you want (OpenAI-compatible, Gemini, Qwen, Volcengine, ...).

## 2. Install the plugin

```powershell
git clone https://github.com/liwei9745/dsh-genbox-plugin
cd dsh-genbox-plugin; corepack pnpm install; corepack pnpm run build
dsh plugin --profile genbox-dev add .      # or add ./dsh-genbox-plugin-0.1.0.tgz
dsh --profile genbox-dev --port 3099
```

The startup log proves the host loaded it:

```
[genbox] plugin loaded (baseUrl=http://127.0.0.1:8892)
```

## 3. Use it

Just talk to the agent:

- "Generate a shiba inu in the snow with GenBox, 1024x1024"
- "Replace the background of `E:\out\dog.png` with a beach"
- "Make a five second sunset clip"
- "Show me the newest GenBox media"

Generated media lands in `outputDir` and the tool returns absolute paths; the model can then open them with the
built-in `read_image` tool. No plugin-side image plumbing needed.

Long jobs are better started with `background: true` and collected with `genbox_task` - a video can take minutes and
you do not want the tool call to sit there.

When something breaks, run `genbox_doctor` first: it checks reachability, auth mode, provider/key readiness, the output
directory and ffmpeg, and tells you what to fix.

## 4. No API key? Verify with mock providers

The repository ships a fake image/video endpoint (Pillow draws a solid PNG at the requested size, plus a fake Volcengine
video task):

```powershell
# terminal A
python scripts/mock-openai-image.py
# terminal B: register it as a GenBox provider (see docs/local-dev.md), then
node scripts/verify-all.mjs
```

`verify-all.mjs` walks the whole chain - generate, edit, upscale, variations, video, background jobs, gallery, prompt
assistant, annotation preview - and prints a PASS/SKIP table. Suites whose prerequisites are missing are skipped instead
of failing, so the same command works in CI.

## 5. Three real traps we hit

1. **`[::1]` inside `NO_PROXY`**. If the host exports a `NO_PROXY` containing `[::1]`, CPython hands it to httpx verbatim,
   and httpx 0.28 raises `InvalidURL: Invalid port: ':1]'` while *building the client* - every outbound GenBox request
   fails before it starts. Fix: strip the bracketed entries in a `sitecustomize.py` inside the venv.
2. **`dsh plugin` needs a real pnpm.** Installing only corepack is not enough; put a `pnpm.cmd` shim forwarding to
   `corepack pnpm` on PATH.
3. **Precision editing is gated.** GenBox only accepts `precision_edit` for models that were explicitly verified as
   image-edit capable; otherwise it answers `precision_edit_provider_unsupported`. That is a deliberate safety gate, not
   a plugin bug.

## 6. Writing a plugin like this yourself

Three things are enough:

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-plugin'
export const inject = ['tools']

export function apply(ctx: Context, config: MyConfig) {
  ctx.tools.register(defineTool({
    name: 'my_tool',
    description: 'What the model sees.',
    parameters: { prompt: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(args, exec) { /* return one canonical JSON value */ },
  }))
}
```

Add a `dsh.bundle.patch` entry to `package.json` plus a `cordis.patch.yml`, and `dsh plugin add` can distribute it.

## 7. Takeaway

One sentence: **GenBox already has a REST API, so do not touch it.** The plugin only translates that API into tools the
model can use, which keeps both sides free to evolve.
