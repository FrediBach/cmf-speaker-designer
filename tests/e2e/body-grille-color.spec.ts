import { expect, test, type Page } from '@playwright/test'
import { STORAGE_KEY, type Design } from '../../src/lib/design'

async function storedDesign(page: Page): Promise<Design> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    STORAGE_KEY,
  )
}

async function expectReady(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Export design', exact: true }),
  ).toBeEnabled()
  await expect(page.locator('.preview-stage canvas')).toBeVisible()
  await expect(
    page.getByText('3D preview unavailable', { exact: true }),
  ).toBeHidden()
}

async function stablePreview(page: Page) {
  let previous: Buffer | undefined
  await expect
    .poll(async () => {
      const frame = await page.locator('.preview-stage canvas').screenshot()
      const stable = previous?.equals(frame) ?? false
      previous = frame
      return stable
    })
    .toBe(true)
  return previous!
}

test('changes the speaker grille independently and restores the gray body constraint atomically', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await expectReady(page)
  const original = await storedDesign(page)
  const preview = page.locator('[role="img"][data-preview-controls]')
  const grille = page.getByRole('group', {
    name: 'Speaker grille',
    exact: true,
  })
  const black = grille.getByRole('button', {
    name: 'Speaker grille: Black',
    exact: true,
  })
  const orange = grille.getByRole('button', {
    name: 'Speaker grille: Orange',
    exact: true,
  })
  const turquoise = grille.getByRole('button', {
    name: 'Speaker grille: Turquoise',
    exact: true,
  })
  await expect(black).toHaveAttribute('aria-pressed', 'true')
  const blackFrame = await stablePreview(page)

  await orange.focus()
  await orange.press('Space')
  await expect(orange).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(() => storedDesign(page))
    .toEqual({
      ...original,
      bodyGrilleColor: 'orange',
    })
  await expect(preview).toHaveAttribute('aria-label', /orange grille/)
  const orangeFrame = await stablePreview(page)
  expect(orangeFrame.equals(blackFrame)).toBe(false)
  await page.screenshot({
    path: testInfo.outputPath('speaker-orange-grille-desktop.png'),
  })

  await page.keyboard.press('Control+z')
  await expect.poll(() => storedDesign(page)).toEqual(original)
  await page.keyboard.press('Control+Shift+z')
  await expect(orange).toHaveAttribute('aria-pressed', 'true')

  await turquoise.click()
  const colored = { ...original, bodyGrilleColor: 'turquoise' }
  await expect.poll(() => storedDesign(page)).toEqual(colored)
  const turquoiseFrame = await stablePreview(page)
  expect(turquoiseFrame.equals(blackFrame)).toBe(false)
  expect(turquoiseFrame.equals(orangeFrame)).toBe(false)
  await page.screenshot({
    path: testInfo.outputPath('speaker-turquoise-grille-desktop.png'),
  })
  await page
    .getByRole('button', { name: 'Speaker body: Gray', exact: true })
    .click()
  const gray = { ...original, bodyColor: 'gray', bodyGrilleColor: 'black' }
  await expect.poll(() => storedDesign(page)).toEqual(gray)
  await expect(black).toHaveAttribute('aria-pressed', 'true')
  await expect(orange).toBeDisabled()
  await expect(turquoise).toBeDisabled()
  await expect(preview).toHaveAttribute('aria-label', /gray body.*black grille/)

  await page.keyboard.press('Control+z')
  await expect.poll(() => storedDesign(page)).toEqual(colored)
  await expect(turquoise).toHaveAttribute('aria-pressed', 'true')
  await expect(orange).toBeEnabled()
  await page.keyboard.press('Control+Shift+z')
  await expect.poll(() => storedDesign(page)).toEqual(gray)

  await page
    .getByRole('button', { name: 'Speaker body: Black', exact: true })
    .click()
  await expect.poll(() => storedDesign(page)).toEqual(original)
  await expect(turquoise).toBeEnabled()
  await turquoise.click()
  await page.reload()
  await expectReady(page)
  await expect(turquoise).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => storedDesign(page)).toEqual(colored)
})

test('normalizes imported gray grilles and keeps all color choices reachable at 320 pixels', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/')
  await expectReady(page)
  await page.getByLabel('Design JSON file', { exact: true }).setInputFiles({
    name: 'gray-speaker.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        model: 'm',
        bodyColor: 'gray',
        bodyGrilleColor: 'orange',
      }),
    ),
  })
  await expect
    .poll(async () => {
      const { model, bodyColor, bodyGrilleColor } = await storedDesign(page)
      return { model, bodyColor, bodyGrilleColor }
    })
    .toEqual({ model: 'm', bodyColor: 'gray', bodyGrilleColor: 'black' })
  const grille = page.getByRole('group', {
    name: 'Speaker grille',
    exact: true,
  })
  await grille.scrollIntoViewIfNeeded()
  for (const color of ['Black', 'Orange', 'Turquoise']) {
    await expect(
      grille.getByRole('button', {
        name: `Speaker grille: ${color}`,
        exact: true,
      }),
    ).toBeInViewport({ ratio: 1 })
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320)
  await page
    .getByRole('button', { name: 'Speaker body: Black', exact: true })
    .click()
  await grille
    .getByRole('button', { name: 'Speaker grille: Turquoise', exact: true })
    .click()
  await expect
    .poll(async () => {
      const { model, bodyColor, bodyGrilleColor } = await storedDesign(page)
      return { model, bodyColor, bodyGrilleColor }
    })
    .toEqual({ model: 'm', bodyColor: 'black', bodyGrilleColor: 'turquoise' })
  await expectReady(page)
  await page.screenshot({
    path: testInfo.outputPath('body-grille-colors-mobile.png'),
  })
})
