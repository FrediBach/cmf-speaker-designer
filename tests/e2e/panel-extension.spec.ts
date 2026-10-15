import { readFile } from 'node:fs/promises'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { STORAGE_KEY } from '../../src/lib/design'
import { inspectBinaryStl } from './stl'
import { revealSpeakerControls } from './controls'

async function expectReady(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Export design', exact: true }),
  ).toBeEnabled()
  await expect(page.locator('.preview-stage canvas')).toBeVisible()
  await expect(
    page.getByText('3D preview unavailable', { exact: true }),
  ).not.toBeVisible()
}

async function storedExtension(page: Page): Promise<number> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).panelExtension,
    STORAGE_KEY,
  )
}

async function downloadPanel(
  page: Page,
  testInfo: TestInfo,
  model: 's' | 'm',
  extension: number,
  handleWidth?: number,
) {
  await expectReady(page)
  await page.getByRole('button', { name: 'Export design', exact: true }).click()
  const dialog = page.getByRole('dialog', {
    name: 'Export design',
    exact: true,
  })
  const summary = dialog.getByText('Side extension · 1.00 cm per side', {
    exact: true,
  })
  if (extension > 0) await expect(summary).toBeVisible()
  else await expect(summary).toHaveCount(0)
  await dialog
    .getByRole('group', { name: 'Export parts' })
    .getByRole('button', { name: 'Panel only', exact: true })
    .click()
  const started = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download STL/ }).click()
  const download = await started
  expect(download.suggestedFilename()).toBe(
    `cmf-speaker-${model}-original${extension > 0 ? '-sides-10.0mm' : ''}${handleWidth ? '-handle-35.0mm' : ''}.stl`,
  )
  const output = testInfo.outputPath(
    `speaker-${model}-sides-${extension}mm${handleWidth ? `-handle-width-${handleWidth}mm` : ''}.stl`,
  )
  await download.saveAs(output)
  const binary = await readFile(output)
  const mesh = inspectBinaryStl(binary)
  expect(mesh.components, 'The panel must remain one solid').toBe(1)
  expect(mesh.invalidEdges, 'Every edge must have two opposing faces').toBe(0)
  expect(mesh.degenerateEdges).toBe(0)
  expect(mesh.signedVolume).toBeGreaterThan(0)
  expect(mesh.minimum[2]).toBeCloseTo(0, 5)
  return { ...mesh, binary }
}

type PanelMesh = Awaited<ReturnType<typeof downloadPanel>>

function upperHandleBounds(mesh: PanelMesh, seamY: number) {
  let minimum = Infinity
  let maximum = -Infinity
  // Above the 4 mm attachment shoulder, the handle's vertical edges and
  // rounded top must fit its own width, independently of the control deck.
  for (let triangle = 84; triangle < mesh.binary.length; triangle += 50) {
    for (let corner = 0; corner < 3; corner += 1) {
      const offset = triangle + 12 + corner * 12
      if (mesh.binary.readFloatLE(offset + 4) <= seamY + 4.01) continue
      const x = mesh.binary.readFloatLE(offset)
      minimum = Math.min(minimum, x)
      maximum = Math.max(maximum, x)
    }
  }
  expect(Number.isFinite(minimum) && Number.isFinite(maximum)).toBe(true)
  return [minimum, maximum] as const
}

function expectExtendedDeck(mesh: PanelMesh, model: 's' | 'm') {
  const deckY = model === 's' ? 29.5 : 70
  for (const x of [-50, 50]) {
    expect(
      mesh.rayZ(x, deckY),
      'The side extension must continue through both sides of the angled controls',
    ).toHaveLength(2)
  }
}

function expectUnchangedOriginalHandle(
  original: PanelMesh,
  extended: PanelMesh,
  model: 's' | 'm',
) {
  const seamY = original.maximum[1] - (model === 's' ? 24 : 27)
  const originalBounds = upperHandleBounds(original, seamY)
  const extendedBounds = upperHandleBounds(extended, seamY)
  originalBounds.forEach((bound, side) =>
    expect(extendedBounds[side]).toBeCloseTo(bound, 4),
  )
  const deckY = model === 's' ? 29.5 : 70
  for (const x of [-50, 50]) expect(original.rayZ(x, deckY)).toEqual([])
  expectExtendedDeck(extended, model)
}

function expectExtendedBounds(
  original: ReturnType<typeof inspectBinaryStl>,
  extended: ReturnType<typeof inspectBinaryStl>,
) {
  expect(Math.abs(original.maximum[0] - original.minimum[0] - 85)).toBeLessThan(
    0.1,
  )
  expect(
    Math.abs(extended.maximum[0] - extended.minimum[0] - 105),
  ).toBeLessThan(0.1)
  // The preserved rear mounting edge is about 0.016 mm wider than the front
  // lip on each side, so total bounds grow slightly less than the 10 mm lip.
  expect(extended.minimum[0]).toBeCloseTo(original.minimum[0] - 10, 1)
  expect(extended.maximum[0]).toBeCloseTo(original.maximum[0] + 10, 1)
  for (const axis of [1, 2]) {
    expect(extended.minimum[axis]).toBeCloseTo(original.minimum[axis], 4)
    expect(extended.maximum[axis]).toBeCloseTo(original.maximum[axis], 4)
  }
  expect(extended.genus, 'Existing openings must remain intact').toBe(
    original.genus,
  )
}

test('extends each panel side by up to 1 cm, keeps history and persistence, and exports both models', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expectReady(page)
  await page.getByRole('tab', { name: 'Front panel', exact: true }).click()
  const slider = page.getByRole('slider', {
    name: 'Side extension',
    exact: true,
  })
  await expect(slider).toHaveAttribute('aria-valuemin', '0')
  await expect(slider).toHaveAttribute('aria-valuemax', '1')
  await expect(slider).toHaveAttribute('aria-valuenow', '0')
  await slider.press('ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuenow', '0.01')
  await expect.poll(() => storedExtension(page)).toBe(0.1)
  await slider.press('Home')
  const smallOriginal = await downloadPanel(page, testInfo, 's', 0)

  await slider.press('End')
  await expect(slider).toHaveAttribute('aria-valuenow', '1')
  await expect.poll(() => storedExtension(page)).toBe(10)
  await page.getByRole('button', { name: 'Randomize', exact: true }).focus()
  await page.keyboard.press('Control+z')
  await expect(slider).toHaveAttribute('aria-valuenow', '0')
  await page.keyboard.press('Control+y')
  await expect(slider).toHaveAttribute('aria-valuenow', '1')
  await page.reload()
  await expectReady(page)
  await expect(slider).toHaveAttribute('aria-valuenow', '1')
  const smallExtended = await downloadPanel(page, testInfo, 's', 10)
  expectExtendedBounds(smallOriginal, smallExtended)
  expectUnchangedOriginalHandle(smallOriginal, smallExtended, 's')
  expect(smallExtended.rayZ(0, -23)).toEqual([])
  await slider.scrollIntoViewIfNeeded()
  await page.screenshot({
    path: testInfo.outputPath('speaker-s-1cm-side-extension.png'),
    fullPage: true,
  })

  await revealSpeakerControls(page)
  await page.getByRole('button', { name: /^Speaker M/ }).click()
  await expect(slider).toHaveAttribute('aria-valuenow', '1')
  const mediumExtended = await downloadPanel(page, testInfo, 'm', 10)
  for (const center of [15, -70]) {
    expect(mediumExtended.rayZ(0, center)).toEqual([])
  }
  await slider.press('Home')
  const mediumOriginal = await downloadPanel(page, testInfo, 'm', 0)
  expectExtendedBounds(mediumOriginal, mediumExtended)
  expectUnchangedOriginalHandle(mediumOriginal, mediumExtended, 'm')
  await slider.press('End')
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(slider).toHaveAttribute('aria-valuenow', '0')
  await expect.poll(() => storedExtension(page)).toBe(0)
  await revealSpeakerControls(page)
  await expect(
    page.getByRole('button', { name: /^Speaker M/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expectReady(page)
  expect(errors).toEqual([])
})

test('keeps the angled controls extended while custom handles retain their selected widths', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expectReady(page)
  await page
    .getByRole('slider', { name: 'Side extension', exact: true })
    .press('End')
  await page.getByRole('tab', { name: 'Handle', exact: true }).click()
  await page.getByRole('button', { name: 'Custom handle', exact: true }).click()
  await page.getByRole('button', { name: 'Carry loop', exact: true }).click()
  const widthInput = page.getByRole('spinbutton', {
    name: 'Handle width in millimeters',
    exact: true,
  })

  for (const model of ['s', 'm'] as const) {
    await revealSpeakerControls(page)
    await page
      .getByRole('button', {
        name: new RegExp(`^Speaker ${model.toUpperCase()}`),
      })
      .click()
    for (const width of [70, 110]) {
      await widthInput.fill(String(width))
      const mesh = await downloadPanel(page, testInfo, model, 10, width)
      const seamY = mesh.maximum[1] - 35
      const bounds = upperHandleBounds(mesh, seamY)
      expect(bounds[0]).toBeCloseTo(-width / 2, 4)
      expect(bounds[1]).toBeCloseTo(width / 2, 4)
      expectExtendedDeck(mesh, model)
      if (model === 's' && width === 70) {
        await widthInput.scrollIntoViewIfNeeded()
        await page.screenshot({
          path: testInfo.outputPath('speaker-s-1cm-sides-70mm-handle.png'),
          fullPage: true,
        })
      }
    }
  }
  expect(errors).toEqual([])
})
