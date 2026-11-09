import { expect } from '@playwright/test'

/** Set by a test that mocks the rating itself. */
const ratingMocked = new WeakSet()
export const markRatingMocked = (page) => ratingMocked.add(page)

/** No place names unless a test sets its own: a clicked point reads "Point on map". And no test ever reaches the
 *  real rating endpoint: an API already running on this machine would make paid calls with the placeholder image. */
const noPlaceNames = async (page) => {
  await page.route('**/api/reverse', (route) => route.fulfill({ json: { name: null } }))
  await page.route('**/api/senses/**', (route) => {
    if (ratingMocked.has(page)) return route.fallback()
    const lines = [{ type: 'start', model: 'test', cached: 0, to_rate: 0, remaining: 0 },
      { type: 'done', seconds: 0, failed: 0, remaining: 0, estimate_usd: 0, estimate_streetview_usd: 0 }]
    return route.fulfill({ contentType: 'application/x-ndjson', body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' })
  })
}

/** Choose a layer directly in the app's state (it is in the sheet on a phone, the panel elsewhere). */
export const chooseLayer = (page, layer) => page.evaluate((l) => {
  document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value.area.layer = l
}, layer)

/** Open /area in a theme and wait until the map has drawn once. Most checks are about Thermal, so that is the layer
 *  unless they ask for another; layer: null keeps the one the app opens on. */
export async function openMap(page, theme, { layer = 'thermal' } = {}) {
  await noPlaceNames(page)
  await page.addInitScript((t) => {
    try { localStorage.setItem('sencity-appearance', t) } catch {}
  }, theme)
  await page.goto('/area')
  await expect(page.locator('html')).toHaveAttribute('data-map-ready', 'true', { timeout: 30_000 })
  await page.evaluate(() => document.fonts.ready)
  if (layer) await chooseLayer(page, layer)
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
    // Cards inside the phone sheet scroll inside it; the sheet itself is checked.
    const sheet = document.querySelector('[data-panel="sheet"]')
    const panels = [...document.querySelectorAll('[data-panel]')]
      .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
      .filter((el) => el === sheet || el.dataset.panel === 'legend' || !sheet?.contains(el))
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
/** The bodies of the mocked /api/area requests, to see which seasons and times were asked for. */
export const areaRequests = []
export const THERMAL = Object.fromEntries(AREA.features.map((f, i) => [f.properties.id, [22, 29, 36][i % 3]]))

/** Mock /api/area (and /api/photo). thermal: also send the thermal stage ('error' sends a thermal_error). */
export async function mockArea(page, { hold = false, thermal = false } = {}) {
  const photoRequests = []
  await page.route('**/api/area', async (route) => {
    if (hold) return // the loading card stays until Cancel
    const asked = route.request().postDataJSON()
    if (thermal === 'fail-winter' && asked.season === 'winter') {
      const line = { type: 'thermal_error', message: 'Too many new thermal runs in a short time. Try again later.' }
      await route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'done', area: AREA })}\n${JSON.stringify(line)}\n` })
      return
    }
    const pending = AREA.features.map((f) => ({ ...f, properties: { ...f.properties, photos: null } }))
    const lines = [{ type: 'segments', features: pending, total: pending.length },
      ...AREA.features.map((f, i) => ({ type: 'segment', feature: f, done: i + 1, total: AREA.features.length })),
      { type: 'done', area: AREA }]
    if (thermal) lines.push({ type: 'stage', stage: 'thermal' })
    if (thermal === true || thermal === 'fail-winter') {
      areaRequests.push(asked)
      // Winter feels cold: every street is 30 °C colder than in the summer values.
      const values = asked.season === 'winter'
        ? Object.fromEntries(Object.entries(THERMAL).map(([k, v]) => [k, v - 30])) : THERMAL
      lines.push({ type: 'thermal', season: asked.season, time: asked.time, values,
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

// Routes: mock POST /api/routes (streamed like the API). Five stretches on A (mixed, hard, mixed, hard,
// mixed), three on B (easy, mixed, easy), built around the points the app sends.
export async function openRoutes(page, theme) {
  await noPlaceNames(page)
  await page.addInitScript((t) => {
    try { localStorage.setItem('sencity-appearance', t) } catch {}
  }, theme)
  await page.goto('/routes')
  await expect(page.locator('html')).toHaveAttribute('data-map-ready', 'true', { timeout: 30_000 })
  await page.evaluate(() => document.fonts.ready)
}

/** Two free map points, in viewport pixels, about 400 m apart at the start zoom. */
export function routeClicks(viewport, phone = false) {
  const y = Math.round(viewport.height * (phone ? 0.3 : 0.6))
  const left = phone ? 0.2 : 0.42
  const right = phone ? 0.8 : 0.62
  return { a: { x: Math.round(viewport.width * left), y }, b: { x: Math.round(viewport.width * right), y } }
}

function routeResponse(req, sameState = false, longName = null, second = false) {
  const { start, end } = req
  const lerp = (t, lift) => [start.lon + t * (end.lon - start.lon), start.lat + t * (end.lat - start.lat) + lift]
  const features = []
  const values = {}
  const part = (id, name, a, b, utci, length) => {
    features.push({
      type: 'Feature', id, geometry: { type: 'LineString', coordinates: [a, b] },
      properties: { id, name, named: true, place_type: 'street', way_type: 'residential', length_m: length, photos: WITH_3.properties.photos },
    })
    values[id] = utci
    return { segment_id: id, length_m: length, coordinates: [a, b] }
  }
  const a = [
    part('a1', longName ?? 'Mittelgasse', lerp(0, 0), lerp(0.2, 0.0006), 29, 100),
    part('a2', 'Heissgasse', lerp(0.2, 0.0006), lerp(0.4, 0.0006), 36, 100),
    part('a3', 'Lange Gasse', lerp(0.4, 0.0006), lerp(0.6, 0.0006), 29, 100),
    part('a4', 'Heissgasse', lerp(0.6, 0.0006), lerp(0.8, 0.0006), 36, 100),
    part('a5', 'Lange Gasse', lerp(0.8, 0.0006), lerp(1, 0), 29, 100),
  ]
  const b = [
    part('b1', 'Kuehlgasse', lerp(0, 0), lerp(0.3, -0.001), 22, 180),
    part('b2', 'Marktgasse', lerp(0.3, -0.001), lerp(0.7, -0.001), 29, 200),
    part('b3', 'Kuehlgasse', lerp(0.7, -0.001), lerp(1, 0), 22, 180),
  ]
  // Two neighbours in the same state, then a third: the stretches stay single streets.
  if (sameState) {
    b.splice(0, 3,
      part('c1', 'Kuehlgasse', lerp(0, 0), lerp(0.25, -0.001), 22, 140),
      part('c2', 'Kuehlgasse', lerp(0.25, -0.001), lerp(0.5, -0.001), 22, 140),
      part('c3', 'Marktgasse', lerp(0.5, -0.001), lerp(0.75, -0.001), 29, 140),
      part('c4', 'Marktgasse', lerp(0.75, -0.001), lerp(1, 0), 29, 140))
  }
  const route = (id, kind, parts, hard) => {
    const length_m = parts.reduce((n, p) => n + p.length_m, 0)
    return { id, kind, length_m, minutes: Math.round(length_m / 80), hard_share: hard, mixed_share: 1 - hard, thermal_share: 1, photo_share: 0.8, parts }
  }
  return {
    type: 'routes', season: req.season, time: req.time, station: { name: 'Wien-Innere Stadt', distance_km: 1.2 },
    routes: [route('A', 'shortest', a, 0.4), route('B', second ? 'second' : 'easiest', b, 0)],
    verdict: 'B is 1 minute longer but avoids the hot stretch on Heissgasse.',
    segments: { type: 'FeatureCollection', features }, values,
  }
}

/** Mock the routes API and the photos. hold: never answer. thermal: 'error' sends a thermal_error (can be changed later). */
export async function mockRoutes(page, { hold = false, thermal = true, sameState = false, longName = null, second = false } = {}) {
  const mock = { requests: [], urls: [], thermal }
  await page.route('**/api/routes', async (route) => {
    mock.urls.push(route.request().url())
    if (hold) { mock.requests.push(route.request().postDataJSON()); return }
    const asked = route.request().postDataJSON()
    mock.requests.push(asked)
    const lines = [{ type: 'stage', stage: 'streets' }, { type: 'segments', total: 8 }, { type: 'segment', done: 8, total: 8 }]
    if (asked.layer === 'senses') {
      const found = routeResponse(asked, sameState, longName)
      lines.push({ type: 'stage', stage: 'routes' }, { ...found, season: null, time: null, station: null, values: {}, verdict: '', routes: [],
        candidates: found.routes.map((r, i) => ({ ...r, id: i ? 'C1' : 'A', kind: i ? 'candidate' : 'shortest' })) })
      await route.fulfill({ contentType: 'application/x-ndjson', body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' })
      return
    }
    lines.push({ type: 'stage', stage: 'thermal' })
    if (mock.thermal === 'route-error') lines.push({ type: 'stage', stage: 'routes' }, { type: 'error', message: 'No walking way was found between these two points.' })
    else if (mock.thermal === 'error') lines.push({ type: 'thermal_error', message: 'No weather station near this area, so thermal comfort is not available here.' })
    else lines.push({ type: 'stage', stage: 'routes' }, routeResponse(asked, sameState, longName, second))
    await route.fulfill({ contentType: 'application/x-ndjson', body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' })
  })
  await page.route('**/api/photo/**', (route) => route.fulfill({ contentType: 'image/png', body: PHOTO }))
  return mock
}
