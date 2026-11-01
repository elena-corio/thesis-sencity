// Keyboard walk-through (brief §3 keyboard focus, §6 keyboard selection, §11).
import { expect, test } from '@playwright/test'
import { openMap } from './helpers.js'

test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })

async function focusedInfo(page) {
  return page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return null
    const cs = getComputedStyle(el)
    return {
      name: el.getAttribute('aria-label') || el.textContent.trim() || el.getAttribute('placeholder') || el.tagName,
      outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineOffset}`,
    }
  })
}

test('every control is reachable with Tab and shows the focus outline', async ({ page }) => {
  await openMap(page, 'dark')
  const seen = new Map()
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab')
    const f = await focusedInfo(page)
    if (!f) continue
    if (seen.has(f.name)) break
    seen.set(f.name, f.outline)
  }
  const names = [...seen.keys()]
  for (const expected of ['Search a street or place', 'Map', 'Compare', 'Profile', 'About and how to use',
    'Print report', 'Switch to light mode', 'Ask', 'Your account', 'Zoom in', 'Zoom out', 'Re-centre the map']) {
    expect(names, `Tab reaches ${expected}`).toContain(expected)
  }
  expect(names.some((n) => n.startsWith('Map. Press Enter')), 'Tab reaches the map').toBe(true)
  for (const [name, outline] of seen) {
    expect(outline, `focus outline on ${name}`).toBe('solid 2px 3px')
  }
})

test('select an area with the keyboard only', async ({ page }) => {
  await openMap(page, 'dark')
  await page.locator('canvas').focus()

  await page.keyboard.press('Enter')
  await expect(page.getByText('Move to set the radius,')).toBeVisible()
  await expect(page.locator('.radius-chip')).toContainText('200 m')

  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  await expect(page.locator('.radius-chip')).toContainText('230 m')
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.radius-chip')).toContainText('220 m')

  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Analyse this area' })).toBeFocused()
  await expect(page.getByText('220 m radius')).toBeVisible()

  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Change area' })).toBeFocused()
})

test('arrow keys stop at 500 m and 50 m; Esc starts again', async ({ page }) => {
  await openMap(page, 'dark')
  await page.locator('canvas').focus()
  await page.keyboard.press('Enter')
  for (let i = 0; i < 35; i++) await page.keyboard.press('ArrowUp')
  await expect(page.locator('.radius-chip')).toContainText('500 m, maximum')
  for (let i = 0; i < 50; i++) await page.keyboard.press('ArrowDown')
  await expect(page.locator('.radius-chip')).toContainText('50 m')

  await page.keyboard.press('Escape')
  await expect(page.getByText('Click to place the centre')).toBeVisible()
  await expect(page.locator('canvas')).toBeFocused()
})

test('the sun/moon switches the theme in one click and is remembered', async ({ page }) => {
  await openMap(page, 'dark')
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await page.evaluate(() => localStorage.getItem('sencity-appearance'))).toBe('light')
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('account menu: System is there; Esc closes it and focus returns to the button', async ({ page }) => {
  await openMap(page, 'dark')
  await page.getByRole('button', { name: 'Your account' }).click()
  await page.getByRole('radio', { name: 'System' }).click()
  expect(await page.evaluate(() => localStorage.getItem('sencity-appearance'))).toBeNull()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Your account' })).toBeFocused()
})

test('clicking into the search shows no outline; Tab into it does', async ({ page }) => {
  await openMap(page, 'dark')
  const box = page.getByRole('combobox')
  await box.click()
  expect(await box.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none')
  await page.keyboard.press('Escape')
  await page.locator('canvas').focus()
  for (let i = 0; i < 5 && !(await box.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab')
  }
  await expect(box).toBeFocused()
  expect(await box.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')
})
