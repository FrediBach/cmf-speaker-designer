import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { STORAGE_KEY, type Design } from '../../src/lib/design'
import { inspectBinaryStl } from './stl'

async function ready(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Export design', exact: true }),
  ).toBeEnabled()
  await expect(page.locator('.preview-stage canvas')).toBeVisible()
  await expect(
    page.getByText('3D preview unavailable', { exact: true }),
  ).toBeHidden()
}

async function storedDesign(page: Page): Promise<Design> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    STORAGE_KEY,
  )
}

for (const model of ['s', 'm'] as const) {
  test(`saves and exports recessed race stripes with clear LEGO studs on Speaker ${model.toUpperCase()}${model === 'm' ? ' on mobile' : ''}`, async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(180_000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    if (model === 'm') await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await ready(page)
    if (model === 'm') {
      await page.getByRole('button', { name: /^Speaker M/ }).click()
      await ready(page)
    }

    const stripes = page.getByRole('checkbox', {
      name: 'Recessed race stripes',
      exact: true,
    })
    const count = page.getByRole('spinbutton', {
      name: 'Stripe count',
      exact: true,
    })
    const width = page.getByRole('spinbutton', {
      name: 'Stripe width in millimeters',
      exact: true,
    })
    const gap = page.getByRole('spinbutton', {
      name: 'Stripe gap in millimeters',
      exact: true,
    })
    const countSlider = page.getByRole('slider', {
      name: 'Stripe count',
      exact: true,
    })
    await expect(stripes).not.toBeChecked()
    await stripes.check()
    await expect(count).toHaveValue('2')
    await expect(width).toHaveValue('6')
    await expect(gap).toHaveValue('4')
    await expect(countSlider).toHaveAttribute('aria-valuemin', '1')
    await expect(countSlider).toHaveAttribute('aria-valuemax', '3')
    await countSlider.press('Home')
    await expect(count).toHaveValue('1')
    await expect(gap).toBeDisabled()
    await count.fill('3')
    await width.fill('8')
    await gap.fill('6')
    await gap.press('Tab')
    const expected = { enabled: true, count: 3, width: 8, gap: 6 }
    await expect
      .poll(async () => (await storedDesign(page)).raceStripes)
      .toEqual(expected)

    // Checkbox changes must remain one undo step, independent of numeric drafts.
    await stripes.uncheck()
    await stripes.press('Control+z')
    await expect(stripes).toBeChecked()
    await stripes.press('Control+y')
    await expect(stripes).not.toBeChecked()
    await stripes.press('Control+z')
    await expect(stripes).toBeChecked()
    await ready(page)
    await page.reload()
    await ready(page)
    await expect(count).toHaveValue('3')
    await expect(width).toHaveValue('8')
    await expect(gap).toHaveValue('6')

    await page.getByRole('tab', { name: 'Handle', exact: true }).click()
    await page
      .getByRole('button', { name: 'Custom handle', exact: true })
      .click()
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
    await page.getByRole('button', { name: 'Round', exact: true }).click()
    await page
      .getByRole('spinbutton', {
        name: 'Hole diameter in millimeters',
        exact: true,
      })
      .fill('12')
    await page
      .getByRole('checkbox', { name: 'LEGO-compatible studs', exact: true })
      .check()
    await ready(page)

    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page
      .getByRole('button', { name: 'Copy design link', exact: true })
      .click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Design link copied.' }),
    ).toBeVisible()
    const link = await page.evaluate(() => navigator.clipboard.readText())
    const shared = JSON.parse(new URL(link).searchParams.get('design')!)
    expect(shared.raceStripes).toEqual(expected)
    expect(shared.handle.legoStuds).toBe(true)
    await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY)
    await page.goto(link)
    await ready(page)
    await page.getByRole('tab', { name: 'Front panel', exact: true }).click()
    await expect(stripes).toBeChecked()
    await expect(count).toHaveValue('3')
    await expect(width).toHaveValue('8')
    await expect(gap).toHaveValue('6')
    await gap.scrollIntoViewIfNeeded()
    await expect(gap).toBeInViewport()
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }))
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport)
    await page.screenshot({
      path: testInfo.outputPath(`race-stripes-${model}.png`),
      fullPage: true,
    })

    await page
      .getByRole('button', { name: 'Export design', exact: true })
      .click()
    const dialog = page.getByRole('dialog', {
      name: 'Export design',
      exact: true,
    })
    await expect(dialog).toContainText(/race stripes/i)
    await dialog
      .getByRole('group', { name: 'Export parts' })
      .getByRole('button', { name: 'Panel only', exact: true })
      .click()
    const started = page.waitForEvent('download')
    await dialog.getByRole('button', { name: /^Download STL/ }).click()
    const download = await started
    const output = testInfo.outputPath(`race-stripes-${model}.stl`)
    await download.saveAs(output)
    const mesh = inspectBinaryStl(await readFile(output))
    expect(mesh.components, 'Recesses must leave one connected panel').toBe(1)
    expect(mesh.invalidEdges, 'The exported mesh must remain watertight').toBe(
      0,
    )
    expect(mesh.degenerateEdges).toBe(0)
    expect(mesh.signedVolume).toBeGreaterThan(0)

    // Inspect the file independently of the application's stripe/stud helpers.
    // The three 8 mm bands have centers -14, 0, 14 and 6 mm clear gaps.
    const seamY = model === 's' ? 65.48455 - 24 : 112.48455 - 27
    for (const y of [seamY + 6, seamY + 38]) {
      const plain = mesh.rayZ(24, y)
      expect(plain).toHaveLength(2)
      expect(plain[1] - plain[0]).toBeCloseTo(4, 3)
      for (const x of [-14, 0, 14]) {
        const recessed = mesh.rayZ(x, y)
        expect(recessed).toHaveLength(2)
        expect(
          recessed[0] - plain[0],
          'Stripe depth must be 0.8 mm',
        ).toBeCloseTo(0.8, 3)
        expect(recessed[1] - recessed[0]).toBeCloseTo(3.2, 3)
      }
    }
    expect(
      mesh.rayZ(0, seamY + 22),
      'The existing handle opening must remain a through-hole',
    ).toEqual([])
    const bottomY = model === 's' ? -60 : -108
    const frontPlain = mesh.rayZ(24, bottomY)
    const frontStripe = mesh.rayZ(0, bottomY)
    expect(frontPlain.length).toBeGreaterThanOrEqual(2)
    expect(frontStripe.length).toBeGreaterThanOrEqual(2)
    expect(
      frontStripe[0] - frontPlain[0],
      'The same recess must continue down the front face',
    ).toBeCloseTo(0.8, 3)

    // The centered LEGO lattice has two possible phases in each direction.
    // Sampling both finds actual retained studs without assuming their count.
    let retainedStuds = 0
    for (let y = 10; y <= 34; y += 4) {
      for (let x = -44; x <= 44; x += 4) {
        const surfaces = mesh.rayZ(x, seamY + y)
        if (surfaces.length !== 2 || surfaces[1] - surfaces[0] < 5.79) continue
        retainedStuds += 1
        expect(surfaces[1] - surfaces[0]).toBeCloseTo(5.8, 3)
        for (const center of [-14, 0, 14]) {
          expect(
            Math.abs(x - center) - 4,
            'The full 4.8 mm stud footprint must clear every stripe',
          ).toBeGreaterThanOrEqual(2.4)
        }
      }
    }
    expect(retainedStuds).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })
}
