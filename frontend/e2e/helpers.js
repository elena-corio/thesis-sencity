import { expect } from '@playwright/test'

/** Open /map in a theme and wait until the map has drawn once. */
export async function openMap(page, theme) {
  await page.addInitScript((t) => {
    try { localStorage.setItem('sencity-appearance', t) } catch {}
  }, theme)
  await page.goto('/map')
  await expect(page.locator('html')).toHaveAttribute('data-map-ready', 'true', { timeout: 30_000 })
  await page.evaluate(() => document.fonts.ready)
}

/** Wait for the map to finish drawing after a change. */
export async function mapIdle(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const m = window.__sencityMap
    if (!m || m.loaded()) requestAnimationFrame(() => resolve())
    else m.once('idle', () => resolve())
  }))
}

/** Points on the map for the centre and the radius, in viewport pixels. */
export function points(viewport, radiusPx = 140, phone = false) {
  const cx = Math.round(viewport.width * (phone ? 0.5 : 0.6))
  const cy = Math.round(viewport.height * (phone ? 0.45 : 0.6))
  const angle = -Math.PI / 5
  return {
    centre: { x: cx, y: cy },
    edge: { x: Math.round(cx + radiusPx * Math.cos(angle)), y: Math.round(cy + radiusPx * Math.sin(angle)) },
  }
}

/** Step 1 → 1b: click the centre, then move the pointer out to the radius. */
export async function placeCentre(page, p) {
  await page.mouse.move(p.centre.x - 30, p.centre.y + 20)
  await page.mouse.click(p.centre.x, p.centre.y)
  await page.mouse.move(p.edge.x, p.edge.y, { steps: 8 })
}

/**
 * Overlap and fit check: the page does not scroll, every panel is inside the viewport,
 * no two panels overlap, and a panel not marked data-scrollable does not overflow.
 * Returns a list of problems (empty when all is well).
 */
export async function layoutProblems(page) {
  return page.evaluate(() => {
    const problems = []
    // Open dropdowns and menus (data-popover) float over the map: they only have to fit the screen.
    for (const el of document.querySelectorAll('[data-popover]')) {
      if (!el.getClientRects().length) continue
      const r = el.getBoundingClientRect()
      if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) {
        problems.push(`popover outside the viewport (${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)})`)
      }
    }
    const hidden = [...document.querySelectorAll('[data-popover]')].map((el) => [el, el.style.display])
    hidden.forEach(([el]) => { el.style.display = 'none' })
    const de = document.documentElement
    if (de.scrollHeight > innerHeight + 1 || de.scrollWidth > innerWidth + 1) {
      problems.push(`page scrolls: ${de.scrollWidth}×${de.scrollHeight} in ${innerWidth}×${innerHeight}`)
    }
    const panels = [...document.querySelectorAll('[data-panel]')]
      .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
    const rects = panels.map((el) => ({ name: el.dataset.panel, r: el.getBoundingClientRect(), el }))
    for (const { name, r, el } of rects) {
      if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) {
        problems.push(`${name} outside the viewport (${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)})`)
      }
      if (!('scrollable' in el.dataset) && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
        problems.push(`${name} overflows (${el.scrollWidth}×${el.scrollHeight} in ${el.clientWidth}×${el.clientHeight})`)
      }
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i].r
        const b = rects[j].r
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (ix > 0.5 && iy > 0.5 && !rects[i].el.contains(rects[j].el) && !rects[j].el.contains(rects[i].el)) {
          problems.push(`${rects[i].name} overlaps ${rects[j].name}`)
        }
      }
    }
    hidden.forEach(([el, display]) => { el.style.display = display })
    return problems
  })
}
