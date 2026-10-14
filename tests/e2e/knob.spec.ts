import { readFile } from 'node:fs/promises'
import { crc32 } from 'node:zlib'
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
      expect(errors, 'Knob changes should not raise browser errors').toEqual([])
    },
    { auto: true },
  ],
})

async function expectReady(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Export design', exact: true }),
  ).toBeEnabled()
  await expect(page.locator('[data-knob-ready]')).toHaveAttribute(
    'data-knob-ready',
    'true',
  )
  await expect(page.locator('.preview-stage canvas')).toBeVisible()
}

async function expectFixedFitControls(page: Page) {
  const editor = page.getByRole('tabpanel', { name: 'Knob', exact: true })
  await expect(editor.getByText('Original fit', { exact: true })).toBeVisible()
  await expect(
    editor.getByRole('spinbutton', { name: /diameter|rotation/i }),
  ).toHaveCount(0)
  await expect(
    editor.getByRole('slider', { name: /diameter|rotation/i }),
  ).toHaveCount(0)
}

async function downloadKnob(page: Page, testInfo: TestInfo, name: string) {
  await expectReady(page)
  await page.getByRole('button', { name: 'Export design', exact: true }).click()
  const dialog = page.getByRole('dialog', {
    name: 'Export design',
    exact: true,
  })
  await dialog
    .getByRole('group', { name: 'Export parts' })
    .getByRole('button', { name: 'Knob only', exact: true })
    .click()
  const started = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download STL/ }).click()
  const download = await started
  const path = testInfo.outputPath(`${name}.stl`)
  await download.saveAs(path)
  return {
    filename: download.suggestedFilename(),
    binary: await readFile(path),
  }
}

/** Compare positions independently of triangle ordering, normals, and filenames. */
function surfaceVertices(binary: Buffer, part: 'base' | 'grip') {
  const vertices = new Set<string>()
  for (let triangle = 0; triangle < binary.readUInt32LE(80); triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const offset = 84 + triangle * 50 + 12 + corner * 12
      const point = [
        binary.readFloatLE(offset),
        binary.readFloatLE(offset + 4),
        binary.readFloatLE(offset + 8),
      ]
      if (part === 'base' ? point[2] < 8 : point[2] > 8)
        vertices.add(point.join(','))
    }
  }
  return [...vertices].sort()
}

/** Parse ZIP headers and check CRC using Node's independent implementation. */
function unzipStored(binary: Buffer) {
  const end = binary.length - 22
  expect(binary.readUInt32LE(end)).toBe(0x06054b50)
  const count = binary.readUInt16LE(end + 10)
  let central = binary.readUInt32LE(end + 16)
  expect(central + binary.readUInt32LE(end + 12)).toBe(end)
  const files = new Map<string, Buffer>()
  for (let index = 0; index < count; index += 1) {
    expect(binary.readUInt32LE(central)).toBe(0x02014b50)
    expect(binary.readUInt16LE(central + 10)).toBe(0)
    const size = binary.readUInt32LE(central + 24)
    const nameLength = binary.readUInt16LE(central + 28)
    const name = binary.toString(
      'utf8',
      central + 46,
      central + 46 + nameLength,
    )
    const local = binary.readUInt32LE(central + 42)
    expect(binary.readUInt32LE(local)).toBe(0x04034b50)
    expect(binary.readUInt32LE(local + 22)).toBe(size)
    const start =
      local +
      30 +
      binary.readUInt16LE(local + 26) +
      binary.readUInt16LE(local + 28)
    const payload = binary.subarray(start, start + size)
    expect(crc32(payload)).toBe(binary.readUInt32LE(central + 16))
    expect(crc32(payload)).toBe(binary.readUInt32LE(local + 14))
    files.set(name, payload)
    central +=
      46 +
      nameLength +
      binary.readUInt16LE(central + 30) +
      binary.readUInt16LE(central + 32)
  }
  expect(central).toBe(end)
  return files
}

/** Inspect the downloaded STEP text without importing the application exporter. */
function inspectFacetedStep(binary: Buffer) {
  const source = binary.toString('utf8')
  expect(source.startsWith('ISO-10303-21;')).toBe(true)
  expect(source.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true)
  expect(source).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION(')
  expect(source).toContain('ADVANCED_FACE(')
  expect(source).toContain('CLOSED_SHELL(')
  expect(source).toMatch(/SI_UNIT\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/)
  const minimum = [Infinity, Infinity, Infinity]
  const maximum = [-Infinity, -Infinity, -Infinity]
  let count = 0
  for (const match of source.matchAll(
    /CARTESIAN_POINT\('[^']*',\s*\(([^)]+)\)\)/g,
  )) {
    const point = match[1].split(',').map(Number)
    if (
      point.length !== 3 ||
      point.some((coordinate) => !Number.isFinite(coordinate))
    )
      throw new Error('Malformed STEP Cartesian point')
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], point[axis])
      maximum[axis] = Math.max(maximum[axis], point[axis])
    }
    count += 1
  }
  expect(count).toBeGreaterThan(100)
  return { minimum, maximum }
}

test('selects all five knobs and renders each in the focused preview', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await expectReady(page)
  await page.getByRole('tab', { name: 'Knob', exact: true }).click()
  await expectFixedFitControls(page)
  await expect(
    page
      .getByRole('group', { name: 'Preview mode' })
      .getByRole('button', { name: 'Knob only', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')

  const frames = new Set<string>()
  for (const [style, label] of [
    ['ring', 'Ring'],
    ['bar', 'Bar'],
    ['cross', 'Cross'],
    ['fluted', 'Fluted'],
    ['hex', 'Faceted'],
  ]) {
    const option = page.getByRole('button', {
      name: `${label} knob`,
      exact: true,
    })
    await option.click()
    await expect(option).toHaveAttribute('aria-pressed', 'true')
    await expectReady(page)
    await expectFixedFitControls(page)
    await expect(page.locator('[data-knob-style]')).toHaveAttribute(
      'data-knob-style',
      style,
    )
    await expect(page.locator('.preview-model')).toContainText(`${label} knob`)
    const screenshot = await page.locator('.preview-stage canvas').screenshot({
      path: testInfo.outputPath(`knob-${style}.png`),
    })
    frames.add(screenshot.toString('base64'))
  }
  expect(frames.size, 'Each selected grip should render a different mesh').toBe(
    5,
  )
  await page
    .getByRole('group', { name: 'Preview mode' })
    .getByRole('button', { name: 'Speaker', exact: true })
    .click()
  await page.screenshot({
    path: testInfo.outputPath('selected-knob-assembled.png'),
  })
})

test('preserves upper grip settings and colors in saved links and the printable ZIP', async ({
  page,
  context,
}, testInfo) => {
  await page.goto('/')
  await expectReady(page)
  await page
    .getByRole('button', { name: 'Front panel: Lagoon', exact: true })
    .click()
  await page.getByRole('tab', { name: 'Knob', exact: true }).click()
  await page.getByRole('button', { name: 'Fluted knob', exact: true }).click()
  for (const [name, value] of [
    ['Knob height in millimeters', '18'],
    ['Grip taper in millimeters', '0.6'],
    ['Flute count', '20'],
    ['Flute depth in millimeters', '0.9'],
  ])
    await page.getByRole('spinbutton', { name, exact: true }).fill(value)
  await page
    .getByRole('group', { name: 'Rib pattern', exact: true })
    .getByRole('button', { name: 'Spiral', exact: true })
    .click()
  const knobEditor = page.getByRole('tabpanel', { name: 'Knob', exact: true })
  await knobEditor
    .getByLabel('Custom volume knob color', { exact: true })
    .fill('#a840cd')
  await expectReady(page)

  await page.reload()
  await expectReady(page)
  await page.getByRole('tab', { name: 'Knob', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Fluted knob', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('spinbutton', {
      name: 'Grip taper in millimeters',
      exact: true,
    }),
  ).toHaveValue('0.6')
  await expect(
    page
      .getByRole('group', { name: 'Rib pattern', exact: true })
      .getByRole('button', { name: 'Spiral', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('spinbutton', {
      name: 'Knob height in millimeters',
      exact: true,
    }),
  ).toHaveValue('18')
  await expect(
    page.getByRole('spinbutton', { name: 'Flute count', exact: true }),
  ).toHaveValue('20')
  await expect(
    knobEditor.getByLabel('Custom volume knob color', { exact: true }),
  ).toHaveValue('#a840cd')

  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page
    .getByRole('button', { name: 'Copy design link', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText('Design link copied.')
  const link = await page.evaluate(() => navigator.clipboard.readText())
  const shared = JSON.parse(new URL(link).searchParams.get('design')!)
  expect(shared).toMatchObject({
    panelColor: '#13b7b1',
    knobColor: '#a840cd',
    knob: {
      style: 'fluted',
      height: 18,
      taper: 0.6,
      fluteCount: 20,
      fluteDepth: 0.9,
      flutePath: 'spiral',
    },
  })
  expect(shared.knob).not.toHaveProperty('diameter')
  expect(shared.knob).not.toHaveProperty('rotation')
  await page.evaluate(() => localStorage.removeItem('cmf-speaker-design-v1'))
  await page.goto(link)
  await expectReady(page)

  await page.getByRole('button', { name: 'Export design', exact: true }).click()
  const dialog = page.getByRole('dialog', {
    name: 'Export design',
    exact: true,
  })
  await expect(
    dialog
      .getByRole('group', { name: 'Export parts' })
      .getByRole('button', { name: 'Panel + knob', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  const zipStarted = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download ZIP/ }).click()
  const zip = await zipStarted
  expect(zip.suggestedFilename()).toBe('cmf-speaker-s-design.zip')
  const zipPath = testInfo.outputPath(zip.suggestedFilename())
  await zip.saveAs(zipPath)
  const entries = unzipStored(await readFile(zipPath))
  expect(entries.size).toBe(3)
  const settings = JSON.parse(entries.get('design.json')!.toString('utf8'))
  expect(settings).toMatchObject(shared)
  expect(settings.export.units).toBe('mm')
  const panel = inspectBinaryStl(entries.get(settings.export.files.panel)!)
  const knobBytes = entries.get(settings.export.files.knob)!
  const knob = inspectBinaryStl(knobBytes)
  expect(panel.maximum[0] - panel.minimum[0]).toBeCloseTo(84.9715, 3)
  expect(panel.minimum[2]).toBeCloseTo(0, 5)
  expect(knob.components).toBe(1)
  expect(knob.invalidEdges).toBe(0)
  expect(knob.degenerateEdges).toBe(0)
  expect(knob.signedVolume).toBeGreaterThan(0)
  expect(knob.minimum[2]).toBeCloseTo(0, 5)
  expect(knob.maximum[2]).toBeCloseTo(18, 3)
  expect(knob.maximum[0] - knob.minimum[0]).toBeCloseTo(18, 3)

  await page.getByRole('button', { name: 'Export design', exact: true }).click()
  await dialog
    .getByRole('group', { name: 'Export parts' })
    .getByRole('button', { name: 'Knob only', exact: true })
    .click()
  const stlStarted = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download STL/ }).click()
  const stl = await stlStarted
  expect(stl.suggestedFilename()).toBe(settings.export.files.knob)
  const stlPath = testInfo.outputPath(stl.suggestedFilename())
  await stl.saveAs(stlPath)
  expect(await readFile(stlPath)).toEqual(knobBytes)
})

test('chooses STL or STP for individual parts and the design ZIP', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await expectReady(page)
  const trigger = page.getByRole('button', {
    name: 'Export design',
    exact: true,
  })
  await trigger.click()
  const dialog = page.getByRole('dialog', {
    name: 'Export design',
    exact: true,
  })
  const formats = dialog.getByRole('group', { name: 'Export format' })
  const stlFormat = formats.getByRole('button', { name: 'STL', exact: true })
  const stpFormat = formats.getByRole('button', { name: 'STP', exact: true })
  await expect(stlFormat).toHaveAttribute('aria-pressed', 'true')
  await expect(stpFormat).toHaveAttribute('aria-pressed', 'false')
  await stpFormat.focus()
  await page.keyboard.press('Enter')
  await expect(stpFormat).toHaveAttribute('aria-pressed', 'true')
  await expect(stlFormat).toHaveAttribute('aria-pressed', 'false')
  await expect(dialog).toContainText('Faceted STEP')
  await dialog.screenshot({
    path: testInfo.outputPath('step-export-dialog.png'),
  })

  const zipStarted = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download ZIP/ }).click()
  const zip = await zipStarted
  expect(zip.suggestedFilename()).toBe('cmf-speaker-s-design-stp.zip')
  const zipPath = testInfo.outputPath(zip.suggestedFilename())
  await zip.saveAs(zipPath)
  const entries = unzipStored(await readFile(zipPath))
  expect(entries.size).toBe(3)
  const settings = JSON.parse(entries.get('design.json')!.toString('utf8'))
  expect(settings.export).toMatchObject({
    format: 'stp',
    units: 'mm',
    geometryType: 'advanced-brep',
    toleranceMm: 0.01,
  })
  expect(settings.export.files.panel).toMatch(/\.stp$/)
  expect(settings.export.files.knob).toMatch(/\.stp$/)
  const panel = inspectFacetedStep(entries.get(settings.export.files.panel)!)
  const archivedKnob = inspectFacetedStep(
    entries.get(settings.export.files.knob)!,
  )
  expect(panel.maximum[0] - panel.minimum[0]).toBeCloseTo(84.9715, 3)
  expect(panel.minimum[2]).toBeCloseTo(0, 5)

  await trigger.click()
  await dialog
    .getByRole('group', { name: 'Export parts' })
    .getByRole('button', { name: 'Knob only', exact: true })
    .click()
  await stlFormat.click()
  const stlStarted = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download STL/ }).click()
  const stl = await stlStarted
  expect(stl.suggestedFilename()).toBe(
    settings.export.files.knob.replace(/\.stp$/, '.stl'),
  )
  const stlPath = testInfo.outputPath(stl.suggestedFilename())
  await stl.saveAs(stlPath)
  const stlKnob = inspectBinaryStl(await readFile(stlPath))

  await trigger.click()
  await stpFormat.click()
  const stpStarted = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download STP/ }).click()
  const stp = await stpStarted
  expect(stp.suggestedFilename()).toBe(settings.export.files.knob)
  const stpPath = testInfo.outputPath(stp.suggestedFilename())
  await stp.saveAs(stpPath)
  const directKnob = inspectFacetedStep(await readFile(stpPath))
  for (let axis = 0; axis < 3; axis += 1) {
    expect(
      Math.abs(directKnob.minimum[axis] - stlKnob.minimum[axis]),
    ).toBeLessThanOrEqual(settings.export.toleranceMm)
    expect(
      Math.abs(directKnob.maximum[axis] - stlKnob.maximum[axis]),
    ).toBeLessThanOrEqual(settings.export.toleranceMm)
    expect(directKnob.minimum[axis]).toBe(archivedKnob.minimum[axis])
    expect(directKnob.maximum[axis]).toBe(archivedKnob.maximum[axis])
  }
  await expect(page.getByRole('status')).toContainText('STP downloaded.')
})

test('exports the final rapid edit and keeps knob controls usable on mobile', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expectReady(page)
  await page.getByRole('tab', { name: 'Knob', exact: true }).click()
  for (const shape of ['Cross', 'Bar', 'Faceted'])
    await page
      .getByRole('button', { name: `${shape} knob`, exact: true })
      .click()
  const height = page.getByRole('spinbutton', {
    name: 'Knob height in millimeters',
    exact: true,
  })
  for (const value of ['14', '17', '19']) await height.fill(value)
  const facets = page.getByRole('spinbutton', {
    name: 'Facet count',
    exact: true,
  })
  for (const value of ['5', '8', '10']) await facets.fill(value)
  await page
    .getByRole('spinbutton', { name: 'Grip taper in millimeters', exact: true })
    .fill('0.4')
  await expectReady(page)
  await expectFixedFitControls(page)
  await expect(page.locator('[data-knob-style]')).toHaveAttribute(
    'data-knob-style',
    'hex',
  )
  await expect(page.locator('.preview-dimensions')).toContainText('19 MM')
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
    height: window.innerHeight,
    contentHeight: document.documentElement.scrollHeight,
  }))
  expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.width + 1)
  expect(dimensions.contentHeight).toBeLessThanOrEqual(dimensions.height + 1)
  await page.screenshot({
    path: testInfo.outputPath('mobile-knob-controls.png'),
  })
  await page.getByRole('button', { name: 'Export design', exact: true }).click()
  const dialog = page.getByRole('dialog', {
    name: 'Export design',
    exact: true,
  })
  await dialog
    .getByRole('group', { name: 'Export parts' })
    .getByRole('button', { name: 'Knob only', exact: true })
    .click()
  const formats = dialog.getByRole('group', { name: 'Export format' })
  const stpFormat = formats.getByRole('button', { name: 'STP', exact: true })
  await expect(stpFormat).toBeInViewport()
  await stpFormat.click()
  await expect(
    dialog.getByRole('button', { name: /^Download STP/ }),
  ).toBeVisible()
  await formats.getByRole('button', { name: 'STL', exact: true }).click()
  const downloadButton = dialog.getByRole('button', { name: /^Download STL/ })
  await expect(downloadButton).toBeInViewport()
  const started = page.waitForEvent('download')
  await downloadButton.click()
  const download = await started
  expect(download.suggestedFilename()).toMatch(/hex|faceted/)
  const file = testInfo.outputPath(download.suggestedFilename())
  await download.saveAs(file)
  const binary = await readFile(file)
  const knob = inspectBinaryStl(binary)
  expect(knob.maximum[2]).toBeCloseTo(19, 3)
  expect(knob.minimum[2]).toBeCloseTo(0, 5)
  expect(knob.components).toBe(1)
  expect(knob.invalidEdges).toBe(0)
  expect(knob.maximum[0] - knob.minimum[0]).toBeCloseTo(18, 3)
  await page.reload()
  const recovered = await downloadKnob(page, testInfo, 'recovered-final-facets')
  expect(recovered.binary).toEqual(binary)
})

test('rib paths and facet counts change the upper mesh while preserving the original base', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await expectReady(page)
  await page.getByRole('tab', { name: 'Knob', exact: true }).click()
  await page.getByRole('button', { name: 'Ring knob', exact: true }).click()
  const original = await downloadKnob(page, testInfo, 'original-ring')
  const base = surfaceVertices(original.binary, 'base')
  expect(base.length).toBeGreaterThan(100)

  await page.getByRole('button', { name: 'Fluted knob', exact: true }).click()
  const surfaces: string[][] = []
  for (const path of ['Straight', 'Spiral', 'Chevron']) {
    await page
      .getByRole('group', { name: 'Rib pattern', exact: true })
      .getByRole('button', { name: path, exact: true })
      .click()
    const file = await downloadKnob(
      page,
      testInfo,
      `fluted-${path.toLowerCase()}`,
    )
    expect(surfaceVertices(file.binary, 'base')).toEqual(base)
    const grip = surfaceVertices(file.binary, 'grip')
    expect(grip).not.toEqual(surfaceVertices(original.binary, 'grip'))
    for (const previous of surfaces) expect(grip).not.toEqual(previous)
    surfaces.push(grip)
    const mesh = inspectBinaryStl(file.binary)
    expect(mesh.invalidEdges).toBe(0)
    expect(mesh.components).toBe(1)
    expect(mesh.maximum[0] - mesh.minimum[0]).toBeCloseTo(18, 3)
    await page.locator('.preview-stage canvas').screenshot({
      path: testInfo.outputPath(`fluted-${path.toLowerCase()}.png`),
    })
  }

  await page.getByRole('button', { name: 'Faceted knob', exact: true }).click()
  await page
    .getByRole('spinbutton', { name: 'Facet count', exact: true })
    .fill('5')
  const five = await downloadKnob(page, testInfo, 'five-facets')
  await page
    .getByRole('spinbutton', { name: 'Facet count', exact: true })
    .fill('12')
  const twelve = await downloadKnob(page, testInfo, 'twelve-facets')
  expect(surfaceVertices(five.binary, 'base')).toEqual(base)
  expect(surfaceVertices(twelve.binary, 'base')).toEqual(base)
  expect(surfaceVertices(five.binary, 'grip')).not.toEqual(
    surfaceVertices(twelve.binary, 'grip'),
  )
  await page
    .getByRole('spinbutton', { name: 'Grip taper in millimeters', exact: true })
    .fill('0.8')
  const tapered = await downloadKnob(page, testInfo, 'tapered-facets')
  expect(surfaceVertices(tapered.binary, 'base')).toEqual(base)
  expect(surfaceVertices(tapered.binary, 'grip')).not.toEqual(
    surfaceVertices(twelve.binary, 'grip'),
  )
  await page.screenshot({
    path: testInfo.outputPath('tapered-faceted-knob.png'),
  })
})

test('ignores legacy diameter and rotation values and exports the unaltered default', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  const original = await downloadKnob(page, testInfo, 'default-bar')
  const legacy = {
    knob: { style: 'bar', diameter: 24, rotation: 90, height: 16 },
  }
  await page.goto(`/?design=${encodeURIComponent(JSON.stringify(legacy))}`)
  await expectReady(page)
  await page.getByRole('tab', { name: 'Knob', exact: true }).click()
  await expectFixedFitControls(page)
  const restored = await downloadKnob(page, testInfo, 'legacy-bar')
  expect(restored.filename).toBe(original.filename)
  expect(restored.binary).toEqual(original.binary)
  const settings = await page.evaluate(
    () => JSON.parse(localStorage.getItem('cmf-speaker-design-v1')!).knob,
  )
  expect(settings).not.toHaveProperty('diameter')
  expect(settings).not.toHaveProperty('rotation')
  expect(settings).toMatchObject({
    style: 'bar',
    height: 16,
    taper: 0,
    flutePath: 'straight',
    facets: 6,
  })
})
