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
    await expect(page.getByText('Easy, 0 to 26 °C')).toBeVisible()
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
    await expect(place.getByTestId('thermal')).toContainText('Hard')
    await expect(place.getByTestId('thermal')).toContainText('above 32 °C')
    await expect(place.getByRole('img', { name: 'Thermal: Hard, 2 of 5' })).toBeVisible()
    await expect(place.getByTestId('thermal')).toContainText('Cooler street nearby')
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/places-dark-thermal-card.png' })
    await place.locator('.nearby-link').click()
    await expect(place.getByTestId('thermal')).not.toContainText('above 32 °C')
  })

  test('the season and time bar turns on with thermal and asks for the new window', async ({ page }) => {
    await mockArea(page, { thermal: true })
    await openMap(page, 'dark')
    const bar = page.locator('[data-panel="season"]')
    const winter = bar.getByRole('button', { name: 'Winter' })
    await analyseCentre(page)
    await expect(winter).toBeEnabled()
    const card = page.locator('[data-panel="area-card"]')
    await expect(card).toContainText('summer, 15:00')

    areaRequests.length = 0
    await winter.click()
    await expect(card).toContainText('winter, 15:00')
    await expect(winter).toHaveAttribute('aria-pressed', 'true')
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
    await expect(bar.getByRole('button', { name: 'Winter' })).toBeEnabled()
  })

  test('a season chosen before analysis costs nothing and Analyse uses it', async ({ page }) => {
    areaRequests.length = 0
    await mockArea(page, { thermal: true })
    await openMap(page, 'dark')
    const bar = page.locator('[data-panel="season"]')
    await bar.getByRole('button', { name: 'Winter' }).click()
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
    const bar = page.locator('[data-panel="season"]')
    await bar.getByRole('button', { name: 'Winter' }).click()
    const card = page.locator('[data-panel="area-card"]')
    await expect(card).toContainText('Too many new thermal runs')
    await expect(card).toContainText('summer, 15:00')
    await expect(bar.getByRole('button', { name: 'Summer' })).toHaveAttribute('aria-pressed', 'true')
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
