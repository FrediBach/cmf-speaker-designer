import { readFile } from 'node:fs/promises'
import {
  test as base,
  expect,
  type Page,
  type TestInfo,
} from '@playwright/test'
import { inspectBinaryStl } from './stl'
import { revealSpeakerControls } from './controls'

const test = base.extend<{ appErrors: string[] }>({
  appErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      const onError = (error: Error) => errors.push(error.message)
      page.on('pageerror', onError)
      await use(errors)
      page.off('pageerror', onError)
      expect(errors, 'Halo changes should not raise browser errors').toEqual([])
    },
    { auto: true },
  ],
})

async function expectReady(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Export design', exact: true }),
  ).toBeEnabled({ timeout: 60_000 })
  await expect(page.locator('.preview-stage canvas')).toBeVisible()
  await expect(
    page.getByText('3D preview unavailable', { exact: true }),
  ).not.toBeVisible()
}

async function downloadPanel(page: Page, testInfo: TestInfo, label: string) {
  await expectReady(page)
  await page.getByRole('button', { name: 'Export design', exact: true }).click()
  const dialog = page.getByRole('dialog', {
    name: 'Export design',
    exact: true,
  })
  await expect(dialog).toContainText(/halo/i)
  await dialog
    .getByRole('group', { name: 'Export parts' })
    .getByRole('button', { name: 'Panel only', exact: true })
    .click()
  const started = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download STL/ }).click()
  const download = await started
  const output = testInfo.outputPath(`${label}.stl`)
  await download.saveAs(output)
  const binary = await readFile(output)
  const mesh = inspectBinaryStl(binary)
  expect(mesh.components, 'Halo and panel must form one solid').toBe(1)
  expect(mesh.invalidEdges, 'Every edge must have two opposing faces').toBe(0)
  expect(mesh.degenerateEdges).toBe(0)
  expect(mesh.signedVolume).toBeGreaterThan(0)
  expect(mesh.minimum[2]).toBeCloseTo(0, 5)
  return { mesh, binary, filename: download.suggestedFilename() }
}

function expectSingleAngledLip(binary: Buffer) {
  const cutAngle = (35 * Math.PI) / 180
  const planeOffsets: number[] = []
  for (let triangle = 0; triangle < binary.readUInt32LE(80); triangle += 1) {
    const vertices = [0, 1, 2].map((corner) => {
      const offset = 84 + triangle * 50 + 12 + corner * 12
      return [
        binary.readFloatLE(offset),
        binary.readFloatLE(offset + 4),
        binary.readFloatLE(offset + 8),
      ]
    })
    // The export faces down: Z=0 is the tip, and the flush panel face is Z=26.
    if (vertices.some((vertex) => vertex[2] >= 25.999)) continue
    const [a, b, c] = vertices
    const u = b.map((value, axis) => value - a[axis])
    const v = c.map((value, axis) => value - a[axis])
    const normal = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ]
    const forwardComponent = Math.abs(normal[2]) / Math.hypot(...normal)
    // The conical walls have an 18° slope; these faces belong to the cut lip.
    if (forwardComponent <= 0.7) continue
    expect(
      forwardComponent,
      'Every forward-facing lip triangle must follow the 35° cut, with no flat tip shelf',
    ).toBeCloseTo(Math.cos(cutAngle), 4)
    for (const vertex of vertices) {
      planeOffsets.push(vertex[2] + Math.tan(cutAngle) * vertex[1])
    }
  }
  expect(
    planeOffsets.length,
    'The exported halo must contain a cut lip',
  ).toBeGreaterThan(20)
  expect(
    Math.max(...planeOffsets) - Math.min(...planeOffsets),
    'The entire exposed lip must lie on one straight cutting plane',
  ).toBeLessThan(0.001)
}

async function screenshotHaloCloseup(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click()
  const preview = page.locator('[role="img"][data-preview-controls]')
  await preview.focus()
  await preview.press('Shift+Equal')
  await preview.press('Shift+Equal')
  await preview.press('ArrowRight')
  await preview.press('ArrowRight')
  await preview.press('ArrowUp')
  await page.getByRole('tab', { name: 'Halo', exact: true }).focus()
  await page.locator('.preview-card').screenshot({
    path: testInfo.outputPath(name),
  })
}

function expectMatchingMediumHalos(
  mesh: ReturnType<typeof inspectBinaryStl>,
  offsets: [number, number][],
) {
  for (const [x, y] of offsets) {
    // Compare only generated geometry forward of the original face, excluding
    // source-panel differences and the grille pattern below each halo.
    const upper = mesh.rayZ(x, 15 + y).filter((z) => z < 25.999)
    const lower = mesh.rayZ(x, -70 + y).filter((z) => z < 25.999)
    expect(
      upper.length,
      'Each sampled halo feature must project forwards',
    ).toBeGreaterThan(0)
    expect(
      lower,
      'Both M openings must have the same generated profile',
    ).toHaveLength(upper.length)
    upper.forEach((z, index) => expect(lower[index]).toBeCloseTo(z, 3))
  }
}

test('generates a cut halo, retains shared settings, and exports it with a grille and handle on both models', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await expectReady(page)
  await page.getByRole('tab', { name: 'Halo', exact: true }).click()
  await expect(
    page.getByRole('tab', { name: 'Halo', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(
    page.getByRole('tab', { name: 'Halo', exact: true }),
  ).toBeFocused()
  await expect(
    page
      .getByRole('group', { name: 'Halo generation mode' })
      .getByRole('button'),
  ).toHaveText(['Original', 'Custom'])
  await page.screenshot({
    path: testInfo.outputPath('halo-original-controls.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Custom halo', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Custom halo', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Rain hood', exact: true }).click()

  const controls = [
    ['Outward angle in degrees', '18'],
    ['Halo depth in millimeters', '26'],
    ['Wall thickness in millimeters', '3'],
    ['Cutting angle in degrees', '35'],
    ['Cut rotation in degrees', '45'],
    ['Rim height in millimeters', '2'],
  ] as const
  for (const [name, value] of controls) {
    await page.getByRole('spinbutton', { name, exact: true }).fill(value)
  }
  await expectReady(page)
  await page.reload()
  await expectReady(page)
  await expect(
    page.getByRole('tab', { name: 'Halo', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  for (const [name, value] of controls) {
    await expect(
      page.getByRole('spinbutton', { name, exact: true }),
    ).toHaveValue(value)
  }

  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page
    .getByRole('button', { name: 'Copy design link', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText('Design link copied.')
  const link = await page.evaluate(() => navigator.clipboard.readText())
  const shared = JSON.parse(new URL(link).searchParams.get('design')!)
  expect(shared.style).toBe('custom')
  expect(shared.halo).toEqual({
    mode: 'custom',
    outwardAngle: 18,
    depth: 26,
    thickness: 3,
    cutAngle: 35,
    cutRotation: 45,
    rimHeight: 2,
  })
  await page.evaluate(() => localStorage.removeItem('cmf-speaker-design-v1'))
  await page.goto(link)
  await expectReady(page)
  await page.getByRole('tab', { name: 'Halo', exact: true }).click()
  for (const [name, value] of controls) {
    await expect(
      page.getByRole('spinbutton', { name, exact: true }),
    ).toHaveValue(value)
  }

  // Orient the longest side upwards, then independently inspect the exported hood.
  await page
    .getByRole('spinbutton', { name: 'Cut rotation in degrees', exact: true })
    .fill('0')
  const rimHeight = page.getByRole('spinbutton', {
    name: 'Rim height in millimeters',
    exact: true,
  })
  await rimHeight.fill('0')
  const small = await downloadPanel(page, testInfo, 'speaker-s-rain-hood')
  expect(small.filename).toBe(
    'cmf-speaker-s-original-halo-26.0mm-cut-35.0deg.stl',
  )
  expect(small.mesh.genus).toBe(4)
  expectSingleAngledLip(small.binary)
  expect(
    small.mesh.rayZ(0, -23),
    'The driver center must remain an unobstructed opening',
  ).toEqual([])
  const upperRim = small.mesh.rayZ(0, -23 + 36.5)
  const lowerRim = small.mesh.rayZ(0, -23 - 36.5)
  expect(upperRim.length).toBeGreaterThan(0)
  expect(lowerRim.length).toBeGreaterThan(0)
  expect(
    lowerRim[0] - upperRim[0],
    'The upward-facing rain cover must project farther than its lower rim',
  ).toBeGreaterThan(5)
  const flushBase = small.mesh.rayZ(0, -58)
  expect(flushBase).toHaveLength(2)
  expect(
    flushBase[0],
    'A zero-height rim must end flush with the original panel face',
  ).toBeCloseTo(26, 4)
  await page.screenshot({
    path: testInfo.outputPath('generative-rain-hood.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Panel only', exact: true }).click()
  await screenshotHaloCloseup(page, testInfo, 'straight-cut-halo-closeup.png')

  await rimHeight.fill('5')
  const raised = await downloadPanel(
    page,
    testInfo,
    'speaker-s-raised-halo-rim',
  )
  const raisedBase = raised.mesh.rayZ(0, -58)
  expect(raisedBase).toHaveLength(2)
  expect(
    flushBase[0] - raisedBase[0],
    'The cut-away side must project by the selected 5 mm rim height',
  ).toBeCloseTo(5, 4)
  expect(raisedBase[1], 'The rear face must remain unchanged').toBeCloseTo(
    flushBase[1],
    4,
  )
  expect(raised.mesh.rayZ(0, -23)).toEqual([])
  await screenshotHaloCloseup(page, testInfo, 'raised-halo-rim-closeup.png')

  await revealSpeakerControls(page)
  await page.getByRole('button', { name: /^Speaker M/ }).click()
  const twinHoods = await downloadPanel(
    page,
    testInfo,
    'speaker-m-twin-rain-hoods',
  )
  expectMatchingMediumHalos(twinHoods.mesh, [
    [0, 36.5],
    [0, -35],
  ])
  for (const center of [15, -70]) {
    expect(
      twinHoods.mesh.rayZ(0, center),
      'Both driver centers must remain open',
    ).toEqual([])
    expect(twinHoods.mesh.rayZ(0, center - 35)[0]).toBeCloseTo(21, 4)
  }
  await screenshotHaloCloseup(page, testInfo, 'speaker-m-twin-rain-hoods.png')

  // A shared change must update both M halos, including the cut direction.
  await rimHeight.fill('0')
  await page
    .getByRole('spinbutton', { name: 'Cut rotation in degrees', exact: true })
    .fill('90')
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click()
  await page.getByRole('button', { name: 'Speaker', exact: true }).click()

  await page.getByRole('tab', { name: 'Handle', exact: true }).click()
  await page.getByRole('button', { name: 'Custom handle', exact: true }).click()
  await page.getByRole('button', { name: 'Carry loop', exact: true }).click()
  await page.getByRole('tab', { name: 'Grille', exact: true }).click()
  await page.getByRole('button', { name: 'Custom grille', exact: true }).click()
  await page.getByRole('button', { name: 'Aligned', exact: true }).click()
  await page.getByRole('checkbox', { name: /Continue across the face/ }).check()
  await expectReady(page)
  await page.getByRole('tab', { name: 'Halo', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Custom halo', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  const medium = await downloadPanel(
    page,
    testInfo,
    'speaker-m-halo-grille-handle',
  )
  expect(medium.filename).toBe(
    'cmf-speaker-m-original-handle-35.0mm-grille-round-extended-halo-26.0mm-cut-35.0deg.stl',
  )
  expect(medium.mesh.genus).toBeGreaterThan(20)
  expectMatchingMediumHalos(medium.mesh, [
    [-36.5, 0],
    [-35, 10],
  ])
  for (const center of [15, -70]) {
    expect(
      medium.mesh.rayZ(35, center).filter((z) => z < 25.999),
      'The newly selected flush rim must apply to both cut-away sides',
    ).toEqual([])
  }
  expect(medium.mesh.maximum[1] - medium.mesh.minimum[1]).toBeGreaterThan(225)
  expect(
    medium.mesh.rayZ(0, 12),
    'The upper driver grille must stay open',
  ).toEqual([])
  expect(
    medium.mesh.rayZ(0, -72),
    'The lower driver grille must stay open',
  ).toEqual([])
  await page.screenshot({
    path: testInfo.outputPath('speaker-m-halo-grille-handle.png'),
    fullPage: true,
  })

  await revealSpeakerControls(page)
  await page.getByRole('button', { name: /^Speaker S/ }).click()
  await page
    .getByRole('spinbutton', { name: 'Cut rotation in degrees', exact: true })
    .fill('0')
  await page.getByRole('tab', { name: 'Handle', exact: true }).click()
  await page
    .getByRole('button', { name: 'Original handle', exact: true })
    .click()
  await page.getByRole('tab', { name: 'Grille', exact: true }).click()
  await page
    .getByRole('button', { name: 'Original grille', exact: true })
    .click()
  const restoredSmall = await downloadPanel(
    page,
    testInfo,
    'speaker-s-restored-single-halo',
  )
  expect(restoredSmall.mesh.genus).toBe(4)
  expect(
    restoredSmall.mesh.maximum[1] - restoredSmall.mesh.minimum[1],
    'Returning to S must remove the second halo and restore its original bounds',
  ).toBeCloseTo(small.mesh.maximum[1] - small.mesh.minimum[1], 4)
  expect(restoredSmall.mesh.signedVolume).toBeCloseTo(
    small.mesh.signedVolume,
    3,
  )
  expect(restoredSmall.mesh.rayZ(0, -23)).toEqual([])
})

test.describe('mobile halo controls', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  })

  test('keeps every halo control reachable and restores the original panel without losing parameters', async ({
    page,
  }, testInfo) => {
    await page.goto('/')
    await expectReady(page)
    await page.getByRole('tab', { name: 'Halo', exact: true }).click()
    await expect(
      page
        .getByRole('group', { name: 'Halo generation mode' })
        .getByRole('button'),
    ).toHaveText(['Original', 'Custom'])
    await expect(
      page.getByRole('button', { name: 'Supplied halo', exact: true }),
    ).toHaveCount(0)
    await page.screenshot({
      path: testInfo.outputPath('mobile-halo-original-controls.png'),
      fullPage: true,
    })
    await page.getByRole('button', { name: 'Custom halo', exact: true }).click()
    await page.getByRole('button', { name: 'Rain hood', exact: true }).click()
    const rotation = page.getByRole('spinbutton', {
      name: 'Cut rotation in degrees',
      exact: true,
    })
    await rotation.scrollIntoViewIfNeeded()
    await expect(rotation).toBeInViewport({ ratio: 1 })
    await rotation.fill('90')
    await expectReady(page)
    const viewport = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
      height: window.innerHeight,
      contentHeight: document.documentElement.scrollHeight,
    }))
    expect(viewport.content).toBeLessThanOrEqual(viewport.width + 1)
    expect(viewport.contentHeight).toBeLessThanOrEqual(viewport.height + 1)
    await expect(page.locator('.preview-card')).toBeInViewport({ ratio: 1 })
    await expect(
      page.getByRole('button', { name: 'Export design', exact: true }),
    ).toBeInViewport({ ratio: 1 })
    await page.screenshot({
      path: testInfo.outputPath('mobile-halo-controls.png'),
      fullPage: true,
    })

    await page
      .getByRole('spinbutton', {
        name: 'Cutting angle in degrees',
        exact: true,
      })
      .fill('70')
    await page
      .getByRole('spinbutton', {
        name: 'Outward angle in degrees',
        exact: true,
      })
      .fill('45')
    await expect(
      page.getByRole('spinbutton', {
        name: 'Cutting angle in degrees',
        exact: true,
      }),
    ).toHaveValue('44')
    await expect(
      page.getByRole('slider', { name: 'Cutting angle', exact: true }),
    ).toHaveAttribute('aria-valuemax', '44')

    const rimHeight = page.getByRole('spinbutton', {
      name: 'Rim height in millimeters',
      exact: true,
    })
    await rimHeight.fill('5')
    await rimHeight.scrollIntoViewIfNeeded()
    await expect(rimHeight).toBeInViewport({ ratio: 1 })
    await expectReady(page)
    await page.screenshot({
      path: testInfo.outputPath('mobile-halo-rim-controls.png'),
      fullPage: true,
    })
    await page
      .getByRole('spinbutton', {
        name: 'Halo depth in millimeters',
        exact: true,
      })
      .fill('2')
    await expect(rimHeight).toHaveValue('2')
    await expect(
      page.getByRole('slider', { name: 'Rim height', exact: true }),
    ).toHaveAttribute('aria-valuemax', '2')

    await page.getByRole('button', { name: 'Full halo', exact: true }).click()
    await expect(
      page.getByRole('spinbutton', {
        name: 'Cutting angle in degrees',
        exact: true,
      }),
    ).toHaveValue('0')
    const depth = page.getByRole('spinbutton', {
      name: 'Halo depth in millimeters',
      exact: true,
    })
    await depth.fill('18')
    await page
      .getByRole('button', { name: 'Original halo', exact: true })
      .click()
    await expectReady(page)
    await expect(
      page.getByRole('button', { name: 'Original halo', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('spinbutton')).toHaveCount(0)
    await page.getByRole('button', { name: 'Custom halo', exact: true }).click()
    await expect(depth).toHaveValue('18')

    await page.getByRole('tab', { name: 'Front panel', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Custom', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Original', exact: true }).click()
    await expectReady(page)
    await expect(page.locator('.preview-model')).toContainText('Original')
    await page.getByRole('tab', { name: 'Halo', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Original halo', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Custom halo', exact: true }).click()
    await expectReady(page)
    await expect(depth).toHaveValue('18')
  })
})
