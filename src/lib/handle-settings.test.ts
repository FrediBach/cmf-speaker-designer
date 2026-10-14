import { describe, expect, it } from 'vitest'
import {
  getDefaultHandleSettings,
  getHandleHoleCenters,
  getHandleLimits,
  getHandleStudCenters,
  getHandleSvgPaths,
  HANDLE_SHOULDER_HEIGHT,
  HANDLE_STUD_DIAMETER,
  HANDLE_STUD_PITCH,
  normalizeHandleSettings,
  type HandleSettings,
} from './handle-settings'
import type { SvgCutout } from './svg-cutout'
import { getRaceStripeIntervals } from './race-stripe-settings'

const svgTriangle: SvgCutout = {
  name: 'triangle.svg',
  aspectRatio: 1.5,
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
}

function outerDistance(x: number, y: number, handle: HandleSettings) {
  const qx = Math.abs(x) - handle.width / 2 + handle.cornerRadius
  const qy =
    Math.abs(y - handle.height / 2) - handle.height / 2 + handle.cornerRadius
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    handle.cornerRadius
  )
}

describe('printable custom handle settings', () => {
  it('keeps complete stud footprints clear of one to three recessed race stripes', () => {
    for (const model of ['s', 'm'] as const) {
      const handle = normalizeHandleSettings(model, {
        mode: 'custom',
        legoStuds: true,
        height: 48,
        width: 96,
        cutout: 'none',
      })
      const original = getHandleStudCenters(model, handle)
      for (const count of [1, 2, 3]) {
        const stripes = { enabled: true, count, width: 8, gap: 6 }
        const intervals = getRaceStripeIntervals(stripes)
        const studs = getHandleStudCenters(model, handle, stripes)
        expect(studs.length).toBeGreaterThan(0)
        expect(studs.length).toBeLessThan(original.length)
        for (const stud of studs)
          for (const { minX, maxX } of intervals)
            expect(
              stud.x + HANDLE_STUD_DIAMETER / 2 <= minX - 0.249 ||
                stud.x - HANDLE_STUD_DIAMETER / 2 >= maxX + 0.249,
            ).toBe(true)
        expect(
          getHandleStudCenters(model, handle, { ...stripes, enabled: false }),
        ).toEqual(original)
      }
    }
  })

  it('keeps original handles by default and does not mutate input settings', () => {
    expect(getDefaultHandleSettings('s').height).toBe(24)
    expect(getDefaultHandleSettings('m').height).toBe(27)
    expect(normalizeHandleSettings('s').mode).toBe('original')
    const requested = Object.freeze({
      mode: 'custom' as const,
      height: 100,
      offsetX: 100,
    })
    const normalized = normalizeHandleSettings('s', requested)
    expect(normalized.height).toBe(70)
    expect(requested).toEqual({ mode: 'custom', height: 100, offsetX: 100 })
    expect(normalizeHandleSettings('s', normalized)).toEqual(normalized)
  })

  it('rejects non-finite and invalid values arriving from saved or shared JSON', () => {
    const invalid = {
      mode: 'unknown',
      cutout: 'triangle',
      height: Number.NaN,
      width: Infinity,
      cornerRadius: -Infinity,
      holeCount: Number.NaN,
      holeWidth: '64',
      holeHeight: null,
      holeGap: {},
      offsetX: Infinity,
      offsetY: Number.NaN,
    } as unknown as Partial<HandleSettings>
    expect(normalizeHandleSettings('s', invalid)).toEqual(
      normalizeHandleSettings('s'),
    )
    expect(normalizeHandleSettings('m', invalid)).toEqual(
      normalizeHandleSettings('m'),
    )
  })

  it('only enables studs for an explicit saved boolean and a custom handle', () => {
    for (const model of ['s', 'm'] as const) {
      expect(getDefaultHandleSettings(model).legoStuds).toBe(false)
      for (const value of [undefined, null, false, 'true', 1, {}, []]) {
        const settings = normalizeHandleSettings(model, {
          mode: 'custom',
          legoStuds: value as boolean,
        })
        expect(settings.legoStuds).toBe(false)
        expect(getHandleStudCenters(model, settings)).toEqual([])
      }
      const settings = normalizeHandleSettings(model, {
        mode: 'custom',
        legoStuds: true,
      })
      expect(settings.legoStuds).toBe(true)
      expect(getHandleStudCenters(model, settings).length).toBeGreaterThan(0)
      expect(
        normalizeHandleSettings(model, JSON.parse(JSON.stringify(settings))),
      ).toEqual(settings)
      expect(
        getHandleStudCenters(model, { ...settings, mode: 'original' }),
      ).toEqual([])
      expect(getHandleLimits(model, settings)).not.toHaveProperty('legoStuds')
    }
  })

  it.each(['s', 'm'] as const)(
    'supports every stud footprint on an 8 mm grid across constrained %s handles',
    (model) => {
      const radius = HANDLE_STUD_DIAMETER / 2
      const violations: string[] = []
      for (const height of [16, 24, 70]) {
        for (const width of [60, 85, 110]) {
          for (const cornerRadius of [0, 16]) {
            for (const cutout of ['none', 'circle', 'slot', 'svg'] as const) {
              for (const direction of [-1, 0, 1]) {
                const settings = normalizeHandleSettings(model, {
                  mode: 'custom',
                  legoStuds: true,
                  height,
                  width,
                  cornerRadius,
                  cutout,
                  svgCutout: svgTriangle,
                  holeCount: 3,
                  holeWidth: 64,
                  holeHeight: 30,
                  holeGap: 20,
                  offsetX: direction * 30,
                  offsetY: direction * 24,
                })
                const centers = getHandleStudCenters(model, settings)
                const holes = getHandleHoleCenters(model, settings)
                for (const center of centers) {
                  const detail = JSON.stringify({ settings, center })
                  for (const axis of ['x', 'y'] as const) {
                    const interval =
                      (center[axis] - centers[0][axis]) / HANDLE_STUD_PITCH
                    if (Math.abs(interval - Math.round(interval)) > 1e-8)
                      violations.push(`Stud off ${axis} grid: ${detail}`)
                  }
                  for (let step = 0; step < 32; step += 1) {
                    const angle = (step * Math.PI) / 16
                    const x = center.x + Math.cos(angle) * radius
                    const y = center.y + Math.sin(angle) * radius
                    if (y <= HANDLE_SHOULDER_HEIGHT)
                      violations.push(`Stud enters shoulder: ${detail}`)
                    // Only the top corners are rounded on the actual outline.
                    if (
                      outerDistance(
                        x,
                        Math.max(y, settings.height / 2),
                        settings,
                      ) >= 0
                    )
                      violations.push(`Stud crosses outline: ${detail}`)
                    for (const hole of holes) {
                      const dx = Math.max(
                        Math.abs(x - hole.x) - (hole.width - hole.height) / 2,
                        0,
                      )
                      if (Math.hypot(dx, y - hole.y) <= hole.height / 2)
                        violations.push(`Stud covers opening: ${detail}`)
                    }
                    if (cutout === 'svg') {
                      const dx =
                        Math.abs(x - settings.offsetX) - settings.holeWidth / 2
                      const dy =
                        Math.abs(
                          y -
                            (settings.height + HANDLE_SHOULDER_HEIGHT) / 2 -
                            settings.offsetY,
                        ) -
                        settings.holeHeight / 2
                      if (Math.max(dx, dy) <= 0)
                        violations.push(`Stud covers SVG bounds: ${detail}`)
                    }
                  }
                }
              }
            }
          }
        }
      }
      expect(violations).toEqual([])
    },
  )

  it('uses the material outside rounded openings instead of excluding their whole bounding boxes', () => {
    const settings = normalizeHandleSettings('s', {
      mode: 'custom',
      legoStuds: true,
      height: 48,
      cutout: 'circle',
      holeWidth: 30,
    })
    const [hole] = getHandleHoleCenters('s', settings)
    const inflatedHalf = hole.width / 2 + HANDLE_STUD_DIAMETER / 2
    expect(
      getHandleStudCenters('s', settings).some(
        ({ x, y }) =>
          Math.abs(x - hole.x) < inflatedHalf &&
          Math.abs(y - hole.y) < inflatedHalf,
      ),
    ).toBe(true)
    const noSvg = { ...settings, cutout: 'svg' as const, svgCutout: null }
    expect(getHandleStudCenters('s', noSvg)).toEqual(
      getHandleStudCenters('s', { ...noSvg, cutout: 'none' }),
    )
  })

  it('keeps SVG paths and their orientation through a saved JSON round trip', () => {
    const settings = normalizeHandleSettings('s', {
      mode: 'custom',
      height: 48,
      cutout: 'svg',
      svgCutout: svgTriangle,
      holeWidth: 30,
      holeHeight: 6,
      holeCount: 3,
      offsetX: 2,
      offsetY: 3,
    })
    expect(settings.holeCount).toBe(1)
    expect(settings.holeHeight).toBe(20)
    expect(getHandleHoleCenters('s', settings)).toEqual([])
    expect(getHandleSvgPaths('s', settings)).toEqual([
      {
        fillRule: 'nonzero',
        contours: [
          [
            [-13, 19],
            [17, 19],
            [2, 39],
          ],
        ],
      },
    ])
    expect(normalizeHandleSettings('s', settings)).toEqual(settings)
    expect(svgTriangle.paths[0].contours[0][0]).toEqual([-0.5, 0.5])
  })

  it('ignores missing or invalid saved SVG data while retaining the selected variant', () => {
    for (const svgCutout of [
      undefined,
      null,
      {},
      { ...svgTriangle, aspectRatio: Infinity },
      {
        ...svgTriangle,
        paths: [{ contours: [[[NaN, 0]]], fillRule: 'nonzero' }],
      },
    ]) {
      const settings = normalizeHandleSettings('m', {
        cutout: 'svg',
        svgCutout: svgCutout as SvgCutout,
      })
      expect(settings.cutout).toBe('svg')
      expect(settings.svgCutout).toBeNull()
      expect(getHandleSvgPaths('m', settings)).toEqual([])
      expect(getHandleHoleCenters('m', settings)).toEqual([])
    }
  })

  it.each(['s', 'm'] as const)(
    'fits tall and wide SVGs into %s handles with a three millimeter outer wall',
    (model) => {
      for (const aspectRatio of [0.05, 0.2, 1, 5, 20]) {
        for (const height of [16, 24, 70]) {
          for (const width of [60, 110]) {
            for (const direction of [-1, 1]) {
              const settings = normalizeHandleSettings(model, {
                mode: 'custom',
                height,
                width,
                cornerRadius: 16,
                cutout: 'svg',
                svgCutout: { ...svgTriangle, aspectRatio },
                holeWidth: 64,
                offsetX: 30 * direction,
                offsetY: 24 * direction,
              })
              expect(settings.holeWidth / settings.holeHeight).toBeCloseTo(
                aspectRatio,
                8,
              )
              expect(settings.holeCount).toBe(1)
              const centerY = settings.height / 2 + 2 + settings.offsetY
              for (const x of [-0.5, 0.5]) {
                for (const y of [-0.5, 0.5]) {
                  const px = settings.offsetX + x * settings.holeWidth
                  const py = centerY + y * settings.holeHeight
                  expect(outerDistance(px, py, settings)).toBeLessThanOrEqual(
                    -3 + 1e-6,
                  )
                  expect(py).toBeGreaterThanOrEqual(7 - 1e-6)
                }
              }
              for (const [key, limit] of Object.entries(
                getHandleLimits(model, settings),
              )) {
                const value = settings[key as keyof HandleSettings] as number
                expect(
                  Number.isFinite(limit.min) && Number.isFinite(limit.max),
                ).toBe(true)
                expect(limit.min).toBeLessThanOrEqual(limit.max)
                expect(value).toBeGreaterThanOrEqual(limit.min - 1e-6)
                expect(value).toBeLessThanOrEqual(limit.max + 1e-6)
              }
              expect(normalizeHandleSettings(model, settings)).toEqual(settings)
            }
          }
        }
      }
    },
  )

  it('retains circular holes and at least three millimeters of material under extreme edits', () => {
    const violations: string[] = []
    let cases = 0
    for (const model of ['s', 'm'] as const) {
      for (const height of [16, 24, 70]) {
        for (const width of [60, 85, 110]) {
          for (const cornerRadius of [0, 3, 16]) {
            for (const cutout of ['circle', 'slot'] as const) {
              for (const holeCount of [1, 2, 3]) {
                for (const [offsetX, offsetY] of [
                  [-30, -24],
                  [0, 0],
                  [30, 24],
                ]) {
                  const handle = normalizeHandleSettings(model, {
                    mode: 'custom',
                    height,
                    width,
                    cornerRadius,
                    cutout,
                    holeCount,
                    holeWidth: 64,
                    holeHeight: 30,
                    holeGap: 20,
                    offsetX,
                    offsetY,
                  })
                  const detail = JSON.stringify(handle)
                  cases += 1
                  if (
                    handle.cutout === 'circle' &&
                    handle.holeWidth !== handle.holeHeight
                  )
                    violations.push(`Non-circular opening: ${detail}`)
                  if (
                    handle.holeWidth < 6 ||
                    handle.holeHeight < 6 ||
                    handle.holeGap < 3
                  )
                    violations.push(`Insufficient hole size or web: ${detail}`)
                  if (handle.holeHeight > handle.holeWidth)
                    violations.push(`Invalid capsule dimensions: ${detail}`)
                  const span =
                    handle.holeCount * handle.holeWidth +
                    (handle.holeCount - 1) * handle.holeGap
                  const centerY = handle.height / 2 + 2 + handle.offsetY
                  for (let hole = 0; hole < handle.holeCount; hole += 1) {
                    const centerX =
                      -span / 2 +
                      handle.holeWidth / 2 +
                      hole * (handle.holeWidth + handle.holeGap) +
                      handle.offsetX
                    for (let sample = 0; sample < 64; sample += 1) {
                      const angle = (2 * Math.PI * sample) / 64
                      const direction = Math.cos(angle)
                      const radius = handle.holeHeight / 2
                      const x =
                        centerX +
                        (Math.sign(direction) *
                          (handle.holeWidth - handle.holeHeight)) /
                          2 +
                        radius * direction
                      const y = centerY + radius * Math.sin(angle)
                      if (outerDistance(x, y, handle) > -3 + 1e-6)
                        violations.push(
                          `Opening reaches rounded outer web: ${detail}`,
                        )
                      if (y < 7 - 1e-6)
                        violations.push(
                          `Opening enters attachment shoulder: ${detail}`,
                        )
                    }
                  }
                  const limits = getHandleLimits(model, handle)
                  for (const [key, limit] of Object.entries(limits)) {
                    const value = handle[key as keyof HandleSettings]
                    if (
                      !Number.isFinite(limit.min) ||
                      !Number.isFinite(limit.max) ||
                      limit.min > limit.max
                    )
                      violations.push(`Invalid ${key} control range: ${detail}`)
                    // Circle height is controlled by its diameter; no separate height slider is shown.
                    if (key === 'holeHeight' && handle.cutout === 'circle')
                      continue
                    if (
                      typeof value !== 'number' ||
                      !Number.isFinite(value) ||
                      value < limit.min - 1e-6 ||
                      value > limit.max + 1e-6
                    )
                      violations.push(`Out-of-range ${key}: ${detail}`)
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(cases).toBe(972)
    expect(violations).toEqual([])
  })
})
