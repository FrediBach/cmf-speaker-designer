import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { inspectBinaryStl } from './stl'

async function ready(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Export design', exact: true }),
  ).toBeEnabled()
  await expect(
    page.getByText('3D preview unavailable', { exact: true }),
  ).toBeHidden()
}

for (const model of ['s', 'm'] as const) {
  test(`saves and exports rounded hair slits on the ${model.toUpperCase()}${model === 'm' ? ' on mobile' : ''}`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    if (model === 'm') await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await ready(page)
    if (model === 'm') {
      await page.getByRole('button', { name: /^Speaker M/ }).click()
      await ready(page)
    }
    await page.getByRole('tab', { name: 'Handle', exact: true }).click()
    await page
      .getByRole('button', { name: 'Custom handle', exact: true })
      .click()
    const slits = page.getByRole('button', { name: 'Top slits', exact: true })
    await slits.click()
    await expect(slits).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByRole('group', { name: 'Number of slits' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: '5 slits', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: '4 slits', exact: true }).click()
    await page
      .getByRole('spinbutton', {
        name: 'Slit depth in millimeters',
        exact: true,
      })
      .fill('14')
    await page.getByRole('button', { name: 'Hair', exact: true }).click()
    await expect(
      page.getByRole('spinbutton', {
        name: 'Extension height in millimeters',
        exact: true,
      }),
    ).toHaveValue('35')
    await expect(
      page.getByRole('spinbutton', {
        name: 'Slit width in millimeters',
        exact: true,
      }),
    ).toHaveValue('5')
    await expect(
      page.getByRole('spinbutton', {
        name: 'Slit depth in millimeters',
        exact: true,
      }),
    ).toHaveValue('23')
    await expect(
      page.getByRole('button', { name: '5 slits', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await ready(page)
    await page.reload()
    await ready(page)
    await expect(slits).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByRole('button', { name: '5 slits', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByRole('spinbutton', {
        name: 'Slit depth in millimeters',
        exact: true,
      }),
    ).toHaveValue('23')
    await page.locator('.handle-placement > summary').click()
    await expect(
      page.getByRole('spinbutton', {
        name: 'Slit spacing in millimeters',
        exact: true,
      }),
    ).toHaveValue('8')
    await expect(
      page.getByRole('spinbutton', {
        name: 'Vertical offset in millimeters',
        exact: true,
      }),
    ).toBeHidden()
    await page.locator('.handle-placement > summary').click()
    await slits.scrollIntoViewIfNeeded()
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.width)
    await page.screenshot({
      path: testInfo.outputPath(`hair-handle-${model}.png`),
      fullPage: true,
    })

    await page
      .getByRole('button', { name: 'Export design', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('5 top slits')
    await dialog
      .getByRole('button', { name: 'Panel only', exact: true })
      .click()
    const started = page.waitForEvent('download')
    await dialog.getByRole('button', { name: /^Download STL/ }).click()
    const download = await started
    const path = testInfo.outputPath(`hair-handle-${model}.stl`)
    await download.saveAs(path)
    const mesh = inspectBinaryStl(await readFile(path))
    expect(mesh.components).toBe(1)
    expect(mesh.invalidEdges).toBe(0)
    expect(mesh.degenerateEdges).toBe(0)
    const seamY = model === 's' ? 65.48455 - 24 : 112.48455 - 27
    const top = seamY + 35
    const bottom = top - 23
    for (const x of [-26, -13, 0, 13, 26]) {
      expect(mesh.rayZ(x, top - 0.1)).toEqual([])
      expect(mesh.rayZ(x, bottom + 0.1)).toEqual([])
      expect(mesh.rayZ(x, bottom - 0.1)).toHaveLength(2)
      expect(mesh.rayZ(x + 2.25, bottom + 0.1)).toHaveLength(2)
      expect(mesh.rayZ(x + 2.25, bottom + 2.5)).toEqual([])
    }
    for (const x of [-19.5, -6.5, 6.5, 19.5])
      expect(mesh.rayZ(x, top - 0.1)).toHaveLength(2)
    expect(errors).toEqual([])
  })
}
