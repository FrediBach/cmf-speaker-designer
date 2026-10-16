import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importSvgShape } from './multicolor-vector'
import { parseSvgCutout } from './svg-cutout-parser'
import { polygonSignedArea, type PatternPoint } from './multicolor-settings'

// The browser suite exercises real SVG parsing. These cases isolate the
// clipping kernel's conversion of per-path SVG fills to canonical outlines.
vi.mock('./svg-cutout-parser', () => ({ parseSvgCutout: vi.fn() }))
const parse = vi.mocked(parseSvgCutout)
const frame = { centerX: 0, centerY: 0, width: 100, height: 150 }
const square: PatternPoint[] = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
]
const inner: PatternPoint[] = square.map(([x, y]) => [x * 0.5, y * 0.5])
beforeEach(() => {
  parse.mockReset()
})

describe('imported SVG outlines', () => {
  it('preserves evenodd holes and returns normalized winding and fitting dimensions', async () => {
    parse.mockReturnValue({
      name: 'ring.svg',
      aspectRatio: 2,
      paths: [{ fillRule: 'evenodd', contours: [square, inner] }],
    })
    const result = await importSvgShape('<svg/>', 'ring.svg', frame)
    expect(result.sourceName).toBe('ring.svg')
    expect(result.width).toBeCloseTo(60)
    expect(result.height).toBeCloseTo(30)
    expect(result.contours).toHaveLength(2)
    expect(result.contours.map(polygonSignedArea).sort()).toEqual([-0.25, 1])
  })

  it('fills nested contours with the same nonzero winding', async () => {
    parse.mockReturnValue({
      name: 'solid.svg',
      aspectRatio: 1,
      paths: [{ fillRule: 'nonzero', contours: [square, inner] }],
    })
    const result = await importSvgShape('<svg/>', 'solid.svg', frame)
    expect(result.contours).toHaveLength(1)
    expect(polygonSignedArea(result.contours[0])).toBeCloseTo(1)
  })

  it('unites independent overlapping fills even when they have opposite source winding', async () => {
    const left: PatternPoint[] = [
      [-0.5, -0.5],
      [0.25, -0.5],
      [0.25, 0.5],
      [-0.5, 0.5],
    ]
    const right: PatternPoint[] = [
      [-0.25, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.25, 0.5],
    ].reverse() as PatternPoint[]
    parse.mockReturnValue({
      name: 'overlap.svg',
      aspectRatio: 1,
      paths: [
        { fillRule: 'nonzero', contours: [left] },
        { fillRule: 'nonzero', contours: [right] },
      ],
    })
    const result = await importSvgShape('<svg/>', 'overlap.svg', frame)
    expect(result.contours).toHaveLength(1)
    expect(polygonSignedArea(result.contours[0])).toBeCloseTo(1)
  })

  it('turns SVG downward Y into the artwork upward Y coordinate system', async () => {
    parse.mockReturnValue({
      name: 'triangle.svg',
      aspectRatio: 1,
      paths: [
        {
          fillRule: 'nonzero',
          contours: [
            [
              [-0.5, 0.5],
              [0.5, 0.5],
              [0, -0.5],
            ],
          ],
        },
      ],
    })
    const result = await importSvgShape('<svg/>', 'triangle.svg', frame)
    expect(result.contours[0]).toContainEqual([0, 0.5])
    expect(result.contours[0]).toContainEqual([-0.5, -0.5])
    expect(result.contours[0]).toContainEqual([0.5, -0.5])
    expect(polygonSignedArea(result.contours[0])).toBeGreaterThan(0)
  })

  it('rejects empty filled geometry and forwards parser errors unchanged', async () => {
    parse.mockReturnValue({
      name: 'empty.svg',
      aspectRatio: 1,
      paths: [{ fillRule: 'evenodd', contours: [square, square] }],
    })
    await expect(importSvgShape('<svg/>', 'empty.svg', frame)).rejects.toThrow(
      /no visible filled area/,
    )
    parse.mockImplementation(() => {
      throw new Error('Convert SVG strokes to filled paths before uploading.')
    })
    await expect(importSvgShape('<svg/>', 'stroke.svg', frame)).rejects.toThrow(
      /Convert SVG strokes/,
    )
  })
})
