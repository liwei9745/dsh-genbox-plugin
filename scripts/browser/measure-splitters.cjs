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
  await browser.close()
  console.log(failures === 0 ? 'OK' : 'FAILURES: ' + failures)
  process.exitCode = failures === 0 ? 0 : 1
})().catch((error) => {
  console.error('FATAL ' + String(error).slice(0, 300))
  process.exit(1)
})