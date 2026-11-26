/**
 * Real Pascal Editor Walkthrough Video Recorder for `@kruschdev/pascal-plugin-plumbing`.
 *
 * Connects Puppeteer to a live running Pascal Editor host (`PASCAL_EDITOR_URL`, e.g.
 * `http://127.0.0.1:3210/project/pascalplumbingdemomedia`) with `@kruschdev/pascal-plugin-plumbing` loaded,
 * drives real clicks and 3D camera orbits across:
 *   1. One-Click IPC/UPC Auto-Populate (10 fixtures, 3 equipment units, PEX manifold, 34 sloped 3D runs)
 *   2. Native Low Walls & 3D Gravity DWV / Supply Orbit + System Layer Visibility Toggles + 2D Blueprint
 *   3. Interactive 3D PEX Manifold & 2x6 Wet-Wall Cutaway (orbit, Cover Off, Steel Enclosure Closed)
 *   4. Live Fixture Schedule, DFU/WSFU/GPM Loads & Electrical Power Coordination, and Bones 16" OC Drill List
 *   5. Live Priced BOM Takeoff Calculator (Labor/Markup/Tax) & IPC/IFGC Compliance Audit (0/0 PASS)
 *
 * Encodes:
 *   - `assets/demo-walkthrough.mp4` (1280x720 H.264 +faststart)
 *   - `assets/demo-walkthrough.gif` (640px wide palette-optimized README preview)
 *   - `assets/demo-3d-plumbing-routing.png` (1440x810 clean live 3D routing shot)
 *   - `assets/demo-plumbing-schedule.png` (1440x810 clean split-pane schedule shot)
 *
 * Usage:
 *   PASCAL_EDITOR_URL=http://127.0.0.1:3210/project/pascalplumbingdemomedia bun run render:walkthrough
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type PuppeteerPageLike = {
  setViewport: (v: { width: number; height: number; deviceScaleFactor: number }) => Promise<void>
  goto: (url: string, opts: { waitUntil: string; timeout: number }) => Promise<void>
  evaluate: <R = unknown, A = unknown>(fn: (arg: A) => R, arg?: A) => Promise<R>
  screenshot: (opts: { type: 'jpeg' | 'png'; quality?: number }) => Promise<Uint8Array>
  mouse: {
    move: (x: number, y: number, opts?: { steps?: number }) => Promise<void>
    down: (opts?: { button?: 'left' | 'right' | 'middle' }) => Promise<void>
    up: (opts?: { button?: 'left' | 'right' | 'middle' }) => Promise<void>
    click: (x: number, y: number) => Promise<void>
    wheel: (opts: { deltaY: number }) => Promise<void>
  }
  on: (event: string, cb: (arg: { message?: string }) => void) => void
}

type PuppeteerBrowserLike = {
  newPage: () => Promise<PuppeteerPageLike>
  close: () => Promise<void>
  process?: () => { kill: (signal?: NodeJS.Signals | number) => boolean | void } | null
}

type PuppeteerLike = {
  launch: (opts: Record<string, unknown>) => Promise<PuppeteerBrowserLike>
}

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const outMp4 = path.join(rootDir, 'assets', 'demo-walkthrough.mp4')
const outGif = path.join(rootDir, 'assets', 'demo-walkthrough.gif')
const keyframesDir = path.join(os.tmpdir(), 'pascal_plumbing_walkthrough_keyframes')
const mediaShotsDir = process.env.MEDIA_SHOTS_DIR ?? ''
const refreshRepoShots = process.env.REFRESH_REPO_SHOTS !== '0'
if (mediaShotsDir) fs.mkdirSync(mediaShotsDir, { recursive: true })

const targetUrl = process.env.PASCAL_EDITOR_URL
if (!targetUrl) {
  console.error(
    'Set PASCAL_EDITOR_URL=http://127.0.0.1:3210/project/<sceneId> before running render:walkthrough.',
  )
  process.exit(1)
}

const puppeteerPath = process.env.PUPPETEER_MODULE ?? 'puppeteer'
const puppeteerMod = (await import(puppeteerPath)) as { default?: PuppeteerLike } & PuppeteerLike
const puppeteer: PuppeteerLike = puppeteerMod.default ?? puppeteerMod
const chromeBin = process.env.CHROME_BIN ?? '/usr/bin/google-chrome'
const ffmpegBin = process.env.FFMPEG_BIN ?? 'ffmpeg'

fs.mkdirSync(keyframesDir, { recursive: true })

const VIEW_W = 1440
const VIEW_H = 810
const CAPTURE_FPS = 10

const angleBackend = process.env.CHROME_ANGLE_BACKEND ?? 'gl-egl'

const browser = await puppeteer.launch({
  executablePath: chromeBin,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--use-gl=angle',
    `--use-angle=${angleBackend}`,
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    `--window-size=${VIEW_W},${VIEW_H}`,
  ],
})

let ffmpeg: Bun.Subprocess<'pipe', 'ignore', 'pipe'> | null = null
let ffmpegFinished = false
let mp4Code = -1
let ffmpegStderr = ''
let totalFrames = 0

try {
  const page = await browser.newPage()
  await page.setViewport({ width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.error('PAGEERROR:', e.message))

  console.log(`Opening real Pascal Editor at ${targetUrl}...`)
  await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 90000 })

  // Wait until the 3D canvas AND the Plumbing plugin button (or Plugins rail) are mounted & hydrated
  let sceneReady = false
  for (let i = 0; i < 120; i++) {
    const state = await page
      .evaluate(() => {
        const canvases = Array.from(document.querySelectorAll('canvas'))
        const hasCanvas = canvases.some((c) => c.getBoundingClientRect().width > 300)
        const btns = Array.from(document.querySelectorAll('button'))
        const hasPlumbing = btns.some(
          (b) => b.innerText.trim() === 'Plumbing' || b.getAttribute('aria-label') === 'Plumbing',
        )
        const hasPlugins = btns.some(
          (b) => b.innerText.trim() === 'Plugins' || b.getAttribute('aria-label') === 'Plugins',
        )
        return { hasCanvas, hasPlumbing, hasPlugins }
      })
      .catch(() => ({ hasCanvas: false, hasPlumbing: false, hasPlugins: false }))
    if (state.hasCanvas && state.hasPlumbing) {
      sceneReady = true
      break
    }
    if (i > 20 && state.hasCanvas && state.hasPlugins) {
      sceneReady = true
      break
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  if (!sceneReady) {
    throw new Error('Timed out waiting for Pascal Editor 3D canvas and Plumbing plugin rail to hydrate')
  }
  await new Promise((r) => setTimeout(r, 4000))

  // Dismiss the "Pan / Rotate / Zoom" hint pill if present
  await page
    .evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      for (const b of btns) {
        const parentText = b.parentElement?.innerText ?? ''
        if (parentText.includes('Pan') && parentText.includes('Rotate') && parentText.includes('Zoom')) {
          b.click()
          break
        }
      }
    })
    .catch(() => {})
  await new Promise((r) => setTimeout(r, 600))

  // Open Plumbing rail panel (installing it via Browse plugins automatically if not yet installed on this project)
  let plumbingPanelOpen = false
  for (let attempt = 0; attempt < 30; attempt++) {
    const hasAutoPop = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll('button')).some((b) =>
          b.innerText.includes('Auto-Populate Plumbing'),
        ),
      )
      .catch(() => false)
    if (hasAutoPop) {
      plumbingPanelOpen = true
      break
    }
    await page
      .evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'))
        // 1. Direct Plumbing button in left Plugins rail
        const plumb = btns.find(
          (b) => b.innerText.trim() === 'Plumbing' || b.getAttribute('aria-label') === 'Plumbing',
        )
        if (plumb) {
          plumb.click()
          return
        }
        // 2. If Browse Plugins marketplace view is open, click Install on the Plumbing card
        const installBtns = btns.filter((b) => b.innerText.trim() === 'Install')
        for (const ib of installBtns) {
          const card = ib.closest('div')?.parentElement ?? ib.parentElement
          const text = card?.innerText ?? ''
          if (text.includes('Plumbing') && text.includes('IPC/UPC/IFGC')) {
            ib.click()
            return
          }
        }
        // 3. If Plumbing is in Browse Plugins as "Manage" (already installed), click 3D to return to viewport
        const manageBtns = btns.filter((b) => b.innerText.trim() === 'Manage')
        for (const mb of manageBtns) {
          const card = mb.closest('div')?.parentElement ?? mb.parentElement
          const text = card?.innerText ?? ''
          if (text.includes('Plumbing') && text.includes('IPC/UPC/IFGC')) {
            const view3d = btns.find((b) => b.innerText.trim() === '3D')
            if (view3d) view3d.click()
            return
          }
        }
        // 4. Open Browse plugins if Plugins sidebar is open
        const browse = btns.find((b) => b.innerText.trim() === 'Browse plugins')
        if (browse) {
          browse.click()
          return
        }
        // 5. Open Plugins sidebar
        const plug = btns.find(
          (b) => b.innerText.trim() === 'Plugins' || b.getAttribute('aria-label') === 'Plugins',
        )
        if (plug) plug.click()
      })
      .catch(() => {})
    await new Promise((r) => setTimeout(r, 900))
  }
  if (!plumbingPanelOpen) {
    throw new Error('Plumbing plugin panel did not open (Auto-Populate Plumbing button not found)')
  }
  // Ensure 3D tab is active (in case Browse plugins tab was left open)
  await page.evaluate(() => {
    const view3d = Array.from(document.querySelectorAll('button')).find((b) => b.innerText.trim() === '3D')
    if (view3d) view3d.click()
  })
  await new Promise((r) => setTimeout(r, 1500))

  // Ensure scene starts clean before Chapter 1 recording (click Clear if any leftover plumbing nodes exist)
  await page.evaluate(() => {
    const clearBtn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.innerText.trim() === 'Clear',
    )
    if (clearBtn) clearBtn.click()
  })
  await new Promise((r) => setTimeout(r, 800))

  // Inject clean CSS hiding Next.js dev overlay badges, plus non-intrusive chapter banner & cursor ring
  await page.evaluate(() => {
    const hideDevStyle = document.createElement('style')
    hideDevStyle.textContent =
      'nextjs-portal, #__next-build-indicator, [data-nextjs-toast], [data-nextjs-dialog-overlay] {' +
      '  display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important;' +
      '}'
    document.head.appendChild(hideDevStyle)

    const pill = document.createElement('div')
    pill.id = '__walkthrough_banner'
    pill.style.cssText =
      'position:fixed;top:52px;left:50%;transform:translateX(-50%);z-index:99999;' +
      'padding:7px 16px;border-radius:999px;background:rgba(10,15,28,0.92);' +
      'border:1px solid rgba(56,189,248,0.6);color:#f8fafc;font:600 13px/1.2 system-ui,sans-serif;' +
      'box-shadow:0 8px 24px rgba(0,0,0,0.45);pointer-events:none;white-space:nowrap;'
    pill.textContent = '1 / 5 · Pascal Editor + IPC Plumbing Plugin (Ready)'
    document.body.appendChild(pill)

    const cursor = document.createElement('div')
    cursor.id = '__walkthrough_cursor'
    cursor.style.cssText =
      'position:fixed;left:-40px;top:-40px;width:22px;height:22px;margin:-11px 0 0 -11px;' +
      'border-radius:999px;border:3px solid #38bdf8;background:rgba(56,189,248,0.28);' +
      'box-shadow:0 0 14px rgba(56,189,248,0.75);z-index:99999;pointer-events:none;' +
      'transition:transform 0.14s ease;'
    document.body.appendChild(cursor)
  })

  // Collapse narrow left icon menu so the 3D Two-Bedroom House fills the widescreen viewport
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(
      (x) => x.getAttribute('aria-label') === 'Hide menu' || x.innerText.trim() === 'Hide menu',
    )
    if (b) b.click()
  })
  await new Promise((r) => setTimeout(r, 600))

  // Pre-frame the entire 14m x 9m Residential House cleanly in a crisp 3/4 architectural overview before frame 1
  const initCanvasCenter = await page.evaluate(() => {
    const c = Array.from(document.querySelectorAll('canvas')).find(
      (x) => x.getBoundingClientRect().width > 300,
    )
    const r = c?.getBoundingClientRect()
    return r ? { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) } : { cx: 920, cy: 420 }
  })
  await page.mouse.move(initCanvasCenter.cx, initCanvasCenter.cy)
  // Frame cleanly so the 14m x 9m house fills ~80% of the 3D viewport (Mechanical Room -> Kitchen all visible)
  await page.mouse.wheel({ deltaY: -45 })
  await new Promise((r) => setTimeout(r, 150))
  await page.mouse.down({ button: 'right' })
  for (let i = 1; i <= 5; i++) {
    await page.mouse.move(initCanvasCenter.cx + i * 22, initCanvasCenter.cy + i * 16)
    await new Promise((r) => setTimeout(r, 60))
  }
  await page.mouse.up({ button: 'right' })
  await new Promise((r) => setTimeout(r, 900))

  const ffmpegProc = Bun.spawn(
    [
      ffmpegBin,
      '-y',
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      '-r',
      String(CAPTURE_FPS),
      '-i',
      '-',
      '-vf',
      'scale=1280:720:flags=lanczos',
      '-r',
      '24',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outMp4,
    ],
    { stdin: 'pipe', stdout: 'ignore', stderr: 'pipe' },
  )
  ffmpeg = ffmpegProc

  async function setBanner(text: string) {
    await page.evaluate((txt: string) => {
      const el = document.getElementById('__walkthrough_banner')
      if (el) el.textContent = txt
    }, text)
  }

  async function moveCursor(x: number, y: number) {
    await page.evaluate(
      ([cx, cy]: [number, number]) => {
        const el = document.getElementById('__walkthrough_cursor')
        if (el) {
          el.style.left = `${cx}px`
          el.style.top = `${cy}px`
        }
      },
      [x, y],
    )
  }

  async function pulseCursor(active: boolean) {
    await page.evaluate((on: boolean) => {
      const el = document.getElementById('__walkthrough_cursor')
      if (el) el.style.transform = on ? 'scale(1.55)' : 'scale(1)'
    }, active)
  }

  async function captureCleanShot(mediaFilename: string, repoAssetFilename?: string) {
    if (!mediaShotsDir && (!refreshRepoShots || !repoAssetFilename)) return
    await page.evaluate(() => {
      const b = document.getElementById('__walkthrough_banner')
      const c = document.getElementById('__walkthrough_cursor')
      if (b) b.style.display = 'none'
      if (c) c.style.display = 'none'
    })
    await new Promise((r) => setTimeout(r, 140))
    const png = await page.screenshot({ type: 'png' })
    if (mediaShotsDir) {
      fs.writeFileSync(path.join(mediaShotsDir, mediaFilename), png)
    }
    if (refreshRepoShots && repoAssetFilename) {
      fs.writeFileSync(path.join(rootDir, 'assets', repoAssetFilename), png)
    }
    await page.evaluate(() => {
      const b = document.getElementById('__walkthrough_banner')
      const c = document.getElementById('__walkthrough_cursor')
      if (b) b.style.display = ''
      if (c) c.style.display = ''
    })
  }

  async function captureFrames(
    count: number,
    delayMs = 90,
    saveKeyframeName?: string,
    staticHold = false,
  ) {
    if (staticHold && count > 2) {
      let lastJpeg: Uint8Array | null = null
      for (let i = 0; i < 2; i++) {
        lastJpeg = await page.screenshot({ type: 'jpeg', quality: 92 })
        ffmpegProc.stdin.write(lastJpeg)
        totalFrames += 1
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
      }
      if (lastJpeg) {
        if (saveKeyframeName) {
          fs.writeFileSync(path.join(keyframesDir, `${saveKeyframeName}.jpg`), lastJpeg)
        }
        for (let i = 2; i < count; i++) {
          ffmpegProc.stdin.write(lastJpeg)
          totalFrames += 1
        }
      }
      return
    }

    for (let i = 0; i < count; i++) {
      const jpeg = await page.screenshot({ type: 'jpeg', quality: 92 })
      ffmpegProc.stdin.write(jpeg)
      totalFrames += 1
      if (saveKeyframeName && i === Math.floor(count / 2)) {
        fs.writeFileSync(path.join(keyframesDir, `${saveKeyframeName}.jpg`), jpeg)
      }
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
    }
  }

  async function findButtonRect(needle: string, exact = false): Promise<{ x: number; y: number } | null> {
    return page.evaluate(
      ([txt, isExact]: [string, boolean]) => {
        const btns = Array.from(document.querySelectorAll('button'))
        const match = btns.find((b) => {
          const r = b.getBoundingClientRect()
          if (r.width <= 0 || r.height <= 0) return false
          const label = b.innerText.trim()
          const aria = b.getAttribute('aria-label') ?? ''
          if (isExact) return label === txt || aria === txt
          return label.includes(txt) || aria.includes(txt)
        })
        if (!match) return null
        match.scrollIntoView({ block: 'nearest' })
        const r = match.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      },
      [needle, exact],
    )
  }

  async function smoothClickButton(needle: string, exact = false, holdBefore = 6, holdAfter = 14, kf?: string) {
    const rect = await findButtonRect(needle, exact)
    if (!rect) {
      console.warn(`Button not found: "${needle}"`)
      return false
    }
    await moveCursor(rect.x, rect.y)
    await captureFrames(holdBefore, 80, undefined, true)
    await pulseCursor(true)
    await page.mouse.click(rect.x, rect.y)
    await captureFrames(3, 80)
    await pulseCursor(false)
    await captureFrames(holdAfter, 90, kf, true)
    return true
  }

  async function dragOrbit(
    startX: number,
    startY: number,
    dx: number,
    dy: number,
    steps: number,
    button: 'left' | 'right' = 'right',
    kf?: string,
  ) {
    await page.mouse.move(startX, startY)
    await moveCursor(startX, startY)
    await page.mouse.down({ button })
    for (let i = 1; i <= steps; i++) {
      const nx = Math.round(startX + (dx * i) / steps)
      const ny = Math.round(startY + (dy * i) / steps)
      await page.mouse.move(nx, ny)
      await moveCursor(nx, ny)
      const jpeg = await page.screenshot({ type: 'jpeg', quality: 92 })
      ffmpegProc.stdin.write(jpeg)
      totalFrames += 1
      if (kf && i === Math.floor(steps / 2)) {
        fs.writeFileSync(path.join(keyframesDir, `${kf}.jpg`), jpeg)
      }
      await new Promise((r) => setTimeout(r, 70))
    }
    await page.mouse.up({ button })
  }

  // ─── CHAPTER 1: Spacious Residential House + One-Click IPC/UPC Auto-Populate ─
  console.log('Recording Chapter 1: IPC/UPC Auto-Populate in Pascal Editor...')
  // Configure Slab-on-Grade (overhead Red/Blue PEX home-runs), ABS DWV (high-contrast charcoal drains),
  // Gas Tank WH, Fuel Gas & Hot Recirc
  await page.evaluate(() => {
    const setSelect = (matchOptionValue: string) => {
      const selects = Array.from(document.querySelectorAll<HTMLSelectElement>('select'))
      const sel = selects.find((s) => Array.from(s.options).some((o) => o.value === matchOptionValue))
      if (!sel) return
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
      setter?.call(sel, matchOptionValue)
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    }
    setSelect('slab')
    setSelect('abs-dwv')
    setSelect('water-heater-tank-gas')

    const labels = Array.from(document.querySelectorAll('label'))
    for (const lbl of labels) {
      const text = lbl.innerText.trim()
      if (text.includes('Fuel Gas') || text.includes('Hot Recirc') || text.includes('Dryer Vent')) {
        const cb = lbl.querySelector<HTMLInputElement>('input[type="checkbox"]')
        if (cb && !cb.checked) cb.click()
      }
    }
  })
  await new Promise((r) => setTimeout(r, 600))

  await setBanner('1 / 5 · Residential Floorplan (Mechanical Room, Laundry & 2x6 Wet Walls) · Ready')
  await captureFrames(18, 90, '01_before_autopop', true)

  await setBanner('1 / 5 · One-Click IPC Auto-Populate: Mechanical Core, Red/Blue PEX, Sloped DWV & Gas')
  await smoothClickButton('Auto-Populate Plumbing', false, 6, 26, '02_after_autopop')

  // Demonstrate System Layer toggles (briefly isolate PEX & DWV)
  await setBanner('1 / 5 · System Layer Toggles: Isolate Red Hot PEX, Blue Cold PEX, Orange Recirc & Gold Gas')
  await smoothClickButton('DWV Vent Stack', false, 4, 12, '02b_pex_isolated')
  await smoothClickButton('DWV Vent Stack', false, 3, 10, '02c_all_layers')

  // ─── CHAPTER 2: Low Walls + X-Ray Sub-Slab 1/4"/ft Gravity DWV Orbit + 2D ──
  console.log('Recording Chapter 2: Low Walls + X-Ray Sub-Slab 1/4"/ft Gravity DWV Orbit & 2D Plan...')
  await setBanner('2 / 5 · Low Walls Mode: Mechanical Room, Red/Blue PEX Home-Runs & Green 3" Vent Stack')
  await smoothClickButton('Low Walls', true, 5, 16, '03_low_walls')
  await dragOrbit(initCanvasCenter.cx + 40, initCanvasCenter.cy, -120, -10, 10, 'right', '03b_low_walls_orbit')
  await captureFrames(8, 90, undefined, true)

  // X-Ray Plumbing: peel away walls & floor slab and tilt lower so EVERY sloped 1/4"/ft below-floor ABS DWV drain & sewer exit is crystal clear!
  await setBanner('2 / 5 · X-Ray Plumbing: Every 1/4"/ft Sloped DWV Drain & 3" Building Drain Dropping to Grade')
  await smoothClickButton('X-Ray Plumbing', true, 5, 16, '03c_xray_plumbing')

  await page.mouse.move(initCanvasCenter.cx, initCanvasCenter.cy)
  await moveCursor(initCanvasCenter.cx, initCanvasCenter.cy)
  for (let i = 0; i < 2; i++) {
    await page.mouse.wheel({ deltaY: -85 })
    await captureFrames(3, 80)
  }
  // Drag upward (negative dy) to pitch camera down to a dramatic 3/4 side-elevation showing the 1/4"/ft gravity slope to grade!
  await dragOrbit(initCanvasCenter.cx + 40, initCanvasCenter.cy + 40, -130, -105, 14, 'right', '03d_xray_dwv_slope')
  await captureFrames(16, 90, undefined, true)
  await captureCleanShot('02-pascal-plumbing-xray-dwv.png', 'demo-3d-plumbing-routing.png')

  await dragOrbit(initCanvasCenter.cx - 80, initCanvasCenter.cy - 20, 190, 20, 14, 'right', '03e_xray_orbit_2')
  await captureFrames(10, 90, undefined, true)

  // Brief 2D Blueprint peek showing 2D plumbing symbols & pipe runs
  await setBanner('2 / 5 · Live Color-Matched 2D Plumbing Floorplan Schematic')
  await smoothClickButton('2D', true, 4, 20, '03f_2d_blueprint')
  await smoothClickButton('3D', true, 3, 10)
  await smoothClickButton('Low Walls', true, 4, 8)

  // ─── CHAPTER 3: Interactive 3D PEX Manifold & 2x6 Wet-Wall Cutaway ─────────
  console.log('Recording Chapter 3: 3D PEX Manifold & 2x6 Wet-Wall Cutaway...')
  await setBanner('3 / 5 · Interactive 3D PEX Manifold & 2x6 Wet-Wall Cutaway (Split-Pane View)')
  await smoothClickButton('Inspect 3D Manifold', false, 6, 16)

  // Collapse plumbing rail so the 3D house + 3D Manifold Cutaway get full widescreen space
  const closeRailBtn = await findButtonRect('Close panel', true)
  if (closeRailBtn) {
    await page.mouse.click(closeRailBtn.x, closeRailBtn.y)
    await new Promise((r) => setTimeout(r, 600))
  } else {
    // Fallback: click the "×" close button inside the Plumbing panel header
    await page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('div'))
      for (const h of headers) {
        if (h.innerText.trim() === 'Plumbing') {
          const closeBtn = h.parentElement?.querySelector('button')
          if (closeBtn) {
            closeBtn.click()
            break
          }
        }
      }
    })
    await new Promise((r) => setTimeout(r, 600))
  }
  await moveCursor(-40, -40)
  await captureFrames(18, 90, '04_manifold_cutaway', true)

  // Orbit the live 3D Manifold Cutaway canvas on the right split pane
  const manifoldCanvasRect = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('canvas'))
    const rightMost = canvases
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.width > 200 && r.height > 200)
      .sort((a, b) => b.x - a.x)[0]
    return rightMost
      ? { x: Math.round(rightMost.x + rightMost.width / 2), y: Math.round(rightMost.y + rightMost.height / 2) }
      : null
  })
  if (manifoldCanvasRect) {
    await setBanner('3 / 5 · Live 3D Orbit: Red Hot & Blue Cold PEX-A Valves, IRC R602.6 Nail Plates & 3" Stack')
    await dragOrbit(manifoldCanvasRect.x - 60, manifoldCanvasRect.y, 130, 0, 14, 'left', '04b_manifold_orbit')
    await captureFrames(8, 90, undefined, true)
  }

  await setBanner('3 / 5 · Toggle Cutaway Modes: Manifold Cover Off & Flush Steel Enclosure Closed')
  await smoothClickButton('Manifold Cover Off', true, 4, 16, '05a_manifold_open')
  await smoothClickButton('Steel Enclosure Closed', true, 4, 16, '05b_manifold_closed')
  await smoothClickButton('2x6 Wet-Wall & 3" Stack Cutaway', true, 4, 12)
  await captureCleanShot('05-pascal-manifold-cutaway-split.png')

  // ─── CHAPTER 4: Fixture Schedule, Loads & Electrical Power, & Drill List ──
  console.log('Recording Chapter 4: Fixture Schedule, Loads & Power, and Bones Drill List...')
  await setBanner('4 / 5 · Live Fixture Schedule: DFU, Cold/Hot WSFU, Drain, Vent & Supply Sizes')
  await smoothClickButton('Fixtures (', false, 5, 22, '06_fixture_schedule')
  await captureCleanShot('06-pascal-plumbing-schedule.png', 'demo-plumbing-schedule.png')

  await setBanner('4 / 5 · DFU/WSFU Hunter Curve GPM, Water Heater Sizing & Cross-Trade Electrical Power Handoff')
  await smoothClickButton('Loads & Power', true, 5, 22, '06b_loads_power')
  await captureCleanShot('06b-pascal-loads-and-power.png')

  await setBanner('4 / 5 · Bones 16" OC Framing Drill List: Exact Hole-Saw Diameters & IRC R602.6 Nail Plates')
  await smoothClickButton('Drill List', false, 5, 22, '06c_drill_list')
  await captureCleanShot('06c-pascal-drill-list.png')

  // ─── CHAPTER 5: Live Priced BOM Takeoff & IPC/IFGC Audit (0/0 PASS) ───────
  console.log('Recording Chapter 5: Live Priced BOM Takeoff & IPC Audit...')
  await setBanner('5 / 5 · Priced Plumbing BOM Takeoff (Live Labor $/hr, Markup % & Sales Tax % Recalculation)')
  await smoothClickButton('BOM ($', false, 5, 14)

  // Live-edit Labor Rate, Markup, and Tax inputs so viewers see real recalculation in Pascal Editor!
  await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="number"]'))
    const setReactVal = (el: HTMLInputElement | undefined, val: string) => {
      if (!el) return
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(el, val)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (inputs.length >= 3) {
      setReactVal(inputs[0], '125')
      setReactVal(inputs[1], '15')
      setReactVal(inputs[2], '8.25')
    }
  })
  await moveCursor(-40, -40)
  await captureFrames(24, 90, '07_bom_takeoff', true)
  await captureCleanShot('07-pascal-plumbing-bom.png')

  await setBanner('5 / 5 · Live IPC / UPC / IFGC / IRC & NEC 110.26(E) Audit: 0 Errors, 0 Warnings (IPC PASS)')
  await smoothClickButton('IPC Audit', false, 5, 24, '08_ipc_audit')
  await captureCleanShot('08-pascal-ipc-audit.png')

  // Finish encoding
  ffmpegProc.stdin.end()
  mp4Code = await ffmpegProc.exited
  ffmpegFinished = true
  if (mp4Code !== 0) {
    ffmpegStderr = await new Response(ffmpegProc.stderr).text()
  }
} finally {
  if (ffmpeg && !ffmpegFinished) {
    try {
      ffmpeg.stdin.end()
    } catch {}
    try {
      ffmpeg.kill('SIGTERM')
    } catch {}
    try {
      await Promise.race([ffmpeg.exited, new Promise((r) => setTimeout(r, 1500))])
    } catch {}
    try {
      ffmpeg.kill('SIGKILL')
    } catch {}
  }
  try {
    await browser.close()
  } catch {}
  try {
    browser.process?.()?.kill('SIGKILL')
  } catch {}
}

if (mp4Code !== 0 || !fs.existsSync(outMp4)) {
  console.error('FFmpeg MP4 encode failed:', ffmpegStderr)
  process.exit(1)
}
console.log(
  `Encoded REAL Pascal Editor walkthrough MP4: ${outMp4} (${Math.round(fs.statSync(outMp4).size / 1024)} KB, ${totalFrames} captured frames)`,
)

const gifProc = Bun.spawn(
  [
    ffmpegBin,
    '-y',
    '-i',
    outMp4,
    '-vf',
    'fps=5,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3',
    outGif,
  ],
  { stdout: 'ignore', stderr: 'pipe' },
)
const gifCode = await gifProc.exited
if (gifCode !== 0 || !fs.existsSync(outGif)) {
  console.error('FFmpeg GIF encode failed:', await new Response(gifProc.stderr).text())
  process.exit(1)
}
console.log(`Encoded REAL Pascal Editor GIF: ${outGif} (${Math.round(fs.statSync(outGif).size / 1024)} KB)`)
