import { readFile } from 'node:fs/promises'
import { test as base, expect, type Page } from '@playwright/test'

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
        'The designer should not raise uncaught browser errors',
      ).toEqual([])
    },
    { auto: true },
  ],
})

async function expectPanelReady(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Download your panel', exact: true }),
  ).toBeEnabled()
  await expect(page.locator('.preview-stage canvas')).toBeVisible()
  await expect(
    page.getByText('Loading your panel…', { exact: true }),
  ).not.toBeVisible()
  await expect(
    page.getByText('3D preview unavailable', { exact: true }),
  ).not.toBeVisible()
}

test('renders WebGL and switches real panel designs, colors, and preview modes', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Make it yours.' }),
  ).toBeVisible()
  await expectPanelReady(page)

  const canvasState = await page
    .locator('.preview-stage canvas')
    .evaluate((element) => {
      const canvas = element as HTMLCanvasElement
      const context = canvas.getContext('webgl2')
      return {
        width: canvas.width,
        height: canvas.height,
        webgl: !!context,
        contextLost: context?.isContextLost(),
      }
    })
  expect(canvasState.width).toBeGreaterThan(0)
  expect(canvasState.height).toBeGreaterThan(0)
  expect(canvasState.webgl).toBe(true)
  expect(canvasState.contextLost).toBe(false)
  await page.screenshot({
    path: testInfo.outputPath('default-designer.png'),
    fullPage: true,
  })

  // These model-specific names correspond to the actual supplied S/M files.
  const variants = [
    {
      model: 'S',
      height: '131',
      styles: ['Original', 'Halo', 'Perforated', 'Slotted'],
    },
    {
      model: 'M',
      height: '225',
      styles: ['Original', 'Halo', 'Twin contours', 'Perforated'],
    },
  ]
  for (const variant of variants) {
    const modelButton = page.getByRole('button', {
      name: new RegExp(`^Speaker ${variant.model}`),
    })
    await modelButton.click()
    await expect(modelButton).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.style-options button')).toHaveText(
      variant.styles,
    )
    for (const style of variant.styles) {
      const styleButton = page.getByRole('button', { name: style, exact: true })
      await styleButton.click()
      await expect(styleButton).toHaveAttribute('aria-pressed', 'true')
      await expectPanelReady(page)
      await expect(page.locator('.preview-model')).toContainText(
        `CMF Speaker ${variant.model}`,
      )
      await expect(page.locator('.preview-model')).toContainText(style)
      await expect(page.locator('.preview-dimensions')).toContainText(
        `85 × ${variant.height} MM`,
      )
    }
  }

  await page
    .getByRole('button', { name: 'Front panel: Lagoon', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Volume knob: Chalk', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Front panel: Lagoon', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('button', { name: 'Front panel: CMF orange', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false')
  await expect(
    page.getByRole('button', { name: 'Volume knob: Chalk', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')

  for (const mode of ['Panel only', 'Exploded', 'Speaker']) {
    const modeButton = page.getByRole('button', { name: mode, exact: true })
    await modeButton.click()
    await expect(modeButton).toHaveAttribute('aria-pressed', 'true')
  }
  await page.getByRole('button', { name: 'Front', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Front', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')

  await page.reload()
  await expectPanelReady(page)
  await expect(
    page.getByRole('button', { name: /^Speaker M/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('button', { name: 'Perforated', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('button', { name: 'Front panel: Lagoon', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('button', { name: 'Volume knob: Chalk', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({
    path: testInfo.outputPath('desktop-designer.png'),
    fullPage: true,
  })
})

test('keyboard face depth produces a correctly named full-size binary STL download', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await expectPanelReady(page)
  await page.getByRole('button', { name: /^Speaker M/ }).click()
  await page.getByRole('button', { name: 'Twin contours', exact: true }).click()
  await expectPanelReady(page)

  const depth = page.getByRole('slider', {
    name: 'Added face depth',
    exact: true,
  })
  await depth.focus()
  await depth.press('ArrowRight')
  await depth.press('ArrowRight')
  await expect(depth).toHaveAttribute('aria-valuenow', '0.2')
  await expectPanelReady(page)
  await page
    .getByRole('button', { name: 'Download your panel', exact: true })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Speaker M · Twin contours')
  await expect(dialog).toContainText('0.2 mm')

  const downloadStarted = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download STL/ }).click()
  const download = await downloadStarted
  expect(download.suggestedFilename()).toBe(
    'cmf-speaker-m-twin-contours-depth-0.2mm.stl',
  )
  const output = testInfo.outputPath(download.suggestedFilename())
  await download.saveAs(output)
  const binary = await readFile(output)
  const triangleCount = binary.readUInt32LE(80)
  expect(triangleCount).toBe(233_048)
  expect(binary.byteLength).toBe(84 + triangleCount * 50)

  // Read the actual browser download independently of the app's STL exporter.
  const minimum = [Infinity, Infinity, Infinity]
  const maximum = [-Infinity, -Infinity, -Infinity]
  let nonFiniteCoordinates = 0
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const vertexOffset = 84 + triangle * 50 + 12
    for (let vertex = 0; vertex < 3; vertex += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const coordinate = binary.readFloatLE(
          vertexOffset + vertex * 12 + axis * 4,
        )
        if (!Number.isFinite(coordinate)) nonFiniteCoordinates += 1
        minimum[axis] = Math.min(minimum[axis], coordinate)
        maximum[axis] = Math.max(maximum[axis], coordinate)
      }
    }
  }
  expect(nonFiniteCoordinates).toBe(0)
  expect(maximum[0] - minimum[0]).toBeCloseTo(84.9715, 3)
  expect(maximum[1] - minimum[1]).toBeCloseTo(224.9691, 3)
  expect(maximum[2] - minimum[2]).toBeCloseTo(52.775, 3)
  expect(minimum[2]).toBeCloseTo(0, 5)
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('status')).toContainText('Your STL is downloaded')
})

test.describe('mobile layout', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  })

  test('fits a narrow viewport and keeps controls and export reachable', async ({
    page,
  }, testInfo) => {
    await page.goto('/')
    await expectPanelReady(page)
    const viewport = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }))
    expect(viewport.content).toBeLessThanOrEqual(viewport.viewport + 1)

    await page
      .getByRole('button', { name: 'Front panel: Chalk', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: 'Front panel: Chalk', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await page
      .getByRole('button', { name: 'Download your panel', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: /^Download STL/ }),
    ).toBeVisible()
    const bounds = await dialog.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391)
    await page.screenshot({
      path: testInfo.outputPath('mobile-download.png'),
      fullPage: true,
    })
    await dialog
      .getByRole('button', { name: 'Close dialog', exact: true })
      .click()
    await page.screenshot({
      path: testInfo.outputPath('mobile-designer.png'),
      fullPage: true,
    })
  })
})
