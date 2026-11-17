// The printable report (boards 8, 8b; brief §7), with the API mocked. Three cases: a full report (profile, area,
// route, place), the profile only, and no profile. Each is printed to PDF by Chromium to count the A4 pages, and the
// pages are photographed in both app themes.
import { expect, test } from '@playwright/test'
import { WITH_3, analyseCentre, chooseLayer, markRatingMocked, mockArea, mockRoutes, mockSurvey, openMap, openSegment, routeClicks, withSavedProfile, TEST_PROFILES } from './helpers.js'

const DEV = TEST_PROFILES[0]
const PROFILE = { language: 'en', answers: DEV.answers, text: DEV.expected, version: '386e888b8867', saved: '2026-11-15T10:00:00Z', weather: { hot: 2, cold: 2 }, thermal: null }
const el = (code, n, en, icon_key) => ({ code, n, en, it: en, icon_key, also: [] })
const NOT_SAID = [/\bpersonas?\b/i, /IAAC/, /institute/i, /universit/i]

function mockRatings(page) {
  markRatingMocked(page)
  return page.route('**/api/senses/rate', async (route) => {
    const body = route.request().postDataJSON()
    const lines = [{ type: 'start', model: 'test', cached: 0, to_rate: body.photos.length, remaining: 0 },
      ...body.photos.map((p, i) => ({ type: 'photo', ...p, status: 'ok', cached: false, cost_usd: 0,
        result: { comfort: [5, 3, 2][i % 3], anchors: ['not at all', 'very much'], bothers: [el('traffic_trams', 5, 'Traffic, trams', 'hearing')],
          feels_good: [el('trees', 12, 'Trees, plants', 'sight')], listed: ['traffic_trams'], reason: 'r', model: 'test', latency_ms: 1, cost_usd: 0, cached: false, personal: true } })),
      { type: 'done', seconds: 1, failed: 0, remaining: 0, estimate_usd: 0 }]
    await route.fulfill({ contentType: 'application/x-ndjson', body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' })
  })
}

const report = (page) => page.getByRole('dialog', { name: 'Report preview' })
async function openReport(page) {
  await page.getByRole('button', { name: 'Print report' }).click()
  await expect(report(page)).toBeVisible()
  await expect(page.getByTestId('report-print')).toHaveAttribute('aria-disabled', 'false', { timeout: 40_000 }) // the maps are drawn
}
/** Print to PDF as Chrome would (A4 from the page's own @page, its backgrounds) and count the sheets: page n exists and
 *  page n + 1 does not (the PDF's own page tree is compressed, so it is not read here). The file is kept for a look. */
async function pdfPages(page, name) {
  const opts = { preferCSSPageSize: true, printBackground: true }
  await page.pdf({ ...opts, path: `e2e/screens/report/${name}.pdf` })
  let n = 0
  while (n < 6) {
    try { await page.pdf({ ...opts, pageRanges: String(n + 1) }) } catch { break }
    n++
  }
  return n
}
/** Each page as it prints (print media: no toolbar, no app), one picture per sheet. */
async function shoot(page, name) {
  const size = page.viewportSize()
  await page.setViewportSize({ width: 900, height: 1200 })
  await page.emulateMedia({ media: 'print' })
  const pages = report(page).locator('.page')
  for (let i = 0; i < await pages.count(); i++) await pages.nth(i).screenshot({ path: `e2e/screens/report/${name}-p${i + 1}.png` })
  await page.emulateMedia({ media: null }) // back to the browser's own: a forced 'screen' would also print as screen
  await page.setViewportSize(size)
}
/** Nothing inside a page spills over its edge (no cut-off content). */
const overflowing = (page) => page.evaluate(() => [...document.querySelectorAll('[data-report] .page')].flatMap((pg, i) => {
  const box = pg.getBoundingClientRect()
  const foot = pg.querySelector('.foot').getBoundingClientRect()
  const body = pg.querySelector('.body')
  return body.scrollHeight > body.clientHeight + 1 || foot.bottom > box.bottom + 1 ? [`page ${i + 1}`] : []
}))

test.describe('the printable report', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test.describe.configure({ timeout: 150_000 })

  for (const theme of ['dark', 'light']) {
    test(`full: profile, area, route and the place on its card, on 2 A4 pages (${theme})`, async ({ page }) => {
      await withSavedProfile(page, PROFILE)
      await mockSurvey(page)
      await mockArea(page, { thermal: true })
      await mockRatings(page)
      await mockRoutes(page)
      await openMap(page, theme, { layer: null })

      // The routes first, then the area with a street open on its card.
      await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Routes' }).click()
      await chooseLayer(page, 'overall', 'routes')
      const { a, b } = routeClicks(page.viewportSize())
      await page.mouse.click(a.x, a.y)
      await page.mouse.click(b.x, b.y)
      await page.getByRole('button', { name: 'Analyse the routes' }).click()
      await expect(page.locator('[data-panel="route-card"]')).toContainText('Which way feels better?', { timeout: 20_000 })
      await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Area' }).click()
      await chooseLayer(page, 'overall')
      await analyseCentre(page)
      await expect(page.locator('[data-panel="area-card"]').getByTestId('area-bar')).toBeVisible({ timeout: 20_000 })
      await openSegment(page, WITH_3.properties.id)
      const cardImg = page.locator('[data-panel="place-card"] .photo img')
      await expect(cardImg).toBeVisible()
      await expect.poll(() => cardImg.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true)

      await openReport(page)
      const r = report(page)
      await expect(r.locator('.page')).toHaveCount(2)
      await expect(r.getByRole('heading', { name: 'Your SenCity report' })).toBeVisible()
      await expect(r.getByTestId('report-in-short')).toContainText(/streets may feel easy for you and \d+ hard/)
      await expect(r.getByTestId('report-radar')).toBeVisible()
      await expect(r.getByTestId('report-words')).toBeVisible()
      await expect(r.getByTestId('report-comfort')).toContainText('Comfortable for you: about 10.5 to 24.5 °C')
      await expect(r.getByTestId('report-area-map').locator('img')).toBeVisible()
      await expect(r.getByTestId('report-area-counts')).toContainText('easy')
      await expect(r.getByTestId('report-area-key')).toHaveText('Overall comfort · summer, 15:00') // what the map and the counts show
      await expect(r.locator('[data-section="area"]')).toContainText('Streets by overall comfort')
      await expect(r.getByTestId('report-route-map').locator('img')).toBeVisible()
      await expect(r.getByTestId('report-routes').locator('li')).toHaveCount(2)
      await expect(r.getByTestId('report-photo')).toBeVisible()
      await expect(r.locator('[data-section="place"]')).toContainText('Personal prediction: from your sensory profile')
      await expect(r.locator('.page').nth(0)).toContainText('Page 1 of 2')
      await expect(r.locator('.page').nth(1)).toContainText('SenCity gives a prediction, not advice. Check the place yourself.')
      // The boards' order: profile and area on page 1; route, place and how it was made on page 2.
      expect(await r.locator('.page').nth(0).locator('[data-section]').evaluateAll((s) => s.map((x) => x.dataset.section))).toEqual(['inShort', 'profile', 'area'])
      expect(await r.locator('.page').nth(1).locator('[data-section]').evaluateAll((s) => s.map((x) => x.dataset.section))).toEqual(['route', 'place', 'made'])
      const text = await r.innerText()
      for (const re of NOT_SAID) expect(text).not.toMatch(re)
      expect(await overflowing(page)).toEqual([])
      await shoot(page, `full-${theme}`)
      expect(await pdfPages(page, `full-${theme}`)).toBe(2)
    })
  }

  test('profile only: one page (light); Esc closes and focus goes back to the print icon', async ({ page }) => {
    await withSavedProfile(page, PROFILE)
    await mockSurvey(page)
    await openMap(page, 'light', { layer: null })
    const icon = page.getByRole('button', { name: 'Print report' })
    await icon.focus()
    await page.keyboard.press('Enter')
    await expect(report(page)).toBeVisible()
    await expect(report(page).getByRole('heading', { name: 'Report preview' })).toBeFocused()
    await expect(report(page).locator('.page')).toHaveCount(1)
    await expect(report(page).getByTestId('report-radar')).toBeVisible()
    await expect(report(page).locator('[data-section]')).toHaveCount(2) // profile, how this was made
    await expect(report(page).getByTestId('report-in-short')).toHaveCount(0)
    expect(await overflowing(page)).toEqual([])
    await shoot(page, 'profile-only-light')
    expect(await pdfPages(page, 'profile-only-light')).toBe(1)
    // Tab stays in the report.
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.activeElement.closest('[data-report]'))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(report(page)).toHaveCount(0)
    await expect(icon).toBeFocused()
  })

  test('no profile: the note, then the area on general results; the place without its photo says so', async ({ page }) => {
    await mockArea(page, { thermal: true })
    await openMap(page, 'dark')
    await analyseCentre(page)
    await expect(page.locator('[data-panel="area-card"]').getByTestId('area-bar')).toBeVisible({ timeout: 20_000 })
    await openSegment(page, WITH_3.properties.id)
    await expect(page.locator('[data-panel="place-card"]')).toBeVisible()
    // The card's photo is not loaded (blocked here): the report never fetches it again.
    await page.locator('[data-panel="place-card"] .photo img').evaluate((img) => img.removeAttribute('src'))
    await openReport(page)
    const r = report(page)
    await expect(r.locator('[data-section="noProfile"]')).toContainText('No personal profile: results are general.')
    await expect(r.getByTestId('report-radar')).toHaveCount(0)
    await expect(r.getByTestId('report-in-short')).not.toContainText('for you')
    await expect(r.getByTestId('report-photo-empty')).toHaveText('Photo not available')
    await expect(r.locator('[data-section="place"] figcaption')).toContainText('CC BY-SA 4.0')
    expect(await overflowing(page)).toEqual([])
    await shoot(page, 'no-profile-dark')
    const n = await r.locator('.page').count()
    expect(await pdfPages(page, 'no-profile-dark')).toBe(n)
  })
})

test.describe('the report on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('from the account menu; the A4 pages scroll sideways inside the preview, not the app', async ({ page }) => {
    await withSavedProfile(page, PROFILE)
    await mockSurvey(page)
    await openMap(page, 'dark', { layer: null })
    await page.getByRole('button', { name: 'Your account' }).click()
    await page.getByRole('button', { name: 'Print report' }).click()
    await expect(report(page)).toBeVisible()
    await expect(report(page).locator('.page')).toHaveCount(1)
    await page.screenshot({ path: 'e2e/screens/report/phone-dark.png' })
  })
})
