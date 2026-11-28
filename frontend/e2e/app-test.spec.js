import { expect, test } from '@playwright/test'
import { PHOTO, TEST_PROFILES, layoutProblems, markRatingMocked, mockSurvey, withSavedProfile } from './helpers.js'

// The in-app test (D197), offered right after the profile questions (Elena, 2026-11-28): the intro (consent box, Start
// once ticked, "Skip for now"), one screen per photo in the fixed order (the app's estimate, then your B1 in the survey's
// words, then whether the reasons were right), and the end; "Rate 3 places" in the account menu brings back the intro,
// and an unfinished test goes on at its next photo. The API is mocked: no model call, no Street View image (a plain
// square stands in for the photos), nothing sent anywhere. Screenshots go to e2e/screens/ (not committed).
const PHOTOS = [
  { order: 1, id: 'sv:AAAAAAAAAAAA', source: 'streetview', pano_id: 'AAAAAAAAAAAA', heading: 10, pitch: 7.5, name: 'One', date: '2026-04' },
  { order: 2, id: 'sv:BBBBBBBBBBBB', source: 'streetview', pano_id: 'BBBBBBBBBBBB', heading: 20, pitch: 7.5, name: 'Two', date: '2026-04' },
  { order: 3, id: 'sv:CCCCCCCCCCCC', source: 'streetview', pano_id: 'CCCCCCCCCCCC', heading: 30, pitch: 7.5, name: 'Three', date: '2026-04' },
]
const PROFILE = { language: 'en', answers: TEST_PROFILES[0].answers, text: 't', version: 'v1', saved: '2026-11-28T10:00:00Z', weather: {}, thermal: null, prepare: null }
const el = (code, en, icon) => ({ code, n: 1, en, it: en, icon_key: icon })

async function mockAppTest(page, { session = null } = {}) {
  const mock = { posts: [], session }
  markRatingMocked(page)
  await page.route('**/api/app-test', (route) => route.fulfill({ json: { photos: PHOTOS, info_sheet_url: 'https://example.org/sheet',
    approved: true, photo_set: 'abc', free_text_max: 500, session: mock.session } }))
  await page.route('**/api/app-test/*', async (route) => {
    const what = new URL(route.request().url()).pathname.split('/').pop()
    mock.posts.push({ what, body: route.request().postDataJSON() })
    if (what === 'finish') {
      const rated = mock.posts.filter((p) => p.what === 'answer' && p.body.rating != null).length
      return route.fulfill({ json: { session: { finished: true, answered: [], rated } } })
    }
    return route.fulfill({ json: what === 'start' ? { session: { finished: false, answered: [], rated: 0 } } : { saved: true } })
  })
  await page.route('**/api/senses/rate', async (route) => {
    const body = route.request().postDataJSON()
    const lines = body.photos.map((p, i) => (i === 2
      ? { type: 'photo', id: p.id, heading: p.heading, status: 'failed', error: 'x' }
      : { type: 'photo', id: p.id, heading: p.heading, status: 'ok', stamp: { listed: [], model: 'test', commit: 'ed963d2', prompt: 'p3' },
          result: { comfort: i === 0 ? 2 : 4, anchors: ['a', 'b'], bothers: [el('traffic_trams', 'Traffic, trams', 'hearing')],
            feels_good: [el('greenery_trees', 'Greenery, trees', 'sight')], reason: 'r', model: 'test', personal: true } }))
    await route.fulfill({ contentType: 'application/x-ndjson', body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' })
  })
  await page.route('**/api/photo/**', (route) => route.fulfill({ contentType: 'image/png', body: PHOTO }))
  return mock
}

/** The onboarding at its last question (Q4), every answer given, the consent agreed: one click saves a new profile. */
const atLastQuestion = (page) => page.addInitScript((answers) => {
  try {
    if (localStorage.getItem('sencity-profile')) return // only before the first save (the test reloads pages)
    localStorage.setItem('sencity-consent', JSON.stringify({ agreed: '2026-11-28T10:00:00Z' }))
    localStorage.setItem('sencity-profile-draft', JSON.stringify({ answers, weather: {}, step: 9, editing: false,
      prepare: { Q1: null, Q2: { ticked: [], other: '' }, Q3: null, Q4: { ticked: [], other: '' } } }))
  } catch {}
}, TEST_PROFILES[0].answers)

const choose = (page, value) => page.locator('[data-row="B1"] label').nth(value - 1).click()
const skipped = (page) => page.evaluate(() => localStorage.getItem('sencity-app-test-skipped'))

test.describe('the app test', () => {
  // Tall enough that the screenshots show a whole photo screen (it scrolls inside its panel on a shorter screen).
  test.use({ viewport: { width: 1440, height: 1500 } })

  test('right after a new profile comes the intro; Skip for now goes to the map and saves nothing', async ({ page }) => {
    const mock = await mockAppTest(page)
    await mockSurvey(page)
    await atLastQuestion(page)
    await page.goto('/profile')
    await page.getByRole('button', { name: 'Save your profile' }).click()
    await expect(page).toHaveURL(/\/app-test\?from=profile$/)
    const intro = page.getByTestId('app-test-consent')
    await expect(intro.getByRole('heading')).toHaveText('Next: rate 3 places')
    await expect(intro).toContainText('about 10 minutes')
    await expect(intro).toContainText('the app\'s estimate for you, then you give your own rating')
    await expect(page.getByTestId('app-test-box')).not.toBeChecked() // never pre-ticked
    await expect(page.getByTestId('app-test-start')).toBeDisabled() // Start only with consent
    await expect(page.getByRole('link', { name: 'Read the information sheet' })).toHaveAttribute('href', 'https://example.org/sheet')
    await expect(page.locator('body')).not.toContainText(/persona|IAAC/i)
    await page.screenshot({ path: 'e2e/screens/app-test-1-intro.png', fullPage: true })
    await page.getByTestId('app-test-skip').click()
    await expect(page).toHaveURL(/\/area$/)
    expect(mock.posts).toEqual([]) // nothing saved
    expect(await skipped(page)).toBeTruthy() // only this browser remembers the skip

    // The way back in: "Rate 3 places" in the account menu opens the same intro; starting now says so.
    await page.getByRole('button', { name: 'Your account' }).click()
    await expect(page.getByTestId('menu-app-test')).toHaveText(/Rate 3 places$/)
    await page.screenshot({ path: 'e2e/screens/app-test-0-menu.png' })
    await page.getByTestId('menu-app-test').click()
    await expect(page).toHaveURL(/\/app-test$/)
    await page.getByTestId('app-test-box').check()
    await page.getByTestId('app-test-start').click()
    await expect(page.getByTestId('app-test-place')).toHaveText('Place 1 of 3')
    expect(mock.posts[0]).toEqual({ what: 'start', body: { consent: true, entry: 'later', skipped_first: true } })
  })

  test('Start from the profile flow: each answer saved in the fixed order, the estimate first', async ({ page }) => {
    const mock = await mockAppTest(page)
    await withSavedProfile(page, PROFILE)
    await page.goto('/app-test?from=profile')
    await page.getByTestId('app-test-box').check()
    await expect(page.getByTestId('app-test-saving')).toContainText('will be saved')
    await page.getByTestId('app-test-start').click()
    await expect(page.getByTestId('app-test-place')).toHaveText('Place 1 of 3')
    expect(mock.posts).toEqual([{ what: 'start', body: { consent: true, entry: 'profile', skipped_first: false } }])

    // Photo 1: the estimate, then B1 in the survey's words, then the reasons question.
    const estimate = page.getByTestId('app-test-estimate')
    await expect(estimate).toContainText('Hard · 2 of 5')
    await expect(estimate).toContainText('Traffic, trams')
    await expect(estimate).toContainText('Greenery, trees')
    await expect(estimate).toContainText('A prediction, not a reason.')
    await expect(page.locator('.scenario')).toHaveText('Imagine walking through this place as it is in the photo, at that time of day and in the weather you see.')
    await expect(page.getByRole('heading', { name: 'How sensory-comfortable would you be walking through here?' })).toBeVisible()
    await expect(page.getByText('1 = Not at all, too much for my senses, 5 = Very much')).toBeVisible()
    await expect(page.getByTestId('app-test-reasons')).toHaveCount(0) // only after your rating
    await page.getByTestId('app-test-next').click()
    await expect(page.getByRole('alert')).toContainText('Please choose a rating')
    await page.screenshot({ path: 'e2e/screens/app-test-2-photo.png', fullPage: true })
    await choose(page, 4)
    await page.getByRole('radio', { name: 'Partly' }).check()
    await page.getByLabel('Anything to add? (optional)').fill('The trams are fine for me.')
    await page.screenshot({ path: 'e2e/screens/app-test-3-answered.png', fullPage: true })
    await page.getByTestId('app-test-next').click()

    // Photo 2: skipped (no rating). Photo 3: no estimate could be made, so no reasons question.
    await expect(page.getByTestId('app-test-place')).toHaveText('Place 2 of 3')
    await page.getByRole('button', { name: 'Skip this place' }).click()
    await expect(page.getByTestId('app-test-estimate')).toContainText('could not make an estimate')
    await choose(page, 2)
    await expect(page.getByTestId('app-test-reasons')).toHaveCount(0)
    await page.getByTestId('app-test-next').click()

    await expect(page.getByTestId('app-test-count')).toHaveText('You rated 2 places.')
    await expect(page.getByTestId('app-test-end')).toContainText('Your answers are saved.')
    await page.screenshot({ path: 'e2e/screens/app-test-4-end.png', fullPage: true })
    const answers = mock.posts.filter((p) => p.what === 'answer').map((p) => p.body)
    expect(answers.map((a) => [a.order, a.photo_id, a.rating, a.reasons_right])).toEqual([
      [1, PHOTOS[0].id, 4, 'partly'], [2, PHOTOS[1].id, null, null], [3, PHOTOS[2].id, 2, null]])
    expect(answers[0].free_text).toBe('The trams are fine for me.')
    expect(answers[0].estimate).toMatchObject({ comfort: 2, level: 'hard', bothers: ['traffic_trams'], feels_good: ['greenery_trees'] })
    expect(answers[2].estimate).toBe(null)
    expect(answers.every((a) => a.shown_at && a.answered_at)).toBe(true)
    expect(mock.posts.at(-1).what).toBe('finish')
  })

  test('someone who stopped halfway goes on at the next unrated photo; once done the entry is gone', async ({ page }) => {
    const mock = await mockAppTest(page, { session: { finished: false, answered: [PHOTOS[0].id], rated: 1 } })
    await withSavedProfile(page, PROFILE)
    await page.goto('/area')
    await page.getByRole('button', { name: 'Your account' }).click()
    await expect(page.getByTestId('menu-app-test')).toHaveText(/Rate 3 places \(1 done\)/)
    await page.getByTestId('menu-app-test').click()
    await expect(page.getByTestId('app-test-place')).toHaveText('Place 2 of 3') // no intro again, not the start
    await choose(page, 5)
    await page.getByTestId('app-test-next').click()
    await choose(page, 3)
    await page.getByTestId('app-test-next').click()
    await expect(page.getByTestId('app-test-end')).toBeVisible()
    expect(mock.posts.filter((p) => p.what === 'answer').map((p) => p.body.order)).toEqual([2, 3]) // photo 1 kept, not resent
    expect(mock.posts.some((p) => p.what === 'start')).toBe(false)
    mock.session = { finished: true, answered: PHOTOS.map((p) => p.id), rated: 3 }
    await page.goto('/area')
    await page.getByRole('button', { name: 'Your account' }).click()
    await expect(page.getByRole('dialog', { name: 'Your account' })).toBeVisible()
    await expect(page.getByTestId('menu-app-test')).toHaveCount(0)
  })

  test('fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockAppTest(page)
    await withSavedProfile(page, PROFILE)
    await page.goto('/app-test?from=profile')
    await expect(page.getByTestId('app-test-consent')).toBeVisible()
    await page.screenshot({ path: 'e2e/screens/app-test-phone-intro.png', fullPage: true })
    expect(await layoutProblems(page)).toEqual([])
    await page.getByTestId('app-test-box').check()
    await page.getByTestId('app-test-start').click()
    await choose(page, 4)
    await expect(page.getByTestId('app-test-reasons')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    expect(await layoutProblems(page)).toEqual([])
  })
})
