import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { STORAGE_KEY, type Design } from '../../src/lib/design'
import type { MulticolorSettings } from '../../src/lib/multicolor-settings'

const ring = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 60">
  <g transform="translate(11 17) scale(1.5 1)">
    <path fill-rule="evenodd" d="M0 0H32V24H0Z M8 8H24V16H8Z"/>
  </g>
</svg>`

const stored = (page: Page): Promise<MulticolorSettings> =>
  page.evaluate(
    (key) => (JSON.parse(localStorage.getItem(key)!) as Design).multicolor,
    STORAGE_KEY,
  )

async function ready(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Export design', exact: true }),
  ).toBeEnabled()
  await expect(page.locator('[data-materials-ready]')).toHaveAttribute(
    'data-materials-ready',
    'true',
  )
}

async function openEditor(page: Page) {
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'Multicolor', exact: true }).click()
  await expect(page.locator('.multicolor-editor')).toBeVisible()
}

async function upload(page: Page, source = ring, name = 'ring.svg') {
  await page.getByLabel('Import SVG shape', { exact: true }).setInputFiles({
    name,
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(source),
  })
}

async function numberField(page: Page, name: string, value: number) {
  const input = page.getByRole('spinbutton', { name, exact: true })
  await input.fill(String(value))
  await input.press('Enter')
}

test('imports transformed SVG holes and preserves edits, history and invalid-import atomicity', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openEditor(page)
  const editor = page.locator('.multicolor-editor')
  const add = page.getByRole('group', { name: 'Add pattern shape' })
  await expect(
    add.getByRole('button', { name: 'SVG', exact: true }),
  ).toBeVisible()
  await upload(page)
  await expect.poll(async () => (await stored(page)).elements.length).toBe(1)
  await ready(page)
  const imported = await stored(page)
  const shape = imported.elements[0]
  expect(shape).toMatchObject({ kind: 'svg', sourceName: 'ring.svg' })
  if (shape.kind !== 'svg') throw new Error('Expected an imported SVG shape.')
  expect(shape.contours).toHaveLength(2)
  expect(shape.width / shape.height).toBeCloseTo(2, 5)

  // The artwork path must retain the counter after the SVG group transform.
  const artwork = page.locator('.multicolor-canvas .multicolor-shape').first()
  await expect(artwork).toHaveAttribute('fill-rule', 'nonzero')
  const fill = await artwork.evaluate((element, position) => {
    const path = element as SVGGeometryElement
    return {
      center: path.isPointInFill(new DOMPoint(position.x, -position.y)),
      edge: path.isPointInFill(
        new DOMPoint(position.x + position.width * 0.4, -position.y),
      ),
    }
  }, shape)
  expect(fill).toEqual({ center: false, edge: true })

  await numberField(page, 'SVG width (mm)', 36)
  await numberField(page, 'Position X (mm)', 4)
  await numberField(page, 'Position Y (mm)', 8)
  await expect
    .poll(async () => (await stored(page)).elements[0])
    .toMatchObject({
      width: 36,
      height: 18,
      x: 4,
      y: 8,
      contours: shape.contours,
    })
  const edited = await stored(page)
  await editor
    .getByRole('button', { name: 'Duplicate ring', exact: true })
    .click()
  await expect.poll(async () => (await stored(page)).elements.length).toBe(2)
  const duplicate = (await stored(page)).elements[1]
  expect(duplicate.id).not.toBe(shape.id)
  expect(duplicate).toMatchObject({
    kind: 'svg',
    sourceName: 'ring.svg',
    width: 36,
    height: 18,
    contours: shape.contours,
    materialId: shape.materialId,
  })
  const canvas = page.locator('.multicolor-canvas')
  await canvas.press('Control+z')
  await expect.poll(() => stored(page)).toEqual(edited)

  for (const [source, message] of [
    ['<svg><path', /valid SVG/i],
    [
      '<svg xmlns="http://www.w3.org/2000/svg"><text>Convert me to outlines</text></svg>',
      /text.*filled paths/i,
    ],
    [
      '<svg xmlns="http://www.w3.org/2000/svg"><path fill="none" stroke="black" d="M0 0L20 20"/></svg>',
      /strokes.*filled paths/i,
    ],
  ] as const) {
    await upload(page, source, 'invalid.svg')
    await expect(editor.getByRole('alert')).toContainText(message)
    expect(await stored(page)).toEqual(edited)
    await ready(page)
  }
  await page.reload()
  await ready(page)
  expect(await stored(page)).toEqual(edited)
  await expect(
    page.locator('.multicolor-canvas .multicolor-shape'),
  ).toHaveCount(1)
  await page.locator('.multicolor-canvas').scrollIntoViewIfNeeded()
  await page.screenshot({
    path: testInfo.outputPath('svg-artwork-desktop.png'),
    fullPage: true,
  })
  expect(errors).toEqual([])
})

test('edits font families and weights as artwork and round-trips both vector types through design JSON', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openEditor(page)
  await upload(page)
  await expect.poll(async () => (await stored(page)).elements.length).toBe(1)
  await page
    .getByRole('group', { name: 'Add pattern shape' })
    .getByRole('button', { name: 'Text', exact: true })
    .click()
  await expect.poll(async () => (await stored(page)).elements.length).toBe(2)
  const initial = await stored(page)
  const text = page.getByRole('textbox', { name: 'Text content', exact: true })
  await text.fill('B8')
  expect(await stored(page)).toEqual(initial)
  await text.press('Enter')
  await expect
    .poll(async () => (await stored(page)).elements[1])
    .toMatchObject({
      kind: 'text',
      text: 'B8',
    })
  await numberField(page, 'Font size (mm)', 14)
  await numberField(page, 'Position Y (mm)', 50)
  await ready(page)
  const artwork = page.locator('.multicolor-canvas .multicolor-shape').nth(1)
  const originalOutline = await artwork.getAttribute('d')
  const font = page.getByRole('combobox', { name: 'Text font', exact: true })
  const weight = page.getByRole('combobox', {
    name: 'Font weight',
    exact: true,
  })
  expect(await font.locator('option').count()).toBeGreaterThanOrEqual(12)
  await font.selectOption({ label: 'Inter' })
  await expect(artwork).not.toHaveAttribute('d', originalOutline!)
  await expect(weight).toHaveValue('400')
  const regular = await stored(page)
  const regularOutline = await artwork.getAttribute('d')
  await weight.selectOption({ label: 'Bold (700)' })
  await expect(artwork).not.toHaveAttribute('d', regularOutline!)
  const bold = await stored(page)
  const boldOutline = await artwork.getAttribute('d')
  expect(bold.elements[1]).toMatchObject({
    kind: 'text',
    text: 'B8',
    fontSize: 14,
    y: 50,
    fontId: 'inter',
    fontWeight: 700,
  })
  const canvas = page.locator('.multicolor-canvas')
  await canvas.press('Control+z')
  await expect.poll(() => stored(page)).toEqual(regular)
  await expect(weight).toHaveValue('400')
  await expect(artwork).toHaveAttribute('d', regularOutline!)
  await canvas.press('Control+y')
  await expect.poll(() => stored(page)).toEqual(bold)
  await expect(weight).toHaveValue('700')
  await expect(artwork).toHaveAttribute('d', boldOutline!)
  await font.selectOption({ label: 'Montserrat' })
  await expect(weight).toHaveValue('700')
  await expect(artwork).not.toHaveAttribute('d', boldOutline!)
  expect((await stored(page)).elements[1]).toMatchObject({
    fontId: 'montserrat',
    fontWeight: 700,
  })
  await canvas.press('Control+z')
  await expect.poll(() => stored(page)).toEqual(bold)
  await expect(artwork).toHaveAttribute('d', boldOutline!)
  await font.selectOption({ label: 'Droid Sans Mono' })
  const mono = await stored(page)
  expect(mono.elements[1]).toMatchObject({
    fontId: 'droid-sans-mono',
    fontWeight: 400,
  })
  await expect(weight).toHaveValue('400')
  await expect(weight).toBeDisabled()
  await expect(weight.locator('option')).toHaveCount(1)
  await canvas.press('Control+z')
  await expect.poll(() => stored(page)).toEqual(bold)
  await expect(font).toHaveValue('inter')
  await expect(weight).toHaveValue('700')
  await expect(weight).toBeEnabled()
  await ready(page)
  await font.scrollIntoViewIfNeeded()
  await page.screenshot({
    path: testInfo.outputPath('text-artwork-desktop.png'),
    fullPage: true,
  })
  await page.reload()
  await ready(page)
  expect(await stored(page)).toEqual(bold)

  const started = page.waitForEvent('download')
  await page
    .getByRole('button', { name: 'Save design JSON', exact: true })
    .click()
  const download = await started
  const path = testInfo.outputPath('vector-artwork.json')
  await download.saveAs(path)
  expect(JSON.parse(await readFile(path, 'utf8')).multicolor).toEqual(bold)
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await ready(page)
  expect((await stored(page)).elements).toEqual([])
  await page
    .locator('input[type="file"][accept=".json,application/json"]')
    .setInputFiles(path)
  await ready(page)
  expect(await stored(page)).toEqual(bold)
  await expect(
    page.locator('.multicolor-canvas .multicolor-shape'),
  ).toHaveCount(2)
  await page.setViewportSize({ width: 390, height: 844 })
  const add = page.getByRole('group', { name: 'Add pattern shape' })
  await add.scrollIntoViewIfNeeded()
  for (const name of ['Stripe', 'Cross', 'Circle', 'Polygon', 'SVG', 'Text']) {
    await expect(
      add.getByRole('button', { name, exact: true }),
    ).toBeInViewport()
  }
  await page
    .locator('.multicolor-layer-select')
    .filter({ hasText: 'Text' })
    .click()
  await weight.scrollIntoViewIfNeeded()
  await expect(font).toBeInViewport()
  await expect(weight).toBeInViewport()
  await expect(font).toHaveValue('inter')
  await expect(weight).toHaveValue('700')
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport)
  await page.screenshot({
    path: testInfo.outputPath('vector-artwork-mobile.png'),
    fullPage: true,
  })
  expect(errors).toEqual([])
})
