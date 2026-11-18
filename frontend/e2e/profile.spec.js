import { expect, test } from '@playwright/test'
import {
  SURVEY, TEST_PROFILES, analyseCentre, layoutProblems, markRatingMocked, mockArea, mockSurvey, openMap, withSavedProfile,
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
    const personal = !!body.profile
    const stamp = { listed: ['shade'], model: 'test', commit: 'ed963d2' }
    const lines = [{ type: 'start', model: 'test', cached: 0, to_rate: body.photos.length, remaining: 0, personal },
      ...body.photos.map((p) => (personal && p.cached
        ? { type: 'photo', id: p.id, heading: p.heading, status: 'keep', cached: true } // the browser's own rating holds
        : { type: 'photo', id: p.id, heading: p.heading, status: 'ok', cached: false, cost_usd: 0.0005,
            ...(personal ? { stamp } : {}),
            result: { comfort: personal ? 2 : 4, anchors: ['not at all', 'very much'], bothers: [], feels_good: [], listed: ['shade'],
              reason: 'r', model: 'test', latency_ms: 1, cost_usd: 0.0005, cached: false, personal } })),
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

    // "Before you start" (board 3, Elena's text): the box unticked, Agree and start only once it is ticked.
    const consent = page.locator('[data-panel="consent"]')
    await expect(consent.getByRole('heading', { name: 'Before you start' })).toBeFocused()
    await expect(consent).toContainText('20 visible elements, about 5 minutes. No health questions.')
    await expect(consent).toContainText('nothing is saved on a server')
    await expect(consent).toContainText('an AI model in the EU, used only for that rating, and not kept by the provider')
    await expect(consent.getByTestId('consent-box')).not.toBeChecked()
    await expect(consent.getByRole('button', { name: 'Agree and start' })).toBeDisabled()
    await expect(page.getByRole('navigation', { name: 'Views' })).toHaveCount(0) // full screen
    await page.screenshot({ path: 'e2e/screens/profile-consent-dark.png' })
    // Not now: back to the map, nothing kept; the next start asks again.
    await consent.getByRole('button', { name: 'Not now' }).click()
    await expect(page).toHaveURL(/\/area$/)
    expect(await draft(page)).toBe(null)
    expect(await page.evaluate(() => localStorage.getItem('sencity-consent'))).toBe(null)
    await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Profile' }).click()
    await empty.getByRole('button', { name: 'Create your profile' }).click()
    await consent.getByText('I have read this and agree').click()
    await consent.getByRole('button', { name: 'Agree and start' }).click()
    expect((await page.evaluate(() => JSON.parse(localStorage.getItem('sencity-consent')))).agreed).toBeTruthy()

    const ob = page.locator('[data-panel="onboarding"]')
    await expect(ob.getByTestId('onboarding-step')).toHaveText('Step 1 of 6')
    await expect(ob).toContainText('Think of all eight senses') // part_a.json intro, word for word
    await expect(page.getByRole('navigation', { name: 'Views' })).toHaveCount(0) // full screen
    await ob.getByRole('button', { name: 'Next' }).click()

    // A11: required.
    await expect(ob.getByTestId('onboarding-step')).toHaveText('Step 2 of 6')
    await expect(ob.getByRole('heading', { level: 2 })).toHaveText('In general, how sensory-comfortable do you feel spending time in outdoor public spaces?')
    await ob.getByRole('button', { name: 'Next' }).click()
    await expect(ob.getByRole('alert')).toHaveText('Please choose an answer to go on.')
    await choose(page, 'A11', DEV.answers.A11)
    await ob.getByRole('button', { name: 'Next' }).click()

    // A12: 10 rows with their sense icons; every row required. Leave halfway: the answers are kept.
    await expect(ob.getByTestId('onboarding-step')).toHaveText('Step 3 of 6')
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
    await expect(ob.getByTestId('onboarding-step')).toHaveText('Step 3 of 6') // back where you left
    await expect(ob).toContainText('5 of 10 answered')
    await answerGrid(page, 'A12', DEV.answers.A12)
    await ob.getByRole('button', { name: 'Next' }).click()

    await expect(ob.getByTestId('onboarding-step')).toHaveText('Step 4 of 6')
    await answerGrid(page, 'A13', DEV.answers.A13)
    await ob.getByRole('button', { name: 'Back' }).click()
    await expect(ob).toContainText('10 of 10 answered')
    await ob.getByRole('button', { name: 'Next' }).click()
    await ob.getByRole('button', { name: 'Next' }).click()

    // A16: optional.
    await expect(ob.getByTestId('onboarding-step')).toHaveText('Step 5 of 6')
    await ob.getByRole('textbox', { name: 'Is there anything else in public spaces that pleases or bothers your senses? (optional)' }).fill(DEV.answers.A16)
    await ob.getByRole('button', { name: 'Next' }).click()

    // Weather (Elena, 2026-11-15): hot, cold and windy weather on the Part A scale; local only.
    await expect(ob.getByTestId('onboarding-step')).toHaveText('Step 6 of 6')
    await expect(ob.getByRole('heading', { level: 2 })).toHaveText('Outdoors, how pleasant or unpleasant is this weather for you?')
    await expect(ob.locator('fieldset')).toHaveCount(3)
    // The progress bar: six segments on one line.
    expect(new Set(await ob.locator('.progress .seg').evaluateAll((s) => s.map((e) => Math.round(e.getBoundingClientRect().top)))).size).toBe(1)
    await expect(ob).toContainText('It is not sent to the model.')
    await choose(page, 'weather-hot', 1)
    await choose(page, 'weather-cold', 3)
    await choose(page, 'weather-wind', 2)
    await page.screenshot({ path: 'e2e/screens/profile-weather-dark.png' })
    await ob.getByRole('button', { name: 'Save your profile' }).click()

    // 5: the profile. Its text is the study's, word for word; the version is the server's.
    const summary = page.locator('[data-panel="profile-summary"]')
    await expect(summary.getByRole('heading', { name: 'This is how you sense the city' })).toBeFocused()
    await expect(summary.getByText('Your sensory profile, as the model reads it')).toHaveCount(0) // not shown (Elena, 2026-11-15)
    const stored = await saved(page)
    expect(stored.text).toBe(DEV.expected)
    expect(stored.version).toBe(DEV_VERSION)
    expect(stored.answers).toEqual(DEV.answers)
    // The weather answers are kept with the profile, apart from the answers: the text and the version are unchanged.
    expect(stored.weather).toEqual({ hot: 1, cold: 3, wind: 2 })
    expect(stored.text).not.toContain('weather')
    expect(await draft(page)).toBe(null)

    // "Temperature that feels comfortable to you", under the overall comfort: hot 1 moves the heat limits down 3 °C.
    const tc = summary.getByTestId('thermal-comfort')
    expect(await summary.getByTestId('overall-comfort').evaluate((el) => el.compareDocumentPosition(document.querySelector('[data-testid="thermal-comfort"]')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy()
    await expect(tc.getByTestId('thermal-summary')).toHaveText('Comfortable for you: about 9 to 23 °C (feels like). Standard: 9 to 26 °C.')
    // "Standard: 9 to 26 °C." on its own line, under the person's range.
    const [mineLine, stdLine] = await Promise.all([tc.getByTestId('thermal-summary').locator('span').first().boundingBox(), tc.getByTestId('thermal-summary').locator('.standard').boundingBox()])
    expect(stdLine.y).toBeGreaterThan(mineLine.y + mineLine.height - 1)
    await expect(tc.locator('[data-tick]')).toHaveCount(4)
    const hot = tc.locator('[data-handle="heat"]')
    await expect(hot).toHaveAttribute('aria-valuenow', '23')
    // Reset is always there; it works once a limit was moved by hand.
    await expect(tc.getByRole('button', { name: 'Reset' })).toBeDisabled()
    const size = await hot.boundingBox()
    expect(size.width).toBeGreaterThanOrEqual(44)
    expect(size.height).toBeGreaterThanOrEqual(44)
    // Keyboard: 0.5 °C a press. Reset goes back to the answers.
    await hot.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(tc.getByTestId('thermal-summary')).toContainText('about 9 to 24 °C')
    expect((await saved(page)).thermal).toEqual({ heat: 24 })
    // No standard ticks on the bar (Elena, 2026-11-15): only the person's four limits.
    await expect(tc.locator('.tick.standard')).toHaveCount(0)
    // The start of hot stops at 39 °C, so its hard limit (+6) stays on the bar's end, 45 °C.
    await expect(hot).toHaveAttribute('aria-valuemax', '39')
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight')
    await expect(hot).toHaveAttribute('aria-valuenow', '39')
    const [lastTick, trackBox] = await Promise.all([tc.locator('[data-tick]').last().boundingBox(), tc.locator('.track').boundingBox()])
    expect(lastTick.x + lastTick.width / 2).toBeLessThanOrEqual(trackBox.x + trackBox.width + 1)
    await page.keyboard.press('Tab')
    for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowLeft') // nothing focused: nothing moves
    expect((await saved(page)).text).toBe(DEV.expected) // never in the profile text
    await tc.getByRole('button', { name: 'Reset' }).click()
    await expect(tc.getByTestId('thermal-summary')).toContainText('about 9 to 23 °C')
    expect((await saved(page)).thermal).toBe(null)
    await expect(tc.getByRole('button', { name: 'Reset' })).toBeVisible()
    await expect(tc.getByRole('button', { name: 'Reset' })).toBeDisabled()
    // Dragging the start of cold.
    const track = await tc.locator('.track').boundingBox()
    const cold = tc.locator('[data-handle="cold"]')
    const c = await cold.boundingBox()
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2)
    await page.mouse.down()
    await page.mouse.move(track.x + track.width * (14 + 10) / 55, c.y + c.height / 2, { steps: 5 }) // 14 °C
    await page.mouse.up()
    await expect(cold).toHaveAttribute('aria-valuenow', '14')
    await expect(cold).toHaveAttribute('aria-valuemin', '-1') // its hard limit (−9) stays on the bar's end, −10 °C
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2)
    const c2 = await cold.boundingBox()
    await page.mouse.move(c2.x + c2.width / 2, c2.y + c2.height / 2)
    await page.mouse.down()
    await page.mouse.move(track.x - 40, c.y + c.height / 2, { steps: 5 }) // past the cold end
    await page.screenshot({ path: 'e2e/screens/profile-thermal-dark.png' }) // while dragging: no standard ticks
    await page.mouse.up()
    await expect(cold).toHaveAttribute('aria-valuenow', '-1')
    // The ends under the snowflake and the sun (Elena, 2026-11-15); a border on the end is not written again.
    await expect(tc.locator('[data-end="cold"]')).toHaveText('−10')
    await expect(tc.locator('[data-end="hot"]')).toHaveText('45 °C')
    expect(await tc.locator('.bar-ticks span', { hasText: /^−10$/ }).count()).toBe(0)
    const [flake, coldEnd] = await Promise.all([tc.locator('.end').first().boundingBox(), tc.locator('[data-end="cold"]').boundingBox()])
    expect(Math.abs((flake.x + flake.width / 2) - (coldEnd.x + coldEnd.width / 2))).toBeLessThan(2)
    await tc.getByRole('button', { name: 'Reset' }).click()
    expect((await page.locator('body').innerText()).toLowerCase()).not.toContain('persona')
    // Overall sensory comfort (A11) as the comfort bar, in the right card; the answers fold, closed at first.
    await expect(summary.locator('aside .top li').first()).toHaveText(/Traffic, trams\s*1 · very unpleasant/) // the answers' words
    await expect(summary.getByTestId('overall-comfort')).toContainText('2 of 5')
    // At the top of the right card, above "In your words" (Elena, 2026-11-15).
    const side = summary.locator('aside')
    await expect(side.getByTestId('overall-comfort')).toBeVisible()
    expect(await side.getByTestId('overall-comfort').evaluate((el) => el.compareDocumentPosition(document.querySelector('[data-testid="answer-A16"]')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy()
    await expect(summary.getByTestId('answer-traffic_trams')).toBeHidden()
    const chev = summary.getByTestId('answers').locator('summary .chev')
    await expect(chev).toBeVisible()
    await summary.getByText('Your answers, element by element').click()
    await expect(summary.getByTestId('answer-traffic_trams')).toContainText('1 · very unpleasant')
    await expect(chev).toHaveCSS('transform', /matrix\(-1/) // the chevron turns up when open
    // The radar (board 5; Elena, 2026-11-15): eight senses in the onboarding order, 1–5, from the stored answers only.
    // Tapping a sense lists its elements with their answers.
    const radar = summary.getByTestId('profile-radar')
    expect(await radar.locator('button[data-sense]').evaluateAll((b) => b.map((x) => x.dataset.sense)))
      .toEqual(['sight', 'hearing', 'smell', 'touch', 'thermal', 'balance_movement', 'body_awareness', 'inner_sensations'])
    await expect(summary.getByTestId('answer-A16')).toContainText(DEV.answers.A16)
    await expect(radar.locator('button[data-sense="hearing"]')).toHaveAttribute('aria-label', 'Hearing: bothers you 5, feels good 5')
    await expect(radar.locator('button[data-sense="balance_movement"]')).toHaveAttribute('aria-label', 'Balance and movement: bothers you 3, feels good 4')
    // Pointing at an icon shows the name of its sense beside it (board 5).
    await radar.locator('button[data-sense="sight"]').hover()
    await expect(radar.getByTestId('radar-name')).toHaveText('Sight')
    await radar.locator('button[data-sense="body_awareness"]').hover()
    await expect(radar.getByTestId('radar-name')).toHaveText('Body awareness')
    await radar.locator('button[data-sense="hearing"]').click()
    await expect(radar.locator('button[data-sense="hearing"]')).toHaveAttribute('aria-expanded', 'true')
    const detail = radar.getByTestId('radar-detail')
    await expect(detail).toContainText('Fountains, water5 · very pleasant')
    await expect(detail).toContainText('Traffic, trams1 · very unpleasant')
    await expect(detail).toBeInViewport() // next to the sense, not under the chart
    await radar.locator('.radar').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'e2e/screens/profile-radar-dark.png' })
    // Esc closes it and focus goes back to the sense; a tap elsewhere closes it too; tapping inside a slice opens it.
    await page.keyboard.press('Escape')
    await expect(detail).toHaveCount(0)
    await expect(radar.locator('button[data-sense="hearing"]')).toBeFocused()
    const box = await radar.locator('.radar').boundingBox()
    await page.mouse.click(box.x + box.width / 2 - box.width * 0.18, box.y + box.height / 2 + box.height * 0.18) // balance and movement's slice
    await expect(detail).toContainText('Balance and movement')
    await expect(detail).toBeInViewport()
    await summary.getByRole('heading', { name: 'This is how you sense the city' }).click()
    await expect(detail).toHaveCount(0)
    await expect(radar.locator('button[data-sense="inner_sensations"]')).toHaveAttribute('aria-label', 'Internal sensations: bothers you 3, feels good 5')
    await page.screenshot({ path: 'e2e/screens/profile-summary-dark.png' })
  })

  test('editing an answer builds the profile again; download, delete and import', async ({ page }) => {
    await withSavedProfile(page, { language: 'en', answers: DEV.answers, text: DEV.expected, version: DEV_VERSION, saved: '2026-11-15T10:00:00Z' })
    await openProfile(page)
    const summary = page.locator('[data-panel="profile-summary"]')
    await expect(summary.getByTestId('overall-comfort')).toContainText('2 of 5')

    // Edit one answer: the onboarding opens at that question, with Cancel and Save changes.
    await summary.getByRole('button', { name: /^Edit: In general/ }).click()
    const ob = page.locator('[data-panel="onboarding"]')
    await expect(ob.getByTestId('onboarding-step')).toHaveText('Step 2 of 6')
    await expect(page.locator('[data-row="A11"] input[value="2"]')).toBeChecked()
    await choose(page, 'A11', 4)
    await ob.getByRole('button', { name: 'Save changes' }).click()
    await expect(summary.getByTestId('overall-comfort')).toContainText('4 of 5')
    const edited = await saved(page)
    expect(edited.text).toBe(DEV.expected.replace('(1 = not at all … 5 = very much): 2.', '(1 = not at all … 5 = very much): 4.'))
    expect(edited.version).not.toBe(DEV_VERSION)

    // The overall comfort bar can be dragged too: it snaps to 1–5, saves A11 and builds the profile again.
    const a11 = summary.locator('[data-handle="A11"]')
    await expect(a11).toHaveAttribute('aria-valuenow', '4')
    const a11Track = await summary.getByTestId('overall-bar').locator('.track').boundingBox()
    const h = await a11.boundingBox()
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
    await page.mouse.down()
    await page.mouse.move(a11Track.x + a11Track.width * 0.48, h.y + h.height / 2, { steps: 5 }) // nearest is 3
    await page.mouse.up()
    await expect(a11).toHaveAttribute('aria-valuenow', '3')
    await expect(summary.getByTestId('overall-comfort')).toContainText('3 of 5')
    expect((await saved(page)).answers.A11).toBe(3)
    expect((await saved(page)).text).toContain('(1 = not at all … 5 = very much): 3.')
    await a11.focus()
    await page.keyboard.press('ArrowRight') // and with the keys, one step
    await expect(summary.getByTestId('overall-comfort')).toContainText('4 of 5')
    expect((await saved(page)).answers.A11).toBe(4)

    // The radar follows an edit at once: traffic from 1 to 3, hearing now bothers 3.
    await summary.getByText('Your answers, element by element').click()
    await summary.getByRole('button', { name: 'Edit the elements, part 1 of 2' }).click()
    await choose(page, 'A12-traffic_trams', 3)
    await ob.getByRole('button', { name: 'Save changes' }).click()
    await expect(summary.locator('button[data-sense="hearing"]')).toHaveAttribute('aria-label', 'Hearing: bothers you 3, feels good 5')
    await summary.getByText('Your answers, element by element').click()
    await summary.getByRole('button', { name: 'Edit the elements, part 1 of 2' }).click()
    await choose(page, 'A12-traffic_trams', 1)
    await ob.getByRole('button', { name: 'Save changes' }).click()

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
    expect(await page.evaluate(() => ['sencity-profile', 'sencity-profile-draft', 'sencity-consent'].map((k) => localStorage.getItem(k)))).toEqual([null, null, null])
    // Importing without consent asks first.
    await page.locator('[data-panel="profile-empty"]').getByRole('button', { name: 'Import a profile file' }).click()
    await expect(page.locator('[data-panel="consent"]')).toBeVisible()
    await page.getByText('I have read this and agree').click()
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Agree and start' }).click()])
    expect(chooser).toBeTruthy()

    // Import the file again: the profile is back, its text built again from the answers.
    await page.locator('input[type="file"]').setInputFiles(file)
    await expect(summary.getByTestId('overall-comfort')).toContainText('4 of 5')
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

    // Personal ratings are kept in this browser only (Elena, 2026-11-15); the next request sends just their stamp
    // (element list, model, export: nothing personal) and the API answers "keep".
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('sencity-ratings')))
    expect(Object.keys(kept).length).toBe(bodies[1].photos.length)
    expect(Object.keys(kept)[0]).toMatch(/\|386e888b8867$/)
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('senses').retry('area'))
    await expect.poll(() => bodies.length).toBe(3)
    expect(bodies[2].photos.every((p) => p.cached && p.cached.listed[0] === 'shade' && !('result' in p.cached))).toBe(true)
    await expect(foot).toContainText('Personal prediction: from your sensory profile')

    // Edit an answer: nothing is sent; the ratings are marked as from the earlier profile until "Rate again".
    await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Profile' }).click()
    await page.getByRole('button', { name: /^Edit: In general/ }).click()
    await choose(page, 'A11', 4)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Area' }).click()
    await expect(foot.getByTestId('senses-stale')).toContainText('Your profile changed')
    await expect(foot).toContainText('Personal prediction: from your earlier profile')
    await page.waitForTimeout(500)
    expect(bodies.length).toBe(3)
    await foot.getByRole('button', { name: 'Rate again with your profile' }).click()
    await expect.poll(() => bodies.length).toBe(4)
    expect(bodies[3].profile.A11).toBe(4)
    expect(bodies[3].photos.some((ph) => ph.cached)).toBe(false) // the earlier profile's ratings were dropped
    await expect(foot.getByTestId('senses-stale')).toHaveCount(0)
    await expect(foot).toContainText('Personal prediction: from your sensory profile')

    // Delete it: general again, rated again without it.
    await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Profile' }).click()
    await page.getByRole('button', { name: 'Delete my profile' }).click()
    await page.getByRole('button', { name: 'Delete everything' }).click()
    await expect.poll(() => bodies.length).toBe(5)
    expect(bodies[4].profile).toBeUndefined()
    expect(await page.evaluate(() => localStorage.getItem('sencity-ratings'))).toBe(null) // gone with the profile
    await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Area' }).click()
    await expect(foot).toContainText('General prediction: not personalised yet')

    // The shortcut opens the onboarding.
    await foot.getByRole('button', { name: 'Create your profile' }).click()
    await expect(page).toHaveURL(/\/profile$/)
    // Delete my profile took the consent too: "Before you start" again, then the first step.
    await page.getByText('I have read this and agree').click()
    await page.getByRole('button', { name: 'Agree and start' }).click()
    await expect(page.locator('[data-panel="onboarding"]').getByTestId('onboarding-step')).toHaveText('Step 1 of 6')
  })
})

test.describe('your sensory profile on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the onboarding fits, one row of five boxes per element', async ({ page }) => {
    await mockSurvey(page)
    await openMap(page, 'dark', { layer: null })
    await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Profile' }).click()
    await page.getByRole('button', { name: 'Create your profile' }).click()
    await expect(page.locator('[data-panel="consent"]')).toBeVisible()
    expect(await layoutProblems(page)).toEqual([])
    await page.getByText('I have read this and agree').click()
    await page.getByRole('button', { name: 'Agree and start' }).click()
    await page.getByRole('button', { name: 'Next' }).click()
    await choose(page, 'A11', 3)
    await page.getByRole('button', { name: 'Next' }).click()
    await choose(page, 'A12-greenery_trees', 5)
    expect(await layoutProblems(page)).toEqual([])
    const boxes = await page.locator('[data-row="A12-greenery_trees"] label').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top))
    expect(new Set(boxes.map(Math.round)).size).toBe(1)
    // Answering down the list never moves the whole screen: the onboarding scrolls, the frame stays put (it was pushed
    // up by about 500 px past the middle of the list, leaving the bottom empty; Elena, 2026-11-15).
    for (const r of SURVEY.questions.find((q) => q.code === 'A12').rows) await choose(page, `A12-${r.code}`, 3)
    expect(await page.locator('[data-panel="onboarding"]').evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(0)
    expect(await page.evaluate(() => document.querySelector('.app').scrollTop)).toBe(0)
    await page.getByRole('button', { name: 'Next' }).scrollIntoViewIfNeeded()
    await expect(page.getByRole('button', { name: 'Next' })).toBeInViewport()
    expect(await page.locator('[data-panel="onboarding"]').evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(0)
    await page.screenshot({ path: 'e2e/screens/profile-onboarding-phone-dark.png' })
  })

  test('every screen against the list: Part A only, one grid per screen, big targets, progress, A16 skippable; view, edit, delete', async ({ page }) => {
    const shot = (name) => page.screenshot({ path: `e2e/screens/profile-phone/${name}.png`, fullPage: true })
    await mockSurvey(page)
    await openMap(page, 'light', { layer: null })
    await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Profile' }).click()
    await shot('0-empty')
    await page.getByRole('button', { name: 'Create your profile' }).click()
    await shot('1-consent')
    await page.getByText('I have read this and agree').click()
    await page.getByRole('button', { name: 'Agree and start' }).click()
    const step = page.getByTestId('onboarding-step')
    const titles = []
    const progress = page.getByRole('progressbar', { name: 'Your sensory profile' })
    // The steps: the intro, A11, A12, A13, A16 from part_a.json, and the app's own weather step. Nothing else.
    for (let i = 1; i <= 6; i++) {
      await expect(step).toHaveText(`Step ${i} of 6`)
      await expect(progress).toHaveAttribute('aria-valuenow', String(i))
      titles.push(await page.locator('[data-panel="onboarding"] h2').innerText())
      const rows = page.locator('[data-panel="onboarding"] [data-row]')
      if (i === 2) await choose(page, 'A11', 3)
      if (i === 3 || i === 4) {
        const grid = i === 3 ? 'A12' : 'A13'
        const codes = SURVEY.questions.find((q) => q.code === grid).rows.map((r) => r.code)
        expect(codes).toHaveLength(10)
        await expect(rows).toHaveCount(10) // one grid per screen, its ten elements: no attention-check rows
        expect(await rows.evaluateAll((els) => els.map((e) => e.dataset.row))).toEqual(codes.map((c) => `${grid}-${c}`))
        for (const c of codes) await choose(page, `${grid}-${c}`, 4)
        const sizes = await page.locator('[data-panel="onboarding"] [data-row] label').evaluateAll((els) =>
          els.map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height) }))
        expect(Math.min(...sizes)).toBeGreaterThanOrEqual(44) // tap targets on a phone (--touch-phone)
      }
      if (i === 5) await expect(page.locator('#a16')).toHaveValue('') // left empty: the step is optional
      if (i === 6) for (const r of ['hot', 'cold', 'wind']) await choose(page, `weather-${r}`, 3)
      expect(await layoutProblems(page)).toEqual([])
      await shot(`${i + 1}-step-${i}`)
      await page.getByRole('button', { name: i === 6 ? 'Save your profile' : 'Next' }).click()
    }
    const text = titles.join(' ').toLowerCase()
    for (const word of ['age', 'gender', 'health', 'diagnos', 'condition', 'education', 'district', 'persona'])
      expect(text).not.toMatch(new RegExp(`\b${word}`))
    // "Your profile": view, edit and delete.
    await expect(page.getByRole('button', { name: 'Edit answers' })).toBeVisible()
    await shot('8-your-profile')
    expect(await layoutProblems(page)).toEqual([])
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sencity-profile')))
    expect(saved.answers.A16).toBe('')
    expect(Object.keys(saved.answers).sort()).toEqual(['A11', 'A12', 'A13', 'A16'])
    await page.getByRole('button', { name: 'Edit answers' }).click()
    await expect(step).toHaveText('Step 2 of 6')
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await shot('9-edit')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('button', { name: 'Delete my profile' }).click()
    await shot('10-delete')
    await page.getByRole('button', { name: 'Delete everything' }).click()
    await expect(page.getByRole('button', { name: 'Create your profile' })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('sencity-profile'))).toBe(null)
  })
})

test.describe('your sensory profile, a start kept from before', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('a start of cold saved beyond the bar is shown at its minimum, its hard limit on the bar\'s end', async ({ page }) => {
    await withSavedProfile(page, { language: 'en', answers: DEV.answers, text: DEV.expected, version: DEV_VERSION, saved: '2026-11-15T10:00:00Z',
      weather: {}, thermal: { cold: -6 } }) // allowed by an earlier scale (−15 to 45)
    await openProfile(page)
    const tc = page.getByTestId('thermal-comfort')
    await expect(tc.locator('[data-handle="cold"]')).toHaveAttribute('aria-valuenow', '-1')
    const [first, track] = await Promise.all([tc.locator('[data-tick]').first().boundingBox(), tc.locator('.track').boundingBox()])
    expect(first.x + first.width / 2).toBeGreaterThanOrEqual(track.x - 1)
    await expect(tc.getByTestId('thermal-summary')).toContainText('about −1 to 26 °C')
  })
})
