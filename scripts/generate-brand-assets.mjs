import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

// Regenerate the checked-in social card and icons with:
//   node scripts/generate-brand-assets.mjs
// Uses installed Chrome, matching the end-to-end test configuration. To use
// Playwright's Chromium instead, set PLAYWRIGHT_CHROMIUM_CHANNEL=chromium.
const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root))
const write = (path, data) => writeFile(new URL(path, root), data)
const dataURL = (mime, buffer) =>
  `data:${mime};base64,${buffer.toString('base64')}`
const [template, photo, dmSans, spaceMono, favicon] = await Promise.all([
  read('scripts/og-card.html'),
  read('public/speakers-lineup.png'),
  read(
    'node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2',
  ),
  read(
    'node_modules/@fontsource/space-mono/files/space-mono-latin-400-normal.woff2',
  ),
  read('public/favicon.svg'),
])
const card = template
  .toString()
  .replaceAll('{{SPEAKERS_IMAGE}}', dataURL('image/png', photo))
  .replaceAll('{{DM_SANS_FONT}}', dataURL('font/woff2', dmSans))
  .replaceAll('{{MONO_FONT}}', dataURL('font/woff2', spaceMono))

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || 'chrome',
  headless: true,
})
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  })
  await page.setContent(card)
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all([...document.images].map((image) => image.decode()))
  })
  await page.screenshot({
    path: fileURLToPath(new URL('public/og-image.png', root)),
    type: 'png',
  })

  // Rasterize the existing vector mark in the browser. A maskable icon uses a
  // solid background and keeps the speaker inside the central 80% safe circle.
  const renderIcon = async (
    size,
    { opaque = false, maskable = false } = {},
  ) => {
    const url = await page.evaluate(
      async ({ svg, size, opaque, maskable }) => {
        const icon = new Image()
        icon.src = svg
        await icon.decode()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const context = canvas.getContext('2d')
        if (opaque || maskable) {
          context.fillStyle = '#f45427'
          context.fillRect(0, 0, size, size)
        }
        const inset = maskable ? size / 8 : 0
        context.drawImage(
          icon,
          inset,
          inset,
          size - inset * 2,
          size - inset * 2,
        )
        return canvas.toDataURL('image/png')
      },
      { svg: dataURL('image/svg+xml', favicon), size, opaque, maskable },
    )
    return Buffer.from(url.split(',')[1], 'base64')
  }
  await write(
    'public/apple-touch-icon.png',
    await renderIcon(180, { opaque: true }),
  )
  await write('public/icon-192.png', await renderIcon(192))
  await write('public/icon-512.png', await renderIcon(512))
  await write(
    'public/icon-maskable-512.png',
    await renderIcon(512, { maskable: true }),
  )

  // ICO supports PNG image entries; package the three small raster sizes without
  // introducing an image-conversion dependency.
  const sizes = [16, 32, 48]
  const images = await Promise.all(sizes.map((size) => renderIcon(size)))
  const header = Buffer.alloc(6 + sizes.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  images.forEach((png, index) => {
    const entry = 6 + index * 16
    header[entry] = header[entry + 1] = sizes[index]
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  await write('public/favicon.ico', Buffer.concat([header, ...images]))
  console.log(
    'Generated OG image, Apple touch icon, PWA icons, and favicon.ico.',
  )
} finally {
  await browser.close()
}
