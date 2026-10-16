import { readFile } from 'node:fs/promises'
import {
  test as base,
  expect,
  type Page,
  type TestInfo,
} from '@playwright/test'
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
    page.getByRole('button', { name: 'Export design', exact: true }),
  ).toBeEnabled({ timeout: 60_000 })
  await expect(page.locator('.preview-stage canvas')).toBeVisible()
  await expect(
    page.getByText('3D preview unavailable', { exact: true }),
  ).not.toBeVisible()
}

async function downloadPatternPanel(
  page: Page,
  testInfo: TestInfo,
  label: string,
  facePattern: string | null,
) {
  await expectGeneratedPanelReady(page)
  await page.getByRole('button', { name: 'Export design', exact: true }).click()
  const dialog = page.getByRole('dialog')
  if (facePattern) await expect(dialog).toContainText(facePattern)
  else await expect(dialog).not.toContainText('face pattern')
  await dialog
    .getByRole('group', { name: 'Export parts' })
    .getByRole('button', { name: 'Panel only', exact: true })
    .click()
  const started = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download STL/ }).click()
  const download = await started
  const output = testInfo.outputPath(`${label}.stl`)
  await download.saveAs(output)
  const mesh = inspectBinaryStl(await readFile(output))
  expect(mesh.components, 'The patterned panel must remain one solid').toBe(1)
  expect(mesh.invalidEdges, 'Every edge must have two opposing faces').toBe(0)
  expect(mesh.degenerateEdges).toBe(0)
  expect(mesh.signedVolume).toBeGreaterThan(0)
  expect(mesh.minimum[2]).toBeCloseTo(0, 5)
  return mesh
}

test('generates a custom speaker grille with through-holes, blind face recesses, and a connected handle', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await expectGeneratedPanelReady(page)

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
  ).toHaveAttribute('aria-valuemax', '6')
  await page.screenshot({
    path: testInfo.outputPath('custom-grille-and-handle.png'),
    fullPage: true,
  })
  await page
    .locator('.preview-card')
    .screenshot({ path: testInfo.outputPath('custom-grille-closeup.png') })

  await page.getByRole('button', { name: 'Export design', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Custom handle · 35 mm extension')
  await dialog
    .getByRole('group', { name: 'Export parts' })
    .getByRole('button', { name: 'Panel only', exact: true })
    .click()
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
  ).toHaveValue('3')
  await expect(
    page.getByRole('slider', { name: 'Recess depth', exact: true }),
  ).toHaveAttribute('aria-valuemax', '6')
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
  await page.getByRole('tab', { name: 'Front panel', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Custom', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Original', exact: true }).click()
  await expectGeneratedPanelReady(page)
  await expect(page.locator('.preview-model')).toContainText('Original')
  await page.getByRole('tab', { name: 'Grille', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Original grille', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Custom grille', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Slot', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('spinbutton', {
      name: 'Slot length in millimeters',
      exact: true,
    }),
  ).toHaveValue('12')
  await page
    .getByRole('button', { name: 'Original grille', exact: true })
    .click()
  await expectGeneratedPanelReady(page)
  await page.getByRole('tab', { name: 'Front panel', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Custom', exact: true }),
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

test('exports through-face holes, raised patterns, and a flat face from signed recess depth', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await expectGeneratedPanelReady(page)
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
  await page.getByRole('checkbox', { name: /Continue across the face/ }).check()
  const depth = page.getByRole('spinbutton', {
    name: 'Recess depth in millimeters',
    exact: true,
  })
  const slider = page.getByRole('slider', {
    name: 'Recess depth',
    exact: true,
  })
  await expect(slider).toHaveAttribute('aria-valuemin', '-3')
  await expect(slider).toHaveAttribute('aria-valuemax', '6')
  await depth.fill('6')
  const through = await downloadPatternPanel(
    page,
    testInfo,
    'through-face-pattern',
    '6 mm recessed face pattern',
  )
  expect(
    through.rayZ(-36, 0),
    'A deep recess must pass through the face away from case attachments',
  ).toEqual([])
  expect(through.rayZ(0, 0), 'Speaker openings remain through-holes').toEqual(
    [],
  )
  const throughWeb = through.rayZ(-33, 0)
  expect(throughWeb).toHaveLength(2)
  expect(throughWeb[1] - throughWeb[0]).toBeCloseTo(3.5, 3)

  await depth.fill('-1.8')
  await expectGeneratedPanelReady(page)
  await page.reload()
  await expectGeneratedPanelReady(page)
  await expect(depth).toHaveValue('-1.8')
  await expect(slider).toHaveAttribute('aria-valuenow', '-1.8')
  const raised = await downloadPatternPanel(
    page,
    testInfo,
    'raised-face-pattern',
    '1.8 mm raised face pattern',
  )
  const raisedBump = raised.rayZ(-36, 0)
  const raisedWeb = raised.rayZ(-33, 0)
  expect(raisedBump).toHaveLength(2)
  expect(raisedWeb).toHaveLength(2)
  expect(
    raisedWeb[0] - raisedBump[0],
    'A negative depth raises the pattern by the specified height',
  ).toBeCloseTo(1.8, 3)
  expect(
    raisedBump[1],
    'Raised detail must retain the rear surface',
  ).toBeCloseTo(raisedWeb[1], 3)
  expect(raisedWeb[1] - raisedWeb[0]).toBeCloseTo(3.5, 3)
  expect(
    raised.rayZ(0, 0),
    'Raised detail must leave the speaker open',
  ).toEqual([])
  await page.locator('.preview-card').screenshot({
    path: testInfo.outputPath('raised-face-pattern.png'),
  })

  await depth.fill('0')
  const flat = await downloadPatternPanel(page, testInfo, 'flat-face', null)
  const flatPattern = flat.rayZ(-36, 0)
  const flatWeb = flat.rayZ(-33, 0)
  expect(flatPattern).toHaveLength(2)
  expect(flatWeb).toHaveLength(2)
  expect(flatPattern[0], 'Zero depth leaves the face flush').toBeCloseTo(
    flatWeb[0],
    3,
  )
  expect(flatPattern[1] - flatPattern[0]).toBeCloseTo(3.5, 3)
  expect(flat.rayZ(0, 0)).toEqual([])
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
    await page
      .getByRole('button', { name: 'Export design', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    const exportButton = dialog.getByRole('button', { name: /^Download ZIP/ })
    await exportButton.scrollIntoViewIfNeeded()
    await expect(exportButton).toBeInViewport()
    const bounds = await dialog.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391)
  })
})
