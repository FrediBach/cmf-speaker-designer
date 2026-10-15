import { expect, test, type Page } from '@playwright/test'
import { STORAGE_KEY, validateDesign, type Design } from '../../src/lib/design'
import { revealSpeakerControls } from './controls'

async function storedDesign(page: Page): Promise<Design> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    STORAGE_KEY,
  )
}

async function expectDesign(page: Page, design: Design) {
  await expect.poll(() => storedDesign(page)).toEqual(design)
}

async function expectReady(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Export design', exact: true }),
  ).toBeEnabled()
  await expect(page.locator('.preview-stage canvas')).toBeVisible()
  await expect(
    page.getByText('3D preview unavailable', { exact: true }),
  ).toBeHidden()
}

async function randomize(page: Page, seed = 4281) {
  const button = page.getByRole('button', { name: 'Randomize', exact: true })
  await expect(button).toBeEnabled()
  // Keep seeding and dispatch atomic: preview UUID creation must not consume
  // this sequence between Playwright actions or after the randomization.
  await button.evaluate((element, initial) => {
    if (!(element instanceof HTMLButtonElement))
      throw new Error('Expected the Randomize button.')
    element.focus()
    const originalRandom = Math.random
    let state = initial
    try {
      Math.random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 4294967296
      }
      element.click()
    } finally {
      Math.random = originalRandom
    }
  }, seed)
}

async function workspaceShortcut(page: Page, shortcut: string) {
  await page.getByRole('button', { name: 'Randomize', exact: true }).focus()
  await page.keyboard.press(shortcut)
}

test('randomizes every design section, preserves either speaker model, and saves the result', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expectReady(page)

  for (const model of ['s', 'm'] as const) {
    await page
      .getByRole('button', {
        name: new RegExp(`^Speaker ${model.toUpperCase()}`),
      })
      .click()
    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    await expectDesign(page, validateDesign({ model }))
    const original = await storedDesign(page)
    // Both seeds deliberately change the default panel/knob color pair.
    await randomize(page, model === 's' ? 4281 : 8160)
    await expect
      .poll(async () => (await storedDesign(page)).handle)
      .not.toEqual(original.handle)
    const randomized = await storedDesign(page)
    expect(randomized.model).toBe(model)
    expect(randomized).toEqual(validateDesign(randomized))
    for (const section of ['handle', 'halo', 'grille', 'knob'] as const) {
      expect(
        randomized[section],
        `${section} should receive fresh parameters`,
      ).not.toEqual(original[section])
    }
    expect([randomized.panelColor, randomized.knobColor]).not.toEqual([
      original.panelColor,
      original.knobColor,
    ])
    await expectReady(page)
    await expect(page.locator('.preview-model')).toContainText(
      `CMF Speaker ${model.toUpperCase()}`,
    )
    await page
      .getByRole('button', { name: 'Export design', exact: true })
      .click()
    const exportDialog = page.getByRole('dialog', {
      name: 'Export design',
      exact: true,
    })
    await expect(
      exportDialog.getByRole('button', {
        name: randomized.multicolor.enabled ? '3MF' : 'STL',
        exact: true,
      }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      exportDialog.getByRole('button', {
        name: randomized.multicolor.enabled ? /^Download 3MF/ : /^Download ZIP/,
      }),
    ).toBeEnabled()
    await page.keyboard.press('Escape')
    await page.reload()
    await expectDesign(page, randomized)
    await expectReady(page)
  }
  expect(errors).toEqual([])
})

test('undoes and redoes a complete randomization with Mac and Windows shortcuts', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: /^Speaker M/ }).click()
  await page
    .getByRole('button', { name: 'Front panel: Lagoon', exact: true })
    .click()
  const before = await storedDesign(page)
  await randomize(page)
  const after = await storedDesign(page)
  expect(after).not.toEqual(before)

  for (const [undo, redo] of [
    ['Control+z', 'Control+Shift+z'],
    ['Meta+z', 'Meta+Shift+z'],
    ['Control+z', 'Control+y'],
  ]) {
    await workspaceShortcut(page, undo)
    await expectDesign(page, before)
    await workspaceShortcut(page, redo)
    await expectDesign(page, after)
  }
  await revealSpeakerControls(page)
  await expect(
    page.getByRole('button', { name: /^Speaker M/ }),
  ).toHaveAttribute('aria-pressed', 'true')
})

test('reset keeps model-specific defaults and undo restores edits while a new edit clears redo', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: /^Speaker M/ }).click()
  await randomize(page)
  const randomized = await storedDesign(page)
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expectDesign(page, validateDesign({ model: 'm' }))
  await workspaceShortcut(page, 'Control+z')
  await expectDesign(page, randomized)
  await workspaceShortcut(page, 'Control+y')
  await expectDesign(page, validateDesign({ model: 'm' }))
  await workspaceShortcut(page, 'Control+z')
  await expectDesign(page, randomized)

  await page.getByRole('tab', { name: 'Front panel', exact: true }).click()
  const color = randomized.panelColor === '#eeeae1' ? 'Lagoon' : 'Chalk'
  const colorLabel = randomized.multicolor.enabled
    ? 'Background'
    : 'Front panel'
  await page
    .getByRole('button', { name: `${colorLabel}: ${color}`, exact: true })
    .click()
  const branched = await storedDesign(page)
  expect(branched).not.toEqual(randomized)
  await workspaceShortcut(page, 'Control+y')
  await expectDesign(page, branched)
  await workspaceShortcut(page, 'Control+z')
  await expectDesign(page, randomized)
})

test('groups a held slider key and a pointer drag into one undo step each', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Custom', exact: true }).click()
  const slider = page.getByRole('slider', {
    name: 'Added face depth',
    exact: true,
  })
  const original = await storedDesign(page)
  await slider.focus()
  for (let repeat = 0; repeat < 4; repeat += 1) {
    await page.keyboard.down('ArrowRight')
  }
  await page.keyboard.up('ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuenow', '0.4')
  const held = await storedDesign(page)
  await workspaceShortcut(page, 'Control+z')
  await expectDesign(page, original)
  await workspaceShortcut(page, 'Control+Shift+z')
  await expectDesign(page, held)

  // Separate arrow presses remain separate edits.
  await slider.press('ArrowRight')
  const firstPress = await storedDesign(page)
  await slider.press('ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuenow', '0.6')
  await workspaceShortcut(page, 'Control+z')
  await expectDesign(page, firstPress)

  await slider.scrollIntoViewIfNeeded()
  const thumb = await slider.boundingBox()
  const track = await slider
    .locator('xpath=ancestor::*[@data-slot="slider"]')
    .boundingBox()
  expect(thumb).not.toBeNull()
  expect(track).not.toBeNull()
  await page.mouse.move(
    thumb!.x + thumb!.width / 2,
    thumb!.y + thumb!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    track!.x + track!.width * 0.85,
    thumb!.y + thumb!.height / 2,
    { steps: 12 },
  )
  await page.mouse.up()
  await expect
    .poll(async () => (await storedDesign(page)).relief)
    .toBeGreaterThan(firstPress.relief)
  const dragged = await storedDesign(page)
  await workspaceShortcut(page, 'Control+z')
  await expectDesign(page, firstPress)
  await workspaceShortcut(page, 'Control+y')
  await expectDesign(page, dragged)
})

test('leaves native input shortcuts and open dialogs in control of their own undo keys', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Handle', exact: true }).click()
  await page.getByRole('button', { name: 'Custom handle', exact: true }).click()
  const beforeColor = await storedDesign(page)
  await page.getByRole('tab', { name: 'Front panel', exact: true }).click()
  await page
    .getByRole('button', { name: 'Front panel: Chalk', exact: true })
    .click()
  const afterColor = await storedDesign(page)
  await page.getByRole('tab', { name: 'Handle', exact: true }).click()
  const input = page.getByRole('spinbutton', {
    name: 'Extension height in millimeters',
    exact: true,
  })
  await input.focus()
  for (const key of ['Control+z', 'Meta+z']) {
    await page.keyboard.press(key)
    await expectDesign(page, afterColor)
  }
  await workspaceShortcut(page, 'Control+z')
  await expectDesign(page, beforeColor)
  await input.focus()
  for (const key of ['Control+Shift+z', 'Meta+Shift+z', 'Control+y']) {
    await page.keyboard.press(key)
    await expectDesign(page, beforeColor)
  }
  await page.getByRole('button', { name: 'Print guide', exact: true }).click()
  const guide = page.getByRole('dialog', { name: 'Print guide', exact: true })
  await expect(guide).toBeVisible()
  for (const key of ['Control+z', 'Control+y']) {
    await page.keyboard.press(key)
    await expectDesign(page, beforeColor)
    await expect(guide).toBeVisible()
  }
  await page.keyboard.press('Escape')
  await workspaceShortcut(page, 'Control+y')
  await expectDesign(page, afterColor)
})

test('undoes individual checkbox toggles while the checkbox stays focused', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Grille', exact: true }).click()
  await page.getByRole('button', { name: 'Custom grille', exact: true }).click()
  const checkbox = page.getByRole('checkbox', {
    name: 'Continue across the face',
  })
  const original = await storedDesign(page)
  await checkbox.check()
  const checked = await storedDesign(page)
  await checkbox.uncheck()
  await checkbox.press('Control+z')
  await expectDesign(page, checked)
  await expect(checkbox).toBeChecked()
  await checkbox.press('Control+z')
  await expectDesign(page, original)
  await checkbox.press('Control+y')
  await expectDesign(page, checked)
})

test('commits a numeric draft separately before starting a slider drag', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Handle', exact: true }).click()
  await page.getByRole('button', { name: 'Custom handle', exact: true }).click()
  const original = await storedDesign(page)
  const input = page.getByRole('spinbutton', {
    name: 'Extension height in millimeters',
    exact: true,
  })
  await input.fill('999')
  await expectDesign(page, original)
  const slider = page.getByRole('slider', {
    name: 'Extension height',
    exact: true,
  })
  await slider.scrollIntoViewIfNeeded()
  const track = await slider
    .locator('xpath=ancestor::*[@data-slot="slider"]')
    .boundingBox()
  expect(track).not.toBeNull()
  await page.mouse.click(
    track!.x + track!.width * 0.4,
    track!.y + track!.height / 2,
  )
  const committed = validateDesign({
    ...original,
    handle: { ...original.handle, height: 70 },
  })
  await expect.poll(() => storedDesign(page)).not.toEqual(committed)
  await workspaceShortcut(page, 'Control+z')
  await expectDesign(page, committed)
  await workspaceShortcut(page, 'Control+z')
  await expectDesign(page, original)
})

test('keeps randomize and reset side by side and reachable at 320 pixels', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/')
  const random = page.getByRole('button', { name: 'Randomize', exact: true })
  const reset = page.getByRole('button', { name: 'Reset', exact: true })
  await expect(random).toBeInViewport({ ratio: 1 })
  await expect(reset).toBeInViewport({ ratio: 1 })
  const randomBounds = await random.boundingBox()
  const resetBounds = await reset.boundingBox()
  expect(randomBounds).not.toBeNull()
  expect(resetBounds).not.toBeNull()
  expect(Math.abs(randomBounds!.y - resetBounds!.y)).toBeLessThanOrEqual(1)
  expect(
    randomBounds!.x + randomBounds!.width <= resetBounds!.x ||
      resetBounds!.x + resetBounds!.width <= randomBounds!.x,
  ).toBe(true)
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320)
  await randomize(page)
  await expect.poll(async () => (await storedDesign(page)).style).toBe('custom')
  await reset.click()
  await expectDesign(page, validateDesign({ model: 's' }))
  await page.screenshot({
    path: testInfo.outputPath('history-controls-320px.png'),
  })
})
