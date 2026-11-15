import { expect, test } from '@playwright/test'
import {
  TEST_PROFILES, analyseCentre, layoutProblems, markRatingMocked, mockArea, mockSurvey, openMap, withSavedProfile,
} from './helpers.js'

// Your sensory profile: the onboarding (boards 4, P4), the profile (5, 5b, 5c), storage on this device, and the switch
// between general (V0) and personal (V2) ratings. The API is mocked; nothing is sent anywhere.
const DEV = TEST_PROFILES[0]
const DEV_VERSION = '386e888b8867' // the server's version of DEV.expected (backend/tests/test_profile.py)
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('sencity-profile') ?? 'null'))
const draft = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('sencity-profile-draft') ?? 'null'))

async function openProfile(page, theme = 'dark') {
  await mockSurvey(page)
  await openMap(page, theme, { layer: null })
  await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Profile' }).click()
  await expect(page).toHaveURL(/\/profile$/)
}

/** Answer one 1–5 row by clicking its box. */
const choose = (page, row, value) => page.locator(`[data-row="${row}"] label`).nth(value - 1).click()

async function answerGrid(page, grid, answers) {
  for (const [code, v] of Object.entries(answers)) await choose(page, `${grid}-${code}`, v)
}

function mockRating(page) {
  const bodies = []
  markRatingMocked(page)
  return page.route('**/api/senses/rate', async (route) => {
    const body = route.request().postDataJSON()
    bodies.push(body)
    const lines = [{ type: 'start', model: 'test', cached: 0, to_rate: body.photos.length, remaining: 0, personal: !!body.profile },
      ...body.photos.map((p) => ({ type: 'photo', ...p, status: 'ok', cached: false, cost_usd: 0.0005,
        result: { comfort: body.profile ? 2 : 4, anchors: ['not at all', 'very much'], bothers: [], feels_good: [], listed: [],
          reason: 'r', model: 'test', latency_ms: 1, cost_usd: 0.0005, cached: false, personal: !!body.profile } })),
      { type: 'done', seconds: 1, failed: 0, remaining: 0, estimate_usd: 0 }]
    await route.fulfill({ contentType: 'application/x-ndjson', body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' })
  }).then(() => bodies)
}

test.describe('your sensory profile', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the onboarding builds the study\'s text word for word, keeps answers when you leave halfway, and saves on this device', async ({ page }) => {
    await openProfile(page)
    // 5b: no profile yet.
    const empty = page.locator('[data-panel="profile-empty"]')
    await expect(empty).toContainText('You don\'t have a profile yet')
    await expect(empty).toContainText('Until then, the map shows general ratings, not personalised for you.')
    await page.screenshot({ path: 'e2e/screens/profile-empty-dark.png' })
    await empty.getByRole('button', { name: 'Create your profile' }).click()

    const ob = page.locator('[data-panel="onboarding"]')
    await expect(ob.getByTestId('onboarding-step')).toHaveText('Step 1 of 5')
    await expect(ob).toContainText('Think of all eight senses') // part_a.json intro, word for word
    await expect(page.getByRole('navigation', { name: 'Views' })).toHaveCount(0) // full screen
    await ob.getByRole('button', { name: 'Next' }).click()

    // A11: required.
    await expect(ob.getByTestId('onboarding-step')).toHaveText('Step 2 of 5')
    await expect(ob.getByRole('heading', { level: 2 })).toHaveText('In general, how sensory-comfortable do you feel spending time in outdoor public spaces?')
    await ob.getByRole('button', { name: 'Next' }).click()
    await expect(ob.getByRole('alert')).toHaveText('Please choose an answer to go on.')
    await choose(page, 'A11', DEV.answers.A11)
    await ob.getByRole('button', { name: 'Next' }).click()

    // A12: 10 rows with their sense icons; every row required. Leave halfway: the answers are kept.
    await expect(ob.getByTestId('onboarding-step')).toHaveText('Step 3 of 5')
    await expect(ob.locator('fieldset')).toHaveCount(10)
    await expect(ob.locator('fieldset .sense-icon')).toHaveCount(10)
    await expect(ob.locator('fieldset').first()).toContainText('Greenery, trees')
    const half = Object.fromEntries(Object.entries(DEV.answers.A12).slice(0, 5))
    await answerGrid(page, 'A12', half)
    await expect(ob).toContainText('5 of 10 answered')
    await ob.getByRole('button', { name: 'Next' }).click()
    await expect(ob.getByRole('alert')).toHaveText('Please answer every row to go on.')
    await expect(page.locator('[data-row="A12-plants_flowers"] input').first()).toBeFocused() // the first one missing
    await page.screenshot({ path: 'e2e/screens/profile-onboarding-dark.png' })
    await ob.getByRole('button', { name: 'Skip for now' }).click()
    await expect(page).toHaveURL(/\/area$/)
    expect((await draft(page)).answers.A12).toEqual(half)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-map-ready', 'true', { timeout: 30_000 })
    await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Profile' }).click()
    await expect(ob.getByTestId('onboarding-step')).toHaveText('Step 3 of 5') // back where you left
    await expect(ob).toContainText('5 of 10 answered')
    await answerGrid(page, 'A12', DEV.answers.A12)
    await ob.getByRole('button', { name: 'Next' }).click()

    await expect(ob.getByTestId('onboarding-step')).toHaveText('Step 4 of 5')
    await answerGrid(page, 'A13', DEV.answers.A13)
    await ob.getByRole('button', { name: 'Back' }).click()
    await expect(ob).toContainText('10 of 10 answered')
    await ob.getByRole('button', { name: 'Next' }).click()
    await ob.getByRole('button', { name: 'Next' }).click()

    // A16: optional.
    await expect(ob.getByTestId('onboarding-step')).toHaveText('Step 5 of 5')
    await ob.getByRole('textbox', { name: 'Is there anything else in public spaces that pleases or bothers your senses? (optional)' }).fill(DEV.answers.A16)
    await ob.getByRole('button', { name: 'Save your profile' }).click()

    // 5: the profile. Its text is the study's, word for word; the version is the server's.
    const summary = page.locator('[data-panel="profile-summary"]')
    await expect(summary.getByRole('heading', { name: 'This is how you sense the city' })).toBeFocused()
    await summary.getByText('Your sensory profile, as the model reads it').click()
    expect(await summary.getByTestId('profile-text').textContent()).toBe(DEV.expected)
    const stored = await saved(page)
    expect(stored.text).toBe(DEV.expected)
    expect(stored.version).toBe(DEV_VERSION)
    expect(stored.answers).toEqual(DEV.answers)
    expect(await draft(page)).toBe(null)
    expect((await page.locator('body').innerText()).toLowerCase()).not.toContain('persona')
    await expect(summary.getByTestId('answer-traffic_trams')).toContainText('1 · very unpleasant')
    await page.screenshot({ path: 'e2e/screens/profile-summary-dark.png' })
  })

  test('editing an answer builds the profile again; download, delete and import', async ({ page }) => {
    await withSavedProfile(page, { language: 'en', answers: DEV.answers, text: DEV.expected, version: DEV_VERSION, saved: '2026-11-15T10:00:00Z' })
    await openProfile(page)
    const summary = page.locator('[data-panel="profile-summary"]')
    await expect(summary.getByTestId('answer-A11')).toContainText('2')

    // Edit one answer: the onboarding opens at that question, with Cancel and Save changes.
    await summary.getByRole('button', { name: /^Edit: In general/ }).click()
    const ob = page.locator('[data-panel="onboarding"]')
    await expect(ob.getByTestId('onboarding-step')).toHaveText('Step 2 of 5')
    await expect(page.locator('[data-row="A11"] input[value="2"]')).toBeChecked()
    await choose(page, 'A11', 4)
    await ob.getByRole('button', { name: 'Save changes' }).click()
    await expect(summary.getByTestId('answer-A11')).toContainText('4')
    const edited = await saved(page)
    expect(edited.text).toBe(DEV.expected.replace('(1 = not at all … 5 = very much): 2.', '(1 = not at all … 5 = very much): 4.'))
    expect(edited.version).not.toBe(DEV_VERSION)

    // Cancel an edit: nothing changes.
    await summary.getByRole('button', { name: 'Edit answers' }).click()
    await choose(page, 'A11', 1)
    await ob.getByRole('button', { name: 'Cancel' }).click()
    expect((await saved(page)).answers.A11).toBe(4)

    // Download my data: the answers and the text, as JSON.
    const [download] = await Promise.all([page.waitForEvent('download'), summary.getByRole('button', { name: 'Download my data' }).click()])
    expect(download.suggestedFilename()).toBe('sencity-profile.json')
    const file = await download.path()

    // Delete (5c): an alert dialog, focus on Cancel; Esc closes it; Delete everything clears this device.
    await summary.getByRole('button', { name: 'Delete my profile' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Delete your profile?' })
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.screenshot({ path: 'e2e/screens/profile-delete-dark.png' })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(summary.getByRole('button', { name: 'Delete my profile' })).toBeFocused()
    await summary.getByRole('button', { name: 'Delete my profile' }).click()
    await dialog.getByRole('button', { name: 'Delete everything' }).click()
    await expect(page.locator('[data-panel="profile-empty"]')).toBeVisible()
    expect(await page.evaluate(() => [localStorage.getItem('sencity-profile'), localStorage.getItem('sencity-profile-draft')])).toEqual([null, null])

    // Import the file again: the profile is back, its text built again from the answers.
    await page.locator('input[type="file"]').setInputFiles(file)
    await expect(summary.getByTestId('answer-A11')).toContainText('4')
    expect((await saved(page)).text).toBe(edited.text)

    // A file that is not a profile is refused.
    await page.locator('input[type="file"]').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"kind":"other"}') })
    await expect(summary.getByRole('alert')).toHaveText('This is not a SenCity profile file.')
  })

  test('the made-up test profile loads in dev mode', async ({ page }) => {
    await openProfile(page)
    await page.getByRole('button', { name: 'Load the test profile (dev only)' }).click()
    await expect(page.locator('[data-panel="profile-summary"]')).toBeVisible()
    expect((await saved(page)).version).toBe(DEV_VERSION)
  })

  test('ratings: general without a profile, with the shortcut; personal with it, rated again when the profile changes', async ({ page }) => {
    await mockArea(page)
    const bodies = await mockRating(page)
    await mockSurvey(page)
    await openMap(page, 'dark', { layer: null })
    await analyseCentre(page)
    const foot = page.getByTestId('senses-foot')
    await expect(foot).toContainText('General prediction: not personalised yet')
    await expect(foot.getByTestId('not-personalised')).toContainText('Ratings for a general visitor.')
    expect(bodies[0].profile).toBeUndefined() // V0: nothing about you is sent

    // Load a profile (dev): what is open is rated again, with your answers and language in the request (not the text).
    await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Profile' }).click()
    await page.getByRole('button', { name: 'Load the test profile (dev only)' }).click()
    await expect(page.locator('[data-panel="profile-summary"]')).toBeVisible()
    await expect.poll(() => bodies.length).toBe(2)
    expect(bodies[1].profile).toEqual({ language: 'en', ...DEV.answers })
    expect(JSON.stringify(bodies[1])).not.toContain('How you experience public spaces')
    await page.getByRole('button', { name: 'Go to map' }).click()
    await expect(foot).toContainText('Personal prediction: from your sensory profile')
    await expect(foot.getByTestId('not-personalised')).toHaveCount(0)

    // Delete it: general again, rated again without it.
    await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Profile' }).click()
    await page.getByRole('button', { name: 'Delete my profile' }).click()
    await page.getByRole('button', { name: 'Delete everything' }).click()
    await expect.poll(() => bodies.length).toBe(3)
    expect(bodies[2].profile).toBeUndefined()
    await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Area' }).click()
    await expect(foot).toContainText('General prediction: not personalised yet')

    // The shortcut opens the onboarding.
    await foot.getByRole('button', { name: 'Create your profile' }).click()
    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.locator('[data-panel="onboarding"]').getByTestId('onboarding-step')).toHaveText('Step 1 of 5')
  })
})

test.describe('your sensory profile on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the onboarding fits, one row of five boxes per element', async ({ page }) => {
    await mockSurvey(page)
    await openMap(page, 'dark', { layer: null })
    await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Profile' }).click()
    await page.getByRole('button', { name: 'Create your profile' }).click()
    await page.getByRole('button', { name: 'Next' }).click()
    await choose(page, 'A11', 3)
    await page.getByRole('button', { name: 'Next' }).click()
    await choose(page, 'A12-greenery_trees', 5)
    expect(await layoutProblems(page)).toEqual([])
    const boxes = await page.locator('[data-row="A12-greenery_trees"] label').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top))
    expect(new Set(boxes.map(Math.round)).size).toBe(1)
    await page.screenshot({ path: 'e2e/screens/profile-onboarding-phone-dark.png' })
  })
})
