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
  test(`saves and exports LEGO studs on the ${model.toUpperCase()} custom handle${model === 'm' ? ' on mobile' : ''}`, async ({
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
    const studs = page.getByRole('checkbox', {
      name: 'LEGO-compatible studs',
      exact: true,
    })
    await expect(studs).toBeHidden()
    await page
      .getByRole('button', { name: 'Custom handle', exact: true })
      .click()
    await expect(studs).not.toBeChecked()
    await page.getByRole('button', { name: 'None', exact: true }).click()
    await page
      .getByRole('spinbutton', {
        name: 'Extension height in millimeters',
        exact: true,
      })
      .fill('40')
    await page
      .getByRole('spinbutton', {
        name: 'Handle width in millimeters',
        exact: true,
      })
      .fill('96')
    await page.locator('.handle-studs-toggle').scrollIntoViewIfNeeded()
    await studs.focus()
    await page.keyboard.press('Space')
    await expect(studs).toBeChecked()
    await expect(page.locator('.handle-studs-detail')).toContainText('48 studs')
    await ready(page)

    await page.keyboard.press('Control+z')
    await expect(studs).not.toBeChecked()
    await page.keyboard.press('Control+Shift+z')
    await expect(studs).toBeChecked()
    await ready(page)
    await page.reload()
    await ready(page)
    await expect(studs).toBeChecked()

    await page
      .getByRole('button', { name: 'Original handle', exact: true })
      .click()
    await ready(page)
    await expect(studs).toBeHidden()
    await page
      .getByRole('button', { name: 'Custom handle', exact: true })
      .click()
    await ready(page)
    await expect(studs).toBeChecked()

    await page.locator('.handle-studs-toggle').scrollIntoViewIfNeeded()
    await expect(page.locator('.handle-studs-toggle')).toBeInViewport()
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.width)
    await page.screenshot({
      path: testInfo.outputPath(`lego-handle-${model}.png`),
      fullPage: true,
    })

    await page
      .getByRole('button', { name: 'Export design', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('LEGO-compatible studs')
    await dialog
      .getByRole('button', { name: 'Panel only', exact: true })
      .click()
    const started = page.waitForEvent('download')
    await dialog.getByRole('button', { name: /^Download STL/ }).click()
    const download = await started
    expect(download.suggestedFilename()).toBe(
      `cmf-speaker-${model}-original-handle-40.0mm-lego-studs.stl`,
    )
    const output = testInfo.outputPath(download.suggestedFilename())
    await download.saveAs(output)
    const mesh = inspectBinaryStl(await readFile(output))
    expect(mesh.components).toBe(1)
    expect(mesh.invalidEdges).toBe(0)
    expect(mesh.degenerateEdges).toBe(0)
    // Four rows and twelve columns on an 8 mm grid. Inspect the actual file
    // independently of the app's placement and export helpers.
    const seamY = model === 's' ? 65.48455 - 24 : 112.48455 - 27
    for (const y of [10, 18, 26, 34]) {
      for (let x = -44; x <= 44; x += 8) {
        const surfaces = mesh.rayZ(x, seamY + y)
        expect(surfaces).toHaveLength(2)
        expect(surfaces[1] - surfaces[0]).toBeCloseTo(5.8, 3)
      }
    }
    const betweenStuds = mesh.rayZ(0, seamY + 10)
    expect(betweenStuds).toHaveLength(2)
    expect(betweenStuds[1] - betweenStuds[0]).toBeCloseTo(4, 3)
    expect(errors).toEqual([])
  })
}
