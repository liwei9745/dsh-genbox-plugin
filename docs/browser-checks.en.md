# Browser reachability checks (coverage matrix)

> Implemented by `scripts/browser/measure-splitters.cjs`, run as the `verify-all` suite
> `browser: splitter trades space`. Without Playwright or a chromium build it skips, and the
> skip line states what is missing and how to provide it.

## Why

**Synthetic `dispatchEvent` calls bypass the hit test**: they hand the event straight to the element,
so a control the user cannot click still measures as "the handler works". We were fooled by exactly
that - a 12px splitter bar with only ~4 clickable pixels passed every synthetic test.

Every check here therefore does two steps: **hit-test with `document.elementFromPoint()`, then send a real
pointer sequence (`page.mouse`)**. A failed hit test skips the check and names the blocking element
instead of producing a false failure.

## Matrix

| # | Object | Hit test | Real-drag assertion | Viewports | Status |
|---|---|---|---|---|---|
| 1 | Generate page vertical splitter `#resizeBottom` | hit-tested first, falling back to its top 3px | the panes trade space (+40 / -40) with a constant total | 1920x1080, 1280x800 | ok |
| 2 | Generate page left splitter `#resizeLeft` | hit-tests the grip mark (`left+10`) | left column +120 / preview -120 | 1920x1080 | ok |
| 3 | Precision canvas corner grip | **reachability is the assertion** | - (handler maths is covered by the static contract test) | 1920x1080 | ok |
| 4 | Precision canvas bottom bar | needs a loaded image and fullscreen | height only: h +120, w 0 | 1920x1080 | ok |
| 5 | Generate page vertical splitter (narrow) | hit test | - | 768x900 | skipped: not laid out at that breakpoint |

## Reproducing

```powershell
# Playwright has to be resolvable; the script finds a chromium build itself
$env:NODE_PATH = "$env:LOCALAPPDATA\npm-cache\_npx\<hash>\node_modules"
node scripts\browser\measure-splitters.cjs

# or as part of the whole gate (missing prerequisites skip with a remedy)
node scripts\verify-all.mjs
```

## Not covered yet

- The provider column handle `.provider-col-resize`: audited (a real drag moves the card 454 -> 534)
  but only ~4 of its 8px are hit-testable - the card's `overflow: hidden` clips the rest and a
  `z-index` bump did not help. Usable but narrow; not asserted yet.
- Narrow-viewport expectations: the suite only asserts "skip when not laid out", not what the
  splitter should do at a small breakpoint.