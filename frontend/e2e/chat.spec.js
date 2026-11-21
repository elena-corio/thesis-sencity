import { expect, test } from '@playwright/test'
import { AREA, THERMAL, analyseCentre, layoutProblems, mockArea, mockSurvey, openMap, openSegment } from './helpers.js'

// The chat (Elena, 2026-11-21). POST /api/chat is mocked: it answers each message with a fixed intent, as the parser
// would. The app carries the intent out on the loaded area (Thermal here: no rating calls) and writes the reply itself.
const blank = (action, over = {}) => ({ action, language: 'en', level: null, with: [], without: [], near: null, radius_m: null,
  start: null, end: null, calmer: false, layer: null, season: null, time: null, topic: null, ...over })
const INTENTS = {
  'show the overall layer': blank('set_view', { layer: 'overall' }),
  'mostra il livello termico': blank('set_view', { language: 'it', layer: 'thermal' }),
  'tell me a joke': blank('out_of_scope'),
  'hard places here': blank('filter_places', { level: 'hard' }),
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

    await panel(page).getByRole('button', { name: 'Remove easy · Thermal' }).click()
    await expect(panel(page).getByTestId('chat-reply').last()).toContainText(/places? match/)
    expect(sent).toHaveLength(0)
    expect(await layoutProblems(page)).toEqual([])
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
