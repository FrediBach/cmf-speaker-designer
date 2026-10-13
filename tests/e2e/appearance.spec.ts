import { expect, test, type Locator, type Page } from '@playwright/test'

const appearanceKey = 'cmf-speaker-appearance-v1'

async function expectPanelReady(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Export STL', exact: true }),
  ).toBeEnabled()
  await expect(page.locator('.preview-stage canvas')).toBeVisible()
}

async function expectWorkspaceInViewport(page: Page) {
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
    height: window.innerHeight,
    contentHeight: document.documentElement.scrollHeight,
    scrollY: window.scrollY,
  }))
  expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.width + 1)
  expect(dimensions.contentHeight).toBeLessThanOrEqual(dimensions.height + 1)
  expect(dimensions.scrollY).toBe(0)
  await expect(page.locator('.preview-card')).toBeInViewport({ ratio: 1 })
  await expect(
    page.getByRole('button', { name: 'Export STL', exact: true }),
  ).toBeInViewport({ ratio: 1 })
}

// Resolve transparent surfaces through their ancestors so the check measures
// the actual text/background pair, including selected control backgrounds.
async function contrastRatio(locator: Locator) {
  return locator.evaluate((element) => {
    const rgba = (color: string) => {
      const values = color.match(/[\d.]+/g)?.map(Number)
      if (!values || values.length < 3 || !color.startsWith('rgb')) {
        throw new Error(`Unexpected computed color: ${color}`)
      }
      return [values[0], values[1], values[2], values[3] ?? 1]
    }
    const composite = (foreground: number[], background: number[]) =>
      foreground
        .slice(0, 3)
        .map(
          (channel, index) =>
            channel * foreground[3] + background[index] * (1 - foreground[3]),
        )
    const ancestors: Element[] = []
    for (
      let ancestor: Element | null = element;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      ancestors.unshift(ancestor)
    }
    let background = [255, 255, 255]
    for (const ancestor of ancestors) {
      background = composite(
        rgba(getComputedStyle(ancestor).backgroundColor),
        background,
      )
    }
    const foreground = composite(
      rgba(getComputedStyle(element).color),
      background,
    )
    const luminance = (rgb: number[]) => {
      const linear = rgb.map((channel) => {
        const value = channel / 255
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    }
    const text = luminance(foreground)
    const surface = luminance(background)
    return (Math.max(text, surface) + 0.05) / (Math.min(text, surface) + 0.05)
  })
}

async function chooseAppearance(
  page: Page,
  theme: 'Light' | 'Dark',
  accent: 'Orange' | 'Turquoise',
) {
  const trigger = page.getByRole('button', { name: 'Appearance', exact: true })
  await expect(trigger).toBeInViewport({ ratio: 1 })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Appearance', exact: true })
  await expect(dialog).toBeVisible()
  for (const label of [theme, accent]) {
    const option = dialog.getByRole('button', { name: label, exact: true })
    await expect(option).toBeInViewport({ ratio: 1 })
    await option.focus()
    await page.keyboard.press('Space')
    await expect(option).toHaveAttribute('aria-pressed', 'true')
  }
  await expect(page.locator('html')).toHaveAttribute(
    'data-theme',
    theme.toLowerCase(),
  )
  await expect(page.locator('html')).toHaveAttribute(
    'data-accent',
    accent.toLowerCase(),
  )
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
}

test('all appearance combinations remain readable and preserve the speaker design', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expectPanelReady(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'orange')
  await expect(page.locator('.status-bar p')).toHaveText(
    'Independent project · Not affiliated with Nothing or CMF · (c) 2026 Fredi Bach',
  )
  await expect(
    page.getByRole('link', { name: 'Fredi Bach', exact: true }),
  ).toHaveAttribute('href', 'https://fredibach.com')

  const model = page.getByRole('button', { name: /^Speaker M/ })
  const panelColor = page.getByRole('button', {
    name: 'Front panel: Lagoon',
    exact: true,
  })
  await model.click()
  await panelColor.click()
  await expectPanelReady(page)

  const backgrounds = new Map<string, string>()
  const accents = new Map<string, string>()
  for (const theme of ['Light', 'Dark'] as const) {
    for (const accent of ['Orange', 'Turquoise'] as const) {
      await chooseAppearance(page, theme, accent)
      await expect(model).toHaveAttribute('aria-pressed', 'true')
      await expect(panelColor).toHaveAttribute('aria-pressed', 'true')
      await expectWorkspaceInViewport(page)

      const exportButton = page.getByRole('button', {
        name: 'Export STL',
        exact: true,
      })
      backgrounds.set(
        theme,
        await page
          .locator('.site-header')
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      accents.set(
        accent,
        await exportButton.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      )
      for (const [name, text] of [
        ['Export button', exportButton],
        ['Model dimensions', model.locator('small')],
        [
          'Panel description',
          page
            .getByRole('tabpanel', { name: 'Front panel', exact: true })
            .locator('.style-description'),
        ],
        ['Footer', page.locator('.status-bar p')],
      ] as const) {
        expect(
          await contrastRatio(text),
          `${name} contrast in ${theme}/${accent}`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  }
  expect(backgrounds.get('Light')).not.toBe(backgrounds.get('Dark'))
  expect(accents.get('Orange')).not.toBe(accents.get('Turquoise'))
  await page.screenshot({
    path: testInfo.outputPath('appearance-dark-turquoise-desktop.png'),
  })

  await page.reload()
  await expectPanelReady(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'turquoise')
  await expect(model).toHaveAttribute('aria-pressed', 'true')
  await expect(panelColor).toHaveAttribute('aria-pressed', 'true')
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      appearanceKey,
    ),
  ).toMatchObject({ theme: 'dark', accent: 'turquoise' })

  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expectPanelReady(page)
  await expect(
    page.getByRole('button', { name: /^Speaker M/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('button', { name: 'Front panel: CMF orange', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'turquoise')
  await page.reload()
  await expectPanelReady(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'turquoise')
})

for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test(`appearance remains usable at ${viewport.width} × ${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expectPanelReady(page)
    await expectWorkspaceInViewport(page)
    await chooseAppearance(page, 'Dark', 'Turquoise')
    await expectWorkspaceInViewport(page)
    await chooseAppearance(page, 'Dark', 'Orange')
    await expectWorkspaceInViewport(page)
    await page.screenshot({
      path: testInfo.outputPath(
        `appearance-dark-orange-${viewport.width}x${viewport.height}.png`,
      ),
    })
  })
}
