import { expect, test } from '@playwright/test'

const canonical = 'https://www.cmfspeakerdesigner.com/'

function pngSize(bytes: Buffer) {
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`
}

test.describe('public deployment assets', () => {
  // Social crawlers and users with scripts disabled must receive real metadata.
  test.use({ javaScriptEnabled: false })

  test('serves crawlable metadata and a real social image on shared URLs', async ({
    page,
    request,
  }) => {
    const document = await page.goto('/?design=%7B%22model%22%3A%22m%22%7D')
    if (process.env.PLAYWRIGHT_PREVIEW === '1') {
      expect(document!.headers()['content-security-policy']).toContain(
        "script-src 'self' 'wasm-unsafe-eval'",
      )
      expect(document!.headers()['x-content-type-options']).toBe('nosniff')
    }
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      canonical,
    )
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      'content',
      canonical,
    )
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      'content',
      'summary_large_image',
    )
    // Playwright's text selector skips noscript descendants even with JS off.
    const fallback = page.locator('noscript p').last()
    await expect(fallback).toBeVisible()
    await expect(fallback).toHaveText(
      'Enable JavaScript in your browser to open the designer.',
    )

    const structuredData = JSON.parse(
      (await page.locator('script[type="application/ld+json"]').textContent())!,
    )
    expect(structuredData.url).toBe(canonical)
    for (const selector of [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
    ]) {
      const imageURL = new URL(
        (await page.locator(selector).getAttribute('content'))!,
      )
      expect(imageURL.origin).toBe(new URL(canonical).origin)
      const response = await request.get(imageURL.pathname)
      expect(response.ok()).toBe(true)
      expect(response.headers()['content-type']).toContain('image/png')
      expect(pngSize(await response.body())).toBe('1200x630')
    }

    const robots = await request.get('/robots.txt')
    expect(robots.ok()).toBe(true)
    expect(robots.headers()['content-type']).toContain('text/plain')
    expect(await robots.text()).toContain(`Sitemap: ${canonical}sitemap.xml`)
    const sitemap = await request.get('/sitemap.xml')
    expect(sitemap.ok()).toBe(true)
    expect(sitemap.headers()['content-type']).toContain('xml')
    expect(await sitemap.text()).toContain(`<loc>${canonical}</loc>`)
  })

  test('serves install icons with their declared sizes and a useful error page', async ({
    page,
    request,
  }) => {
    await page.goto('/')
    const manifestPath = await page
      .locator('link[rel="manifest"]')
      .getAttribute('href')
    const response = await request.get(manifestPath!)
    expect(response.ok()).toBe(true)
    expect(response.headers()['content-type']).toContain('manifest+json')
    const manifest = await response.json()
    expect(new URL(manifest.start_url, canonical).origin).toBe(
      new URL(canonical).origin,
    )
    expect(
      manifest.icons.some(
        (icon: { purpose: string }) => icon.purpose === 'maskable',
      ),
    ).toBe(true)
    for (const icon of manifest.icons) {
      const asset = await request.get(icon.src)
      expect(asset.ok()).toBe(true)
      expect(asset.headers()['content-type']).toContain(icon.type)
      expect(pngSize(await asset.body())).toBe(icon.sizes)
    }
    const appleIcon = await request.get(
      (await page
        .locator('link[rel="apple-touch-icon"]')
        .getAttribute('href'))!,
    )
    expect(pngSize(await appleIcon.body())).toBe('180x180')
    const favicon = await request.get('/favicon.ico')
    expect(favicon.ok()).toBe(true)
    expect((await favicon.body()).subarray(0, 4).toString('hex')).toBe(
      '00000100',
    )

    await page.goto('/404.html')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'This page could not be found.',
    )
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex',
    )
    await expect(
      page.getByRole('link', { name: 'Open the designer' }),
    ).toHaveAttribute('href', '/')
  })
})
