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
        'The designer should not raise uncaught browser errors',
      ).toEqual([])
    },
    { auto: true },
  ],
})

async function expectPanelReady(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Export STL', exact: true }),
  ).toBeEnabled()
  await expect(page.locator('.preview-stage canvas')).toBeVisible()
  await expect(
    page.getByText('Loading your panel…', { exact: true }),
  ).not.toBeVisible()
  await expect(
    page.getByText('3D preview unavailable', { exact: true }),
  ).not.toBeVisible()
}

async function expectWorkspaceInViewport(page: Page) {
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
    height: window.innerHeight,
    contentHeight: document.documentElement.scrollHeight,
    scrollY: window.scrollY,
  }))
  expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.width + 1)
  expect(dimensions.contentHeight).toBeLessThanOrEqual(dimensions.height + 1)
  expect(dimensions.scrollY).toBe(0)
  await expect(page.locator('.preview-card')).toBeInViewport({ ratio: 1 })
  await expect(
    page.getByRole('button', { name: 'Export STL', exact: true }),
  ).toBeInViewport({ ratio: 1 })
}

async function revealDeepHandleControl(page: Page) {
  await page.getByRole('tab', { name: 'Handle', exact: true }).click()
  await page.getByRole('button', { name: 'Custom handle', exact: true }).click()
  await page.getByRole('button', { name: 'Carry loop', exact: true }).click()
  await page.getByText('Position & spacing', { exact: false }).click()
  const offset = page.getByRole('spinbutton', {
    name: 'Vertical offset in millimeters',
    exact: true,
  })
  await offset.scrollIntoViewIfNeeded()
  await offset.focus()
  await expect(offset).toBeInViewport({ ratio: 1 })
  await expect(offset).toBeFocused()
  expect(
    await page
      .locator('.controls-scroll')
      .evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0)
}

async function stablePreviewFrame(page: Page) {
  const canvas = page.locator('.preview-stage canvas')
  let previous: Buffer | undefined
  await expect
    .poll(
      async () => {
        const frame = await canvas.screenshot()
        const stable = previous?.equals(frame) ?? false
        previous = frame
        return stable
      },
      {
        message:
          'The rendered preview should settle before comparing camera views',
      },
    )
    .toBe(true)
  return previous!
}

test.describe('workspace accessibility', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('keeps the preview and export visible while keyboard users edit deep controls', async ({
    page,
  }, testInfo) => {
    await page.goto('/')
    await expectPanelReady(page)
    await expectWorkspaceInViewport(page)
    await page.screenshot({
      path: testInfo.outputPath('workspace-1440x900.png'),
    })

    const preview = page.locator('[role="img"][data-preview-controls]')
    await expect(preview).toHaveAttribute(
      'aria-description',
      /arrow keys.*plus.*minus/,
    )
    await preview.focus()
    await expect(preview).toBeFocused()
    let before = await stablePreviewFrame(page)
    for (const key of ['ArrowRight', 'ArrowUp', 'Shift+Equal', 'Minus']) {
      await preview.press(key)
      await expect
        .poll(
          async () =>
            !(await page.locator('.preview-stage canvas').screenshot()).equals(
              before,
            ),
          { message: `${key} should visibly change the 3D camera` },
        )
        .toBe(true)
      before = await stablePreviewFrame(page)
      await expect(preview).toBeFocused()
      await expectWorkspaceInViewport(page)
    }

    const panelTab = page.getByRole('tab', { name: 'Front panel', exact: true })
    const handleTab = page.getByRole('tab', { name: 'Handle', exact: true })
    const knobTab = page.getByRole('tab', { name: 'Knob', exact: true })
    await panelTab.focus()
    await panelTab.press('End')
    await expect(knobTab).toBeFocused()
    await expect(knobTab).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.getByRole('tabpanel', { name: 'Knob', exact: true }),
    ).toBeVisible()
    await knobTab.press('ArrowLeft')
    await expect(handleTab).toBeFocused()
    await expect(handleTab).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.getByRole('tabpanel', { name: 'Handle', exact: true }),
    ).toBeVisible()
    await handleTab.press('ArrowLeft')
    const grilleTab = page.getByRole('tab', { name: 'Grille', exact: true })
    await expect(grilleTab).toBeFocused()
    await expect(grilleTab).toHaveAttribute('aria-selected', 'true')
    await grilleTab.press('Home')
    await expect(panelTab).toBeFocused()
    await expect(panelTab).toHaveAttribute('aria-selected', 'true')

    const customColor = page.getByLabel('Custom front panel color', {
      exact: true,
    })
    await customColor.focus()
    await expect(customColor).toBeFocused()
    const focusIndicator = await customColor.evaluate((input) => {
      const style = getComputedStyle(input.closest('label')!)
      return {
        style: style.outlineStyle,
        width: parseFloat(style.outlineWidth),
      }
    })
    expect(focusIndicator.style).not.toBe('none')
    expect(focusIndicator.width).toBeGreaterThanOrEqual(2)

    const printGuide = page.getByRole('button', {
      name: 'Print guide',
      exact: true,
    })
    await printGuide.click()
    const guide = page.getByRole('dialog', { name: 'Print guide', exact: true })
    await expect(guide).toBeVisible()
    await guide
      .getByRole('button', { name: 'Close dialog', exact: true })
      .click()
    await expect(guide).not.toBeVisible()
    await expect(printGuide).toBeFocused()

    const depthHelp = page.getByRole('button', {
      name: 'About added face depth',
      exact: true,
    })
    await depthHelp.click()
    await expect(guide).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(guide).not.toBeVisible()
    await expect(depthHelp).toBeFocused()

    await revealDeepHandleControl(page)
    await expectWorkspaceInViewport(page)
    await expectPanelReady(page)
    const exportButton = page.getByRole('button', {
      name: 'Export STL',
      exact: true,
    })
    await exportButton.click()
    const dialog = page.getByRole('dialog', {
      name: 'Export design',
      exact: true,
    })
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: /^Download ZIP/ }),
    ).toBeInViewport({ ratio: 1 })
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(exportButton).toBeFocused()
    await expectWorkspaceInViewport(page)
  })
})

for (const viewport of [
  { width: 320, height: 568 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
]) {
  test(`keeps the workspace usable at ${viewport.width} × ${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expectPanelReady(page)
    await expectWorkspaceInViewport(page)
    await page.screenshot({
      path: testInfo.outputPath(
        `workspace-${viewport.width}x${viewport.height}.png`,
      ),
    })

    await revealDeepHandleControl(page)
    await expectPanelReady(page)
    await expectWorkspaceInViewport(page)
    await page.screenshot({
      path: testInfo.outputPath(
        `workspace-deep-controls-${viewport.width}x${viewport.height}.png`,
      ),
    })
  })
}

test('renders WebGL and switches real panel designs, colors, and preview modes', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Speaker designer' }),
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
  await page.getByRole('button', { name: 'Export STL', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Speaker M · Twin contours')
  await expect(dialog).toContainText('0.2 mm')
  await dialog
    .getByRole('group', { name: 'Export parts' })
    .getByRole('button', { name: 'Panel only', exact: true })
    .click()

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
  await expect(page.getByRole('status')).toContainText('STL downloaded.')
})

test('generates a connected custom handle with real round and slotted through-holes', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await expectPanelReady(page)
  await page.getByRole('tab', { name: 'Handle', exact: true }).click()
  await page.getByRole('button', { name: 'Custom handle', exact: true }).click()
  await page.getByRole('button', { name: 'Three dots', exact: true }).click()
  await page
    .getByRole('spinbutton', {
      name: 'Extension height in millimeters',
      exact: true,
    })
    .fill('48')
  await page
    .getByRole('spinbutton', {
      name: 'Handle width in millimeters',
      exact: true,
    })
    .fill('96')
  await page
    .getByRole('spinbutton', {
      name: 'Corner radius in millimeters',
      exact: true,
    })
    .fill('8')
  await page
    .getByRole('spinbutton', {
      name: 'Hole diameter in millimeters',
      exact: true,
    })
    .fill('12')
  await page.getByText('Position & spacing', { exact: false }).click()
  await page
    .getByRole('spinbutton', {
      name: 'Hole spacing in millimeters',
      exact: true,
    })
    .fill('8')
  await page
    .getByRole('spinbutton', {
      name: 'Horizontal offset in millimeters',
      exact: true,
    })
    .fill('6')
  await page
    .getByRole('spinbutton', {
      name: 'Vertical offset in millimeters',
      exact: true,
    })
    .fill('3')
  await expectPanelReady(page)
  await expect(page.locator('.preview-dimensions')).toContainText('96 × 155 MM')

  // A reload must recover the generated configuration, including model-specific normalization.
  await page.reload()
  await expectPanelReady(page)
  await expect(
    page.getByRole('tab', { name: 'Handle', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(
    page.getByRole('button', { name: 'Round', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('button', { name: '3 holes', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('spinbutton', {
      name: 'Extension height in millimeters',
      exact: true,
    }),
  ).toHaveValue('48')
  await page.screenshot({
    path: testInfo.outputPath('custom-handle.png'),
    fullPage: true,
  })

  async function downloadHandle(label: string) {
    await expectPanelReady(page)
    await page.getByRole('button', { name: 'Export STL', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Custom handle · 48 mm extension')
    await dialog
      .getByRole('group', { name: 'Export parts' })
      .getByRole('button', { name: 'Panel only', exact: true })
      .click()
    const started = page.waitForEvent('download')
    await dialog.getByRole('button', { name: /^Download STL/ }).click()
    const download = await started
    expect(download.suggestedFilename()).toBe(
      'cmf-speaker-s-original-handle-48.0mm.stl',
    )
    const path = testInfo.outputPath(`${label}.stl`)
    await download.saveAs(path)
    const report = inspectBinaryStl(await readFile(path))
    expect(
      report.components,
      'The handle and original panel must be one solid',
    ).toBe(1)
    expect(
      report.invalidEdges,
      'Every edge must have two oppositely wound faces',
    ).toBe(0)
    expect(report.degenerateEdges).toBe(0)
    expect(report.signedVolume).toBeGreaterThan(0)
    expect(report.maximum[0] - report.minimum[0]).toBeCloseTo(96, 3)
    expect(report.maximum[1] - report.minimum[1]).toBeCloseTo(154.9691, 3)
    expect(report.maximum[2] - report.minimum[2]).toBeCloseTo(24, 3)
    expect(report.minimum[2]).toBeCloseTo(0, 5)
    return report
  }

  const round = await downloadHandle('three-round-holes')
  // Source S has four through-holes. Replacing its carry hole with three gives genus six.
  expect(round.genus).toBe(6)
  const seamY = 65.48455 - 24
  const roundY = seamY + 48 / 2 + 2 + 3
  for (const x of [14, -6, -26]) {
    expect(
      round.rayZ(x, roundY),
      'A hole center must be empty through the entire thickness',
    ).toEqual([])
    expect(round.rayZ(x + 4, roundY)).toEqual([])
  }
  for (const x of [4, -16]) {
    const wall = round.rayZ(x, roundY)
    expect(wall).toHaveLength(2)
    expect(wall[0]).toBeCloseTo(20, 3)
    expect(wall[1]).toBeCloseTo(24, 3)
  }
  await page.screenshot({
    path: testInfo.outputPath('generated-round-handle.png'),
    fullPage: true,
  })

  await page.getByRole('button', { name: 'Slot', exact: true }).click()
  await page.getByRole('button', { name: '2 holes', exact: true }).click()
  await page
    .getByRole('spinbutton', { name: 'Hole width in millimeters', exact: true })
    .fill('28')
  await page
    .getByRole('spinbutton', {
      name: 'Hole height in millimeters',
      exact: true,
    })
    .fill('10')
  await page.getByText('Position & spacing', { exact: false }).click()
  await page
    .getByRole('spinbutton', {
      name: 'Horizontal offset in millimeters',
      exact: true,
    })
    .fill('0')
  await page
    .getByRole('spinbutton', {
      name: 'Vertical offset in millimeters',
      exact: true,
    })
    .fill('0')
  const slots = await downloadHandle('two-slot-holes')
  expect(slots.genus).toBe(5)
  const slotY = seamY + 48 / 2 + 2
  for (const x of [-18, 18]) {
    expect(slots.rayZ(x, slotY)).toEqual([])
    expect(
      slots.rayZ(x + 12, slotY),
      'The elongated end of a slot must also be open',
    ).toEqual([])
    expect(
      slots.rayZ(x, slotY + 6),
      'Material must remain outside each cutout',
    ).toHaveLength(2)
  }
  expect(
    slots.rayZ(0, slotY),
    'The bridge between slots must remain solid',
  ).toHaveLength(2)
  await page.screenshot({
    path: testInfo.outputPath('generated-slot-handle.png'),
    fullPage: true,
  })

  await page.getByRole('button', { name: 'None', exact: true }).click()
  await expectPanelReady(page)
  await expect(
    page.getByRole('button', { name: 'None', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Carry loop', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Slot', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('spinbutton', {
      name: 'Extension height in millimeters',
      exact: true,
    }),
  ).toHaveValue('35')
  await page.getByRole('button', { name: 'Solid', exact: true }).click()
  await expectPanelReady(page)
  await expect(
    page.getByRole('button', { name: 'None', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page
    .getByRole('button', { name: 'Original handle', exact: true })
    .click()
  await expectPanelReady(page)
  await expect(page.locator('.preview-dimensions')).toContainText('85 × 131 MM')
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
    await expectWorkspaceInViewport(page)
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
    await page.getByRole('button', { name: 'Export STL', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: /^Download ZIP/ }),
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

    await page.getByRole('tab', { name: 'Handle', exact: true }).click()
    await page
      .getByRole('button', { name: 'Custom handle', exact: true })
      .click()
    await page.getByRole('button', { name: 'Carry loop', exact: true }).click()
    await expectPanelReady(page)
    await page.getByText('Position & spacing', { exact: false }).click()
    const offset = page.getByRole('spinbutton', {
      name: 'Vertical offset in millimeters',
      exact: true,
    })
    await offset.scrollIntoViewIfNeeded()
    await expect(offset).toBeInViewport({ ratio: 1 })
    expect(
      await page
        .locator('.controls-scroll')
        .evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(0)
    await expectWorkspaceInViewport(page)
    const handleViewport = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }))
    expect(handleViewport.content).toBeLessThanOrEqual(
      handleViewport.viewport + 1,
    )
    await page.screenshot({
      path: testInfo.outputPath('mobile-custom-handle.png'),
      fullPage: true,
    })
    await page.getByRole('button', { name: 'Export STL', exact: true }).click()
    await expect(dialog).toContainText('Custom handle · 35 mm extension')
    const customDownload = dialog.getByRole('button', { name: /^Download ZIP/ })
    await customDownload.scrollIntoViewIfNeeded()
    await expect(customDownload).toBeInViewport()
    const handleDialogBounds = await dialog.boundingBox()
    expect(handleDialogBounds).not.toBeNull()
    expect(handleDialogBounds!.x).toBeGreaterThanOrEqual(0)
    expect(
      handleDialogBounds!.x + handleDialogBounds!.width,
    ).toBeLessThanOrEqual(391)
    await page.screenshot({
      path: testInfo.outputPath('mobile-custom-download.png'),
      fullPage: true,
    })
  })
})
