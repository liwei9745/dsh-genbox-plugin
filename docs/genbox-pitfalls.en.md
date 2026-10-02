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
existing install if needed) and checks the splitter at three viewport sizes with a real pointer
sequence (synthetic events bypass the hit test - which had hidden that the bar's centre was
clipped out of its scrolling panel, leaving only a few pixels of its top edge clickable):

```
1920x1080: baseline 643+250=893 | +120 -> 683+210=893 | -240 -> 443+450=893
1280x800 : baseline 363+250=613 | +120 -> 403+210=613 | -240 -> 220+393=613
OK
```

That last line is the automated counterpart of item 7: the precision workbench's bottom bar
changes the height only (h +120, w 0). It needs a local image - pass `PROBE_IMAGE=<png>` or let
it pick the newest png under `.genbox-out`.

### What the harness covers now (all with real pointer sequences)

| # | Check | Assertion |
|---|---|---|
| 1 | Generate page vertical splitter (1920x1080 / 1280x800) | the panes trade space with a constant total; hit-tested first, skipped when unreachable |
| 2 | Generate page left splitter | left column +120 / preview -120 (real drag) |
| 3 | Precision canvas corner grip | **reachability**: `elementFromPoint(centre)` must return the grip |
| 4 | Precision canvas bottom bar | height only (h +120, w 0) |

Item 1 is skipped (not failed) at 768x900, where the bar is not laid out.

**Audit note:** the left splitter is healthy (hit test returns `div#resizeLeft` and the drag works),
and the creation-tools rail is a **click-to-collapse toggle**, not a drag splitter, so it has no
equivalent problem.

## 9. The canvas corner grip was swallowed by the status bar (**fixed**)

**Symptom:** with a tall canvas and a short viewport the 44x44 `nwse` grip at the canvas's
bottom-right corner ended up underneath the app status bar - `document.elementFromPoint()`
returned `div.status-bar` and no pointer event could reach the grip.

**Cause:** the canvas height limit was a viewport allowance (`viewportHeight - 120` in
`precisionCanvasResizeLimits`); it neither reserved the status bar nor looked at the shell's own
top edge, and the workbench panel is allowed to overflow in precision-edit mode.

**`z-index` cannot fix it** (measured): an ancestor of the grip, `#panelPrecisionEdit`,
carries a `backdrop-filter` and is a stacking context of its own, painting in DOM order before
the status bar; raising the grip to `z-index: 30` changed nothing.

**Fix:** a new `precisionCanvasAvailableHeight(shell)` measures from the shell's top to the status
bar's top and feeds `maxHeight` (still clamped to 240-760). Measured at 1920x1080:

```
canvas 760 -> 733 (the limit now reflects the real space)
grip bottom 1049  vs  status bar top 1050
document.elementFromPoint(grip centre) -> button#precisionCanvasResizeHandle
```

`scripts/browser/measure-splitters.cjs` now asserts exactly that
(`precision corner grip is reachable`) instead of reporting it as blocked.

## 10. The generate page's panes overflowed the column at narrow widths (**fixed**)

**Symptom:** at 768x900 the column scrolled and the vertical splitter was no longer laid out
where a pointer could reach it.

**Cause (measured):** the three children of `.generate-center` kept their intrinsic heights -
canvas row 490 + task monitor 167 + input row 349 = **1006** against a **721** column. The stylesheet
has a three-row grid rule for this breakpoint (`grid-template-rows: minmax(180px,1fr) 42px` ...
whose minimum total is only 432), but the computed style reported `display: flex` with
`flex: 0 0 auto` children - the grid was not in effect, so they grew to their content.

**Fix** (rather than hunting for the rule that overrode the grid, let the two rows share the
column at this breakpoint):

```css
@media (max-width: 800px) {
  #pageGenerate .generate-center > .creator-canvas-row  { flex: 1 1 auto; min-height: 180px; }
  #pageGenerate .generate-center > .creator-task-monitor { flex: 0 0 auto; }
  #pageGenerate .generate-center > .creator-input-row   { flex: 1 1 auto; min-height: 210px; }
}
```

**Measured:** `490+349=839` (118px of overflow) became `312+222=534` (within the 721px
column), and the browser assertion went from a reported upstream issue to `[ok]`.
See the coverage matrix in [browser-checks.en.md](./browser-checks.en.md).
