import { expect, test as base, type Page } from '@playwright/test'
import { STORAGE_KEY, validateDesign, type Design } from '../../src/lib/design'
import { applyMulticolorPreset } from '../../src/lib/multicolor-presets'

const test = base.extend<{ appErrors: string[] }>({
  appErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await use(errors)
      expect(errors, 'Exploring variations should not crash the app').toEqual(
        [],
      )
    },
    { auto: true },
  ],
})

const activation = (page: Page) =>
  page.getByRole('button', { name: 'Explore variations', exact: true })

const explorer = (page: Page) =>
  page.getByRole('region', { name: 'Variation explorer', exact: true })

const variationSelect = (page: Page) =>
  explorer(page).getByLabel('Inspect variation', { exact: true })

async function storedDesign(page: Page): Promise<Design> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    STORAGE_KEY,
  )
}

async function ready(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Export design', exact: true }),
  ).toBeEnabled()
  await expect(activation(page)).toBeEnabled()
  await expect(page.locator('.preview-stage canvas')).toBeVisible()
}

async function openExplorer(page: Page, seed?: number) {
  if (seed === undefined) await activation(page).click()
  else
    await activation(page).evaluate((element, initial) => {
      const originalRandom = Math.random
      let state = initial
      try {
        Math.random = () => {
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0
          return state / 4294967296
        }
        ;(element as HTMLButtonElement).click()
      } finally {
        Math.random = originalRandom
      }
    }, seed)
  await expect(explorer(page)).toBeVisible()
  await expect(explorer(page).locator('canvas')).toBeVisible()
  await expect(variationSelect(page).locator('option')).toHaveCount(25)
}

async function inspectReadyVariation(page: Page) {
  const select = variationSelect(page)
  await expect(select).toBeEnabled()
  let value: string | undefined
  await expect
    .poll(
      async () => {
        value = await select.locator('option').evaluateAll((options) => {
          const candidate = options
            .slice(1)
            .find((option) => !(option as HTMLOptionElement).disabled)
          return (candidate as HTMLOptionElement | undefined)?.value
        })
        return value
      },
      { message: 'At least one generated variation should become available' },
    )
    .toBeDefined()
  await select.selectOption(value!)
  await expect(
    explorer(page).getByRole('button', {
      name: 'Use variation',
      exact: true,
    }),
  ).toBeEnabled()
}

async function savedSnapshot(page: Page) {
  return page.evaluate((key) => {
    return {
      saved: localStorage.getItem(key),
      url: window.location.href,
    }
  }, STORAGE_KEY)
}

async function shortcut(page: Page, keys: string) {
  await activation(page).focus()
  await page.keyboard.press(keys)
}

type MarkerPosition = { id: string; x: number; y: number }

async function settledMarkerPositions(page: Page) {
  let previous: Map<string, MarkerPosition> | undefined
  let positions: MarkerPosition[] = []
  await expect
    .poll(
      async () => {
        positions = await explorer(page)
          .locator('button[data-variation-id]')
          .evaluateAll((markers) =>
            markers
              .map((marker) => {
                const bounds = marker.getBoundingClientRect()
                return {
                  id: marker.getAttribute('data-variation-id')!,
                  x: bounds.x + bounds.width / 2,
                  y: bounds.y + bounds.height / 2,
                }
              })
              .sort((a, b) => a.id.localeCompare(b.id)),
          )
        const current = new Map(
          positions.map((position) => [position.id, position]),
        )
        if (positions.length !== 25 || current.size !== 25) {
          previous = undefined
          return Infinity
        }
        const sameMarkers =
          previous && positions.every(({ id }) => previous!.has(id))
        const movement = sameMarkers
          ? Math.max(
              ...positions.map((position) => {
                const before = previous!.get(position.id)!
                return Math.hypot(position.x - before.x, position.y - before.y)
              }),
            )
          : Infinity
        previous = current
        return movement
      },
      { message: 'The camera should finish moving before comparing views' },
    )
    .toBeLessThan(0.25)
  return positions
}

function relativeMarkerPositions(positions: MarkerPosition[]) {
  const original = positions.find(({ id }) => id === 'original')!
  return positions.map(({ id, x, y }) => ({
    id,
    x: x - original.x,
    y: y - original.y,
  }))
}

function maximumMarkerMovement(
  before: MarkerPosition[],
  after: MarkerPosition[],
) {
  return Math.max(
    ...before.map((position, index) =>
      Math.hypot(position.x - after[index].x, position.y - after[index].y),
    ),
  )
}

test('opening, inspecting, regenerating, and cancelling preserve the saved design, shared URL, and redo history', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const initial = validateDesign({ model: 's' })
  await page.goto(
    `/?${new URLSearchParams({ design: JSON.stringify(initial) })}`,
  )
  await ready(page)
  await page
    .getByRole('button', { name: 'Front panel: Chalk', exact: true })
    .click()
  const before = await storedDesign(page)
  await page
    .getByRole('button', { name: 'Front panel: Lagoon', exact: true })
    .click()
  const after = await storedDesign(page)
  await shortcut(page, 'Control+z')
  await expect.poll(() => storedDesign(page)).toEqual(before)
  const original = await savedSnapshot(page)

  await openExplorer(page)
  expect(await savedSnapshot(page)).toEqual(original)
  await inspectReadyVariation(page)
  expect(await savedSnapshot(page)).toEqual(original)

  // Exploring the camera and using history shortcuts must not edit the design.
  const canvas = explorer(page).locator('canvas')
  const bounds = (await canvas.boundingBox())!
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  )
  await page.mouse.wheel(0, -160)
  const regenerate = explorer(page).getByRole('button', {
    name: 'New variations',
    exact: true,
  })
  await regenerate.focus()
  for (const keys of ['Control+z', 'Control+y']) {
    await page.keyboard.press(keys)
    expect(await savedSnapshot(page)).toEqual(original)
  }
  await regenerate.click()
  expect(await savedSnapshot(page)).toEqual(original)
  await inspectReadyVariation(page)
  expect(await savedSnapshot(page)).toEqual(original)
  await explorer(page)
    .getByRole('button', { name: 'Cancel variations', exact: true })
    .click()
  await expect(explorer(page)).toBeHidden()
  expect(await savedSnapshot(page)).toEqual(original)

  await openExplorer(page)
  await page.keyboard.press('Escape')
  await expect(explorer(page)).toBeHidden()
  expect(await savedSnapshot(page)).toEqual(original)

  await openExplorer(page)
  await variationSelect(page).selectOption({ index: 0 })
  await explorer(page)
    .getByRole('button', { name: 'Keep original', exact: true })
    .click()
  await expect(explorer(page)).toBeHidden()
  expect(await savedSnapshot(page)).toEqual(original)

  // A preserved redo branch proves exploration never created a history entry.
  await shortcut(page, 'Control+y')
  await expect.poll(() => storedDesign(page)).toEqual(after)
  await shortcut(page, 'Control+z')
  await expect.poll(() => storedDesign(page)).toEqual(before)
})

for (const model of ['s', 'm'] as const) {
  test(`choosing a Speaker ${model.toUpperCase()} variation applies one complete, undoable, persistent design`, async ({
    page,
  }) => {
    const initial = validateDesign({
      model,
      panelColor: '#eeeae1',
      powerButtonColor: '#5573ce',
      knobColor: '#13b7b1',
    })
    await page.goto(
      `/?${new URLSearchParams({ design: JSON.stringify(initial) })}`,
    )
    await ready(page)
    await expect.poll(() => storedDesign(page)).toEqual(initial)
    const original = await savedSnapshot(page)

    await openExplorer(page)
    await inspectReadyVariation(page)
    expect(await savedSnapshot(page)).toEqual(original)
    await explorer(page)
      .getByRole('button', { name: 'Use variation', exact: true })
      .click()
    await expect(explorer(page)).toBeHidden()
    await expect.poll(() => storedDesign(page)).not.toEqual(initial)
    const chosen = await storedDesign(page)
    expect(chosen.model).toBe(model)
    expect(chosen).toEqual(validateDesign(chosen))
    await ready(page)
    await expect(page.locator('.preview-stage canvas')).toHaveCount(1)
    const chosenUrl = new URL(page.url())
    const shared =
      new URLSearchParams(chosenUrl.hash.slice(1)).get('design') ??
      chosenUrl.searchParams.get('design')
    expect(JSON.parse(shared!)).toEqual(chosen)

    await shortcut(page, 'Control+z')
    await expect.poll(() => storedDesign(page)).toEqual(initial)
    await shortcut(page, 'Control+Shift+z')
    await expect.poll(() => storedDesign(page)).toEqual(chosen)
    await page.reload()
    await expect.poll(() => storedDesign(page)).toEqual(chosen)
    await ready(page)
    await expect(explorer(page)).toBeHidden()
  })
}

test('camera modes rotate and pan the army without changing the selected or saved design', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await ready(page)
  const original = await savedSnapshot(page)
  await openExplorer(page, 4281)
  await expect(
    explorer(page).locator('button[data-variation-id][data-status="ready"]'),
  ).toHaveCount(25, { timeout: 120_000 })

  const rotate = explorer(page).getByRole('button', {
    name: 'Rotate camera',
    exact: true,
  })
  const pan = explorer(page).getByRole('button', {
    name: 'Pan camera',
    exact: true,
  })
  await expect(rotate).toHaveAttribute('aria-pressed', 'true')
  await expect(pan).toHaveAttribute('aria-pressed', 'false')
  const initialView = await settledMarkerPositions(page)
  const canvasBounds = (await explorer(page).locator('canvas').boundingBox())!
  const drag = async (horizontal: number, vertical: number) => {
    const x = canvasBounds.x + canvasBounds.width * 0.82
    const y = canvasBounds.y + canvasBounds.height * 0.25
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + horizontal, y + vertical, { steps: 16 })
    await page.mouse.up()
  }

  await drag(-150, 30)
  const rotatedView = await settledMarkerPositions(page)
  expect(
    maximumMarkerMovement(
      relativeMarkerPositions(initialView),
      relativeMarkerPositions(rotatedView),
    ),
    'Rotating should change the relative positions of the speaker rows',
  ).toBeGreaterThan(20)
  await page.screenshot({
    path: testInfo.outputPath('variation-camera-rotate.png'),
  })
  await pan.click()
  await expect(pan).toHaveAttribute('aria-pressed', 'true')
  await expect(rotate).toHaveAttribute('aria-pressed', 'false')
  const switchedView = await settledMarkerPositions(page)
  expect(
    maximumMarkerMovement(rotatedView, switchedView),
    'Changing the movement mode should preserve the viewing angle and framing',
  ).toBeLessThan(1)

  await drag(-100, 0)
  const pannedView = await settledMarkerPositions(page)
  const beforeOriginal = switchedView.find(({ id }) => id === 'original')!
  const afterOriginal = pannedView.find(({ id }) => id === 'original')!
  expect(
    beforeOriginal.x - afterOriginal.x,
    'Panning left should move the speakers left across the preview',
  ).toBeGreaterThan(40)
  expect(
    maximumMarkerMovement(
      relativeMarkerPositions(switchedView),
      relativeMarkerPositions(pannedView),
    ),
    'Panning should preserve the projected formation apart from perspective',
  ).toBeLessThan(30)
  await expect(variationSelect(page)).toHaveValue('original')
  expect(await savedSnapshot(page)).toEqual(original)
  await page.screenshot({
    path: testInfo.outputPath('variation-camera-pan.png'),
  })

  // Keyboard arrows obey the selected camera mode as well as pointer drags.
  const surface = explorer(page).locator('[data-variation-controls]')
  await surface.focus()
  await page.keyboard.press('ArrowRight')
  const keyboardPanView = await settledMarkerPositions(page)
  expect(maximumMarkerMovement(pannedView, keyboardPanView)).toBeGreaterThan(5)
  await rotate.click()
  await surface.focus()
  await page.keyboard.press('ArrowRight')
  const keyboardRotateView = await settledMarkerPositions(page)
  expect(
    maximumMarkerMovement(
      relativeMarkerPositions(keyboardPanView),
      relativeMarkerPositions(keyboardRotateView),
    ),
  ).toBeGreaterThan(5)

  const spread = (positions: MarkerPosition[]) =>
    Math.max(
      ...relativeMarkerPositions(positions).map(({ x, y }) => Math.hypot(x, y)),
    )
  await page.keyboard.press('+')
  const zoomedView = await settledMarkerPositions(page)
  expect(spread(zoomedView)).toBeGreaterThan(spread(keyboardRotateView) * 1.08)
  await page.keyboard.press('-')
  const zoomedOutView = await settledMarkerPositions(page)
  expect(maximumMarkerMovement(keyboardRotateView, zoomedOutView)).toBeLessThan(
    1,
  )
  expect(await savedSnapshot(page)).toEqual(original)
  await expect(variationSelect(page)).toHaveValue('original')
})

test('the explorer is keyboard accessible and its controls fit at 320 pixels', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/')
  await ready(page)
  const button = activation(page)
  const presentation = page.getByRole('button', {
    name: 'Presentation mode',
    exact: true,
  })
  await expect(button).toBeInViewport({ ratio: 1 })
  await expect(presentation).toBeInViewport({ ratio: 1 })
  const activationBounds = (await button.boundingBox())!
  const presentationBounds = (await presentation.boundingBox())!
  expect(
    Math.abs(activationBounds.y - presentationBounds.y),
    'Variation activation belongs beside the presentation button',
  ).toBeLessThanOrEqual(1)
  const original = await savedSnapshot(page)
  await button.focus()
  await button.press('Space')
  await expect(explorer(page)).toBeVisible()
  await expect(explorer(page).locator('canvas')).toBeVisible()

  for (const control of [
    variationSelect(page),
    ...[
      'Rotate camera',
      'Pan camera',
      'Fit all variations',
      'Focus variation',
    ].map((name) => explorer(page).getByRole('button', { name, exact: true })),
    explorer(page).getByRole('button', {
      name: 'New variations',
      exact: true,
    }),
    explorer(page).getByRole('button', {
      name: 'Cancel variations',
      exact: true,
    }),
    explorer(page).getByRole('button', {
      name: 'Keep original',
      exact: true,
    }),
  ]) {
    await expect(control).toBeInViewport({ ratio: 1 })
    await control.click({ trial: true })
  }
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.width + 1)

  await inspectReadyVariation(page)
  await expect(
    explorer(page).getByRole('button', { name: 'Use variation', exact: true }),
  ).toBeInViewport({ ratio: 1 })
  await page.screenshot({
    path: testInfo.outputPath('variation-explorer-320px.png'),
  })

  // Exercise real touch input: one finger follows the visible movement mode.
  const touchSession = await page.context().newCDPSession(page)
  await touchSession.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 2,
  })
  const canvasBounds = (await explorer(page).locator('canvas').boundingBox())!
  const touchDrag = async (horizontal: number) => {
    const x = canvasBounds.x + canvasBounds.width * 0.82
    const y = canvasBounds.y + canvasBounds.height * 0.25
    await touchSession.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    })
    for (let step = 1; step <= 8; step += 1)
      await touchSession.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (horizontal * step) / 8, y }],
      })
    await touchSession.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
  }
  await expect(explorer(page).locator('button[data-variation-id]')).toHaveCount(
    25,
  )
  const beforeTouchRotate = await settledMarkerPositions(page)
  await touchDrag(-40)
  const afterTouchRotate = await settledMarkerPositions(page)
  expect(
    maximumMarkerMovement(
      relativeMarkerPositions(beforeTouchRotate),
      relativeMarkerPositions(afterTouchRotate),
    ),
    'A one-finger drag should rotate the speaker formation',
  ).toBeGreaterThan(4)
  await explorer(page)
    .getByRole('button', { name: 'Pan camera', exact: true })
    .click()
  const beforeTouchPan = await settledMarkerPositions(page)
  await touchDrag(-30)
  const afterTouchPan = await settledMarkerPositions(page)
  expect(
    beforeTouchPan.find(({ id }) => id === 'original')!.x -
      afterTouchPan.find(({ id }) => id === 'original')!.x,
    'A one-finger drag in Pan mode should move the speaker formation left',
  ).toBeGreaterThan(8)
  await touchSession.detach()
  expect(await savedSnapshot(page)).toEqual(original)
  await variationSelect(page).focus()
  await page.keyboard.press('Escape')
  await expect(explorer(page)).toBeHidden()
  await expect(button).toBeFocused()
  expect(await savedSnapshot(page)).toEqual(original)
})

test('a failed explorer download shows an unavailable state and cancels back to the unchanged preview', async ({
  page,
}) => {
  // Match Vite's development module and the hashed production chunk.
  await page.route(
    /\/VariationExplorer(?:-[^/?]+\.js|\.tsx)(?:\?|$)/,
    (route) => route.abort(),
  )
  await page.goto('/')
  await ready(page)
  const original = await savedSnapshot(page)
  await activation(page).click()
  await expect(explorer(page)).toBeVisible()
  await expect(explorer(page).getByRole('alert')).toContainText(
    'Preview could not load',
  )
  await expect(
    explorer(page).getByText('Preview unavailable', { exact: true }),
  ).toBeVisible()
  await expect(
    explorer(page).getByRole('button', { name: 'Keep original', exact: true }),
  ).toBeDisabled()
  expect(await savedSnapshot(page)).toEqual(original)

  await explorer(page)
    .getByRole('button', { name: 'Cancel variations', exact: true })
    .click()
  await expect(explorer(page)).toBeHidden()
  await ready(page)
  expect(await savedSnapshot(page)).toEqual(original)
})

test('Escape dismisses a dialog above the explorer before cancelling variations', async ({
  page,
}) => {
  await page.goto('/')
  await ready(page)
  const original = await savedSnapshot(page)
  await openExplorer(page)
  await page.getByRole('button', { name: 'Print guide', exact: true }).click()
  const guide = page.getByRole('dialog', { name: 'Print guide', exact: true })
  await expect(guide).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(guide).toBeHidden()
  await expect(explorer(page)).toBeVisible()
  expect(await savedSnapshot(page)).toEqual(original)

  await page.keyboard.press('Escape')
  await expect(explorer(page)).toBeHidden()
  await ready(page)
  expect(await savedSnapshot(page)).toEqual(original)
})

for (const multicolor of [false, true]) {
  test(`renders every ${multicolor ? 'multicolor' : 'single-color'} variation and applies a bold speaker chosen in the scene`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    let initial = validateDesign({ model: 's' })
    if (multicolor) {
      const preset = applyMulticolorPreset('france', initial.multicolor)
      initial = validateDesign({
        ...initial,
        panelColor: preset.panelColor,
        multicolor: preset.settings,
      })
    }
    await page.goto(
      `/#${new URLSearchParams({ design: JSON.stringify(initial) })}`,
    )
    await ready(page)
    await expect.poll(() => storedDesign(page)).toEqual(initial)
    const original = await savedSnapshot(page)
    await openExplorer(page, 4281)

    // Wait through the whole queue: early candidates alone cannot expose a
    // failed outer-ring design or a stalled shared multicolor worker.
    const markers = explorer(page).locator('button[data-variation-id]')
    await expect(markers).toHaveCount(25)
    let settled:
      | { ready: number; failed: (string | null)[]; waiting: (string | null)[] }
      | undefined
    await expect
      .poll(
        async () => {
          settled = await markers.evaluateAll((buttons) => ({
            ready: buttons.filter(
              (button) => button.getAttribute('data-status') === 'ready',
            ).length,
            failed: buttons
              .filter(
                (button) => button.getAttribute('data-status') === 'error',
              )
              .map((button) => button.getAttribute('title')),
            waiting: buttons
              .filter(
                (button) => button.getAttribute('data-status') === 'loading',
              )
              .map((button) => button.getAttribute('data-variation-id')),
          }))
          return (
            settled.waiting.length === 0 &&
            settled.ready + settled.failed.length === 25
          )
        },
        {
          timeout: 240_000,
          message: 'All 25 speaker assemblies should finish without errors',
        },
      )
      .toBe(true)
    expect(settled, 'All 25 assemblies should be valid').toEqual({
      ready: 25,
      failed: [],
      waiting: [],
    })
    expect(await savedSnapshot(page)).toEqual(original)
    const screenshotPrefix = multicolor ? 'multicolor' : 'single-color'
    await page.screenshot({
      path: testInfo.outputPath(`variation-army-${screenshotPrefix}.png`),
    })

    const bold = explorer(page).getByRole('button', {
      name: 'Inspect Bold 1',
      exact: true,
    })
    await expect(bold).toBeInViewport({ ratio: 1 })
    const candidateId = await bold.getAttribute('data-variation-id')
    await bold.click()
    await expect(bold).toHaveAttribute('aria-pressed', 'true')
    await expect(variationSelect(page)).toHaveValue(candidateId!)
    if (multicolor)
      await expect(
        explorer(page).getByText(
          'Original panel shape · varied colors and knob',
          { exact: true },
        ),
      ).toBeVisible()
    expect(await savedSnapshot(page)).toEqual(original)

    const canvas = explorer(page).locator('canvas')
    const beforeFocus = await canvas.screenshot()
    await explorer(page)
      .getByRole('button', { name: 'Focus variation', exact: true })
      .click()
    await expect
      .poll(async () => !(await canvas.screenshot()).equals(beforeFocus), {
        message: 'Focusing a variation should visibly move closer to it',
      })
      .toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`variation-bold-${screenshotPrefix}.png`),
    })
    expect(await savedSnapshot(page)).toEqual(original)

    await explorer(page)
      .getByRole('button', { name: 'Use variation', exact: true })
      .click()
    await expect(explorer(page)).toBeHidden()
    await expect.poll(() => storedDesign(page)).not.toEqual(initial)
    const chosen = await storedDesign(page)
    expect(chosen.model).toBe(initial.model)
    expect(chosen).toEqual(validateDesign(chosen))
    if (multicolor) {
      for (const key of [
        'style',
        'relief',
        'panelExtension',
        'panelGap',
        'handle',
        'grille',
        'halo',
        'raceStripes',
      ] as const)
        expect(chosen[key]).toEqual(initial[key])
      expect(chosen.multicolor.enabled).toBe(true)
      expect(chosen.multicolor.elements).toEqual(initial.multicolor.elements)
      expect(chosen.multicolor.groups).toEqual(initial.multicolor.groups)
      expect(chosen.multicolor.frame).toEqual(initial.multicolor.frame)
      expect(chosen.multicolor.preset).toEqual(initial.multicolor.preset)
      expect(chosen.multicolor.materials.map(({ id }) => id)).toEqual(
        initial.multicolor.materials.map(({ id }) => id),
      )
    }
    await ready(page)
    await expect(page.locator('.preview-stage canvas')).toHaveCount(1)
    await shortcut(page, 'Control+z')
    await expect.poll(() => storedDesign(page)).toEqual(initial)
  })
}
