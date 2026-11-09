import { expect, test } from '@playwright/test'
import { AREA, WITH_3, analyseCentre, layoutProblems, mapIdle, mockArea, openMap, openSegment } from './helpers.js'

// The model is mocked: these checks never call OpenRouter.
const ANSWER = {
  comfort: 4,
  bothers: [{ code: 'traffic_trams_crowds', en: 'Traffic, trams, crowds (hearing)', it: 'Traffico, tram, folla (udito)', sense: 'hearing', kind: 'bothering' }],
  feels_good: [
    { code: 'greenery_water_buildings', en: 'Greenery, water, nice buildings (sight)', it: 'Verde, acqua, edifici belli (vista)', sense: 'sight', kind: 'pleasant' },
    { code: 'shade', en: 'Shade from trees, pergolas or buildings (thermal)', it: 'Ombra (termico)', sense: 'thermal', kind: 'pleasant' },
  ],
  reason: 'The trees give shade and the facades are pleasant, but the road carries steady traffic.',
  model: 'google/gemini-3.1-flash-lite', latency_ms: 1400, cost_usd: 0.0005, cached: false,
}
const OTHER = AREA.features.find((f) => f.properties.photos.length && f.properties.id !== WITH_3.properties.id)

/** Mock the prediction. mock.fail: answer with an error. mock.hold: never answer until released. */
async function mockSenses(page) {
  const mock = { requests: [], fail: false, release: null }
  await page.route('**/api/senses/predict**', async (route) => {
    mock.requests.push(route.request())
    if (mock.hold) await new Promise((resolve) => { mock.release = resolve })
    if (mock.fail) return route.fulfill({ status: 502, json: { detail: 'The model\'s answer was not valid, twice, so nothing is shown. It said: "oops"' } })
    return route.fulfill({ json: ANSWER })
  })
  return mock
}

async function openSenses(page, theme = 'dark') {
  await mockArea(page)
  const mock = await mockSenses(page)
  await openMap(page, theme)
  if ((page.viewportSize()?.width ?? 1440) < 768) await page.locator('[data-panel="sheet"]').getByRole('tab', { name: /^Settings/ }).click()
  await page.getByRole('radio', { name: 'Senses', exact: true }).first().click()
  await analyseCentre(page)
  await expect(page.locator('[data-panel="area-card"]')).toBeVisible()
  return mock
}

test.describe('Senses mode', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('a clicked street shows the wait, then the marker and the prediction', async ({ page }) => {
    const mock = await openSenses(page)
    mock.hold = true
    await openSegment(page, WITH_3.properties.id)
    await expect(page.locator('[data-senses="loading"]')).toHaveCount(1)
    await expect(page.locator('[data-panel="place-card"]')).toContainText('Asking the model')
    await expect.poll(() => mock.release !== null).toBe(true)
    mock.release()

    const card = page.locator('[data-panel="place-card"]')
    await expect(card).toContainText('4 · fairly comfortable')
    await expect(card).toContainText('Traffic, trams, crowds')
    await expect(card).not.toContainText('(hearing)') // the sense is the icon
    await expect(card.getByRole('img', { name: 'hearing' })).toBeVisible()
    await expect(card).toContainText('The trees give shade')
    await expect(card).toContainText('General prediction: not yet personal')
    await expect(card).toContainText('A prediction, not a reason.')
    await expect(page.getByTestId('senses-status')).toHaveText('google/gemini-3.1-flash-lite · 1.4 s · $0.0005')
    await expect(page.locator('body')).not.toContainText(/persona\b/i) // "personal" is the required label

    const marker = page.locator('[data-senses="ready"]')
    await expect(marker).toHaveText('4')
    expect(await marker.locator('.marker-pin').evaluate((el) => el.style.background)).toContain('--senses-high')

    const sent = mock.requests[0]
    expect(sent.method()).toBe('POST')
    expect(sent.url()).toContain(`pano_id=${WITH_3.properties.photos[0].pano_id}`)
    expect(sent.postDataBuffer().length).toBeGreaterThan(0)

    await mapIdle(page)
    expect(await layoutProblems(page)).toEqual([])
    await page.screenshot({ path: 'e2e/screens/senses-dark.png' })
  })

  test('markers stay when another street is clicked, and a street is not asked about twice', async ({ page }) => {
    const mock = await openSenses(page)
    await openSegment(page, WITH_3.properties.id)
    await expect(page.locator('[data-senses="ready"]')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await openSegment(page, OTHER.properties.id)
    await expect(page.locator('[data-senses="ready"]')).toHaveCount(2)
    await page.keyboard.press('Escape')
    await openSegment(page, WITH_3.properties.id)
    await expect(page.locator('[data-panel="place-card"]')).toContainText('4 · fairly comfortable')
    expect(mock.requests).toHaveLength(2)

    await page.getByRole('radio', { name: 'Thermal', exact: true }).first().click()
    await expect(page.locator('[data-senses]')).toHaveCount(0) // one layer at a time
  })

  test('an error is shown plainly, and Retry asks again', async ({ page }) => {
    const mock = await openSenses(page, 'light')
    mock.fail = true
    await openSegment(page, WITH_3.properties.id)
    const error = page.getByTestId('senses-error')
    await expect(error).toContainText('It said: "oops"')
    await expect(page.locator('[data-senses="error"]')).toHaveText('!')
    await page.screenshot({ path: 'e2e/screens/senses-error-light.png' })

    mock.fail = false
    await error.getByRole('button', { name: 'Retry' }).click()
    await expect(page.locator('[data-panel="place-card"]')).toContainText('4 · fairly comfortable')
    await expect(page.locator('[data-senses="ready"]')).toHaveCount(1)
    expect(mock.requests).toHaveLength(2)
  })

  test('the card fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openSenses(page)
    await openSegment(page, WITH_3.properties.id)
    await expect(page.locator('[data-panel="sheet"]')).toContainText('4 · fairly comfortable')
    await mapIdle(page)
    expect(await layoutProblems(page)).toEqual([])
    await page.screenshot({ path: 'e2e/screens/senses-phone.png' })
  })
})
