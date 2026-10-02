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

const pull = (page, dy) => page.evaluate((delta) => {
  const handle = document.getElementById('resizeBottom')
  if (handle === null) return false
  const rect = handle.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y, button: 0 }))
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y + delta }))
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y + delta }))
  return true
}, dy)

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
  const ok = grew > 20 && Math.abs(grew - gave) <= 2 && shrank > 100 && Math.abs(shrank - took) <= 2
    && Math.abs(down.sum - base.sum) <= 2 && Math.abs(up.sum - base.sum) <= 2
    && down.sum <= down.centerH && up.sum <= up.centerH
  return { viewport, base, down, up, grew, gave, shrank, took, ok }
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

  // The shell usually starts at its maximum width, so shrink first and then grow back.
  const small = await drag(-160)
  const large = await drag(80)
  await page.close()

  const ratio = (shell) => shell.h / shell.w
  const shrankBoth = small.shell.w < before0.w - 20 && small.shell.h < before0.h - 20
  const grewBoth = large.shell.w > small.shell.w + 20 && large.shell.h > small.shell.h + 20
  const aspectKept = Math.abs(ratio(small) - ratio(before0)) < 0.02 && Math.abs(ratio(large) - ratio(before0)) < 0.02
  return {
    before: before0, small, large, cursor: before.cursor, dismissed,
    shrankBoth, grewBoth, aspectKept, ok: shrankBoth && grewBoth && aspectKept,
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
      + ' splitter trades space (top +' + result.grew + ' / neighbour -' + result.gave
      + '; top -' + result.shrank + ' / neighbour +' + result.took + ')')
    if (!result.ok) failures += 1
  }
  const grip = await checkPrecisionGrip(browser, VIEWPORTS[0])
  if (grip.skipped) {
    console.log('  [skip] precision corner grip: ' + grip.skipped)
  } else {
    console.log('  corner grip (' + grip.cursor + ', docs ' + grip.dismissed + '): '
      + grip.before.shell.w + 'x' + grip.before.shell.h
      + ' -> -160px ' + grip.small.shell.w + 'x' + grip.small.shell.h
      + ' -> +80px ' + grip.large.shell.w + 'x' + grip.large.shell.h)
    console.log('  [' + (grip.ok ? 'ok' : 'FAIL') + '] precision corner grip resizes on a vertical drag'
      + ' (grew ' + grip.grewBoth + ', shrank ' + grip.shrankBoth + ', aspect kept ' + grip.aspectKept + ')')
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