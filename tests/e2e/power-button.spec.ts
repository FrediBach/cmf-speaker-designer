import { readFile } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js'
import {
  expect,
  test as base,
  type Page,
  type TestInfo,
} from '@playwright/test'
import { STORAGE_KEY, type Design } from '../../src/lib/design'
import { inspectBinaryStl } from './stl'

const test = base.extend<{ appErrors: string[] }>({
  appErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await use(errors)
      expect(
        errors,
        'Power button editing and exports should not crash',
      ).toEqual([])
    },
    { auto: true },
  ],
})

const stored = (page: Page): Promise<Design> =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY)

async function ready(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Export design', exact: true }),
  ).toBeEnabled()
  await expect(page.locator('.preview-stage canvas')).toBeVisible()
  await expect(page.locator('[data-power-button-ready]')).toHaveAttribute(
    'data-power-button-ready',
    'true',
  )
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

async function shortcut(page: Page, keys: string) {
  await page.getByRole('button', { name: 'Randomize', exact: true }).focus()
  await page.keyboard.press(keys)
}

async function download(
  page: Page,
  testInfo: TestInfo,
  target?: 'All parts' | 'Power button only',
  format?: 'STL' | '3MF',
) {
  await ready(page)
  await page.getByRole('button', { name: 'Export design', exact: true }).click()
  const dialog = page.getByRole('dialog', {
    name: 'Export design',
    exact: true,
  })
  const targets = dialog.getByRole('group', { name: 'Export parts' })
  const formats = dialog.getByRole('group', { name: 'Export format' })
  if (target)
    await targets.getByRole('button', { name: target, exact: true }).click()
  else
    await expect(
      targets.getByRole('button', { name: 'All parts', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
  if (format)
    await formats.getByRole('button', { name: format, exact: true }).click()
  else
    await expect(
      formats.getByRole('button', { name: 'STL', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
  if (!target)
    await dialog.screenshot({
      path: testInfo.outputPath('all-parts-export-dialog.png'),
    })
  const started = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download (ZIP|STL|3MF)/ }).click()
  const file = await started
  const filename = file.suggestedFilename()
  const path = testInfo.outputPath(filename)
  await file.saveAs(path)
  return { filename, binary: await readFile(path) }
}

async function inspectThreeMf(page: Page, binary: Buffer) {
  const entries = unzipSync(new Uint8Array(binary))
  const model = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, 'application/xml')
    const objects = Array.from(document.querySelectorAll('resources > object'))
    const materials = Array.from(
      document.querySelectorAll('basematerials > base'),
    )
    return {
      errors: document.querySelectorAll('parsererror').length,
      unit: document.documentElement.getAttribute('unit'),
      builds: Array.from(document.querySelectorAll('build > item')).map(
        (item) => {
          const assembly = objects.find(
            (object) => object.id === item.getAttribute('objectid'),
          )!
          return {
            name: assembly.getAttribute('name'),
            parts: Array.from(assembly.querySelectorAll('component')).map(
              (component) => {
                const part = objects.find(
                  (object) => object.id === component.getAttribute('objectid'),
                )!
                return {
                  name: part.getAttribute('name'),
                  color:
                    materials[Number(part.getAttribute('pindex'))].getAttribute(
                      'displaycolor',
                    ),
                  triangles: part.querySelectorAll('triangle').length,
                }
              },
            ),
          }
        },
      ),
    }
  }, strFromU8(entries['3D/3dmodel.model']))
  expect(model.errors).toBe(0)
  expect(model.unit).toBe('millimeter')
  return {
    ...model,
    design: JSON.parse(strFromU8(entries['Metadata/design.json'])),
  }
}

test('edits the power button independently and preserves custom colors through history, reload, and sharing', async ({
  page,
  context,
}, testInfo) => {
  await page.goto('/')
  await ready(page)
  await page
    .getByRole('button', { name: 'Front panel: Lagoon', exact: true })
    .click()
  const before = await stored(page)
  const color = page.getByLabel('Custom power button color', { exact: true })
  const originalFrame = await stablePreview(page)
  await color.fill('#7b39c6')
  const expected = { ...before, powerButtonColor: '#7b39c6' }
  await expect.poll(() => stored(page)).toEqual(expected)
  await expect(color).toHaveValue('#7b39c6')
  await expect(page.locator('[data-power-button-color]')).toHaveAttribute(
    'data-power-button-color',
    '#7b39c6',
  )
  expect((await stablePreview(page)).equals(originalFrame)).toBe(false)

  await shortcut(page, 'Control+z')
  await expect.poll(() => stored(page)).toEqual(before)
  await expect(color).toHaveValue(before.powerButtonColor)
  await shortcut(page, 'Control+Shift+z')
  await expect.poll(() => stored(page)).toEqual(expected)
  await page
    .getByRole('button', { name: 'Front panel: Chalk', exact: true })
    .click()
  await expect(color).toHaveValue('#7b39c6')
  await shortcut(page, 'Control+z')
  await expect.poll(() => stored(page)).toEqual(expected)

  await page.reload()
  await ready(page)
  await expect(color).toHaveValue('#7b39c6')
  await expect.poll(() => stored(page)).toEqual(expected)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page
    .getByRole('button', { name: 'Copy design link', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText('Design link copied.')
  const link = await page.evaluate(() => navigator.clipboard.readText())
  const url = new URL(link)
  const shared = JSON.parse(
    new URLSearchParams(url.hash.slice(1)).get('design') ??
      url.searchParams.get('design')!,
  )
  expect(shared).toEqual(expected)
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY)
  await page.goto(link)
  await ready(page)
  await expect(color).toHaveValue('#7b39c6')
  await expect.poll(() => stored(page)).toEqual(expected)
  await page.getByRole('button', { name: 'Front', exact: true }).click()
  await page.screenshot({
    path: testInfo.outputPath('custom-power-button.png'),
  })
})

test('exports the original button in the default STL bundle and as a separate color in individual and all-part 3MF files', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await ready(page)
  await page
    .getByLabel('Custom power button color', { exact: true })
    .fill('#7b39c6')
  const original = inspectBinaryStl(
    await readFile(
      'resources/stl-files/cmf-speaker-sm-3d-printing-power-button-original-v1.stl',
    ),
  )
  const archive = await download(page, testInfo)
  expect(archive.filename).toBe('cmf-speaker-s-design.zip')
  const entries = unzipSync(new Uint8Array(archive.binary))
  expect(Object.keys(entries)).toHaveLength(4)
  const settings = JSON.parse(strFromU8(entries['design.json']))
  expect(settings).toMatchObject({
    powerButtonColor: '#7b39c6',
    export: { format: 'stl', units: 'mm' },
  })
  const buttonFilename = settings.export.files.powerButton
  expect(buttonFilename).toMatch(/power-button.*\.stl$/)
  const buttonBytes = Buffer.from(entries[buttonFilename])
  const button = inspectBinaryStl(buttonBytes)
  expect(button.components).toBe(1)
  expect(button.invalidEdges).toBe(0)
  expect(button.degenerateEdges).toBe(0)
  expect(button.signedVolume).toBeGreaterThan(0)
  expect(button.signedVolume).toBeCloseTo(original.signedVolume, 3)
  expect(button.triangleCount).toBe(original.triangleCount)
  expect(button.minimum[2]).toBeCloseTo(0, 5)
  for (let axis = 0; axis < 3; axis += 1)
    expect(button.maximum[axis] - button.minimum[axis]).toBeCloseTo(
      original.maximum[axis] - original.minimum[axis],
      5,
    )
  const individual = await download(page, testInfo, 'Power button only', 'STL')
  expect(individual.filename).toBe(buttonFilename)
  expect(individual.binary).toEqual(buttonBytes)

  const individualThreeMf = await download(
    page,
    testInfo,
    'Power button only',
    '3MF',
  )
  expect(individualThreeMf.filename).toBe('cmf-speaker-s-power-button.3mf')
  const buttonModel = await inspectThreeMf(page, individualThreeMf.binary)
  const buttonBuild = {
    name: 'Power button',
    parts: [
      {
        name: 'Power button',
        color: '#7B39C6FF',
        triangles: original.triangleCount,
      },
    ],
  }
  // The white preview indicator is not a second printable part.
  expect(buttonModel.builds).toEqual([buttonBuild])
  expect(buttonModel.design.powerButtonColor).toBe('#7b39c6')

  const allThreeMf = await download(page, testInfo, 'All parts', '3MF')
  expect(allThreeMf.filename).toBe('cmf-speaker-s-design.3mf')
  const allModel = await inspectThreeMf(page, allThreeMf.binary)
  expect(allModel.builds.map(({ name }) => name)).toEqual([
    'Speaker S panel',
    'Volume knob',
    'Power button',
  ])
  expect(allModel.builds[0].parts[0].color).toBe('#F45427FF')
  expect(allModel.builds[1].parts[0].color).toBe('#303538FF')
  expect(allModel.builds[2]).toEqual(buttonBuild)
  expect(allModel.design.powerButtonColor).toBe('#7b39c6')
})

test('keeps the M power button color and all four export targets reachable on mobile', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: /^Speaker M/ }).click()
  await ready(page)
  const color = page.getByLabel('Custom power button color', { exact: true })
  await color.scrollIntoViewIfNeeded()
  await expect(color).toBeInViewport()
  const originalFrame = await stablePreview(page)
  await color.fill('#ca638e')
  await expect
    .poll(async () => (await stored(page)).powerButtonColor)
    .toBe('#ca638e')
  expect((await stablePreview(page)).equals(originalFrame)).toBe(false)
  await page.screenshot({
    path: testInfo.outputPath('mobile-power-button-color.png'),
  })
  await page.getByRole('button', { name: 'Export design', exact: true }).click()
  const dialog = page.getByRole('dialog', {
    name: 'Export design',
    exact: true,
  })
  const targets = dialog.getByRole('group', { name: 'Export parts' })
  await expect(targets.getByRole('button')).toHaveCount(4)
  for (const name of [
    'All parts',
    'Panel only',
    'Knob only',
    'Power button only',
  ]) {
    const target = targets.getByRole('button', { name, exact: true })
    await target.scrollIntoViewIfNeeded()
    await expect(target).toBeInViewport()
    await target.click()
    await expect(target).toHaveAttribute('aria-pressed', 'true')
  }
  await expect(dialog.locator('.power-button-download-summary')).toContainText(
    '#CA638E',
  )
  const downloadButton = dialog.getByRole('button', { name: /^Download STL/ })
  await downloadButton.scrollIntoViewIfNeeded()
  await expect(downloadButton).toBeInViewport()
  await dialog.screenshot({
    path: testInfo.outputPath('mobile-power-button-export.png'),
  })
  const started = page.waitForEvent('download')
  await downloadButton.click()
  const file = await started
  expect(file.suggestedFilename()).toMatch(/power-button.*\.stl$/)
  const path = testInfo.outputPath(file.suggestedFilename())
  await file.saveAs(path)
  const button = inspectBinaryStl(await readFile(path))
  expect(button.invalidEdges).toBe(0)
  expect(button.components).toBe(1)
  await page.reload()
  await ready(page)
  await expect(color).toHaveValue('#ca638e')
  await expect(
    page.getByRole('button', { name: /^Speaker M/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390)
})
