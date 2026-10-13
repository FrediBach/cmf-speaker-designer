import { expect, test } from '@playwright/test'

for (const [tab, mode] of [
  ['Handle', 'Custom handle'],
  ['Grille', 'Custom grille'],
  ['Halo', 'Custom halo'],
  ['Knob', null],
] as const) {
  test(`${tab} numeric drafts retain focus and follow slider edits and undo`, async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: tab, exact: true }).click()
    if (mode) {
      await page.getByRole('button', { name: mode, exact: true }).click()
    }
    const input = page.getByRole('spinbutton').first()
    const slider = page.getByRole('slider').first()
    const initial = await input.inputValue()

    // Empty drafts are allowed while typing and restored on blur.
    await input.fill('')
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('')
    await input.press('Tab')
    await expect(input).toHaveValue(initial)

    const minimum = Number(await input.getAttribute('min'))
    const maximum = Number(await input.getAttribute('max'))
    const next = String(Number(((minimum + maximum) / 2).toFixed(2)))
    await input.fill(next)
    await expect(input).toBeFocused()
    await expect(input).toHaveValue(next)
    await expect(slider).toHaveAttribute('aria-valuenow', next)

    await slider.press('Home')
    await expect(input).toHaveValue(String(minimum))
    await slider.press('Control+z')
    await expect(input).toHaveValue(next)
    await slider.press('Control+y')
    await expect(input).toHaveValue(String(minimum))

    // Out-of-range drafts remain editable, then clamp on commit.
    await input.fill(String(maximum + 100))
    await expect(input).toBeFocused()
    await expect(slider).toHaveAttribute('aria-valuenow', String(minimum))
    await input.press('Tab')
    await expect(input).toHaveValue(String(maximum))
    await expect(slider).toHaveAttribute('aria-valuenow', String(maximum))
  })
}
