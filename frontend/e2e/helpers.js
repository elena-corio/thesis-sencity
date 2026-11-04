import { expect } from '@playwright/test'

/** Open /area in a theme and wait until the map has drawn once. */
export async function openMap(page, theme) {
  await page.addInitScript((t) => {
    try { localStorage.setItem('sencity-appearance', t) } catch {}
  }, theme)
  await page.goto('/area')
  await expect(page.locator('html')).toHaveAttribute('data-map-ready', 'true', { timeout: 30_000 })
  await page.evaluate(() => document.fonts.ready)
}

/** Wait for the map to finish drawing after a change. */
export async function mapIdle(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const m = window.__sencityMap
    if (!m || m.loaded()) requestAnimationFrame(() => resolve())
    else m.once('idle', () => resolve())
  }))
}

/** Points on the map for the centre and the radius, in viewport pixels. */
export function points(viewport, radiusPx = 140, phone = false) {
  const cx = Math.round(viewport.width * (phone ? 0.5 : 0.6))
  const cy = Math.round(viewport.height * (phone ? 0.45 : 0.6))
  const angle = -Math.PI / 5
  return {
    centre: { x: cx, y: cy },
    edge: { x: Math.round(cx + radiusPx * Math.cos(angle)), y: Math.round(cy + radiusPx * Math.sin(angle)) },
  }
}

/** Step 1 → 1b: click the centre, then move the pointer out to the radius. */
export async function placeCentre(page, p) {
  await page.mouse.move(p.centre.x - 30, p.centre.y + 20)
  await page.mouse.click(p.centre.x, p.centre.y)
  await page.mouse.move(p.edge.x, p.edge.y, { steps: 8 })
}

/**
 * Overlap and fit check: the page does not scroll, every panel is inside the viewport,
 * no two panels overlap, and a panel not marked data-scrollable does not overflow.
 * Returns a list of problems (empty when all is well).
 */
export async function layoutProblems(page) {
  return page.evaluate(() => {
    const problems = []
    // Open dropdowns and menus (data-popover) float over the map: they only have to fit the screen.
    for (const el of document.querySelectorAll('[data-popover]')) {
      if (!el.getClientRects().length) continue
      const r = el.getBoundingClientRect()
      if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) {
        problems.push(`popover outside the viewport (${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)})`)
      }
    }
    const hidden = [...document.querySelectorAll('[data-popover]')].map((el) => [el, el.style.display])
    hidden.forEach(([el]) => { el.style.display = 'none' })
    const de = document.documentElement
    if (de.scrollHeight > innerHeight + 1 || de.scrollWidth > innerWidth + 1) {
      problems.push(`page scrolls: ${de.scrollWidth}×${de.scrollHeight} in ${innerWidth}×${innerHeight}`)
    }
    const panels = [...document.querySelectorAll('[data-panel]')]
      .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
    const rects = panels.map((el) => ({ name: el.dataset.panel, r: el.getBoundingClientRect(), el }))
    for (const { name, r, el } of rects) {
      if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) {
        problems.push(`${name} outside the viewport (${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)})`)
      }
      if (!('scrollable' in el.dataset) && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
        problems.push(`${name} overflows (${el.scrollWidth}×${el.scrollHeight} in ${el.clientWidth}×${el.clientHeight})`)
      }
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i].r
        const b = rects[j].r
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (ix > 0.5 && iy > 0.5 && !rects[i].el.contains(rects[j].el) && !rects[j].el.contains(rects[i].el)) {
          problems.push(`${rects[i].name} overlaps ${rects[j].name}`)
        }
      }
    }
    hidden.forEach(([el, display]) => { el.style.display = display })
    return problems
  })
}

// Area and photo mocks: the checks never call Street View or Overpass.
import { readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

export const AREA = JSON.parse(readFileSync(new URL('./fixtures/area-stephansplatz-100m.json', import.meta.url), 'utf8'))
export const WITH_3 = AREA.features.find((f) => f.properties.photos.length === 3)
export const WITHOUT = AREA.features.find((f) => f.properties.photos.length === 0)

/** A small solid-colour PNG, standing in for a Street View image. */
function png(size, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([r, g, b]))])
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const PHOTO = png(64, [120, 150, 160])

/**
 * Mock POST /api/area (streamed like the API: segments, then each segment, then done) and
 * GET /api/photo. Returns the list of photo URLs requested. hold: never answer (to test Cancel).
 */
/** Feels-like °C per segment for the mocked thermal step: 22, 29, 36, 22, … (easy, mixed, hard). */
export const THERMAL = Object.fromEntries(AREA.features.map((f, i) => [f.properties.id, [22, 29, 36][i % 3]]))

/** Mock /api/area (and /api/photo). thermal: also send the thermal stage ('error' sends a thermal_error). */
export async function mockArea(page, { hold = false, thermal = false } = {}) {
  const photoRequests = []
  await page.route('**/api/area', async (route) => {
    if (hold) return // the loading card stays until Cancel
    const pending = AREA.features.map((f) => ({ ...f, properties: { ...f.properties, photos: null } }))
    const lines = [{ type: 'segments', features: pending, total: pending.length },
      ...AREA.features.map((f, i) => ({ type: 'segment', feature: f, done: i + 1, total: AREA.features.length })),
      { type: 'done', area: AREA }]
    if (thermal) lines.push({ type: 'stage', stage: 'thermal' })
    if (thermal === true) {
      lines.push({ type: 'thermal', season: 'summer', time: '15:00', values: THERMAL,
        station: { name: 'Wien-Innere Stadt', distance_km: 1.2 } })
    } else if (thermal === 'error') {
      lines.push({ type: 'thermal_error', message: 'Thermal comfort could not be loaded. Try again.' })
    }
    await route.fulfill({ contentType: 'application/x-ndjson', body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' })
  })
  await page.route('**/api/photo/**', async (route) => {
    photoRequests.push(route.request().url())
    await route.fulfill({ contentType: 'image/png', body: PHOTO, headers: { 'Cache-Control': 'private, max-age=3600' } })
  })
  return photoRequests
}

/** Set a 100 m circle at the map centre with the keyboard and press Analyse this area. */
export async function analyseCentre(page) {
  await page.locator('canvas').focus()
  await page.keyboard.press('Enter')
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Analyse this area' }).click()
}

/** Open a segment's place card through the keyboard list of streets. */
export async function openSegment(page, id) {
  const btn = page.locator(`[data-seg="${id}"]`)
  await btn.focus()
  await page.keyboard.press('Enter')
}
