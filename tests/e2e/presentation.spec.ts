import { expect, test as base, type Page } from '@playwright/test'
import { STORAGE_KEY } from '../../src/lib/design'

const test = base.extend<{ appErrors: string[] }>({
  appErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await use(errors)
      expect(
        errors,
        'Presentation controls should not crash the preview',
      ).toEqual([])
    },
    { auto: true },
  ],
})

const presentationButton = (page: Page) =>
  page.getByRole('button', { name: 'Presentation mode', exact: true })

const canvas = (page: Page) => page.locator('.preview-stage canvas')

async function ready(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Export design', exact: true }),
  ).toBeEnabled()
  await expect(canvas(page)).toBeVisible()
}

async function stableFrame(page: Page) {
  let previous: Buffer | undefined
  let matchingFrames = 0
  await expect
    .poll(
      async () => {
        const frame = await canvas(page).screenshot()
        matchingFrames = previous?.equals(frame) ? matchingFrames + 1 : 0
        previous = frame
        return matchingFrames
      },
      {
        message: 'The camera should stay still after presentation stops',
        intervals: [200, 300, 500],
      },
    )
    .toBeGreaterThanOrEqual(3)
  return previous!
}

async function expectMotion(page: Page) {
  // Observe successive changes, so a single initial camera adjustment cannot
  // satisfy the check for a continuously orbiting presentation.
  let previous = await canvas(page).screenshot()
  for (let change = 0; change < 2; change += 1) {
    await expect
      .poll(async () => !(await canvas(page).screenshot()).equals(previous), {
        message: 'Presentation should keep changing the visible camera angle',
      })
      .toBe(true)
    previous = await canvas(page).screenshot()
  }
}

async function startPresentation(page: Page) {
  const button = presentationButton(page)
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  for (const name of ['3D view', 'Front']) {
    await expect(
      page.getByRole('button', { name, exact: true }),
    ).toHaveAttribute('aria-pressed', 'false')
  }
}

async function expectPreviewControlsReachable(page: Page) {
  const buttons = page.locator('.preview-card button')
  const boxes = []
  for (const button of await buttons.all()) {
    await expect(button).toBeInViewport({ ratio: 1 })
    await button.click({ trial: true })
    expect(
      await button.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        const hit = document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        )
        return hit === element || (hit !== null && element.contains(hit))
      }),
      `The ${(await button.getAttribute('aria-label')) ?? (await button.innerText())} button should receive pointer input`,
    ).toBe(true)
    boxes.push((await button.boundingBox())!)
  }
  for (let first = 0; first < boxes.length; first += 1) {
    for (let second = first + 1; second < boxes.length; second += 1) {
      const a = boxes[first]
      const b = boxes[second]
      const overlapWidth = Math.max(
        0,
        Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
      )
      const overlapHeight = Math.max(
        0,
        Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
      )
      expect(
        overlapWidth * overlapHeight,
        'Preview buttons must not overlap',
      ).toBeLessThanOrEqual(1)
    }
  }
  const viewport = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
    height: window.innerHeight,
    contentHeight: document.documentElement.scrollHeight,
  }))
  expect(viewport.contentWidth).toBeLessThanOrEqual(viewport.width + 1)
  expect(viewport.contentHeight).toBeLessThanOrEqual(viewport.height + 1)
}

test('presentation visibly circles the speaker and pauses at its current angle without changing the design', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await ready(page)
  const button = presentationButton(page)
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  const design = await page.evaluate(
    (key) => localStorage.getItem(key),
    STORAGE_KEY,
  )
  const original = await stableFrame(page)

  await button.focus()
  await button.press('Space')
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expectMotion(page)
  await page.screenshot({
    path: testInfo.outputPath('presentation-desktop.png'),
  })
  await button.press('Space')
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  expect((await stableFrame(page)).equals(original)).toBe(false)
  expect(
    await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  ).toBe(design)

  await startPresentation(page)
  await expectMotion(page)
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await stableFrame(page)
  await expectPreviewControlsReachable(page)
})

test('static views, reset, pointer input, and keyboard input take over the presentation camera', async ({
  page,
}) => {
  await page.goto('/')
  await ready(page)
  const button = presentationButton(page)

  for (const name of ['Front', '3D view', 'Reset camera']) {
    await startPresentation(page)
    await expectMotion(page)
    await page.getByRole('button', { name, exact: true }).click()
    await expect(button).toHaveAttribute('aria-pressed', 'false')
    await stableFrame(page)
    if (name !== 'Reset camera') {
      await expect(
        page.getByRole('button', { name, exact: true }),
      ).toHaveAttribute('aria-pressed', 'true')
    }
  }

  await startPresentation(page)
  const bounds = (await canvas(page).boundingBox())!
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  }
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.mouse.move(center.x + 55, center.y + 15, { steps: 5 })
  await page.mouse.up()
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await stableFrame(page)

  await startPresentation(page)
  await page.mouse.move(center.x, center.y)
  await page.mouse.wheel(0, -80)
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await stableFrame(page)

  await startPresentation(page)
  const preview = page.locator('[role="img"][data-preview-controls]')
  await preview.focus()
  await preview.press('ArrowRight')
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  const manual = await stableFrame(page)
  await preview.press('ArrowUp')
  expect((await stableFrame(page)).equals(manual)).toBe(false)
  await expect(preview).toBeFocused()
})

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
]) {
  test(`presentation remains usable at ${viewport.width} × ${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await ready(page)
    await expectPreviewControlsReachable(page)
    await startPresentation(page)
    await expectMotion(page)
    await page.screenshot({
      path: testInfo.outputPath(`presentation-mobile-${viewport.width}.png`),
    })
    await presentationButton(page).click()
    await expect(presentationButton(page)).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await stableFrame(page)

    if (viewport.width === 390) {
      await page.getByRole('button', { name: /^Speaker M/ }).click()
      await ready(page)
      await startPresentation(page)
      await expectMotion(page)
      await presentationButton(page).click()
      await page
        .getByRole('group', { name: 'Preview mode', exact: true })
        .getByRole('button', { name: 'Knob only', exact: true })
        .click()
      await startPresentation(page)
      await expectMotion(page)
      await presentationButton(page).click()
      await stableFrame(page)
      await expectPreviewControlsReachable(page)
    }
  })
}
