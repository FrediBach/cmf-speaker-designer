import { readFile } from 'node:fs/promises'
import { test as base, expect, type Page } from '@playwright/test'
import { inspectBinaryStl } from './stl'

const test = base.extend<{ appErrors: string[] }>({
  appErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      const onError = (error: Error) => errors.push(error.message)
      page.on('pageerror', onError)
      await use(errors)
      page.off('pageerror', onError)
      expect(
        errors,
        'Grille generation should not raise uncaught browser errors',
      ).toEqual([])
    },
    { auto: true },
  ],
})

async function expectGeneratedPanelReady(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Export STL', exact: true }),
  ).toBeEnabled({ timeout: 60_000 })
  await expect(page.locator('.preview-stage canvas')).toBeVisible()
  await expect(
    page.getByText('3D preview unavailable', { exact: true }),
  ).not.toBeVisible()
}

test('generates a custom speaker grille with through-holes, blind face recesses, and a connected handle', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await expectGeneratedPanelReady(page)

  // Preserve a supplied style so restoring the original grille also exercises source selection.
  await page.getByRole('button', { name: 'Slotted', exact: true }).click()
  await page.getByRole('tab', { name: 'Handle', exact: true }).click()
  await page.getByRole('button', { name: 'Custom handle', exact: true }).click()
  await page.getByRole('button', { name: 'Carry loop', exact: true }).click()
  await page.getByRole('tab', { name: 'Grille', exact: true }).click()
  await page.getByRole('button', { name: 'Custom grille', exact: true }).click()
  await page.getByRole('button', { name: 'Round', exact: true }).click()
  await page.getByRole('button', { name: 'Aligned', exact: true }).click()
  await page
    .getByRole('spinbutton', {
      name: 'Hole diameter in millimeters',
      exact: true,
    })
    .fill('4')
  await page
    .getByRole('spinbutton', {
      name: 'Space between openings in millimeters',
      exact: true,
    })
    .fill('2')
  await page
    .getByRole('spinbutton', {
      name: 'Pattern rotation in degrees',
      exact: true,
    })
    .fill('0')
  await page.locator('summary').filter({ hasText: 'Grille thickness' }).click()
  await page
    .getByRole('spinbutton', {
      name: 'Grille thickness in millimeters',
      exact: true,
    })
    .fill('3.5')
  await page.getByRole('checkbox', { name: /Continue across the face/ }).check()
  await page
    .getByRole('spinbutton', {
      name: 'Recess depth in millimeters',
      exact: true,
    })
    .fill('3')
  await expectGeneratedPanelReady(page)

  await page.reload()
  await expectGeneratedPanelReady(page)
  await expect(
    page.getByRole('tab', { name: 'Grille', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(
    page.getByRole('button', { name: 'Custom grille', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('button', { name: 'Round', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('button', { name: 'Aligned', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('spinbutton', {
      name: 'Hole diameter in millimeters',
      exact: true,
    }),
  ).toHaveValue('4')
  await expect(
    page.getByRole('spinbutton', {
      name: 'Space between openings in millimeters',
      exact: true,
    }),
  ).toHaveValue('2')
  await expect(
    page.getByRole('checkbox', { name: /Continue across the face/ }),
  ).toBeChecked()
  await expect(
    page.getByRole('spinbutton', {
      name: 'Recess depth in millimeters',
      exact: true,
    }),
  ).toHaveValue('3')
  await expect(
    page.getByRole('slider', { name: 'Recess depth', exact: true }),
  ).toHaveAttribute('aria-valuemax', '3')
  await page.screenshot({
    path: testInfo.outputPath('custom-grille-and-handle.png'),
    fullPage: true,
  })
  await page
    .locator('.preview-card')
    .screenshot({ path: testInfo.outputPath('custom-grille-closeup.png') })

  await page.getByRole('button', { name: 'Export STL', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Custom handle · 35 mm extension')
  const started = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download STL/ }).click()
  const download = await started
  expect(download.suggestedFilename()).toBe(
    'cmf-speaker-s-original-handle-35.0mm-grille-round-extended.stl',
  )
  const output = testInfo.outputPath(download.suggestedFilename())
  await download.saveAs(output)

  const mesh = inspectBinaryStl(await readFile(output))
  expect(
    mesh.components,
    'The handle, grille, and original panel must form one solid',
  ).toBe(1)
  expect(
    mesh.invalidEdges,
    'Every edge must have two oppositely wound faces',
  ).toBe(0)
  expect(mesh.degenerateEdges).toBe(0)
  expect(mesh.signedVolume).toBeGreaterThan(0)
  expect(
    mesh.genus,
    'The downloaded speaker opening must contain a real repeated pattern of holes',
  ).toBeGreaterThan(10)
  expect(mesh.maximum[0] - mesh.minimum[0]).toBeCloseTo(85, 3)
  expect(mesh.maximum[1] - mesh.minimum[1]).toBeCloseTo(141.9691, 3)
  expect(mesh.maximum[2] - mesh.minimum[2]).toBeCloseTo(24, 3)
  expect(mesh.minimum[2]).toBeCloseTo(0, 5)

  // A 4 mm opening with 2 mm webs creates a 6 mm grid anchored at canonical (0,0).
  // Export flips X and Z, and shifts front Z=4 onto the print bed.
  expect(
    mesh.rayZ(0, 0),
    'A patterned opening over the speaker must pass through the grille',
  ).toEqual([])
  expect(
    mesh.rayZ(0, -24),
    'An opening close to the driver center must also pass through',
  ).toEqual([])
  const blindRecess = mesh.rayZ(-36, 0)
  expect(
    blindRecess,
    'An extended face recess must retain a rear wall',
  ).toHaveLength(2)
  expect(blindRecess[0]).toBeCloseTo(3, 3)
  expect(blindRecess[1]).toBeCloseTo(3.5, 3)
  for (const [x, y] of [
    [0, 6],
    [-30, -24],
    [0, -54],
  ]) {
    const transitionRecess = mesh.rayZ(x, y)
    expect(
      transitionRecess,
      'The pattern must continue across the speaker rim as a blind recess',
    ).toHaveLength(2)
    expect(transitionRecess[0]).toBeCloseTo(3, 3)
    expect(transitionRecess[1]).toBeCloseTo(3.5, 3)
  }
  const untouchedWeb = mesh.rayZ(-33, 0)
  expect(untouchedWeb).toHaveLength(2)
  expect(untouchedWeb[0]).toBeCloseTo(0, 3)
  expect(untouchedWeb[1]).toBeCloseTo(3.5, 3)
  expect(blindRecess[1] - blindRecess[0]).toBeCloseTo(0.5, 3)
  expect(
    mesh.rayZ(0, 60.98455),
    'The separately designed carry-loop opening must remain clear',
  ).toEqual([])

  await page.locator('summary').filter({ hasText: 'Grille thickness' }).click()
  await page
    .getByRole('spinbutton', {
      name: 'Grille thickness in millimeters',
      exact: true,
    })
    .fill('2')
  await expect(
    page.getByRole('spinbutton', {
      name: 'Recess depth in millimeters',
      exact: true,
    }),
  ).toHaveValue('1.5')
  await expect(
    page.getByRole('slider', { name: 'Recess depth', exact: true }),
  ).toHaveAttribute('aria-valuemax', '1.5')
  await expectGeneratedPanelReady(page)

  await page.getByRole('button', { name: 'Hexagon', exact: true }).click()
  await expectGeneratedPanelReady(page)
  await expect(
    page.getByRole('spinbutton', {
      name: 'Hexagon diameter in millimeters',
      exact: true,
    }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Slot', exact: true }).click()
  await page
    .getByRole('spinbutton', {
      name: 'Slot length in millimeters',
      exact: true,
    })
    .fill('12')
  await expectGeneratedPanelReady(page)
  await expect(
    page.getByRole('button', { name: 'Slot', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page
    .getByRole('button', { name: 'Original grille', exact: true })
    .click()
  await expectGeneratedPanelReady(page)
  await page.getByRole('tab', { name: 'Front panel', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Slotted', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('tab', { name: 'Handle', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Custom handle', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('spinbutton', {
      name: 'Extension height in millimeters',
      exact: true,
    }),
  ).toHaveValue('35')
})

test.describe('mobile grille controls', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  })

  test('keeps grille controls and the combined export reachable on a narrow screen', async ({
    page,
  }, testInfo) => {
    await page.goto('/')
    await expectGeneratedPanelReady(page)
    await page.getByRole('tab', { name: 'Grille', exact: true }).click()
    await page
      .getByRole('button', { name: 'Custom grille', exact: true })
      .click()
    await page.getByRole('button', { name: 'Staggered', exact: true }).click()
    await page
      .getByRole('checkbox', { name: /Continue across the face/ })
      .check()
    await expectGeneratedPanelReady(page)
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }))
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.width + 1)
    await page.screenshot({
      path: testInfo.outputPath('mobile-custom-grille.png'),
      fullPage: true,
    })
    await page.getByRole('button', { name: 'Export STL', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const exportButton = dialog.getByRole('button', { name: /^Download STL/ })
    await exportButton.scrollIntoViewIfNeeded()
    await expect(exportButton).toBeInViewport()
    const bounds = await dialog.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391)
  })
})
