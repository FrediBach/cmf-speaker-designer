import { describe, expect, it } from 'vitest'
import { normalizeSvgCutout, type SvgCutout } from './svg-cutout'

const triangle: SvgCutout = {
  name: 'triangle.svg',
  aspectRatio: 1.5,
  paths: [
    {
      fillRule: 'nonzero',
      contours: [
        [
          [-0.5, -0.5],
          [0.5, -0.5],
          [0, 0.5],
        ],
      ],
    },
  ],
}

describe('persisted SVG cutouts', () => {
  it('copies contours, preserves fill rules and normalizes duplicate closing points', () => {
    const input = structuredClone(triangle)
    input.paths[0].contours[0].unshift([-0.5, -0.5])
    input.paths[0].contours[0].push([-0.5, -0.5], [-0.5, -0.5])
    input.paths[0].fillRule = 'evenodd'
    const normalized = normalizeSvgCutout(input)!
    expect(normalized.paths[0].contours[0]).toEqual(
      triangle.paths[0].contours[0],
    )
    expect(normalized.paths[0].fillRule).toBe('evenodd')
    expect(normalizeSvgCutout(normalized)).toEqual(normalized)
    input.paths[0].contours[0][0][0] = 0
    expect(normalized.paths[0].contours[0][0][0]).toBe(-0.5)
  })

  it('rounds compact coordinates once and cleans the display name', () => {
    const input = structuredClone(triangle)
    input.name = '  test\u0000.svg\n'
    input.aspectRatio = 1.567890123
    input.paths[0].contours[0][2][0] = 0.123456789
    const normalized = normalizeSvgCutout(input)!
    expect(normalized.name).toBe('test.svg')
    expect(normalized.aspectRatio).toBe(1.56789)
    expect(normalized.paths[0].contours[0][2][0]).toBe(0.123457)
    expect(normalizeSvgCutout(normalized)).toEqual(normalized)
    input.paths[0].contours[0][2][0] = -0.00000000001
    const nearZero = normalizeSvgCutout(input)!
    expect(nearZero.paths[0].contours[0][2][0]).toBe(0)
  })

  it('rejects corrupt coordinates, degenerate shapes, unknown rules and oversized arrays', () => {
    for (const coordinate of [NaN, Infinity, -Infinity, 0.6, '0.1', null]) {
      const input = structuredClone(triangle)
      input.paths[0].contours[0][0][0] = coordinate as number
      expect(normalizeSvgCutout(input)).toBeNull()
    }
    expect(
      normalizeSvgCutout({ ...triangle, aspectRatio: Infinity }),
    ).toBeNull()
    expect(normalizeSvgCutout({ ...triangle, aspectRatio: 0 })).toBeNull()
    expect(normalizeSvgCutout({ ...triangle, paths: [] })).toBeNull()
    expect(
      normalizeSvgCutout({
        ...triangle,
        paths: [{ fillRule: 'unknown', contours: triangle.paths[0].contours }],
      }),
    ).toBeNull()
    expect(
      normalizeSvgCutout({
        ...triangle,
        paths: [
          {
            fillRule: 'nonzero',
            contours: [
              [
                [-0.5, 0],
                [0, 0],
                [0.5, 0],
              ],
            ],
          },
        ],
      }),
    ).toBeNull()
    expect(
      normalizeSvgCutout({
        ...triangle,
        paths: Array(129).fill(triangle.paths[0]),
      }),
    ).toBeNull()
    expect(
      normalizeSvgCutout({
        ...triangle,
        paths: [
          { fillRule: 'nonzero', contours: [Array(4097).fill([-0.5, 0])] },
        ],
      }),
    ).toBeNull()
    for (const value of [null, undefined, [], {}, 'svg'])
      expect(normalizeSvgCutout(value)).toBeNull()
  })

  it('accepts narrow artwork and self-intersections without confusing signed area with fill', () => {
    expect(
      normalizeSvgCutout({ ...triangle, aspectRatio: 0.001 }),
    ).not.toBeNull()
    expect(
      normalizeSvgCutout({ ...triangle, aspectRatio: 1000 }),
    ).not.toBeNull()
    const bowTie = {
      ...triangle,
      paths: [
        {
          fillRule: 'evenodd',
          contours: [
            [
              [-0.5, -0.5],
              [0.5, 0.5],
              [-0.5, 0.5],
              [0.5, -0.5],
            ],
          ],
        },
      ],
    }
    expect(normalizeSvgCutout(bowTie)).not.toBeNull()
  })
})
