import { describe, expect, it } from 'vitest'
import {
  getDefaultMulticolorSettings,
  polygonSignedArea,
  type PatternElement,
} from './multicolor-settings'
import {
  CIRCLE_CHORD_ERROR_MM,
  createPatternElement,
  fitMulticolorArtwork,
  generateStripes,
  getElementContours,
} from './multicolor-patterns'

describe('multicolor primitive geometry', () => {
  it('rotates and translates a rectangle in physical XY coordinates', () => {
    const element: PatternElement = {
      ...createPatternElement('stripe', getDefaultMulticolorSettings().frame),
      kind: 'stripe',
      width: 4,
      height: 10,
      x: 7,
      y: 8,
      rotation: 90,
    }
    const points = getElementContours(element)[0]
    expect(points[0][0]).toBeCloseTo(12)
    expect(points[0][1]).toBeCloseTo(6)
    expect(polygonSignedArea(points)).toBeCloseTo(40)
    expect(Math.min(...points.map(([x]) => x))).toBeCloseTo(2)
    expect(Math.max(...points.map(([, y]) => y))).toBeCloseTo(10)
  })

  it('keeps circular rings true circles, with clockwise holes and bounded chord error', () => {
    const element: PatternElement = {
      ...createPatternElement('circle', getDefaultMulticolorSettings().frame),
      kind: 'circle',
      radius: 17,
      innerRadius: 9,
      x: 3,
      y: -8,
      rotation: 17,
    }
    const [outside, inside] = getElementContours(element)
    expect(polygonSignedArea(outside)).toBeGreaterThan(0)
    expect(polygonSignedArea(inside)).toBeLessThan(0)
    for (const [x, y] of outside)
      expect(Math.hypot(x - 3, y + 8)).toBeCloseTo(17, 10)
    const [a, b] = outside
    const chordMidpointRadius = Math.hypot(
      (a[0] + b[0]) / 2 - 3,
      (a[1] + b[1]) / 2 + 8,
    )
    expect(17 - chordMidpointRadius).toBeLessThanOrEqual(CIRCLE_CHORD_ERROR_MM)
  })

  it('builds an unequal cross with independent arm extents and shared center', () => {
    const element: PatternElement = {
      ...createPatternElement('cross', getDefaultMulticolorSettings().frame),
      kind: 'cross',
      x: 0,
      y: 0,
      left: 10,
      right: 20,
      top: 15,
      bottom: 5,
      horizontalThickness: 4,
      verticalThickness: 6,
    }
    const points = getElementContours(element)[0]
    expect(polygonSignedArea(points)).toBe(30 * 4 + 20 * 6 - 4 * 6)
    expect(Math.min(...points.map(([x]) => x))).toBe(-10)
    expect(Math.max(...points.map(([x]) => x))).toBe(20)
    expect(Math.max(...points.map(([, y]) => y))).toBe(15)
  })
})

describe('stripe generator and explicit fit', () => {
  it('generates weighted stripes and gaps without modifying the existing document', () => {
    const initial = getDefaultMulticolorSettings()
    initial.frame = { centerX: 4, centerY: 5, width: 100, height: 60 }
    const result = generateStripes(initial, {
      count: 3,
      angle: 0,
      gap: 2,
      weights: [1, 2, 1],
      colors: ['#ff0000', '#ffffff'],
    })
    expect(initial.elements).toHaveLength(0)
    expect(result.materials).toHaveLength(2)
    expect(result.groups).toHaveLength(1)
    const stripes = result.elements.filter(
      (element) => element.kind === 'stripe',
    )
    expect(stripes.map((element) => element.width)).toEqual([24, 48, 24])
    expect(stripes.map((element) => element.x)).toEqual([-34, 4, 42])
    expect(stripes.map((element) => element.height)).toEqual([60, 60, 60])
    expect(stripes[0].materialId).toBe(stripes[2].materialId)
  })

  it('supports one stripe, horizontal order, and more than six independent bands', () => {
    const initial = getDefaultMulticolorSettings()
    expect(
      generateStripes(initial, { count: 1, angle: 0, gap: 100 }).elements,
    ).toHaveLength(1)
    const result = generateStripes(initial, { count: 10, angle: 270, gap: 0 })
    expect(result.elements).toHaveLength(10)
    expect(result.elements[0].y).toBeGreaterThan(result.elements[9].y)
  })

  it('rejects invalid counts, impossible gaps and incomplete weights atomically', () => {
    const initial = getDefaultMulticolorSettings()
    expect(() =>
      generateStripes(initial, { count: 0, angle: 0, gap: 0 }),
    ).toThrow()
    expect(() =>
      generateStripes(initial, { count: 3, angle: 0, gap: 50 }),
    ).toThrow(/no room/)
    expect(() =>
      generateStripes(initial, { count: 3, angle: 0, gap: 0, weights: [1, 2] }),
    ).toThrow(/one positive weight/)
    expect(initial).toEqual(getDefaultMulticolorSettings())
  })

  it('fits uniformly and scales radius, translation and generator spacing together', () => {
    let initial = getDefaultMulticolorSettings()
    initial.frame = { centerX: 0, centerY: 0, width: 100, height: 50 }
    initial = generateStripes(initial, { count: 2, angle: 0, gap: 4 })
    initial.elements.push({
      ...createPatternElement('circle', initial.frame),
      kind: 'circle',
      x: 10,
      y: 5,
      radius: 8,
      innerRadius: 2,
    })
    const result = fitMulticolorArtwork(initial, {
      centerX: 5,
      centerY: 10,
      width: 200,
      height: 200,
    })
    const circle = result.elements.at(-1)
    expect(circle).toMatchObject({
      kind: 'circle',
      x: 25,
      y: 20,
      radius: 16,
      innerRadius: 4,
    })
    expect(result.frame).toEqual({
      centerX: 5,
      centerY: 10,
      width: 200,
      height: 100,
    })
    expect(result.groups[0].generator?.gap).toBe(8)
  })
})
