import type { Page } from '@playwright/test'

export async function revealSpeakerControls(page: Page) {
  const summary = page.getByRole('button', {
    name: /^Edit speaker model and colors/,
  })
  if (await summary.isVisible()) await summary.click()
}
