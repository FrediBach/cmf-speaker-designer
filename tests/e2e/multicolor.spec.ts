import { readFile } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js'
import { expect, test, type Page } from '@playwright/test'
import { STORAGE_KEY, type Design } from '../../src/lib/design'
import { inspectBinaryStl } from './stl'

const ready = async (page: Page) => {
  await expect(
    page.getByRole('button', { name: 'Export design', exact: true }),
  ).toBeEnabled()
  await expect(page.locator('.preview-stage canvas')).toBeVisible()
  await expect(page.locator('[data-materials-ready]')).toHaveAttribute(
    'data-materials-ready',
    'true',
  )
}
const stored = (page: Page): Promise<Design> =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY)

async function preset(page: Page, id: string) {
  const editor = page.locator('.multicolor-editor')
  const details = editor
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Choose a preset' }) })
    .first()
  if ((await details.getAttribute('open')) === null)
    await details.locator('summary').click()
  await editor.getByLabel('Pattern preset', { exact: true }).selectOption(id)
  await editor.getByRole('button', { name: 'Apply editable preset' }).click()
  await ready(page)
}

test('authors, preserves, shares and downloads a registered multicolor assembly', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'Multicolor', exact: true }).click()
  await expect(page.locator('.multicolor-editor')).toBeVisible()
  await preset(page, 'france')
  const authored = (await stored(page)).multicolor
  expect(authored.elements.length).toBe(3)
  await expect(page.locator('[data-material-count]')).toHaveAttribute(
    'data-material-count',
    '3',
  )

  // Recoloring retains the partition buffers; no worker request is necessary.
  const selectedMaterial = page.locator(
    '[aria-label="Selected shape controls"] input[aria-label$="hex color"]',
  )
  await selectedMaterial.fill('#bc285b')
  await selectedMaterial.press('Tab')
  await ready(page)
  expect(
    (await stored(page)).multicolor.materials.some(
      (material) => material.color === '#bc285b',
    ),
  ).toBe(true)
  const saved = await stored(page)
  await page.getByRole('button', { name: 'Single color', exact: true }).click()
  await ready(page)
  await expect(page.locator('.multicolor-editor')).toBeHidden()
  await page.getByRole('button', { name: 'Multicolor', exact: true }).click()
  await ready(page)
  expect((await stored(page)).multicolor.elements).toEqual(
    saved.multicolor.elements,
  )
  await page
    .getByRole('button', { name: 'Original', exact: true })
    .first()
    .click()
  expect((await stored(page)).multicolor.enabled).toBe(true)

  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page
    .getByRole('button', { name: 'Copy design link', exact: true })
    .click()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(new URL(link).search).toBe('')
  expect(
    JSON.parse(new URLSearchParams(new URL(link).hash.slice(1)).get('design')!)
      .multicolor.elements,
  ).toEqual(saved.multicolor.elements)
  await page.goto(link)
  await ready(page)
  await page.getByRole('button', { name: 'Front', exact: true }).click()
  await page.locator('.multicolor-canvas').scrollIntoViewIfNeeded()
  await page.screenshot({
    path: testInfo.outputPath('multicolor-france-desktop.png'),
    fullPage: true,
  })

  await page.getByRole('button', { name: 'Export design', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('button', { name: '3MF', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('button', { name: 'Panel only', exact: true }).click()
  const downloadEvent = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download 3MF/ }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toMatch(/\.3mf$/)
  const file = testInfo.outputPath('multicolor-panel.3mf')
  await download.saveAs(file)
  const entries = unzipSync(new Uint8Array(await readFile(file)))
  const xml = strFromU8(entries['3D/3dmodel.model'])
  const parsed = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, 'application/xml')
    return {
      errors: document.querySelectorAll('parsererror').length,
      units: document.documentElement.getAttribute('unit'),
      meshes: document.querySelectorAll('mesh').length,
      components: document.querySelectorAll('component').length,
      builds: document.querySelectorAll('build > item').length,
      materials: Array.from(
        document.querySelectorAll('basematerials > base'),
      ).map((base) => ({
        name: base.getAttribute('name'),
        color: base.getAttribute('displaycolor'),
      })),
    }
  }, xml)
  expect(parsed).toMatchObject({
    errors: 0,
    units: 'millimeter',
    meshes: 3,
    components: 3,
    builds: 1,
  })
  expect(
    parsed.materials.some((material) => material.color === '#BC285BFF'),
  ).toBe(true)
  expect(
    JSON.parse(strFromU8(entries['Metadata/design.json'])).multicolor.elements,
  ).toEqual(saved.multicolor.elements)

  await page.getByRole('button', { name: 'Export design', exact: true }).click()
  await dialog.getByRole('button', { name: 'STL parts', exact: true }).click()
  const zipEvent = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download ZIP/ }).click()
  const zipDownload = await zipEvent
  const zipPath = testInfo.outputPath('multicolor-parts.zip')
  await zipDownload.saveAs(zipPath)
  const files = unzipSync(new Uint8Array(await readFile(zipPath)))
  const materialFiles = Object.entries(files).filter(([name]) =>
    name.endsWith('.stl'),
  )
  expect(materialFiles).toHaveLength(3)
  for (const [, bytes] of materialFiles) {
    const mesh = inspectBinaryStl(Buffer.from(bytes))
    expect(mesh.invalidEdges).toBe(0)
    expect(mesh.signedVolume).toBeGreaterThan(0)
  }
  expect(errors).toEqual([])
})

test('edits mixed shapes and JSON on a narrow M workspace, with undo and mode cancellation', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: /^Speaker M/ }).click()
  await ready(page)
  await page.getByRole('button', { name: 'Multicolor', exact: true }).click()
  await preset(page, 'norway')
  await page
    .getByRole('group', { name: 'Add pattern shape' })
    .getByRole('button', { name: 'Circle', exact: true })
    .click()
  await page
    .getByRole('spinbutton', { name: 'Position X (mm)', exact: true })
    .fill('35')
  await page
    .getByRole('spinbutton', { name: 'Position X (mm)', exact: true })
    .press('Tab')
  await page
    .getByRole('spinbutton', { name: 'Outer radius (mm)', exact: true })
    .fill('10')
  await page
    .getByRole('spinbutton', { name: 'Outer radius (mm)', exact: true })
    .press('Tab')
  await ready(page)
  const before = await stored(page)
  expect(before.multicolor.elements.at(-1)).toMatchObject({
    kind: 'circle',
    x: 35,
    radius: 10,
  })
  const canvas = page.locator('.multicolor-canvas')
  await canvas.focus()
  await canvas.press('ArrowLeft')
  await expect
    .poll(async () => (await stored(page)).multicolor.elements.at(-1)!.x)
    .toBe(34)
  await canvas.press('Control+z')
  await expect
    .poll(async () => (await stored(page)).multicolor.elements.at(-1)!.x)
    .toBe(35)
  await ready(page)

  // Cancel a freshly scheduled partition by leaving multicolor; canonical export
  // must become available without waiting for the disabled pattern job.
  await canvas.press('ArrowLeft')
  await page.getByRole('button', { name: 'Single color', exact: true }).click()
  await ready(page)
  await expect(page.locator('[data-material-count]')).toHaveAttribute(
    'data-material-count',
    '0',
  )
  await page.getByRole('button', { name: 'Multicolor', exact: true }).click()
  await ready(page)
  const current = await stored(page)
  const jsonEvent = page.waitForEvent('download')
  await page
    .getByRole('button', { name: 'Save design JSON', exact: true })
    .click()
  const jsonDownload = await jsonEvent
  const jsonPath = testInfo.outputPath('mixed-pattern.json')
  await jsonDownload.saveAs(jsonPath)
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await ready(page)
  await page
    .locator('input[type="file"][accept=".json,application/json"]')
    .setInputFiles(jsonPath)
  await ready(page)
  expect((await stored(page)).multicolor).toEqual(current.multicolor)
  await page.locator('.multicolor-canvas').scrollIntoViewIfNeeded()
  await page.screenshot({
    path: testInfo.outputPath('multicolor-mobile.png'),
    fullPage: true,
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  expect(errors).toEqual([])
})
