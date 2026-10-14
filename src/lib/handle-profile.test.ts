import { describe, expect, it } from 'vitest'
import {
  getHandleHoleCenters,
  getHandleLimits,
  getHandleOutline,
  getHandleSlits,
  getHandleStudCenters,
  getHandleSvgPaths,
  getHandleTopY,
  HANDLE_MIN_WEB,
  HANDLE_SHOULDER_HEIGHT,
  normalizeHandleSettings,
  type HandleSettings,
} from './handle-settings'
import type { SvgCutout } from './svg-cutout'

const threeSquares: SvgCutout = {
  name: 'squares.svg',
  aspectRatio: 4,
  paths: [-0.4, 0, 0.4].map((x) => ({
    fillRule: 'nonzero',
    contours: [
      [
        [x - 0.1, -0.1],
        [x + 0.1, -0.1],
        [x + 0.1, 0.1],
        [x - 0.1, 0.1],
      ],
    ],
  })),
}

const sloped: Partial<HandleSettings> = {
  mode: 'custom',
  height: 40,
  width: 96,
  cornerRadius: 3,
  topAngle: 30,
  cutout: 'circle',
  holeCount: 3,
  holeWidth: 14,
  holeGap: 10,
}

describe('shaped handle top and individually supported details', () => {
  it('keeps saved flat handles flat and recovers invalid profile data', () => {
    const legacy = normalizeHandleSettings('s', { mode: 'custom' })
    expect(legacy).toMatchObject({
      topAngle: 0,
      topShape: 'straight',
      topCurve: 10,
    })
    expect(getHandleOutline('s', legacy)).toEqual(
      getHandleOutline('s', { ...legacy, topCurve: 0 }),
    )
    expect(
      normalizeHandleSettings('s', {
        topAngle: Number.NaN,
        topShape: 'invalid',
        topCurve: Number.POSITIVE_INFINITY,
      } as unknown as Partial<HandleSettings>),
    ).toEqual(normalizeHandleSettings('s'))
  })

  it('bows outwards or inwards while keeping height at the highest outer point', () => {
    for (const topShape of ['straight', 'outward', 'inward'] as const) {
      const settings = normalizeHandleSettings('m', {
        height: 48,
        width: 96,
        cornerRadius: 5,
        topShape,
        topCurve: 12,
      })
      const topCenter = getHandleTopY('m', settings, 0)
      const topSide = getHandleTopY('m', settings, 38)
      const highest = Math.max(
        ...getHandleOutline('m', settings).map(([, y]) => y),
      )
      expect(highest).toBeCloseTo(48, 8)
      if (topShape === 'outward') expect(topCenter).toBeGreaterThan(topSide)
      else if (topShape === 'inward') expect(topCenter).toBeLessThan(topSide)
      else expect(topCenter).toBe(topSide)
    }
    const tilt = { height: 48, width: 96, topAngle: 12 }
    expect(getHandleTopY('s', tilt, 30)).toBeGreaterThan(
      getHandleTopY('s', tilt, -30),
    )
    expect(getHandleTopY('s', { ...tilt, topAngle: -12 }, 30)).toBeCloseTo(
      getHandleTopY('s', tilt, -30),
      8,
    )
  })

  it('keeps the profile and ranges finite and normalization stable at extreme edits', () => {
    for (const model of ['s', 'm'] as const) {
      for (const height of [16, 24, 70]) {
        for (const width of [60, 110]) {
          for (const cornerRadius of [0, 16]) {
            for (const topAngle of [-100, -5, 0, 5, 100]) {
              for (const topShape of [
                'straight',
                'outward',
                'inward',
              ] as const) {
                const settings = normalizeHandleSettings(model, {
                  height,
                  width,
                  cornerRadius,
                  topAngle,
                  topShape,
                  topCurve: 100,
                })
                expect(normalizeHandleSettings(model, settings)).toEqual(
                  settings,
                )
                expect(
                  normalizeHandleSettings(
                    model,
                    JSON.parse(JSON.stringify(settings)),
                  ),
                ).toEqual(settings)
                for (const [key, range] of Object.entries(
                  getHandleLimits(model, settings),
                )) {
                  const value = settings[key as keyof HandleSettings] as number
                  expect(
                    Number.isFinite(range.min) && Number.isFinite(range.max),
                  ).toBe(true)
                  expect(value).toBeGreaterThanOrEqual(range.min - 1e-8)
                  expect(value).toBeLessThanOrEqual(range.max + 1e-8)
                }
                const outline = getHandleOutline(model, settings)
                expect(
                  outline.every((point) => point.every(Number.isFinite)),
                ).toBe(true)
                expect(Math.max(...outline.map(([, y]) => y))).toBeCloseTo(
                  height,
                  8,
                )
                // The top is monotone in X, including its corner blends, so
                // extreme slope/curvature cannot create crossing edges.
                const top = outline.slice(4, -2)
                for (let index = 1; index < top.length; index += 1) {
                  expect(top[index][0]).toBeLessThan(top[index - 1][0])
                  expect(top[index][1]).toBeGreaterThanOrEqual(
                    HANDLE_SHOULDER_HEIGHT + HANDLE_MIN_WEB - 1e-8,
                  )
                }
              }
            }
          }
        }
      }
    }
  })

  it('omits the low-side holes separately without moving surviving holes', () => {
    const settings = normalizeHandleSettings('s', sloped)
    const holes = getHandleHoleCenters('s', settings)
    expect(settings.holeCount).toBe(3)
    expect(holes).toHaveLength(1)
    expect(holes[0]).toMatchObject({ x: 24, y: 22, width: 14, height: 14 })
    expect(
      getHandleHoleCenters('s', {
        ...settings,
        topAngle: -settings.topAngle,
      })[0].x,
    ).toBe(-24)
    expect(
      getHandleHoleCenters('s', { ...settings, topAngle: 0 }),
    ).toHaveLength(3)
  })

  it('follows each slit top locally and leaves its bottom above the attachment web', () => {
    const settings = normalizeHandleSettings('s', {
      ...sloped,
      cutout: 'slits',
      holeCount: 5,
      holeWidth: 5,
      holeGap: 9,
      holeHeight: 18,
    })
    const slits = getHandleSlits('s', settings)
    expect(slits.length).toBeGreaterThan(0)
    expect(slits.length).toBeLessThan(settings.holeCount)
    const outline = getHandleOutline('s', settings)
    for (const slit of slits) {
      expect(slit.topY).toBeCloseTo(getHandleTopY('s', settings, slit.x), 8)
      expect(slit.bottomY).toBeCloseTo(slit.topY - settings.holeHeight, 8)
      expect(slit.bottomY).toBeGreaterThanOrEqual(
        HANDLE_SHOULDER_HEIGHT + HANDLE_MIN_WEB,
      )
      expect(slit.leftTopY).toBeLessThan(slit.rightTopY)
      expect(
        outline.some(
          ([x, y]) =>
            Math.abs(x - slit.x) < 1e-8 && Math.abs(y - slit.bottomY) < 1e-8,
        ),
      ).toBe(true)
    }
    expect(getHandleSlits('s', { ...settings, topAngle: 0 })).toHaveLength(5)
  })

  it('omits unsafe SVG paths individually and only reserves the accepted paths for studs', () => {
    const settings = normalizeHandleSettings('s', {
      ...sloped,
      cutout: 'svg',
      svgCutout: threeSquares,
      holeWidth: 64,
      legoStuds: true,
    })
    const paths = getHandleSvgPaths('s', settings)
    expect(paths).toHaveLength(1)
    expect(
      Math.min(...paths[0].contours.flat().map(([x]) => x)),
    ).toBeGreaterThan(0)
    const onlySafe = {
      ...settings,
      svgCutout: { ...threeSquares, paths: [threeSquares.paths[2]] },
    }
    expect(getHandleStudCenters('s', settings)).toEqual(
      getHandleStudCenters('s', onlySafe),
    )
    const allOmitted = {
      ...settings,
      svgCutout: { ...threeSquares, paths: [threeSquares.paths[0]] },
    }
    expect(getHandleSvgPaths('s', allOmitted)).toEqual([])
    expect(getHandleStudCenters('s', allOmitted)).toEqual(
      getHandleStudCenters('s', { ...allOmitted, cutout: 'none' }),
    )
  })
})
