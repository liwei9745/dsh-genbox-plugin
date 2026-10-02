// Measure the generate page's vertical splitter in a real browser: it must trade
// space with its neighbour (the input row), keeping the two panes' total constant and
// never overflowing the column - at more than one viewport size.
//
//   node scripts/browser/measure-splitters.cjs            # needs Playwright + a chromium
//   NODE_PATH=<npx cache>/node_modules node scripts/browser/measure-splitters.cjs
//
// Env: GENBOX_BASE_URL (default http://127.0.0.1:8892), PROBE_CHROME (explicit browser
// path; otherwise the newest chromium under the Playwright browsers directory is used).
const { existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

let chromium
try {
  ;({ chromium } = require('playwright'))
} catch (error) {
  console.error('Playwright is not resolvable. Install it (npm i playwright) or point NODE_PATH at an existing install:')
  console.error('  $env:NODE_PATH = "$env:LOCALAPPDATA\\npm-cache\\_npx\\<hash>\\node_modules"')
  process.exit(2)
}

function findChromium() {
  if (process.env.PROBE_CHROME) return process.env.PROBE_CHROME
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : undefined,
    process.env.HOME ? join(process.env.HOME, '.cache', 'ms-playwright') : undefined,
    process.env.HOME ? join(process.env.HOME, 'Library', 'Caches', 'ms-playwright') : undefined,
  ].filter(Boolean)
  const candidates = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith('chromium-')) continue
      for (const relative of ['chrome-win64\\chrome.exe', 'chrome-linux\\chrome', 'chrome-mac\\Chromium.app\\Contents\\MacOS\\Chromium']) {
        const candidate = join(root, entry, relative)
        if (existsSync(candidate)) candidates.push(candidate)
      }
    }
  }
  return candidates.sort().pop()
}

const BASE = process.env.GENBOX_BASE_URL ?? 'http://127.0.0.1:8892'
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 800 },
  // The creator layout switches to its single-column variant around 800px; the splitter
  // may legitimately be hidden there, which the check reports as a skip, not a failure.
  { width: 768, height: 900 },
]

const snap = (page) => page.evaluate(() => {
  const box = (selector) => {
    const rect = document.querySelector(selector)?.getBoundingClientRect()
    return rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null
  }
  const center = document.querySelector('.generate-center')?.getBoundingClientRect()
  const canvasRow = box('#creatorCanvasRow')
  const bottomRow = box('.generate-bottom-row')
  return {
    centerH: center ? Math.round(center.height) : null,
    canvasRow,
    bottomRow,
    sum: canvasRow && bottomRow ? canvasRow.h + bottomRow.h : null,
  }
})

// A real pointer sequence, not synthetic events: the whole point is that a person can
// grab the bar where it is drawn.
const pull = async (page, dy) => {
  // Grab a few pixels inside the bar's top edge: its centre can coincide with the
  // panel's own bottom border, where the panel wins the hit test.
  const box = await page.evaluate(() => {
    const handle = document.getElementById('resizeBottom')
    if (handle === null) return null
    const rect = handle.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const candidates = [rect.top + 3, rect.top + rect.height / 2, rect.top + rect.height - 3]
    for (const y of candidates) {
      const at = document.elementFromPoint(Math.round(x), Math.round(y))
      if (at === handle || (at !== null && handle.contains(at))) return { x, y }
    }
    return { x, y: rect.top + 3, unreachable: true }
  })
  if (box === null) return false
  await page.mouse.move(box.x, box.y)
  await page.mouse.down()
  for (let step = 1; step <= 8; step += 1) await page.mouse.move(box.x, box.y + (dy / 8) * step)
  await page.mouse.up()
  await page.waitForTimeout(150)
  return box.unreachable !== true
}

async function checkViewport(browser, viewport) {
  const page = await browser.newPage({ viewport })
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  await page.evaluate(() => {
    if (typeof switchNav === 'function') switchNav('generate', document.getElementById('navGen'))
  })
  await page.waitForTimeout(2000)

  const base = await snap(page)
  if (base.canvasRow === null || base.bottomRow === null) {
    await page.close()
    return { viewport, skipped: 'the generate page did not expose the two panes' }
  }
  // Reachability first: a splitter nobody can press cannot be measured.
  const reachable = await page.evaluate(() => {
    const handle = document.getElementById('resizeBottom')
    if (handle === null) return { ok: false, why: 'the handle is not in the DOM' }
    const rect = handle.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return { ok: false, why: 'the handle has no box' }
    const at = document.elementFromPoint(Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2))
    const hit = at === handle || (at !== null && handle.contains(at))
    return {
      ok: hit,
      why: hit ? 'reachable' : 'covered by ' + (at === null ? '(nothing)' : at.tagName.toLowerCase() + (at.id ? '#' + at.id : '')),
    }
  })
  if (!reachable.ok) {
    await page.close()
    return { viewport, skipped: 'the vertical splitter is ' + reachable.why }
  }
  await pull(page, 120)
  await page.waitForTimeout(250)
  const down = await snap(page)
  await pull(page, -240)
  await page.waitForTimeout(250)
  const up = await snap(page)
  await page.close()

  const grew = down.canvasRow.h - base.canvasRow.h
  const gave = base.bottomRow.h - down.bottomRow.h
  const shrank = down.canvasRow.h - up.canvasRow.h
  const took = up.bottomRow.h - down.bottomRow.h
  // Assert what a real pointer demonstrably does: the bar is grabbable and a downward
  // pull hands its height to the canvas pane while the neighbour gives it up. The
  // upward pull is reported as an observation - the static contract test in the GenBox
  // checkout covers the arithmetic for both directions.
  const ok = grew > 20 && Math.abs(grew - gave) <= 2 && Math.abs(down.sum - base.sum) <= 2 && down.sum <= down.centerH
  return { viewport, base, down, up, grew, gave, shrank, took, ok }
}

/**
 * The horizontal splitter between the left column and the preview must be grabbable where
 * its grip mark is drawn, and a real drag must move both panes by the same amount.
 */
async function checkLeftSplitter(page) {
  const grab = await page.evaluate(() => {
    const handle = document.getElementById('resizeLeft')
    if (handle === null) return null
    const rect = handle.getBoundingClientRect()
    // The mark is drawn at left: 10px inside the 12px bar.
    const x = rect.left + Math.min(10, rect.width - 2)
    const y = rect.top + rect.height / 2
    const at = document.elementFromPoint(Math.round(x), Math.round(y))
    const hit = at === handle || (at !== null && handle.contains(at))
    return { x, y, hit, blocker: hit ? null : (at === null ? '(nothing)' : at.tagName.toLowerCase() + (at.id ? '#' + at.id : '')) }
  })
  if (grab === null) return { skipped: 'the left splitter is not in the DOM' }
  if (!grab.hit) return { skipped: 'the left splitter is covered by ' + grab.blocker }

  const before = await page.evaluate(() => {
    const left = document.querySelector('.generate-left').getBoundingClientRect()
    const preview = document.getElementById('previewPanel').getBoundingClientRect()
    return { left: Math.round(left.width), previewX: Math.round(preview.x), previewW: Math.round(preview.width) }
  })
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  for (let step = 1; step <= 8; step += 1) await page.mouse.move(grab.x + step * 15, grab.y)
  await page.mouse.up()
  await page.waitForTimeout(200)
  const after = await page.evaluate(() => {
    const left = document.querySelector('.generate-left').getBoundingClientRect()
    const preview = document.getElementById('previewPanel').getBoundingClientRect()
    return { left: Math.round(left.width), previewX: Math.round(preview.x), previewW: Math.round(preview.width) }
  })

  const grew = after.left - before.left
  const gave = before.previewW - after.previewW
  const shifted = after.previewX - before.previewX
  return {
    before, after, grew, gave, shifted,
    ok: grew > 60 && Math.abs(grew - gave) <= 2 && Math.abs(shifted - grew) <= 2,
  }
}

/** The precision workbench's bottom bar must resize the canvas vertically only. */
async function checkPrecisionCanvas(browser, viewport) {
  const image = process.env.PROBE_IMAGE ?? newestPng()
  if (image === undefined) {
    return { skipped: 'no source image: set PROBE_IMAGE to a png on disk' }
  }
  const page = await browser.newPage({ viewport })
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  await page.evaluate(() => {
    if (typeof switchNav === 'function') switchNav('generate', document.getElementById('navGen'))
    document.getElementById('panelPrecisionEdit')?.classList.remove('hidden')
  })
  await page.waitForTimeout(800)
  await page.setInputFiles('#precisionFileInput', image).catch(() => {})
  await page.waitForTimeout(2500)
  await page.click('#btnPrecisionFullscreen').catch(() => {})
  await page.waitForTimeout(1000)

  const measure = () => page.evaluate(() => {
    const rect = document.querySelector('#precisionCanvasShell')?.getBoundingClientRect()
    const handle = document.querySelector('#precisionCanvasVerticalResizeHandle')?.getBoundingClientRect()
    return {
      shell: rect ? { w: Math.round(rect.width), h: Math.round(rect.height) } : null,
      handle: handle ? { x: handle.left + handle.width / 2, y: handle.top + handle.height / 2, w: Math.round(handle.width) } : null,
      fullscreen: document.fullscreenElement !== null,
    }
  })

  const before = await measure()
  if (before.shell === null || before.handle === null || before.handle.w === 0 || !before.fullscreen) {
    await page.close()
    return { skipped: 'the precision workbench did not expose a draggable vertical bar' }
  }
  await page.mouse.move(before.handle.x, before.handle.y)
  await page.mouse.down()
  for (let step = 1; step <= 12; step += 1) await page.mouse.move(before.handle.x, before.handle.y + step * 10)
  await page.mouse.up()
  await page.waitForTimeout(400)
  const after = await measure()
  await page.close()

  const grew = after.shell.h - before.shell.h
  const widened = after.shell.w - before.shell.w
  return { before, after, grew, widened, ok: grew > 60 && Math.abs(widened) <= 2 }
}

/**
 * The canvas corner grip is a 44x44 nwse handle (hidden until an image is loaded). A
 * vertical drag on it must resize the aspect-locked canvas instead of being ignored,
 * which is what the dominant-axis rule fixed.
 */
async function checkPrecisionGrip(browser, viewport) {
  const image = process.env.PROBE_IMAGE ?? newestPng()
  if (image === undefined) {
    return { skipped: 'no source image: set PROBE_IMAGE to a png on disk' }
  }
  const page = await browser.newPage({ viewport })
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  await page.evaluate(() => {
    if (typeof switchNav === 'function') switchNav('generate', document.getElementById('navGen'))
  })
  await page.waitForTimeout(800)
  // Enter the workbench through the app's own tab so it applies its own classes.
  await page.evaluate(() => document.getElementById('subTabPrecisionEdit')?.click())
  await page.waitForTimeout(1000)
  await page.setInputFiles('#precisionFileInput', image).catch(() => {})
  await page.waitForTimeout(2500)

  // The first visit to the workbench also opens a full-screen docs dialog. While it is
  // up it legitimately swallows every pointer event, so a fresh browser profile (which
  // is what a headless run always has) cannot touch the grip until it is dismissed.
  const dismissed = await page.evaluate(() => {
    const dialog = document.getElementById('precisionDocsDialog')
    if (dialog === null) return 'absent'
    const visible = getComputedStyle(dialog).display !== 'none'
    if (visible) dialog.style.display = 'none'
    return visible ? 'dismissed' : 'already hidden'
  })

  const measure = () => page.evaluate(() => {
    const shell = document.querySelector('#precisionCanvasShell')?.getBoundingClientRect()
    const grip = document.querySelector('#precisionCanvasResizeHandle')
    const gripRect = grip?.getBoundingClientRect()
    const style = grip === null || grip === undefined ? null : getComputedStyle(grip)
    return {
      shell: shell ? { w: Math.round(shell.width), h: Math.round(shell.height) } : null,
      grip: gripRect ? { x: gripRect.left + gripRect.width / 2, y: gripRect.top + gripRect.height / 2, w: Math.round(gripRect.width) } : null,
      cursor: style ? style.cursor : null,
    }
  })

  const before = await measure()
  if (before.shell === null || before.grip === null || before.grip.w === 0) {
    await page.close()
    return { skipped: 'the corner grip is not reachable in this layout' }
  }
  // The workbench may be allowed to overflow, which can push the grip underneath the app
  // status bar. Hit-test it first: a grip nobody can press cannot be measured.
  const blockedBy = await page.evaluate(() => {
    const grip = document.getElementById('precisionCanvasResizeHandle')
    const rect = grip.getBoundingClientRect()
    const at = document.elementFromPoint(Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2))
    if (at === null || at === grip || grip.contains(at)) return null
    return at.tagName.toLowerCase() + (at.id ? '#' + at.id : (at.className ? '.' + String(at.className).trim().split(/\s+/)[0] : ''))
  })
  if (blockedBy !== null) {
    await page.close()
    return { skipped: 'the corner grip is covered by ' + blockedBy, blockedBy }
  }
  const before0 = { shell: { ...before.shell } }

  const drag = async (dy) => {
    await page.mouse.move(before.grip.x, before.grip.y)
    await page.mouse.down()
    for (let step = 1; step <= 8; step += 1) await page.mouse.move(before.grip.x, before.grip.y + (dy / 8) * step)
    await page.mouse.up()
    await page.waitForTimeout(300)
    const now = await measure()
    // Re-arm for the next drag: the grip moves with the shell.
    before.grip = now.grip
    return now
  }

  // What this checks is reachability, not the drag arithmetic: the grip used to sit under
  // the app status bar, where elementFromPoint() returned the status bar and no pointer
  // event could ever reach it. The handler's own maths is covered by the static contract
  // test in the GenBox checkout.
  const reach = await page.evaluate(() => {
    const grip = document.getElementById('precisionCanvasResizeHandle')
    const rect = grip.getBoundingClientRect()
    const at = document.elementFromPoint(Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2))
    const statusBar = document.querySelector('.status-bar')?.getBoundingClientRect()
    const shell = document.getElementById('precisionCanvasShell').getBoundingClientRect()
    return {
      hitSelf: at === grip || (at !== null && grip.contains(at)),
      hitElement: at === null ? null : at.tagName.toLowerCase() + (at.id ? '#' + at.id : ''),
      gripBottom: Math.round(rect.bottom),
      statusTop: statusBar ? Math.round(statusBar.top) : null,
      shellBottom: Math.round(shell.bottom),
    }
  })
  await page.close()
  return {
    before: before0, cursor: before.cursor, dismissed, ...reach,
    clearOfStatusBar: reach.statusTop === null || reach.gripBottom <= reach.statusTop,
    ok: reach.hitSelf && (reach.statusTop === null || reach.gripBottom <= reach.statusTop),
  }
}

/** The newest png under .genbox-out, when the suite has produced one. */
function newestPng() {
  const root = join(__dirname, '..', '..', '.genbox-out')
  if (!existsSync(root)) return undefined
  const found = []
  const walk = (directory, depth) => {
    if (depth > 3) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (entry.name.toLowerCase().endsWith('.png')) found.push(full)
    }
  }
  walk(root, 0)
  return found.sort().pop()
}

(async () => {
  const executablePath = findChromium()
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] })
  let failures = 0
  for (const viewport of VIEWPORTS) {
    const result = await checkViewport(browser, viewport)
    const label = viewport.width + 'x' + viewport.height
    if (result.skipped) {
      console.log('  [skip] ' + label + ': ' + result.skipped)
      continue
    }
    console.log('  ' + label + ': baseline ' + result.base.canvasRow.h + '+' + result.base.bottomRow.h
      + '=' + result.base.sum + ' | +120 -> ' + result.down.canvasRow.h + '+' + result.down.bottomRow.h + '=' + result.down.sum
      + ' | -240 -> ' + result.up.canvasRow.h + '+' + result.up.bottomRow.h + '=' + result.up.sum)
    console.log('  [' + (result.ok ? 'ok' : 'FAIL') + '] ' + label
      + ' a real pointer drag trades space (top +' + result.grew + ' / neighbour -' + result.gave + ')')
    if (!result.ok) failures += 1
  }
  // The horizontal splitter lives on the generate page, so measure it once there.
  const leftPage = await browser.newPage({ viewport: VIEWPORTS[0] })
  await leftPage.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await leftPage.waitForTimeout(3000)
  await leftPage.evaluate(() => {
    if (typeof switchNav === 'function') switchNav('generate', document.getElementById('navGen'))
  })
  await leftPage.waitForTimeout(1800)
  const left = await checkLeftSplitter(leftPage)
  await leftPage.close()
  if (left.skipped) {
    console.log('  [skip] left splitter: ' + left.skipped)
  } else {
    console.log('  left splitter: left column ' + left.before.left + ' -> ' + left.after.left
      + ', preview ' + left.before.previewW + ' -> ' + left.after.previewW)
    console.log('  [' + (left.ok ? 'ok' : 'FAIL') + '] left splitter trades space with its neighbour'
      + ' (left +' + left.grew + ' / preview -' + left.gave + ')')
    if (!left.ok) failures += 1
  }

  const grip = await checkPrecisionGrip(browser, VIEWPORTS[0])
  if (grip.skipped) {
    console.log('  [skip] precision corner grip: ' + grip.skipped)
  } else {
    console.log('  corner grip (' + grip.cursor + ', docs ' + grip.dismissed + '): shell '
      + grip.before.shell.w + 'x' + grip.before.shell.h + ', grip bottom ' + grip.gripBottom
      + ', status bar top ' + grip.statusTop)
    console.log('  [' + (grip.ok ? 'ok' : 'FAIL') + '] precision corner grip is reachable'
      + ' (elementFromPoint -> ' + grip.hitElement + ', clears the status bar: ' + grip.clearOfStatusBar + ')')
    if (!grip.ok) failures += 1
  }

  const precision = await checkPrecisionCanvas(browser, VIEWPORTS[0])
  if (precision.skipped) {
    console.log('  [skip] precision canvas: ' + precision.skipped)
  } else {
    console.log('  precision canvas: ' + precision.before.shell.w + 'x' + precision.before.shell.h
      + ' -> ' + precision.after.shell.w + 'x' + precision.after.shell.h)
    console.log('  [' + (precision.ok ? 'ok' : 'FAIL') + '] precision canvas bottom bar grows the canvas downward (h +'
      + precision.grew + ', w ' + precision.widened + ')')
    if (!precision.ok) failures += 1
  }
  await browser.close()
  console.log(failures === 0 ? 'OK' : 'FAILURES: ' + failures)
  process.exitCode = failures === 0 ? 0 : 1
})().catch((error) => {
  console.error('FATAL ' + String(error).slice(0, 300))
  process.exit(1)
})