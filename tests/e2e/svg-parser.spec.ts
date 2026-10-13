import { expect, test, type Page } from '@playwright/test'
import type { SvgCutout } from '../../src/lib/svg-cutout'

// Integration uploads cover the production build; these exercise the parser's
// geometry directly through Vite so assertions can inspect its numeric output.
test.skip(
  process.env.PLAYWRIGHT_PREVIEW === '1',
  'Direct parser import requires the Vite development server.',
)

async function parse(page: Page, body: string) {
  return page.evaluate(
    async (source) => {
      const modulePath = '/src/lib/svg-cutout-parser.ts'
      const { parseSvgCutout } = await import(/* @vite-ignore */ modulePath)
      try {
        return {
          result: parseSvgCutout(source, 'test.svg') as SvgCutout,
          error: null,
        }
      } catch (error) {
        return {
          result: null,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
    body.startsWith('<svg')
      ? body
      : `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`,
  )
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('normalizes transformed basic shapes, curves and nested paths while preserving fill rules', async ({
  page,
}) => {
  const circle = await parse(
    page,
    '<g transform="translate(80 40)"><g transform="scale(2 1)"><circle cx="10" cy="10" r="5"/></g></g>',
  )
  expect(circle.error).toBeNull()
  expect(circle.result!.aspectRatio).toBe(2)
  const points = circle.result!.paths[0].contours[0]
  expect(points.length).toBeGreaterThan(24)
  expect(Math.min(...points.map(([x]) => x))).toBe(-0.5)
  expect(Math.max(...points.map(([, y]) => y))).toBe(0.5)

  const rounded = await parse(
    page,
    '<rect x="20" y="30" width="40" height="20" rx="100"/>',
  )
  expect(rounded.error).toBeNull()
  expect(rounded.result!.aspectRatio).toBe(2)
  expect(rounded.result!.paths[0].contours[0].length).toBeGreaterThan(20)

  const rotated = await parse(
    page,
    '<path transform="rotate(90)" d="M0 0L40 0L20 20Z"/>',
  )
  expect(rotated.error).toBeNull()
  expect(rotated.result!.aspectRatio).toBe(0.5)
  expect(rotated.result!.paths[0].contours[0]).toEqual([
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0],
  ])

  const ring = await parse(
    page,
    '<g style="fill-rule:evenodd"><path d="M0 0H40V20H0Z M10 5H30V15H10Z"/></g>',
  )
  expect(ring.error).toBeNull()
  expect(ring.result!.paths[0].fillRule).toBe('evenodd')
  expect(ring.result!.paths[0].contours).toHaveLength(2)

  const arc = await parse(page, '<path d="M0 0A10 10 0 0 1 20 0L0 0Z"/>')
  expect(arc.error).toBeNull()
  expect(arc.result!.paths[0].contours[0].length).toBeGreaterThan(16)
  const compactArc = await parse(page, '<path d="M0 0A10 10 0 0120 0L0 0Z"/>')
  expect(compactArc.error).toBeNull()
  expect(compactArc.result).toEqual(arc.result)
  const spacedTransforms = await parse(
    page,
    '<circle r="10" transform="translate(10 0),scale (2 1)"/>',
  )
  expect(spacedTransforms.error).toBeNull()
  expect(spacedTransforms.result!.aspectRatio).toBe(2)
})

test('ignores invisible shapes, closes filled open paths and handles repeated first points', async ({
  page,
}) => {
  const visible = await parse(
    page,
    '<rect width="40" height="20"/><g display="none"><rect width="900" height="900"/></g><g opacity="0"><rect width="800" height="800"/></g><rect width="600" height="600" fill="rgba(0,0,0,0)"/><circle visibility="hidden" r="999"/><rect width="700" height="700" fill-opacity="0"/>',
  )
  expect(visible.error).toBeNull()
  expect(visible.result!.aspectRatio).toBe(2)
  expect(visible.result!.paths).toHaveLength(1)
  const repeated = await parse(page, '<path d="M0 0L0 0L40 0L20 20L0 0L0 0Z"/>')
  expect(repeated.error).toBeNull()
  expect(repeated.result!.paths[0].contours[0]).toEqual([
    [-0.5, -0.5],
    [0.5, -0.5],
    [0, 0.5],
  ])
  const open = await parse(page, '<path d="M0 0L40 0L20 20"/>')
  expect(open.result).toEqual(repeated.result)
})

test('rejects malformed geometry and unsupported artwork with actionable errors', async ({
  page,
}) => {
  const cases = [
    ['<svg><path', /valid SVG/i],
    ['<path d="M0 0L10"/>', /invalid path/i],
    ['<path d="M0 0X20 10Z"/>', /invalid path/i],
    [
      '<path d="M0 0Q10 20 20 0S30 20 40 0L40 30L0 30Z"/>',
      /expand mixed SVG smooth curves/i,
    ],
    [
      '<path d="M0 0C10 20 15 20 20 0T40 0L40 30L0 30Z"/>',
      /expand mixed SVG smooth curves/i,
    ],
    [
      '<path d="M0 0Q10 20 20 0ZS30 20 40 0L40 30L0 30Z"/>',
      /expand mixed SVG smooth curves/i,
    ],
    ['<rect width="-10" height="20"/>', /invalid dimensions/i],
    ['<circle r="1e999"/>', /invalid dimensions/i],
    [
      '<path fill="none" stroke="black" d="M0 0L20 20"/>',
      /strokes to filled paths/i,
    ],
    ['<text>Hello</text>', /text to filled paths/i],
    ['<use href="#thing"/>', /use elements.*filled paths/i],
    ['<path clip-path="url(#clip)" d="M0 0H20V20Z"/>', /clips.*filled paths/i],
    [
      '<style>.shape{fill:red}</style><rect width="20" height="10"/>',
      /inline styles/i,
    ],
    [
      '<rect width="20" height="10" transform="something(2)"/>',
      /unsupported transform/i,
    ],
    ['<path fill="none" d="M0 0L20 20"/>', /no visible filled shapes/i],
  ] as const
  for (const [source, message] of cases) {
    const parsed = await parse(page, source)
    expect(parsed.result, source).toBeNull()
    expect(parsed.error, source).toMatch(message)
  }
  expect(
    (await parse(page, '<rect width="20" height="10"/>'.repeat(129))).error,
  ).toMatch(/too complex/i)
  expect((await parse(page, ' '.repeat(256 * 1024))).error).toMatch(
    /smaller than 256 KB/i,
  )
})

test('keeps SVG markup inert and never requests referenced resources', async ({
  page,
}) => {
  const requested: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('svg-cutout-probe.invalid'))
      requested.push(request.url())
  })
  const script = await parse(
    page,
    '<script>window.svgCutoutExecuted=true;fetch("https://svg-cutout-probe.invalid/script")</script><rect width="20" height="10"/>',
  )
  expect(script.error).toMatch(/script elements.*filled paths/i)
  const image = await parse(
    page,
    '<image href="https://svg-cutout-probe.invalid/image" width="10" height="10"/>',
  )
  expect(image.error).toMatch(/image elements.*filled paths/i)
  const handler = await parse(
    page,
    '<svg xmlns="http://www.w3.org/2000/svg" onload="window.svgCutoutExecuted=true;fetch(\'https://svg-cutout-probe.invalid/event\')"><rect width="20" height="10"/></svg>',
  )
  expect(handler.error).toBeNull()
  expect(handler.result!.paths).toHaveLength(1)
  expect(
    await page.evaluate(
      () =>
        (window as Window & { svgCutoutExecuted?: boolean }).svgCutoutExecuted,
    ),
  ).toBeUndefined()
  expect(requested).toEqual([])
})
