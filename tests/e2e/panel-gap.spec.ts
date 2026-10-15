import { readFile } from 'node:fs/promises'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { STORAGE_KEY } from '../../src/lib/design'
import { inspectBinaryStl } from './stl'
import { revealSpeakerControls } from './controls'

async function expectReady(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Export design', exact: true }),
  ).toBeEnabled()
  await expect(page.locator('.preview-stage canvas')).toBeVisible()
  await expect(
    page.getByText('3D preview unavailable', { exact: true }),
  ).not.toBeVisible()
}

async function storedGap(page: Page): Promise<number> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).panelGap,
    STORAGE_KEY,
  )
}

async function downloadPanel(
  page: Page,
  testInfo: TestInfo,
  model: 's' | 'm',
  gap: number,
) {
  await expectReady(page)
  await page.getByRole('button', { name: 'Export design', exact: true }).click()
  const dialog = page.getByRole('dialog', {
    name: 'Export design',
    exact: true,
  })
  const summary = dialog.getByText('Panel gap · 0.50 cm · Recessed controls', {
    exact: true,
  })
  if (gap > 0) await expect(summary).toBeVisible()
  else await expect(summary).toHaveCount(0)
  await dialog
    .getByRole('group', { name: 'Export parts' })
    .getByRole('button', { name: 'Panel only', exact: true })
    .click()
  const started = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download STL/ }).click()
  const download = await started
  expect(download.suggestedFilename()).toBe(
    `cmf-speaker-${model}-original${gap > 0 ? '-gap-5.0mm' : ''}.stl`,
  )
  const output = testInfo.outputPath(`speaker-${model}-gap-${gap}mm.stl`)
  await download.saveAs(output)
  const binary = await readFile(output)
  const mesh = inspectBinaryStl(binary)
  expect(
    mesh.components,
    'The spaced panel and supports must form one solid',
  ).toBe(1)
  expect(mesh.invalidEdges, 'Every edge must have two opposing faces').toBe(0)
  expect(mesh.degenerateEdges).toBe(0)
  expect(mesh.signedVolume).toBeGreaterThan(0)
  expect(mesh.minimum[2]).toBeCloseTo(0, 5)
  return { ...mesh, binary }
}

type PanelMesh = Awaited<ReturnType<typeof downloadPanel>>

function worldRay(mesh: PanelMesh, gap: number, x: number, y: number) {
  // STL export flips X/Z and puts the outer front face on the print bed.
  // These panels have zero added face depth, so their world front is Z=4+gap.
  return mesh
    .rayZ(-x, y)
    .map((z) => 4 + gap - z)
    .reverse()
}

function expectPhysicalGap(
  original: PanelMesh,
  spaced: PanelMesh,
  model: 's' | 'm',
) {
  const faceY = model === 's' ? -20 : -70
  const originalFace = worldRay(original, 0, 40, faceY)
  const spacedFace = worldRay(spaced, 5, 40, faceY)
  expect(originalFace.at(-1)).toBeCloseTo(4, 4)
  expect(
    spacedFace.at(-1),
    'The front face must move 5 mm away from the speaker body',
  ).toBeCloseTo(9, 4)

  const latchX = model === 's' ? 35.75 : 35.5
  const latchY = model === 's' ? 3 : 29
  const originalLatch = worldRay(original, 0, latchX, latchY)
  const spacedLatch = worldRay(spaced, 5, latchX, latchY)
  expect(originalLatch[0]).toBeLessThan(-4)
  expect(
    spacedLatch[0],
    'The locking tip must retain its original body attachment position',
  ).toBeCloseTo(originalLatch[0], 4)

  const controlY = model === 's' ? 29.5 : 70
  const controlZ = model === 's' ? -6 : -8.5
  for (const x of [-28.5, 28.5]) {
    expect(
      // A vertical ray can intersect the original angled rear collar farther
      // back; the usable opening around the fixed control must stay clear.
      worldRay(spaced, 5, x, controlY).filter((z) => z > controlZ - 2),
      'The fixed button and knob centers must remain clear in their recessed openings',
    ).toEqual([])
  }

  const postY = model === 's' ? -50 : -100
  for (const x of [-39.5, 39.5]) {
    const post = worldRay(spaced, 5, x, postY).filter((z) => z >= -0.1)
    expect(
      post[0],
      'Front support feet must reach the original body face',
    ).toBeCloseTo(0, 3)
    expect(post.at(-1)).toBeCloseTo(9, 4)
    const besidePost = worldRay(spaced, 5, x - Math.sign(x) * 3, postY).filter(
      (z) => z >= 0,
    )
    expect(
      besidePost[0],
      'Space behind the panel must stay open beside the support posts',
    ).toBeGreaterThan(4.9)
  }

  // Deck posts follow its 45-degree normal, with their feet fixed slightly
  // behind the original inside surface instead of following the raised face.
  const footY = (model === 's' ? 28.5 : 69) - 0.5 / Math.SQRT2
  const footZ = (model === 's' ? -9.949747 : -12.449747) - 0.5 / Math.SQRT2
  for (const x of [-10, 10]) {
    const post = worldRay(spaced, 5, x, footY)
    expect(
      Math.min(...post.map((z) => Math.abs(z - footZ))),
      'Angled support feet must remain seated against the original control deck',
    ).toBeLessThan(0.001)
  }
}

async function screenshotGap(page: Page, testInfo: TestInfo) {
  await page
    .getByRole('slider', { name: 'Panel gap', exact: true })
    .scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click()
  await page.screenshot({
    path: testInfo.outputPath('speaker-s-5mm-gap-assembled.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Panel only', exact: true }).click()
  const preview = page.locator('[role="img"][data-preview-controls]')
  await preview.focus()
  for (let turn = 0; turn < 22; turn += 1) await preview.press('ArrowRight')
  await page.locator('.preview-card').screenshot({
    path: testInfo.outputPath('speaker-s-5mm-gap-rear-supports.png'),
  })
  await page.getByRole('button', { name: 'Speaker', exact: true }).click()
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click()
}

test('spaces panels by up to 0.5 cm, preserves saved history, and exports connected attachments on both models', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expectReady(page)
  const slider = page.getByRole('slider', { name: 'Panel gap', exact: true })
  await expect(slider).toHaveAttribute('aria-valuemin', '0')
  await expect(slider).toHaveAttribute('aria-valuemax', '0.5')
  await expect(slider).toHaveAttribute('aria-valuenow', '0')
  await slider.press('ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuenow', '0.01')
  await expect.poll(() => storedGap(page)).toBe(0.1)
  await slider.press('Home')
  const smallOriginal = await downloadPanel(page, testInfo, 's', 0)

  await slider.press('End')
  await expect(slider).toHaveAttribute('aria-valuenow', '0.5')
  await expect.poll(() => storedGap(page)).toBe(5)
  await page.getByRole('button', { name: 'Randomize', exact: true }).focus()
  await page.keyboard.press('Control+z')
  await expect(slider).toHaveAttribute('aria-valuenow', '0')
  await page.keyboard.press('Control+y')
  await expect(slider).toHaveAttribute('aria-valuenow', '0.5')
  await page.reload()
  await expectReady(page)
  await expect(slider).toHaveAttribute('aria-valuenow', '0.5')
  const smallSpaced = await downloadPanel(page, testInfo, 's', 5)
  expect(smallSpaced.signedVolume).toBeGreaterThan(smallOriginal.signedVolume)
  expectPhysicalGap(smallOriginal, smallSpaced, 's')
  await screenshotGap(page, testInfo)

  await revealSpeakerControls(page)
  await page.getByRole('button', { name: /^Speaker M/ }).click()
  await expect(slider).toHaveAttribute('aria-valuenow', '0.5')
  const mediumSpaced = await downloadPanel(page, testInfo, 'm', 5)
  await slider.press('Home')
  const mediumOriginal = await downloadPanel(page, testInfo, 'm', 0)
  expect(mediumSpaced.signedVolume).toBeGreaterThan(mediumOriginal.signedVolume)
  expectPhysicalGap(mediumOriginal, mediumSpaced, 'm')
  await slider.press('End')
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(slider).toHaveAttribute('aria-valuenow', '0')
  await expect.poll(() => storedGap(page)).toBe(0)
  await revealSpeakerControls(page)
  await expect(
    page.getByRole('button', { name: /^Speaker M/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expectReady(page)
  expect(errors).toEqual([])
})
