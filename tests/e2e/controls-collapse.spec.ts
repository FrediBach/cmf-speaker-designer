import { expect, test } from '@playwright/test'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 320, height: 568 },
]) {
  test(`collapses speaker controls and restores them from metadata at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    const settings = page.locator('.speaker-settings')
    const scroller = page.getByRole('region', {
      name: 'Front panel parameters',
    })
    const model = page.getByRole('button', { name: /^Speaker M/ })
    await model.click()
    await page
      .getByRole('button', { name: 'Speaker grille: Turquoise', exact: true })
      .click()
    const initialHeight = await scroller.evaluate(
      (element) => element.clientHeight,
    )

    await scroller.hover()
    await page.mouse.wheel(0, 350)
    await expect(settings).toHaveAttribute('data-collapsed', 'true')
    const summary = page.getByRole('button', {
      name: /^Edit speaker model and colors/,
    })
    await expect(summary).toHaveAccessibleName(
      'Edit speaker model and colors: Speaker M, 85 × 225 mm, Black body, Turquoise grille',
    )
    await expect(summary).toBeInViewport({ ratio: 1 })
    await expect(model).toBeHidden()
    await expect
      .poll(() => scroller.evaluate((element) => element.clientHeight))
      .toBeGreaterThan(initialHeight + 80)
    await expect(
      page.getByRole('button', { name: 'Export design', exact: true }),
    ).toBeInViewport({ ratio: 1 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width)
    await page.screenshot({ path: testInfo.outputPath('speaker-summary.png') })

    await summary.click()
    await expect(settings).toHaveAttribute('data-collapsed', 'false')
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBe(0)
    await expect
      .poll(() => scroller.evaluate((element) => element.clientHeight))
      .toBe(initialHeight)
    await expect(model).toBeFocused()
    await expect(model).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByRole('button', {
        name: 'Speaker grille: Turquoise',
        exact: true,
      }),
    ).toHaveAttribute('aria-pressed', 'true')

    // Scrolling up partway keeps the summary; reaching the top reveals controls.
    await scroller.focus()
    await scroller.hover()
    await page.mouse.wheel(0, 350)
    await expect(settings).toHaveAttribute('data-collapsed', 'true')
    await expect
      .poll(() => scroller.evaluate((element) => element.clientHeight))
      .toBeGreaterThan(initialHeight + 80)
    await page.mouse.wheel(0, -80)
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBeLessThan(350)
    expect(
      await scroller.evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(0)
    await expect(settings).toHaveAttribute('data-collapsed', 'true')
    await page.mouse.wheel(0, -2000)
    await expect(settings).toHaveAttribute('data-collapsed', 'false')
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBe(0)
    await expect(scroller).toBeFocused()
    await expect(model).toBeVisible()
    await expect
      .poll(() => scroller.evaluate((element) => element.clientHeight))
      .toBe(initialHeight)

    // Keyboard scrolling also reveals at the top without stealing focus.
    await scroller.press('PageDown')
    await expect(settings).toHaveAttribute('data-collapsed', 'true')
    await scroller.press('Home')
    await expect(settings).toHaveAttribute('data-collapsed', 'false')
    await expect(scroller).toBeFocused()
    await expect
      .poll(() => scroller.evaluate((element) => element.clientHeight))
      .toBe(initialHeight)

    // Changing tabs preserves the extra space.
    await scroller.focus()
    await scroller.press('PageDown')
    await expect(settings).toHaveAttribute('data-collapsed', 'true')
    await page.getByRole('tab', { name: 'Handle', exact: true }).click()
    const handleScroller = page.getByRole('region', {
      name: 'Handle parameters',
    })
    await expect
      .poll(() => handleScroller.evaluate((element) => element.scrollTop))
      .toBe(0)
    await expect(settings).toHaveAttribute('data-collapsed', 'true')
    await summary.focus()
    await summary.press('Enter')
    await expect(model).toBeFocused()
    await expect(settings).toHaveAttribute('data-collapsed', 'false')
    await expect(
      page.getByRole('tab', { name: 'Handle', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
  })
}

test('stays collapsed when the editor becomes tall enough to fit and respects reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Handle', exact: true }).click()
  const scroller = page.getByRole('region', { name: 'Handle parameters' })
  // Leave just a little overflow, so collapsing clamps the scroll offset to zero.
  const height = await scroller.evaluate(
    (element) =>
      window.innerHeight + element.scrollHeight - element.clientHeight - 40,
  )
  await page.setViewportSize({ width: 1440, height })
  await scroller.hover()
  await page.mouse.wheel(0, 30)
  const summary = page.getByRole('button', {
    name: /^Edit speaker model and colors/,
  })
  await expect(summary).toBeVisible()
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBe(0)
  await expect(page.locator('.speaker-settings')).toHaveAttribute(
    'data-collapsed',
    'true',
  )
  await expect
    .poll(() =>
      scroller.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    )
    .toBe(0)
  await summary.press('Space')
  await expect(page.getByRole('button', { name: /^Speaker S/ })).toBeFocused()
  await expect(page.locator('.speaker-settings')).toHaveAttribute(
    'data-collapsed',
    'false',
  )
})
