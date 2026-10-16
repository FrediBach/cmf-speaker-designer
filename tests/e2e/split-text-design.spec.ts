import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'three/addons/libs/fflate.module.js'
import design from '../../src/lib/__fixtures__/split-text-design.json' with { type: 'json' }
import { STORAGE_KEY } from '../../src/lib/design'

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

test('opens the reported split text design, separates all parts in Exploded view and exports multicolor', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`/#design=${encodeURIComponent(JSON.stringify(design))}`)
  await expect(page.locator('[data-materials-ready]')).toHaveAttribute(
    'data-materials-ready',
    'true',
    { timeout: 90_000 },
  )
  await expect(page.locator('[data-material-count]')).toHaveAttribute(
    'data-material-count',
    '2',
  )
  await expect(
    page.getByText('A color boundary is too small to export reliably.', {
      exact: false,
    }),
  ).toHaveCount(0)
  const saved = await page.evaluate(
    (key) => localStorage.getItem(key),
    STORAGE_KEY,
  )
  await settledPreview(page)
  await page
    .locator('.preview-card')
    .screenshot({ path: testInfo.outputPath('reported-design-assembled.png') })

  await page.getByRole('button', { name: 'Exploded', exact: true }).click()
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click()
  await settledPreview(page)
  await page
    .locator('.preview-card')
    .screenshot({ path: testInfo.outputPath('reported-design-exploded.png') })
  expect(
    await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  ).toBe(saved)

  await page.getByRole('button', { name: 'Export design', exact: true }).click()
  const dialog = page.getByRole('dialog', {
    name: 'Export design',
    exact: true,
  })
  await expect(
    dialog.getByText('2 used materials · Full-depth regions', { exact: true }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'All parts', exact: true }).click()
  await dialog.getByRole('button', { name: '3MF', exact: true }).click()
  const started = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download 3MF/ }).click()
  const download = await started
  const output = testInfo.outputPath('reported-design.3mf')
  await download.saveAs(output)
  const entries = unzipSync(new Uint8Array(await readFile(output)))
  const xml = strFromU8(entries['3D/3dmodel.model'])
  expect(xml.match(/<item /g)).toHaveLength(4)
  for (const name of [
    'Speaker M front panel',
    'Speaker M upper panel',
    'Volume knob',
    'Power button',
  ])
    expect(xml).toContain(`name="${name}"`)
  const settings = JSON.parse(strFromU8(entries['Metadata/design.json']))
  expect(settings.multicolor.elements).toEqual(
    JSON.parse(saved!).multicolor.elements,
  )
  expect(settings.panelSplit).toBe(true)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click()
  await settledPreview(page)
  await page.locator('.preview-card').screenshot({
    path: testInfo.outputPath('reported-design-exploded-mobile.png'),
  })
  await page.getByRole('button', { name: 'Speaker', exact: true }).click()
  expect(
    await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  ).toBe(saved)
  expect(errors).toEqual([])
})
