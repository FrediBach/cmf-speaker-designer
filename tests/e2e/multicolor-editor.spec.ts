import { expect, test, type Page } from '@playwright/test'
import { STORAGE_KEY, type Design } from '../../src/lib/design'
import type {
  MulticolorSettings,
  PatternElement,
} from '../../src/lib/multicolor-settings'

const stored = async (page: Page): Promise<MulticolorSettings> =>
  page.evaluate(
    (key) => (JSON.parse(localStorage.getItem(key)!) as Design).multicolor,
    STORAGE_KEY,
  )

async function openEditor(page: Page) {
  await page.goto('/')
  await expect(
    page.getByRole('button', { name: 'Export design', exact: true }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Multicolor', exact: true }).click()
  await expect(page.locator('.multicolor-editor')).toBeVisible()
}

async function screenPoint(page: Page, x: number, y: number) {
  return page.locator('.multicolor-canvas').evaluate(
    (element, point) => {
      const svg = element as SVGSVGElement
      const matrix = svg.getScreenCTM()
      if (!matrix) throw new Error('Artwork canvas has no screen transform.')
      const screen = new DOMPoint(point.x, -point.y).matrixTransform(matrix)
      return { x: screen.x, y: screen.y }
    },
    { x, y },
  )
}

async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  release = true,
) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 6 })
  if (release) await page.mouse.up()
}

const findShape = (
  settings: MulticolorSettings,
  id: string,
): PatternElement => {
  const shape = settings.elements.find((element) => element.id === id)
  if (!shape) throw new Error(`Expected artwork element ${id}.`)
  return shape
}

test('canvas drags and resizes form single undo steps, while Escape restores the gesture baseline', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openEditor(page)
  await page
    .getByRole('group', { name: 'Add pattern shape' })
    .getByRole('button', { name: 'Stripe', exact: true })
    .click()
  const initial = await stored(page)
  const shape = initial.elements[0]
  expect(shape.kind).toBe('stripe')
  if (shape.kind !== 'stripe') throw new Error('Expected a stripe.')
  const canvas = page.locator('.multicolor-canvas')
  const committedWidth = Number((shape.width + 8).toFixed(2))
  const width = page.getByRole('spinbutton', {
    name: 'Stripe width (mm)',
    exact: true,
  })
  await width.fill(String(committedWidth))
  expect(await stored(page)).toEqual(initial)
  await canvas.scrollIntoViewIfNeeded()

  // Start directly from a focused draft: pointer-down must commit it before
  // taking the gesture snapshot. The selected outline also spans an opening.
  const edge = { x: shape.x - shape.width / 2, y: shape.y }
  await drag(
    page,
    await screenPoint(page, edge.x, edge.y),
    await screenPoint(page, edge.x + 6, edge.y + 4),
  )
  await expect
    .poll(async () => findShape(await stored(page), shape.id))
    .toMatchObject({ x: shape.x + 6, y: shape.y + 4, width: committedWidth })
  const moved = await stored(page)
  const numeric = {
    ...initial,
    elements: [{ ...shape, width: committedWidth }],
  }
  await canvas.press('Control+z')
  await expect.poll(() => stored(page)).toEqual(numeric)
  await canvas.press('Control+z')
  await expect.poll(() => stored(page)).toEqual(initial)
  await canvas.press('Control+y')
  await expect.poll(() => stored(page)).toEqual(numeric)
  await canvas.press('Control+y')
  await expect.poll(() => stored(page)).toEqual(moved)

  const movedShape = findShape(moved, shape.id)
  const corner = {
    x: movedShape.x + committedWidth / 2,
    y: movedShape.y + shape.height / 2,
  }
  await drag(
    page,
    await screenPoint(page, corner.x, corner.y),
    await screenPoint(
      page,
      movedShape.x + committedWidth * 0.4,
      movedShape.y + shape.height * 0.4,
    ),
  )
  await expect
    .poll(async () => {
      const result = findShape(await stored(page), shape.id)
      return result.kind === 'stripe' ? result.width : NaN
    })
    .toBeCloseTo(committedWidth * 0.8, 1)
  const resized = await stored(page)
  const resizedShape = findShape(resized, shape.id)
  if (resizedShape.kind !== 'stripe')
    throw new Error('Expected a stripe after resizing.')
  expect(resizedShape.height).toBeCloseTo(shape.height * 0.8, 1)
  await canvas.press('Control+z')
  await expect.poll(() => stored(page)).toEqual(moved)
  await canvas.press('Control+y')
  await expect.poll(() => stored(page)).toEqual(resized)

  const resizedEdge = {
    x: resizedShape.x - resizedShape.width / 2,
    y: resizedShape.y,
  }
  await drag(
    page,
    await screenPoint(page, resizedEdge.x, resizedEdge.y),
    await screenPoint(page, resizedEdge.x + 5, resizedEdge.y + 3),
    false,
  )
  await expect
    .poll(async () => findShape(await stored(page), shape.id).x)
    .toBe(resizedShape.x + 5)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect.poll(() => stored(page)).toEqual(resized)
  // A cancelled gesture must not insert an extra history entry.
  await canvas.press('Control+z')
  await expect.poll(() => stored(page)).toEqual(moved)
  expect(errors).toEqual([])
})

test('material reuse, make unique and explicit merge preserve identity even for identical RGB colors', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await openEditor(page)
  const editor = page.locator('.multicolor-editor')
  await page
    .getByRole('group', { name: 'Add pattern shape' })
    .getByRole('button', { name: 'Circle', exact: true })
    .click()
  const first = (await stored(page)).elements[0]
  await editor
    .getByRole('button', { name: 'Duplicate Circle', exact: true })
    .click()
  await expect.poll(async () => (await stored(page)).elements.length).toBe(2)
  const shared = await stored(page)
  expect(shared.elements.map((element) => element.materialId)).toEqual([
    first.materialId,
    first.materialId,
  ])

  await editor.getByRole('button', { name: 'Make unique', exact: true }).click()
  await expect.poll(async () => (await stored(page)).materials.length).toBe(2)
  const unique = await stored(page)
  expect(unique.elements[1].materialId).not.toBe(first.materialId)
  expect(unique.materials[0].color).toBe(unique.materials[1].color)
  const hex = editor.locator(
    '[aria-label="Selected shape controls"] input[aria-label$="hex color"]',
  )
  await hex.fill('#245aa5')
  await hex.press('Tab')
  await expect
    .poll(async () => (await stored(page)).materials[1].color)
    .toBe('#245aa5')
  expect((await stored(page)).materials[0]).toEqual(unique.materials[0])

  await hex.fill(unique.materials[0].color)
  await hex.press('Tab')
  await expect
    .poll(async () =>
      (await stored(page)).materials.map((material) => material.color),
    )
    .toEqual([unique.materials[0].color, unique.materials[0].color])
  expect(
    new Set((await stored(page)).elements.map((element) => element.materialId))
      .size,
  ).toBe(2)

  await editor
    .locator('summary')
    .filter({ hasText: /^Material palette/ })
    .click()
  const secondMaterial = editor.locator('.multicolor-palette-row').nth(1)
  await secondMaterial.getByRole('combobox').selectOption(first.materialId)
  await secondMaterial
    .getByRole('button', { name: 'Merge into', exact: true })
    .click()
  await expect.poll(async () => (await stored(page)).materials.length).toBe(1)
  const merged = await stored(page)
  expect(merged.elements.map((element) => element.materialId)).toEqual([
    first.materialId,
    first.materialId,
  ])
  expect(merged.elements.map((element) => element.id)).toEqual(
    unique.elements.map((element) => element.id),
  )
})

test('stripe redistribution retains overlays and assignments, and numeric drafts keep keyboard editing predictable', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await openEditor(page)
  const editor = page.locator('.multicolor-editor')
  await editor
    .locator('summary')
    .filter({ hasText: /^Generate stripes/ })
    .click()
  const count = editor.getByRole('spinbutton', {
    name: 'Stripe count',
    exact: true,
  })
  const gap = editor.getByRole('spinbutton', {
    name: 'Stripe gap (mm)',
    exact: true,
  })
  await count.fill('4')
  await count.press('Tab')
  await gap.fill('2')
  await gap.press('Tab')
  await editor.getByRole('button', { name: 'Horizontal', exact: true }).click()
  await editor
    .getByLabel('Stripe width weights', { exact: true })
    .fill('1, 2, 1, 2')
  await editor
    .getByLabel('Stripe color sequence', { exact: true })
    .fill('#ff0000, #00ff00')
  await editor
    .getByRole('button', { name: 'Generate editable stripes', exact: true })
    .click()
  await expect.poll(async () => (await stored(page)).elements.length).toBe(4)
  const generated = await stored(page)
  expect(generated.groups).toHaveLength(1)
  expect(generated.groups[0].generator).toMatchObject({
    count: 4,
    gap: 2,
    angle: 270,
    weights: [1, 2, 1, 2],
  })
  expect(new Set(generated.elements.map((element) => element.groupId))).toEqual(
    new Set([generated.groups[0].id]),
  )
  const widths = generated.elements.map((element) =>
    element.kind === 'stripe' ? element.width : NaN,
  )
  expect(widths[1]).toBeCloseTo(widths[0] * 2, 5)
  expect(
    Math.abs(generated.elements[1].y - generated.elements[0].y) -
      (widths[0] + widths[1]) / 2,
  ).toBeCloseTo(2, 5)

  // An unrelated overlay must remain above the group when its count changes.
  await page
    .getByRole('group', { name: 'Add pattern shape' })
    .getByRole('button', { name: 'Circle', exact: true })
    .click()
  const beforeRedistribution = await stored(page)
  const overlay = beforeRedistribution.elements.at(-1)!
  await count.fill('5')
  await count.press('Tab')
  await gap.fill('3')
  await gap.press('Tab')
  await editor.getByLabel('Stripe width weights', { exact: true }).fill('')
  await editor
    .getByRole('button', { name: 'Redistribute stripe group', exact: true })
    .click()
  await expect.poll(async () => (await stored(page)).elements.length).toBe(6)
  const redistributed = await stored(page)
  expect(redistributed.groups).toHaveLength(1)
  expect(redistributed.groups[0]).toMatchObject({
    id: generated.groups[0].id,
    generator: { count: 5, gap: 3 },
  })
  expect(redistributed.elements.at(-1)).toEqual(overlay)
  expect(
    redistributed.elements
      .slice(0, 4)
      .map(({ id, materialId }) => ({ id, materialId })),
  ).toEqual(
    generated.elements.map(({ id, materialId }) => ({ id, materialId })),
  )
  const canvas = editor.locator('.multicolor-canvas')
  await canvas.focus()
  await canvas.press('Control+z')
  await expect.poll(() => stored(page)).toEqual(beforeRedistribution)
  await canvas.press('Control+y')
  await expect.poll(() => stored(page)).toEqual(redistributed)

  const x = editor.getByRole('spinbutton', {
    name: 'Position X (mm)',
    exact: true,
  })
  const selected = redistributed.elements[0]
  const y = editor.getByRole('spinbutton', {
    name: 'Position Y (mm)',
    exact: true,
  })
  await y.focus()
  await y.press('Tab')
  expect(await stored(page)).toEqual(redistributed)
  // Retyping the displayed rounded value also leaves hidden precision intact.
  await y.fill(String(Number(selected.y.toFixed(2))))
  await y.press('Tab')
  expect(await stored(page)).toEqual(redistributed)
  await canvas.press('Control+z')
  await expect.poll(() => stored(page)).toEqual(beforeRedistribution)
  await canvas.press('Control+y')
  await expect.poll(() => stored(page)).toEqual(redistributed)
  await x.fill('')
  expect(await stored(page)).toEqual(redistributed)
  await x.press('Tab')
  await expect(x).toHaveValue(String(Number(selected.x.toFixed(2))))
  await x.fill('12.5')
  expect(await stored(page)).toEqual(redistributed)
  await x.press('Escape')
  await expect.poll(() => stored(page)).toEqual(redistributed)
  await x.fill('12.5')
  await x.press('Enter')
  await expect
    .poll(async () => findShape(await stored(page), selected.id).x)
    .toBe(12.5)
  const numeric = await stored(page)
  // Native input undo must not undo the design while a draft field has focus.
  await x.press('Control+z')
  expect(await stored(page)).toEqual(numeric)
  await x.press('Escape')
  await canvas.focus()
  await canvas.press('ArrowRight')
  await canvas.press('Shift+ArrowUp')
  await canvas.press('Alt+ArrowLeft')
  await expect
    .poll(async () => findShape(await stored(page), selected.id).x)
    .toBeCloseTo(13.4, 5)
  expect(findShape(await stored(page), selected.id).y).toBeCloseTo(
    selected.y + 10,
    5,
  )
  await canvas.press('Control+d')
  await expect.poll(async () => (await stored(page)).elements.length).toBe(7)
  await canvas.press('Delete')
  await expect.poll(async () => (await stored(page)).elements.length).toBe(6)
  await expect(editor.getByRole('alert')).toBeHidden()
})
