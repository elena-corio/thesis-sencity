// About and how to use (board 7) and the first-time tips (Elena, 2026-11-16).
import { expect, test } from '@playwright/test'
import { TEST_PROFILES, analyseCentre, mockArea, mockSurvey, openMap, withSavedProfile } from './helpers.js'

const NOT_SAID = [/\bpersonas?\b/i, /IAAC/i, /institute/i, /universit/i, /sign.?in/i, /16 elements/i, /3D/]

async function aboutHasNoOldWords(about) {
  const text = await about.innerText()
  for (const re of NOT_SAID) expect(text, String(re)).not.toMatch(re)
  for (const h of ['What SenCity does', 'How to read the colours', 'Where ratings come from', 'Your profile and data',
    'Weather and “feels like”', 'Photos', 'What SenCity does not do']) {
    await expect(about.getByRole('heading', { name: h, level: 3, exact: true })).toBeVisible()
  }
}

for (const theme of ['dark', 'light']) {
  test.describe(`desktop, ${theme}`, () => {
    test.use({ viewport: { width: 1440, height: 900 }, colorScheme: theme })

    test('About opens from "?", focus moves in, Esc closes it and focus goes back', async ({ page }) => {
      await openMap(page, theme)
      const help = page.getByRole('button', { name: 'About and how to use' })
      await help.click()
      const about = page.getByRole('dialog', { name: 'How SenCity works' })
      await expect(about).toBeVisible()
      await expect(about.getByRole('heading', { name: 'How SenCity works', level: 2 })).toBeFocused()
      await aboutHasNoOldWords(about)
      await expect(about).toContainText('20 visible elements')
      await expect(about).toContainText('Part of a master thesis final project')
      await page.screenshot({ path: `e2e/screens/about-desktop-${theme}.png` })
      // Tab stays inside.
      for (let i = 0; i < 6; i++) await page.keyboard.press('Tab')
      expect(await about.evaluate((d) => d.contains(document.activeElement))).toBe(true)
      await page.keyboard.press('Escape')
      await expect(about).toHaveCount(0)
      await expect(help).toBeFocused()
      // "Got it" closes it too.
      await help.click()
      await about.getByRole('button', { name: 'Got it' }).click()
      await expect(about).toHaveCount(0)
    })
  })

  test.describe(`phone, ${theme}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, colorScheme: theme, hasTouch: true })

    test('About from the menu, as a full-screen sheet', async ({ page }) => {
      await openMap(page, theme)
      const account = page.getByRole('button', { name: 'Your account' })
      await account.click()
      await page.getByRole('dialog', { name: 'Your account' }).getByRole('button', { name: 'About and how to use' }).click()
      const about = page.getByRole('dialog', { name: 'How SenCity works' })
      await expect(about).toBeVisible()
      await expect(about.getByRole('heading', { name: 'How SenCity works', level: 2 })).toBeFocused()
      const box = await about.boundingBox()
      expect(box).toMatchObject({ x: 0, y: 0, width: 390 })
      expect(Math.round(box.height)).toBe(844)
      await aboutHasNoOldWords(about)
      await page.screenshot({ path: `e2e/screens/about-phone-${theme}.png` })
      await page.keyboard.press('Escape')
      await expect(about).toHaveCount(0)
      await expect(account).toBeFocused()
    })
  })
}

test.describe('How this works links', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })

  test('the legend link opens About at the colours, the profile link at your data', async ({ page }) => {
    await mockArea(page, { thermal: true })
    await openMap(page, 'dark', { layer: 'senses' })
    await analyseCentre(page)
    await page.locator('[data-panel="area-card"] [data-testid="comfort-key"]').getByRole('button', { name: 'How this works' }).click()
    const about = page.getByRole('dialog', { name: 'How SenCity works' })
    await expect(about.getByRole('heading', { name: 'How to read the colours' })).toBeFocused()
    await expect(about.getByRole('heading', { name: 'How to read the colours' })).toBeInViewport()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-panel="area-card"] [data-how="colours"]')).toBeFocused()
  })

  test('profile and comfort bar', async ({ page }) => {
    const DEV = TEST_PROFILES[0]
    await withSavedProfile(page, { language: 'en', answers: DEV.answers, text: DEV.expected, version: '386e888b8867', saved: '2026-11-15T10:00:00Z', weather: {}, thermal: null })
    await mockSurvey(page)
    await openMap(page, 'dark', { layer: null })
    await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Profile' }).click()
    const summary = page.locator('[data-panel="profile-summary"]')
    const about = page.getByRole('dialog', { name: 'How SenCity works' })
    await summary.locator('[data-how="data"]').click()
    await expect(about.getByRole('heading', { name: 'Your profile and data' })).toBeFocused()
    await page.keyboard.press('Escape')
    await summary.locator('[data-how="weather"]').click()
    await expect(about.getByRole('heading', { name: 'Weather and “feels like”' })).toBeFocused()
    await expect(about.getByRole('heading', { name: 'Weather and “feels like”' })).toBeInViewport()
  })
})

test.describe('first-time tips', () => {
  // No tip seen yet (the config marks them all as seen for the other tests).
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', storageState: { cookies: [], origins: [] } })
  const seen = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('sencity-tips-seen') ?? 'null'))

  test('shown once, Got it hides it for good, Show tips again brings them back', async ({ page }) => {
    await openMap(page, 'dark')
    const tip = page.locator('[data-panel="layers"] [data-tip="map"]')
    await expect(tip).toBeVisible()
    await expect(tip).toContainText('Click the map to choose an area')
    await page.screenshot({ path: 'e2e/screens/tip-map-dark.png' })
    await tip.getByRole('button', { name: 'Got it, hide this tip' }).click()
    await expect(tip).toHaveCount(0)
    expect(await seen(page)).toEqual(['map'])
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-map-ready', 'true', { timeout: 30_000 })
    await expect(page.locator('[data-tip="map"]')).toHaveCount(0)
    // Show tips again (About).
    await page.getByRole('button', { name: 'About and how to use' }).click()
    await page.getByRole('dialog', { name: 'How SenCity works' }).getByRole('button', { name: 'Show tips again' }).click()
    expect(await seen(page)).toBeNull()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-panel="layers"] [data-tip="map"]')).toBeVisible()
  })

  test('Delete my profile clears which tips were seen', async ({ page }) => {
    const DEV = TEST_PROFILES[0]
    await withSavedProfile(page, { language: 'en', answers: DEV.answers, text: DEV.expected, version: '386e888b8867', saved: '2026-11-15T10:00:00Z', weather: {}, thermal: null })
    await mockSurvey(page)
    await openMap(page, 'dark', { layer: null })
    await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Profile' }).click()
    const tip = page.locator('[data-tip="profile"]')
    await expect(tip).toContainText('Your profile stays in this browser')
    await page.screenshot({ path: 'e2e/screens/tip-profile-dark.png' })
    await tip.getByRole('button', { name: 'Got it, hide this tip' }).click()
    expect(await seen(page)).toEqual(['profile'])
    const summary = page.locator('[data-panel="profile-summary"]')
    await summary.getByRole('button', { name: 'Delete my profile' }).click()
    await page.getByRole('alertdialog', { name: 'Delete your profile?' }).getByRole('button', { name: 'Delete everything' }).click()
    await expect(page.locator('[data-panel="profile-empty"]')).toBeVisible()
    expect(await seen(page)).toBeNull()
  })
})
