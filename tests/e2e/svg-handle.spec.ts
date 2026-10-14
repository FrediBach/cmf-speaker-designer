import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { inspectBinaryStl } from './stl'

const triangle =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40"><g transform="translate(9 11)"><path d="M0 20 L40 20 L20 0Z"/></g></svg>'

async function ready(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Export design', exact: true }),
  ).toBeEnabled()
  await expect(
    page.getByText('3D preview unavailable', { exact: true }),
  ).toBeHidden()
}

async function openSvg(page: Page) {
  await page.goto('/')
  await ready(page)
  await page.getByRole('tab', { name: 'Handle', exact: true }).click()
  await page.getByRole('button', { name: 'Custom handle', exact: true }).click()
  await page
    .getByRole('spinbutton', {
      name: 'Extension height in millimeters',
      exact: true,
    })
    .fill('48')
  await page.getByRole('button', { name: 'SVG', exact: true }).click()
}

async function upload(page: Page, name = 'triangle.svg', source = triangle) {
  await page.getByLabel('Upload SVG cutout', { exact: true }).setInputFiles({
    name,
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(source),
  })
}

test('uploads, saves, restores and exports an SVG as a real handle cutout', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openSvg(page)
  await upload(page)
  await expect(page.locator('.svg-upload-file')).toContainText('triangle.svg')
  await expect(page.locator('.svg-cutout-size')).toContainText('40 × 20 mm')
  await ready(page)

  await page
    .getByRole('spinbutton', {
      name: 'Cutout width in millimeters',
      exact: true,
    })
    .fill('36')
  await expect(page.locator('.svg-cutout-size')).toContainText('36 × 18 mm')
  await page
    .getByRole('spinbutton', {
      name: 'Cutout width in millimeters',
      exact: true,
    })
    .fill('40')
  await page.getByRole('button', { name: 'SVG', exact: true }).focus()
  await ready(page)
  await page.reload()
  await ready(page)
  await expect(
    page.getByRole('button', { name: 'SVG', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.svg-upload-file')).toContainText('triangle.svg')

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page
    .getByRole('button', { name: 'Copy design link', exact: true })
    .click()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(new URL(link).search).toBe('')
  expect(new URLSearchParams(new URL(link).hash.slice(1)).has('design')).toBe(
    true,
  )
  await page.goto(link)
  await page.reload()
  await ready(page)
  await expect(page.locator('.svg-upload-file')).toContainText('triangle.svg')

  // Reject bad replacements without changing the current geometry or saved file.
  for (const source of [
    '<svg><path',
    '<svg xmlns="http://www.w3.org/2000/svg"><text>Hi</text></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path fill="none" stroke="black" d="M0 0L20 20"/></svg>',
  ]) {
    await upload(page, 'invalid.svg', source)
    await expect(page.locator('.svg-upload-error')).toBeVisible()
    await expect(page.locator('.svg-upload-file')).toContainText('triangle.svg')
    await ready(page)
  }
  await upload(page)
  await expect(page.locator('.svg-upload-error')).toBeHidden()

  await page
    .getByRole('button', { name: 'Remove SVG cutout', exact: true })
    .click()
  await expect(page.locator('.svg-upload-file')).toBeHidden()
  await page.getByRole('button', { name: 'SVG', exact: true }).focus()
  await page.keyboard.press('Control+z')
  await expect(page.locator('.svg-upload-file')).toContainText('triangle.svg')
  await ready(page)
  await page.getByRole('button', { name: 'Slot', exact: true }).click()
  await page.getByRole('button', { name: 'SVG', exact: true }).click()
  await expect(page.locator('.svg-upload-file')).toContainText('triangle.svg')
  await ready(page)

  await page.getByRole('button', { name: 'Export design', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('SVG cutout · triangle.svg')
  await dialog.getByRole('button', { name: 'Panel only', exact: true }).click()
  const started = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download STL/ }).click()
  const download = await started
  const path = testInfo.outputPath('svg-handle.stl')
  await download.saveAs(path)
  const mesh = inspectBinaryStl(await readFile(path))
  expect(mesh.components).toBe(1)
  expect(mesh.invalidEdges).toBe(0)
  expect(mesh.degenerateEdges).toBe(0)
  expect(mesh.genus).toBe(4)
  const centerY = 65.48455 - 24 + 48 / 2 + 2
  expect(mesh.rayZ(0, centerY + 6)).toEqual([])
  expect(mesh.rayZ(12, centerY + 6)).toHaveLength(2)
  expect(mesh.rayZ(12, centerY - 6)).toEqual([])
  expect(mesh.rayZ(0, centerY + 12)).toHaveLength(2)
  await page
    .getByRole('button', { name: 'SVG', exact: true })
    .scrollIntoViewIfNeeded()
  await page.screenshot({
    path: testInfo.outputPath('svg-handle-desktop.png'),
    fullPage: true,
  })
  await upload(
    page,
    'ring.svg',
    '<svg xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M0 0H40V40H0Z M10 10H30V30H10Z"/></svg>',
  )
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'This SVG leaves floating islands' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Export design', exact: true }),
  ).toBeDisabled()
  await upload(page)
  await ready(page)
  expect(errors).toEqual([])
})

test('shows SVG upload and replacement controls in the mobile layout', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openSvg(page)
  await upload(page)
  await ready(page)
  await page
    .getByRole('button', { name: 'Replace SVG', exact: true })
    .scrollIntoViewIfNeeded()
  await expect(
    page.getByRole('button', { name: 'Replace SVG', exact: true }),
  ).toBeInViewport()
  const size = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    height: window.innerHeight,
    contentHeight: document.documentElement.scrollHeight,
  }))
  expect(size.content).toBeLessThanOrEqual(size.viewport)
  expect(size.contentHeight).toBeLessThanOrEqual(size.height)
  await page.screenshot({
    path: testInfo.outputPath('svg-handle-mobile.png'),
    fullPage: true,
  })
})
