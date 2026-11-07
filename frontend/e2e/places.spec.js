// Street segments and their photos: loading card, segments on the map, place card, enlarged photo.
// /api/area and /api/photo are mocked (no Street View or Overpass calls).
import { expect, test } from '@playwright/test'
import { AREA, THERMAL, WITH_3, areaRequests, WITHOUT, analyseCentre, layoutProblems, mapIdle, mockArea, openMap, openSegment } from './helpers.js'

const segPx = (page, id) => page.evaluate((segId) => {
  const m = window.__sencityMap
  const f = m.getSource('sc-seg')._data.features?.find((x) => x.properties.id === segId)
    ?? m.querySourceFeatures('sc-seg').find((x) => x.properties.id === segId)
  const c = f.geometry.coordinates
  const mid = c[Math.floor(c.length / 2)]
  const a = m.project(c[0])
  const b = m.project(c[c.length - 1])
  return mid && c.length > 2 ? m.project(mid) : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}, id)

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })

  test('analyse, click a street, see its photos; no image before the click', async ({ page }) => {
    const photos = await mockArea(page)
    await openMap(page, 'dark')
    await analyseCentre(page)
    await expect(page.getByText(`${AREA.features.length} street stretches`)).toBeVisible()
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/places-dark-loaded.png' })
    expect(photos).toHaveLength(0) // nothing is fetched until a street is clicked

    // Click the street itself on the map.
    const p = await segPx(page, WITH_3.properties.id)
    await page.mouse.click(p.x, p.y)
    const card = page.locator('[data-panel="place-card"]')
    await expect(card.getByRole('heading')).toBeVisible()
    await expect(card).toContainText('Not rated yet. Ratings come in the next step.')
    await expect(card).toContainText('Photo 1 of')
    await expect(card.locator('img').first()).toHaveJSProperty('complete', true)
    // Only this street's photos load (at most 3: the current one, the previous and the next).
    await expect.poll(() => new Set(photos).size).toBeGreaterThan(0)
    const shown = new Set(photos)
    expect(shown.size).toBeLessThanOrEqual(3)
    const segPhotos = AREA.features.find((f) => f.properties.id === (
      // the clicked street may be a neighbour of WITH_3 if they overlap on screen
      [...shown][0] && AREA.features.find((x) => x.properties.photos.some((ph) => [...shown][0].includes(ph.pano_id)))?.properties.id))
    expect(segPhotos).toBeTruthy()
    expect([...shown].every((u) => segPhotos.properties.photos.some((ph) => u.includes(ph.pano_id)))).toBe(true)
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/places-dark-card.png' })

    // The segment is selected through a feature-state.
    const selected = await page.evaluate(() => {
      const m = window.__sencityMap
      return m.querySourceFeatures('sc-seg').filter((f) => m.getFeatureState({ source: 'sc-seg', id: f.properties.id }).selected).length
    })
    expect(selected).toBeGreaterThanOrEqual(1)

    // Back to area clears the selection.
    await card.getByRole('button', { name: 'Back to area' }).click()
    await expect(page.locator('[data-panel="place-card"]')).toHaveCount(0)
    await expect(page.getByText('Click a street to see its photos.')).toBeVisible()
  })

  test('enlarged photo: arrows, Esc, focus stays inside', async ({ page }) => {
    await mockArea(page)
    await openMap(page, 'dark')
    await analyseCentre(page)
    await expect(page.getByText('street stretches')).toBeVisible()
    await openSegment(page, WITH_3.properties.id)
    const card = page.locator('[data-panel="place-card"]')
    await expect(card.getByRole('button', { name: 'Back to area' })).toBeFocused()

    await card.getByRole('button', { name: 'Enlarge photo', exact: true }).click()
    const viewer = page.getByRole('dialog')
    await expect(viewer).toContainText('Photo 1 of 3')
    await page.keyboard.press('ArrowRight')
    await expect(viewer).toContainText('Photo 2 of 3')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(viewer).toContainText('Photo 3 of 3')
    await page.screenshot({ path: 'e2e/screens/places-dark-viewer.png' })

    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]'))).toBe(true)

    await page.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Enlarge photo', exact: true })).toBeFocused()
    // A second Esc goes back to the area, and focus returns to the street that opened the card.
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-panel="place-card"]')).toHaveCount(0)
    await expect(page.locator(`[data-seg="${WITH_3.properties.id}"]`)).toBeFocused()
  })

  test('a street with no photo; go to the nearest street with photos', async ({ page }) => {
    const photos = await mockArea(page)
    await openMap(page, 'light')
    await analyseCentre(page)
    await expect(page.getByText('street stretches')).toBeVisible()
    await openSegment(page, WITHOUT.properties.id)
    const card = page.locator('[data-panel="place-card"]')
    await expect(card).toContainText('No photo')
    await expect(card).toContainText('We never guess between photos')
    expect(photos).toHaveLength(0)
    await page.screenshot({ path: 'e2e/screens/places-light-no-photo.png' })
    await card.getByRole('button', { name: 'Go to the nearest street with photos' }).click()
    await expect(card).toContainText('Photo 1 of')
  })

  test('thermal comfort arrives after the photos and becomes the layer', async ({ page }) => {
    await mockArea(page, { thermal: true })
    await openMap(page, 'dark')
    await analyseCentre(page)
    const thermalBtn = page.getByRole('button', { name: 'Thermal', exact: true })
    await expect(thermalBtn).toBeEnabled()
    await expect(thermalBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Senses', exact: true })).toBeDisabled()
    await expect(page.getByText('Feels like temperature, hot or cold')).toBeVisible()
    // Every value here is 9 °C or warmer: Easy with its range, then only the heat side.
    const legend = page.getByTestId('thermal-legend')
    await expect(legend).toContainText('Easy, 9 to 26 °C')
    await expect(legend).toContainText('Mixed, 26 to 32 °C')
    await expect(legend).toContainText('Hard, above 32 °C')
    await expect(legend).not.toContainText('−13')
    // The info button opens the full scale, heat and cold, on click (not hover).
    const info = page.getByRole('button', { name: 'Show the full scale, heat and cold' })
    await expect(info).toHaveAttribute('aria-expanded', 'false')
    await info.click()
    await expect(info).toHaveAttribute('aria-expanded', 'true')
    const scale = page.getByRole('region', { name: 'Full scale, heat and cold' })
    await expect(scale).toContainText('−13 to 9 °C')
    await expect(scale).toContainText('below −13 °C')
    await info.click()
    await expect(scale).toHaveCount(0)
    await expect(page.getByText(/with weather from Wien-Innere Stadt/)).toBeVisible()

    // Every street with a value is lit in its state colour, photo or not.
    await mapIdle(page)
    const lit = await page.evaluate(() => {
      const m = window.__sencityMap
      return { filter: m.getFilter('sc-seg-core'), states: m.querySourceFeatures('sc-seg').map((f) => f.properties.thermal_state) }
    })
    expect(lit.filter).toEqual(['has', 'thermal_state'])
    expect(new Set(lit.states)).toEqual(new Set(['easy', 'mixed', 'hard']))
    const card = page.locator('[data-panel="area-card"]')
    await expect(card).toContainText(`Thermal · ${AREA.features.length} street stretches`)
    await expect(card.getByRole('img', { name: /^Thermal: Easy \d+, Mixed \d+, Hard \d+/ })).toBeVisible()
    await expect(card).toContainText('Places here')
    await page.screenshot({ path: 'e2e/screens/places-dark-thermal.png' })

    // The place card shows how warm the street feels; a street with no photo has a value too.
    await openSegment(page, WITHOUT.properties.id)
    const place = page.locator('[data-panel="place-card"]')
    const t = THERMAL[WITHOUT.properties.id]
    await expect(place.getByTestId('thermal')).toContainText(`${t} °C feels like`)
    await expect(place.getByTestId('thermal')).toContainText('not a measurement')

    // A hard street: the reason, its place on the 1–5 bar, and a cooler street nearby to go to.
    await place.getByRole('button', { name: 'Back to area' }).click()
    const hard = AREA.features.find((f) => THERMAL[f.properties.id] === 36)
    await openSegment(page, hard.properties.id)
    await expect(place.getByTestId('thermal')).toContainText('Hard: above 32 °C')
    // A temperature bar on the heat side (every value here is 9 °C or warmer), no 1–5 score.
    await expect(place.getByRole('img', { name: 'Feels like 36 °C on the heat side of the scale' })).toBeVisible()
    for (const t of ['9', '26', '32', '40']) await expect(place.getByTestId('thermal-bar')).toContainText(t)
    await expect(place.getByTestId('thermal')).not.toContainText('of 5')
    await expect(place.getByTestId('thermal')).toContainText('Cooler street nearby')
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/places-dark-thermal-card.png' })
    // Following it selects that street (same state as a map click), zooms to it, and keeps the layer.
    const link = place.getByRole('button', { name: /^Go to .+, \d+ min away, \d+ °C$/ })
    await expect(link).toBeVisible()
    const box = await link.boundingBox()
    expect(box.height).toBeGreaterThanOrEqual(44)
    const zoomBefore = await page.evaluate(() => window.__sencityMap.getZoom())
    await link.click()
    await expect(place.getByTestId('thermal')).not.toContainText('above 32 °C')
    // The ring pulses on the new street, even while the map moves there (the pulse lasts 6 s).
    await expect(page.locator('.ring.pulsing')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Thermal', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-seg][aria-pressed="true"]')).toHaveCount(1)
    await mapIdle(page)
    expect(await page.evaluate(() => window.__sencityMap.getZoom())).toBeGreaterThanOrEqual(zoomBefore)

    // "Back to <street>" returns to the hard street, and is gone there.
    const back = place.getByRole('button', { name: `Back to ${hard.properties.name}` })
    await expect(back).toBeVisible()
    await back.click()
    await expect(place.getByTestId('thermal')).toContainText('above 32 °C')
    await expect(place.getByRole('button', { name: /^Back to (?!area)/ })).toHaveCount(0)

    // With the keyboard, focus lands on "Back to <street>" after following the link.
    await link.focus()
    await page.keyboard.press('Enter')
    await expect(back).toBeFocused()

    // An easy street has no nearby block at all.
    const easy = AREA.features.find((f) => THERMAL[f.properties.id] === 22)
    await openSegment(page, easy.properties.id)
    await expect(place.getByTestId('thermal')).toContainText('Easy: 9 to 26 °C')
    await expect(place.locator('.nearby')).toHaveCount(0)
  })

  test('suggestions: likely easiest places, numbered pins, seen tick, collapse and the Places filter', async ({ page }) => {
    await mockArea(page, { thermal: true })
    await openMap(page, 'dark')
    await analyseCentre(page)
    const list = page.getByTestId('suggestions')
    await expect(list).toContainText('Likely easiest for you')
    const rows = list.getByRole('listitem')
    const n = await rows.count()
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(3)
    // One pin per row, a 44 px button, numbered as the list; every suggestion is easy.
    const pins = page.locator('[data-marker]')
    await expect(pins).toHaveCount(n)
    const first = page.getByRole('button', { name: /^Suggestion 1: / })
    expect((await first.boundingBox()).height).toBeGreaterThanOrEqual(44)
    await expect(rows.first()).toContainText('Easy')
    // The highlighted stretches are drawn above the street colours.
    await mapIdle(page)
    expect(await page.evaluate(() => window.__sencityMap.getSource('sc-mark').serialize().data.features.length)).toBe(n)
    await page.screenshot({ path: 'e2e/screens/places-dark-suggestions.png' })

    // A pin opens that place's card; the other pins stay. Nothing about suggestions in the card.
    const name = (await first.getAttribute('aria-label')).replace(/^Suggestion 1: /, '')
    const pinBox = await first.boundingBox()
    await first.click()
    const place = page.locator('[data-panel="place-card"]')
    await expect(place.locator('#place-title')).toHaveText(name)
    // The selection ring takes the pin's place; the other pins stay.
    await expect(pins).toHaveCount(n - 1)
    const ringBox = await page.locator('.ring:not(.focus)').boundingBox()
    expect(Math.abs(ringBox.x + ringBox.width / 2 - (pinBox.x + pinBox.width / 2))).toBeLessThan(2)
    expect(Math.abs(ringBox.y + ringBox.height / 2 - (pinBox.y + pinBox.height / 2))).toBeLessThan(2)
    await expect(place).not.toContainText('uggestion')
    await place.getByRole('button', { name: 'Back to area' }).click()
    await expect(list.getByRole('button', { name: /, seen$/ })).toHaveCount(1)

    // A street that is not suggested hides the pins and highlights, with no popup; Back to area brings them back.
    const marked = new Set(await page.evaluate(() => window.__sencityMap.getSource('sc-mark').serialize().data.features.map((f) => f.properties.id)))
    const other = AREA.features.find((f) => !marked.has(f.properties.id))
    await openSegment(page, other.properties.id)
    await expect(pins).toHaveCount(0)
    await mapIdle(page)
    expect(await page.evaluate(() => window.__sencityMap.getSource('sc-mark').serialize().data.features.length)).toBe(0)
    await expect(page.getByRole('button', { name: /suggestion/i })).toHaveCount(0)
    await place.getByRole('button', { name: 'Back to area' }).click()
    await expect(pins).toHaveCount(n)

    // Places filter: Parks limits the map and the suggestions to parks.
    await page.getByRole('button', { name: 'Parks', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Parks', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await mapIdle(page)
    const kinds = await page.evaluate(() => window.__sencityMap.getSource('sc-seg').serialize().data.features.map((f) => f.properties.place_type))
    expect(kinds.every((k) => k === 'park')).toBe(true)
    const parkRows = await rows.count()
    if (parkRows) await expect(rows.first()).toContainText('Park')
    else await expect(list).toContainText('Nothing easy here at this time. Try another time or a nearby area.')
    await page.getByRole('button', { name: 'All', exact: true }).click()
    await expect(rows).toHaveCount(n)
  })

  test('season and time in the left panel turn on with thermal and ask for the new window', async ({ page }) => {
    await mockArea(page, { thermal: true })
    await openMap(page, 'dark')
    const bar = page.getByTestId('season-time')
    const winter = bar.getByRole('radio', { name: 'Winter' })
    await analyseCentre(page)
    await expect(winter).toBeEnabled()
    const card = page.locator('[data-panel="area-card"]')
    await expect(card).toContainText('summer, 15:00')

    areaRequests.length = 0
    await winter.click()
    await expect(card).toContainText('winter, 15:00')
    await expect(winter).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText(/Simulated by Infrared\.city for winter, 15:00/)).toBeVisible()
    expect(areaRequests.map((r) => r.season)).toEqual(['winter'])

    // Arrow-key steps on the slider ask only once, for the last time.
    areaRequests.length = 0
    const slider = bar.getByRole('slider', { name: 'Time of day' })
    await slider.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(card).toContainText('winter, 17:00')
    expect(areaRequests.map((r) => r.time)).toEqual(['17:00'])
    await expect(bar.getByRole('radio', { name: 'Winter' })).toBeEnabled()
  })

  test('a season chosen before analysis costs nothing and Analyse uses it', async ({ page }) => {
    areaRequests.length = 0
    await mockArea(page, { thermal: true })
    await openMap(page, 'dark')
    const bar = page.getByTestId('season-time')
    await bar.getByRole('radio', { name: 'Winter' }).click()
    await bar.getByRole('slider', { name: 'Time of day' }).fill('9')
    await page.waitForTimeout(1000) // longer than the wait before a loaded area asks again
    expect(areaRequests).toHaveLength(0)
    await analyseCentre(page)
    const card = page.locator('[data-panel="area-card"]')
    await expect(card).toContainText('winter, 09:00')
    expect(areaRequests.map((r) => [r.season, r.time])).toEqual([['winter', '09:00']])
  })

  test('a failed season keeps what was shown and says why', async ({ page }) => {
    await mockArea(page, { thermal: 'fail-winter' })
    await openMap(page, 'dark')
    await analyseCentre(page)
    const bar = page.getByTestId('season-time')
    await bar.getByRole('radio', { name: 'Winter' }).click()
    const card = page.locator('[data-panel="area-card"]')
    await expect(card).toContainText('Too many new thermal runs')
    await expect(card).toContainText('summer, 15:00')
    await expect(bar.getByRole('radio', { name: 'Summer' })).toHaveAttribute('aria-checked', 'true')
  })

  test('a thermal failure keeps the photos and offers Try again', async ({ page }) => {
    await mockArea(page, { thermal: 'error' })
    await openMap(page, 'dark')
    await analyseCentre(page)
    const card = page.locator('[data-panel="area-card"]')
    await expect(card).toContainText('Thermal comfort could not be loaded. Try again.')
    await expect(card.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Thermal', exact: true })).toBeDisabled()
    await expect(page.getByText(`${AREA.features.length} street stretches`)).toBeVisible()
  })

  test('Try again after the photos failed goes on from there, not from the beginning', async ({ page }) => {
    // First try: the streets and half of the photos, then an error. Second try: what the API sends when
    // it goes on (no streets step; the photos found so far, then the rest).
    const half = Math.floor(AREA.features.length / 2)
    const pending = (fs) => fs.map((f, i) => (i < half ? f : { ...f, properties: { ...f.properties, photos: null } }))
    const tries = []
    await page.route('**/api/area', async (route) => {
      tries.push(route.request().postDataJSON())
      const total = AREA.features.length
      const lines = tries.length === 1
        ? [{ type: 'stage', stage: 'streets' },
            { type: 'segments', features: AREA.features.map((f) => ({ ...f, properties: { ...f.properties, photos: null } })), total, done: 0 },
            ...AREA.features.slice(0, half).map((f, i) => ({ type: 'segment', feature: f, done: i + 1, total })),
            { type: 'error', message: 'Could not load street photos for this area. Try again.' }]
        : [{ type: 'segments', features: pending(AREA.features), total, done: half },
            ...AREA.features.slice(half).map((f, i) => ({ type: 'segment', feature: f, done: half + i + 1, total })),
            { type: 'done', area: AREA }]
      if (tries.length > 1) await new Promise((r) => setTimeout(r, 400)) // the retry is on screen a moment
      await route.fulfill({ contentType: 'application/x-ndjson', body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' })
    })
    await openMap(page, 'dark')
    await analyseCentre(page)
    const loading = page.locator('[data-panel="loading-card"]')
    await expect(loading.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(page.getByText('Could not load street photos')).toBeVisible()
    // The streets stay on the map while it failed.
    expect(await page.evaluate(() => window.__sencityMap.getSource('sc-seg').serialize().data.features.length)).toBe(AREA.features.length)

    // Try again: the photo count goes on from where it stopped, the streets stay on the map.
    let lowest = Infinity
    await page.exposeFunction('__seen', (n) => { lowest = Math.min(lowest, n) })
    await page.evaluate(() => {
      const obs = new MutationObserver(() => {
        const m = document.querySelector('[data-panel="loading-card"]')?.textContent.match(/(\d+) of \d+/)
        if (m) window.__seen(Number(m[1]))
      })
      obs.observe(document.body, { subtree: true, childList: true, characterData: true })
    })
    await loading.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText(`${AREA.features.length} street stretches`)).toBeVisible()
    expect(tries).toHaveLength(2)
    expect(Number.isFinite(lowest)).toBe(true) // the count was on screen during the retry
    expect(lowest).toBeGreaterThanOrEqual(half) // and never went back to 0 of N
  })

  test('Try again after thermal failed asks for thermal only and keeps the map', async ({ page }) => {
    const tries = []
    await page.route('**/api/area', async (route) => {
      const asked = route.request().postDataJSON()
      tries.push(asked)
      const pending = AREA.features.map((f) => ({ ...f, properties: { ...f.properties, photos: null } }))
      const lines = tries.length === 1
        ? [{ type: 'segments', features: pending, total: pending.length, done: 0 },
            ...AREA.features.map((f, i) => ({ type: 'segment', feature: f, done: i + 1, total: AREA.features.length })),
            { type: 'done', area: AREA }, { type: 'stage', stage: 'thermal' },
            { type: 'thermal_error', message: 'Thermal comfort could not be loaded. Try again.' }]
        : [{ type: 'done', area: AREA, cached: true }, { type: 'stage', stage: 'thermal' },
            { type: 'thermal', season: asked.season, time: asked.time, values: THERMAL, station: { name: 'Wien-Innere Stadt', distance_km: 1.2 } }]
      await route.fulfill({ contentType: 'application/x-ndjson', body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' })
    })
    await openMap(page, 'dark')
    await analyseCentre(page)
    const card = page.locator('[data-panel="area-card"]')
    await expect(card).toContainText('Thermal comfort could not be loaded. Try again.')
    // The streets never leave the map during the retry.
    await page.evaluate(() => {
      window.__emptied = false
      const src = window.__sencityMap.getSource('sc-seg')
      const set = src.setData.bind(src)
      src.setData = (d) => { if (!d?.features?.length) window.__emptied = true; return set(d) }
    })
    await card.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('button', { name: 'Thermal', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(tries).toHaveLength(2)
    expect(await page.evaluate(() => window.__emptied)).toBe(false)
  })

  test('Cancel while loading goes back to the set circle', async ({ page }) => {
    await mockArea(page, { hold: true })
    await openMap(page, 'dark')
    await analyseCentre(page)
    const loading = page.locator('[data-panel="loading-card"]')
    await expect(loading).toContainText('Loading this area')
    await expect(loading).toContainText('Streets')
    await expect(loading).toContainText('Street photos')
    await expect(loading).toContainText('Thermal')
    await page.screenshot({ path: 'e2e/screens/places-dark-loading.png' })
    await loading.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Analyse this area' })).toBeVisible()
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'light', hasTouch: true, isMobile: true })

  test('place sheet and full-page photo', async ({ page }) => {
    await mockArea(page)
    await openMap(page, 'light')
    await analyseCentre(page)
    await expect(page.getByText('street stretches')).toBeVisible()
    await openSegment(page, WITH_3.properties.id)
    const sheet = page.locator('[data-panel="place-card"]')
    await expect(sheet).toContainText('Photo 1 of 3')
    await mapIdle(page)
    expect(await layoutProblems(page)).toEqual([])
    await page.screenshot({ path: 'e2e/screens/places-phone-sheet.png' })
    await sheet.getByRole('button', { name: 'Enlarge photo', exact: true }).tap()
    await expect(page.getByRole('dialog')).toContainText('Swipe or tap the arrows')
    await page.screenshot({ path: 'e2e/screens/places-phone-viewer.png' })
  })
})

test.describe('street name on hover', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })

  test('hovering a street shows its full name; Tab to a street shows it too', async ({ page }) => {
    await mockArea(page)
    await openMap(page, 'dark')
    await analyseCentre(page)
    await expect(page.getByText('street stretches')).toBeVisible()
    await mapIdle(page)
    const tip = page.locator('.street-tip')

    const p = await segPx(page, WITH_3.properties.id)
    await page.mouse.move(p.x - 30, p.y - 30)
    await page.mouse.move(p.x, p.y, { steps: 4 })
    await expect(tip).toBeVisible()
    const hovered = await page.evaluate(() => {
      const m = window.__sencityMap
      const f = m.querySourceFeatures('sc-seg').find((x) => m.getFeatureState({ source: 'sc-seg', id: x.properties.id }).hover)
      return f?.properties.name
    })
    await expect(tip).toContainText(hovered)
    await page.screenshot({ path: 'e2e/screens/places-dark-hover-name.png' })

    await page.mouse.move(5, 450) // off the streets
    await expect(tip).toHaveCount(0)

    await page.locator(`[data-seg="${WITH_3.properties.id}"]`).focus()
    await expect(tip).toContainText(WITH_3.properties.name)
  })
})
