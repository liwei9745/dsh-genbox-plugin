# Integrating with GenBox: the pitfalls we hit

> Every row was measured on a live GenBox, with the root cause (source location) and the fix.
> Useful whether or not you use this plugin.
> Assumes GenBox runs in dev mode on `127.0.0.1:8892` (`APP_MODE=dev`, no `X-Admin-Key`).

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | `inpaint_provider_unsupported` | The gate is **declarative**: it wants `endpoint_type == 'openai'` (`main.py:1504-1510`) | Change that provider's `endpoint_type` from `auto` to `openai` |
| 2 | `upscale_to` with `"1024x1024"` **silently keeps the original** | `_do_local_upscale` parses with `int(target_size)` (`main.py:3572`) and the exception is swallowed (`main.py:4633-4635`) | Send the **longest edge as an integer**; the plugin normalises `WxH` |
| 3 | `image_variation_upstream_error` | The native path proxies the **legacy** OpenAI `/images/variations` multipart contract (`main.py:4875-4920`) | Generate candidates with `mode=i2i` + `quantities` (plugin: `strategy=prompt/auto`) |
| 4 | HTTP 429 | Only `/api/generate` is throttled: **10 requests per minute per IP** | Back off with growing waits; batch with `background: true` |
| 5 | `precision_upscale_not_allowed` | precision_edit refuses post-generation upscaling (`main.py:1350-1355`) | Call `/api/images/upscale` on the result (local Lanczos, 1024->2048 in 0.8s) |
| 6 | precision edit refused | Needs `capabilities.precision_edit` **and** a model-level declaration (`main.py:1521, 2737`) | Read `model_capabilities` / `precision_size_catalog` |
| 7 | Canvas corner grip ignores vertical drags | The grip is a 44x44 `nwse` corner handle, but the handler read only `dx` | Use the dominant axis (`Math.abs(dx) >= Math.abs(dy) ? dx : dy`) |
| 8 | The generate page's vertical splitter does **nothing** | `startResize(e,'bottom')` flexed `.generate-preview`, a **grandchild** of the flex container | Size `#creatorCanvasRow` with an explicit `height` |

## Two general lessons

1. **When an upstream refuses an operation, read its validation code first.** Several
   refusals are declaration gates rather than missing capability: `auto` already resolves
   to the openai protocol at request time (the generation status reports
   `request_contract.protocol = openai`) and is still refused.
2. **Silent degradation is worse than an error.** Item 2 keeps returning
   `status: completed` and simply hands back the un-upscaled image. A client should
   normalise parameters into the shape the upstream actually parses instead of copying
   its documentation verbatim.

## Reproducing this

No API key needed: the repository ships a zero-cost mock provider, and
`node scripts/verify-all.mjs` runs the suites against it. Real-provider work is opt-in:
`GENBOX_REAL_PROVIDER=gpt-image node scripts/verify-real-provider.mjs`.

Items 7 and 8 are measured in a real browser. `scripts/browser/measure-splitters.cjs`
finds a chromium by itself (Playwright has to be resolvable - point `NODE_PATH` at an
existing install if needed) and checks the splitter at two viewport sizes:

```
1920x1080: baseline 643+250=893 | +120 -> 683+210=893 | -240 -> 443+450=893
1280x800 : baseline 363+250=613 | +120 -> 403+210=613 | -240 -> 220+393=613
OK
```

That last line is the automated counterpart of item 7: the precision workbench's bottom bar
changes the height only (h +120, w 0). It needs a local image - pass `PROBE_IMAGE=<png>` or let
it pick the newest png under `.genbox-out`.

## 9. The canvas corner grip can end up under the status bar (**not fixed, reproducible**)

With a tall canvas and a short viewport the shell is allowed to overflow
(`overflow: visible` while `precision-edit-active`), and the canvas size limit is computed from the
viewport without subtracting the bottom status bar (`.status-bar`, min-height 28px, with a
`backdrop-filter`). The shell's bottom-right corner - where the 44x44 `nwse` grip sits - therefore lands
underneath the status bar:

```js
document.elementFromPoint(gripX, gripY)   // -> div.status-bar (not the grip)
```

**`z-index` does not rescue it**: an ancestor of the grip, `#panelPrecisionEdit`, carries a
`backdrop-filter` and is a stacking context of its own (z-index: auto), so in the root context it
paints in DOM order before the status bar - measured with the grip raised to `z-index: 30` as well.
The real fix is either to subtract the status bar height from the canvas limit, or to stop the
workbench panel from overflowing in precision-edit mode.

`scripts/browser/measure-splitters.cjs` hit-tests the grip first and reports
`the corner grip is covered by div.status-bar` instead of failing spuriously.
