import { expect, test } from '@playwright/test'

test('keeps editing and export available when the preview chunk fails, then recovers on reload', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Match both Vite's development module and the hashed production chunk.
  const previewChunk = /\/SpeakerPreview(?:-[^/?]+\.js|\.tsx)(?:\?|$)/
  await page.route(previewChunk, (route) => route.abort())
  await page.goto('/')

  await expect(page.getByRole('alert')).toContainText('Preview could not load')
  const exportButton = page.getByRole('button', {
    name: 'Export design',
    exact: true,
  })
  await expect(exportButton).toBeEnabled()
  const chalk = page.getByRole('button', {
    name: 'Front panel: Chalk',
    exact: true,
  })
  await chalk.click()
  await expect(chalk).toHaveAttribute('aria-pressed', 'true')

  await exportButton.click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByRole('group', { name: 'Export parts' })
    .getByRole('button', { name: 'Panel only', exact: true })
    .click()
  const downloadStarted = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download STL/ }).click()
  const download = await downloadStarted
  expect(download.suggestedFilename()).toMatch(/\.stl$/)
  expect(await download.failure()).toBeNull()

  await page.unroute(previewChunk)
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Reload page', exact: true }).click(),
  ])
  await expect(page.locator('.preview-stage canvas')).toBeVisible()
  await expect(page.getByText('Preview could not load')).not.toBeVisible()
  await expect(exportButton).toBeEnabled()
  await expect(chalk).toHaveAttribute('aria-pressed', 'true')
  expect(errors).toEqual([])
})
