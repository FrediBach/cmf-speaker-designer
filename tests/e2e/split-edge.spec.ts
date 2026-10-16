import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'three/addons/libs/fflate.module.js'
import { DEFAULT_DESIGN, STORAGE_KEY } from '../../src/lib/design'
import { inspectBinaryStl } from './stl'

async function settledPreview(page: Page) {
  let previous: Buffer | undefined
  let matches = 0
  await expect
    .poll(
      async () => {
        const current = await page.locator('.preview-stage canvas').screenshot()
        matches = previous?.equals(current) ? matches + 1 : 0
        previous = current
        return matches
      },
      { intervals: [150, 250, 500] },
    )
    .toBeGreaterThanOrEqual(2)
}

test('keeps the reported stock S split joint clean in preview and exports both closed pieces', async ({
  page,
}, testInfo) => {
  const design = {
    ...DEFAULT_DESIGN,
    panelSplit: true,
    multicolor: {
      ...DEFAULT_DESIGN.multicolor,
      frame: { ...DEFAULT_DESIGN.multicolor.frame, height: 225 },
    },
  }
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`/?design=${encodeURIComponent(JSON.stringify(design))}`)
  await expect(
    page.getByRole('button', { name: 'Export design', exact: true }),
  ).toBeEnabled()
  await expect(
    page.getByRole('checkbox', { name: 'Split front and upper panel' }),
  ).toBeChecked()
  const saved = await page.evaluate(
    (key) => localStorage.getItem(key),
    STORAGE_KEY,
  )
  expect(JSON.parse(saved!)).toEqual(design)

  await page.getByRole('button', { name: 'Exploded', exact: true }).click()
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click()
  await settledPreview(page)
  await page.locator('.preview-card').screenshot({
    path: testInfo.outputPath('split-edge-front.png'),
  })

  const preview = page.locator('[role="img"][data-preview-controls]')
  await preview.focus()
  for (let turn = 0; turn < 10; turn += 1) await preview.press('ArrowRight')
  for (let turn = 0; turn < 6; turn += 1) await preview.press('ArrowDown')
  for (let zoom = 0; zoom < 10; zoom += 1) await preview.press('Equal')
  await settledPreview(page)
  await page.locator('.preview-card').screenshot({
    path: testInfo.outputPath('split-edge-rear.png'),
  })

  await page.getByRole('button', { name: 'Export design', exact: true }).click()
  const dialog = page.getByRole('dialog', {
    name: 'Export design',
    exact: true,
  })
  await dialog.getByRole('button', { name: 'Panel only', exact: true }).click()
  await dialog.getByRole('button', { name: 'STL', exact: true }).click()
  const started = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download ZIP/ }).click()
  const download = await started
  const output = testInfo.outputPath('split-edge.zip')
  await download.saveAs(output)
  const entries = unzipSync(new Uint8Array(await readFile(output)))
  const parts = Object.entries(entries).filter(([name]) =>
    name.endsWith('.stl'),
  )
  expect(parts).toHaveLength(2)
  expect(parts.some(([name]) => name.includes('front'))).toBe(true)
  expect(parts.some(([name]) => name.includes('upper'))).toBe(true)
  for (const [, bytes] of parts) {
    const mesh = inspectBinaryStl(Buffer.from(bytes))
    expect(mesh.components).toBe(1)
    expect(mesh.invalidEdges).toBe(0)
    expect(mesh.degenerateEdges).toBe(0)
    expect(mesh.signedVolume).toBeGreaterThan(0)
    expect(mesh.minimum[2]).toBeCloseTo(0, 5)
  }
  const exported = JSON.parse(strFromU8(entries['design.json']))
  delete exported.export
  expect(exported).toEqual(design)
  expect(
    await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  ).toBe(saved)
  expect(errors).toEqual([])
})
