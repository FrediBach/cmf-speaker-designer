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
  test(`saves and exports an angled curved hair profile on ${model.toUpperCase()}${model === 'm' ? ' on mobile' : ''}`, async ({
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
    await page.getByRole('button', { name: 'Hair', exact: true }).click()
    await page
      .getByRole('spinbutton', {
        name: 'Extension height in millimeters',
        exact: true,
      })
      .fill('45')

    const shapeName = model === 's' ? 'Rounded outwards' : 'Rounded inwards'
    const shape = page.getByRole('button', { name: shapeName, exact: true })
    await expect(
      page.getByRole('group', { name: 'Top shape', exact: true }),
    ).toBeVisible()
    await shape.click()
    const curve = page.getByRole('spinbutton', {
      name: 'Curve depth in millimeters',
      exact: true,
    })
    await curve.fill('10')
    const angle = page.getByRole('spinbutton', {
      name: 'Top angle in degrees',
      exact: true,
    })
    const angleValue = model === 's' ? '12' : '-12'
    await angle.fill(angleValue)
    // Leave the number field so keyboard undo targets design history.
    await shape.focus()
    await page.keyboard.press('Control+z')
    await expect(angle).toHaveValue('0')
    await page.keyboard.press('Control+Shift+z')
    await expect(angle).toHaveValue(angleValue)

    const studs = page.getByRole('checkbox', {
      name: 'LEGO-compatible studs',
      exact: true,
    })
    await studs.focus()
    await page.keyboard.press('Space')
    await expect(studs).toBeChecked()
    await ready(page)
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const saved = JSON.parse(
            localStorage.getItem('cmf-speaker-design-v1') ?? '{}',
          )
          return saved.handle
        }),
      )
      .toMatchObject({
        topShape: model === 's' ? 'outward' : 'inward',
        topAngle: Number(angleValue),
        topCurve: 10,
        legoStuds: true,
        cutout: 'slits',
      })

    await page.reload()
    await ready(page)
    await expect(shape).toHaveAttribute('aria-pressed', 'true')
    await expect(angle).toHaveValue(angleValue)
    await expect(curve).toHaveValue('10')
    await expect(studs).toBeChecked()
    await shape.scrollIntoViewIfNeeded()
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.width)
    await page.screenshot({
      path: testInfo.outputPath(`handle-profile-${model}.png`),
      fullPage: true,
    })
    await curve.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: testInfo.outputPath(`handle-profile-curve-${model}.png`),
      fullPage: true,
    })
    let fittedSlits = 5
    if (model === 'm') {
      const omitted = page.getByText(/^\d+ of 5 slits fit this profile\./)
      await expect(omitted).toBeVisible()
      fittedSlits = Number((await omitted.innerText()).match(/^\d+/)?.[0])
      expect(fittedSlits).toBeGreaterThan(0)
      expect(fittedSlits).toBeLessThan(5)
    }

    await page
      .getByRole('button', { name: 'Export design', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('LEGO-compatible studs')
    await expect(dialog).toContainText(
      fittedSlits === 5 ? '5 top slits' : `${fittedSlits} of 5 top slits`,
    )
    await dialog
      .getByRole('button', { name: 'Panel only', exact: true })
      .click()
    const started = page.waitForEvent('download')
    await dialog.getByRole('button', { name: /^Download STL/ }).click()
    const download = await started
    const output = testInfo.outputPath(`handle-profile-${model}.stl`)
    await download.saveAs(output)
    const mesh = inspectBinaryStl(await readFile(output))
    expect(mesh.components).toBe(1)
    expect(mesh.invalidEdges).toBe(0)
    expect(mesh.degenerateEdges).toBe(0)
    expect(mesh.signedVolume).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })
}
