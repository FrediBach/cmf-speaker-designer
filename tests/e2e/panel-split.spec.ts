import { readFile } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js'
import { expect, test, type Page } from '@playwright/test'
import { STORAGE_KEY } from '../../src/lib/design'
import { revealSpeakerControls } from './controls'
import { inspectBinaryStl } from './stl'

async function ready(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Export design', exact: true }),
  ).toBeEnabled()
  await expect(page.locator('.preview-stage canvas')).toBeVisible()
}

test('opts into two printable panel pieces on both models and preserves the choice through history and reload', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await ready(page)
  const split = page.getByRole('checkbox', {
    name: 'Split front and upper panel',
  })
  await expect(split).not.toBeChecked()
  await split.check()
  await ready(page)
  await page.getByRole('button', { name: 'Randomize', exact: true }).focus()
  await page.keyboard.press('Control+z')
  await expect(split).not.toBeChecked()
  await page.keyboard.press('Control+y')
  await expect(split).toBeChecked()
  await page.reload()
  await ready(page)
  await expect(split).toBeChecked()
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).panelSplit,
        STORAGE_KEY,
      ),
    )
    .toBe(true)

  for (const model of ['s', 'm'] as const) {
    if (model === 'm') {
      await revealSpeakerControls(page)
      await page.getByRole('button', { name: /^Speaker M/ }).click()
      await ready(page)
    }
    await page
      .getByRole('button', { name: 'Export design', exact: true })
      .click()
    const dialog = page.getByRole('dialog', {
      name: 'Export design',
      exact: true,
    })
    await dialog
      .getByRole('button', { name: 'Panel only', exact: true })
      .click()
    const started = page.waitForEvent('download')
    await dialog.getByRole('button', { name: /^Download ZIP/ }).click()
    const download = await started
    expect(download.suggestedFilename()).toMatch(/\.zip$/)
    const path = testInfo.outputPath(`split-${model}.zip`)
    await download.saveAs(path)
    const entries = unzipSync(new Uint8Array(await readFile(path)))
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
    expect(JSON.parse(strFromU8(entries['design.json'])).panelSplit).toBe(true)
  }

  await split.scrollIntoViewIfNeeded()
  await page.screenshot({
    path: testInfo.outputPath('split-panel-control.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Panel only', exact: true }).click()
  const preview = page.locator('[role="img"][data-preview-controls]')
  await preview.focus()
  for (let turn = 0; turn < 22; turn += 1) await preview.press('ArrowRight')
  await page
    .locator('.preview-card')
    .screenshot({ path: testInfo.outputPath('split-panel-rear.png') })

  await page.getByRole('button', { name: 'Multicolor', exact: true }).click()
  const editor = page.locator('.multicolor-editor')
  const presets = editor
    .locator('details')
    .filter({
      has: page.locator('summary', { hasText: 'Choose a preset' }),
    })
    .first()
  if ((await presets.getAttribute('open')) === null)
    await presets.locator('summary').click()
  await editor
    .getByLabel('Pattern preset', { exact: true })
    .selectOption('france')
  await editor.getByRole('button', { name: 'Apply editable preset' }).click()
  await expect(page.locator('[data-materials-ready]')).toHaveAttribute(
    'data-materials-ready',
    'true',
  )
  await ready(page)
  await page.getByRole('button', { name: 'Export design', exact: true }).click()
  const materialDialog = page.getByRole('dialog', {
    name: 'Export design',
    exact: true,
  })
  await materialDialog
    .getByRole('button', { name: 'Panel only', exact: true })
    .click()
  await materialDialog.getByRole('button', { name: '3MF', exact: true }).click()
  const materialStarted = page.waitForEvent('download')
  await materialDialog.getByRole('button', { name: /^Download 3MF/ }).click()
  const materialDownload = await materialStarted
  const materialPath = testInfo.outputPath('split-multicolor.3mf')
  await materialDownload.saveAs(materialPath)
  const materialEntries = unzipSync(
    new Uint8Array(await readFile(materialPath)),
  )
  const xml = strFromU8(materialEntries['3D/3dmodel.model'])
  expect(xml.match(/<item /g)).toHaveLength(2)
  expect(xml).toContain('name="Speaker M front panel"')
  expect(xml).toContain('name="Speaker M upper panel"')
  expect(
    JSON.parse(strFromU8(materialEntries['Metadata/design.json'])).panelSplit,
  ).toBe(true)

  await page.getByRole('button', { name: 'Single color', exact: true }).click()
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(split).not.toBeChecked()
  await ready(page)
  expect(errors).toEqual([])
})
