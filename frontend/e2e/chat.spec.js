import { expect, test } from '@playwright/test'
import { AREA, TEST_PROFILES, THERMAL, analyseCentre, layoutProblems, mockArea, mockSurvey, openMap, openSegment, withSavedProfile } from './helpers.js'

// The chat (Elena, 2026-11-21). POST /api/chat is mocked: it answers each message with a fixed intent, as the parser
// would. The app carries the intent out on the loaded area (Thermal here: no rating calls) and writes the reply itself.
const blank = (action, over = {}) => ({ action, language: 'en', level: null, with: [], without: [], near: null, radius_m: null,
  start: null, end: null, calmer: false, layer: null, season: null, time: null, topic: null, ...over })
const INTENTS = {
  'show the overall layer': blank('set_view', { layer: 'overall' }),
  'mostra il livello termico': blank('set_view', { language: 'it', layer: 'thermal' }),
  'tell me a joke': blank('out_of_scope'),
  'hard places here': blank('filter_places', { level: 'hard' }),
  'how to prepare for this area?': blank('prepare_cope', { near: 'this area' }),
}
async function mockChat(page, { fail = false } = {}) {
  await mockSurvey(page) // the element names (nothing personal)
  const sent = []
  await page.route('**/api/chat', async (route) => {
    const body = route.request().postDataJSON()
    sent.push(body)
    if (fail) return route.fulfill({ status: 500, json: { detail: 'x' } })
    await route.fulfill({ json: { intent: INTENTS[body.message] ?? blank('out_of_scope') } })
  })
  return sent
}
const panel = (page) => page.locator('[data-panel="chat"]')
/** The words of the last reply (without its pills or cards). */
const lastText = (page) => panel(page).getByTestId('chat-reply').last().locator('p').first()
async function openArea(page) {
  await mockArea(page, { thermal: true })
  await openMap(page, 'dark') // Thermal
  await analyseCentre(page)
  await expect(page.locator('[data-panel="area-card"], [data-testid="area-card"]').first()).toBeVisible({ timeout: 20_000 }).catch(() => {})
  await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('area').thermal)).toBe('ready')
}
async function ask(page, text) {
  await panel(page).getByTestId('chat-input').fill(text)
  await panel(page).getByRole('button', { name: 'Send' }).click()
}
const store = (page, name, key) => page.evaluate(([n, k]) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)[k], [name, key])
const HARD = AREA.features.filter((f) => THERMAL[f.properties.id] === 36).length

test.describe('Ask about places', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('opens with one sentence; a ready-made prompt runs without a model call; pills read back; removing one runs again', async ({ page }) => {
    const sent = await mockChat(page)
    await openArea(page)
    await page.getByRole('button', { name: 'Ask about places' }).click()
    await expect(panel(page).getByTestId('chat-intro')).toContainText('Ask about places on the map or your profile')
    await expect(panel(page).getByTestId('chat-input')).toHaveAttribute('placeholder', /^e\.g\. /)

    await panel(page).locator('[data-preset="easy"]').click()
    const reply = panel(page).getByTestId('chat-reply').last()
    await expect(reply).toContainText(/places? (is|are) easy for you on Thermal/)
    await expect(panel(page).getByTestId('chat-pills')).toContainText('easy · Thermal')
    expect(await store(page, 'area', 'markerKind')).toBe('chat') // marked on the map
    expect(sent).toHaveLength(0) // no model call
    await page.screenshot({ path: 'e2e/screens/chat-preset-dark.png' })

    // The chat's places are on the map only while the chat is open: closed, the area's own recommendations are back.
    await panel(page).getByRole('button', { name: 'Close the chat' }).click()
    expect(await store(page, 'area', 'markerKind')).toBe('suggestions')
    await expect(page.locator('[data-panel="area-card"]')).not.toContainText('From your question')
    await expect(page.locator('[data-panel="area-card"]').getByTestId('suggestions')).toContainText('Likely easiest for you') // Thermal's own
    await page.getByRole('button', { name: 'Ask about places' }).click()
    expect(await store(page, 'area', 'markerKind')).toBe('chat') // open again: the chat's places again

    await panel(page).getByRole('button', { name: 'Remove easy · Thermal' }).click()
    await expect(panel(page).getByTestId('chat-reply').last()).toContainText(/places? match/)
    expect(sent).toHaveLength(0)
    expect(await layoutProblems(page)).toEqual([])
  })

  test('a street from the list opens its card at once, selected on the map; "Back to the chat" returns', async ({ page }) => {
    await mockChat(page)
    await openArea(page)
    await page.getByRole('button', { name: 'Ask about places' }).click()
    await panel(page).locator('[data-preset="easy"]').click()
    const first = panel(page).getByTestId('chat-reply').last().locator('.item').first()
    const id = await first.getAttribute('data-place')
    await first.click()
    // The chat gives way to the street's card; the street is the selected one.
    await expect(panel(page)).toHaveCount(0)
    const card = page.locator('[data-panel="place-card"]')
    await expect(card).toBeVisible()
    expect(await store(page, 'area', 'selectedId')).toBe(id)
    await page.screenshot({ path: 'e2e/screens/chat-open-place-dark.png' })
    expect(await store(page, 'area', 'markerKind')).toBe('suggestions') // the chat is closed: its places are not on the map
    // Back to the conversation, as it was, with its places on the map again.
    await card.getByTestId('back-to-chat').click()
    await expect(panel(page).getByTestId('chat-pills')).toContainText('easy · Thermal')
    expect(await store(page, 'area', 'markerKind')).toBe('chat')
    expect(await store(page, 'area', 'markersCollapsed')).toBe(false)
  })

  test('with the chat open, a place clicked on the map opens its card; "Back to the chat" returns', async ({ page }) => {
    await mockChat(page)
    await openArea(page)
    await page.getByRole('button', { name: 'Ask about places' }).click()
    await panel(page).locator('[data-preset="easy"]').click()
    const id = AREA.features.find((f) => THERMAL[f.properties.id] === 22).properties.id
    await openSegment(page, id) // as a click on the street
    await expect(panel(page)).toHaveCount(0)
    const card = page.locator('[data-panel="place-card"]')
    await expect(card).toBeVisible()
    expect(await store(page, 'area', 'selectedId')).toBe(id)
    await card.getByTestId('back-to-chat').click()
    await expect(panel(page).getByTestId('chat-pills')).toContainText('easy · Thermal')
  })

  test('a typed message: only its text is sent; the intent is carried out by the app', async ({ page }) => {
    const sent = await mockChat(page)
    await openArea(page)
    await page.getByRole('button', { name: 'Ask about places' }).click()
    await ask(page, 'show the overall layer')
    await expect(lastText(page)).toHaveText('Showing Overall.')
    expect(sent).toEqual([{ message: 'show the overall layer' }]) // never the profile or ratings
    expect(await store(page, 'area', 'layer')).toBe('overall')
    await expect(panel(page).getByTestId('chat-input')).toHaveValue('')

    await ask(page, 'hard places here')
    await expect(panel(page).getByTestId('chat-pills')).toContainText('hard · Overall') // the level follows the current layer
  })

  test('Italian: understood, answered in English with the note first', async ({ page }) => {
    await mockChat(page)
    await openArea(page)
    await page.getByRole('button', { name: 'Ask about places' }).click()
    await ask(page, 'mostra il livello termico')
    await expect(lastText(page)).toHaveText('I understood your request; replies are in English for now. Showing Thermal.')
  })

  test('out of scope: a short explanation and two prompts that work', async ({ page }) => {
    await mockChat(page)
    await openArea(page)
    await page.getByRole('button', { name: 'Ask about places' }).click()
    await ask(page, 'tell me a joke')
    const reply = panel(page).getByTestId('chat-reply').last()
    await expect(reply).toContainText('I can only help with places on the SenCity map and with your profile.')
    await expect(reply.locator('.chip')).toHaveCount(2)
  })

  test('a failed send keeps the message in the input with "Could not send. Try again."', async ({ page }) => {
    await mockChat(page, { fail: true })
    await openArea(page)
    await page.getByRole('button', { name: 'Ask about places' }).click()
    await ask(page, 'show the overall layer')
    await expect(panel(page).getByTestId('chat-error')).toHaveText('Could not send. Try again.')
    await expect(panel(page).getByTestId('chat-input')).toHaveValue('show the overall layer')
  })

  test('"What can I ask?" lists examples for the six tasks; never "persona"', async ({ page }) => {
    await mockChat(page)
    await openArea(page)
    await page.getByRole('button', { name: 'Ask about places' }).click()
    await panel(page).getByRole('button', { name: 'What can I ask?' }).click()
    await expect(panel(page).getByTestId('chat-help').locator('h3')).toHaveCount(6)
    expect((await panel(page).innerText()).toLowerCase()).not.toContain('persona')
  })

  test('"Why is this hard?" on a hard place card explains it from its stored values', async ({ page }) => {
    const sent = await mockChat(page)
    await openArea(page)
    const hard = AREA.features.find((f) => THERMAL[f.properties.id] === 36)
    await openSegment(page, hard.properties.id)
    await page.getByTestId('why-hard').click()
    await expect(panel(page).getByTestId('chat-reply').last()).toContainText('hard')
    await expect(panel(page).getByTestId('chat-reply').last()).toContainText('feels like 36 °C')
    expect(sent).toHaveLength(0)
    expect(HARD).toBeGreaterThan(0)
  })
})

test.describe('Prepare for an area', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the area’s facts first, then tips from what the person said helps', async ({ page }) => {
    const DEV = TEST_PROFILES[0]
    await withSavedProfile(page, { language: 'en', answers: DEV.answers, text: DEV.expected, version: '386e888b8867', saved: '2026-11-15T10:00:00Z',
      weather: {}, thermal: null, prepare: { Q1: 3, Q2: { ticked: [], other: '' }, Q3: 4, Q4: { ticked: ['drink_eat', 'sit_rest', 'quieter_spot'], other: '' } } })
    await mockChat(page)
    await openArea(page)
    await page.getByRole('button', { name: 'Ask about places' }).click()
    await ask(page, 'how to prepare for this area?')
    const t = lastText(page)
    // Thermal layer, photos not rated here: the thermal facts (22 / 29 / 36 °C → easy to hard, heat), then the tips.
    await expect(t).toContainText('Thermal comfort is easy to hard for you, because of high temperatures (feels like up to 36 °C), summer at 15:00.')
    await expect(t).toContainText('Bring water with you')
    await expect(t).toContainText('Plan time to rest')
    await expect(t).not.toContainText('open the place')
    // The easy places it names are links: one opens that place's card, selected.
    const link = t.locator('[data-place-link]').first()
    await expect(link).toBeVisible()
    const id = await link.getAttribute('data-place-link')
    await link.click()
    await expect(panel(page)).toHaveCount(0)
    await expect(page.locator('[data-panel="place-card"]')).toBeVisible()
    expect(await store(page, 'area', 'selectedId')).toBe(id)
  })
})

test.describe('Ask about places on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('full screen, closes back to the map', async ({ page }) => {
    await mockChat(page)
    await mockArea(page, { thermal: true })
    await openMap(page, 'light')
    await page.locator('[data-panel="search"]').getByRole('button', { name: 'Ask about places' }).click()
    const box = await panel(page).boundingBox()
    expect(box.width).toBe(390)
    expect(await layoutProblems(page)).toEqual([])
    await panel(page).getByRole('button', { name: 'Close the chat' }).click()
    await expect(panel(page)).toHaveCount(0)
  })
})
