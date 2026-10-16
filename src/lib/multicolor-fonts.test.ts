import { describe, expect, it } from 'vitest'
import { getTextContours, validatePatternText } from './multicolor-fonts'
import {
  PATTERN_FONTS,
  polygonSignedArea,
  type PatternFontWeight,
} from './multicolor-settings'

describe('multicolor text outlines', () => {
  for (const { id, name, weights } of PATTERN_FONTS) {
    it.each(weights)(
      `preserves holes and centers ${name} %i text`,
      (weight) => {
        const contours = getTextContours('B O', id, 12, weight)
        expect(
          contours.filter((points) => polygonSignedArea(points) > 0),
        ).toHaveLength(2)
        expect(
          contours.filter((points) => polygonSignedArea(points) < 0),
        ).toHaveLength(3)
        const x = contours.flat().map((point) => point[0])
        const y = contours.flat().map((point) => point[1])
        expect([...x, ...y].every(Number.isFinite)).toBe(true)
        expect(Math.min(...x) + Math.max(...x)).toBeCloseTo(0)
        expect(Math.min(...y) + Math.max(...y)).toBeCloseTo(0)
        expect(
          contours.every(
            (points) =>
              points.length > 2 &&
              points[0].some((value, index) => value !== points.at(-1)![index]),
          ),
        ).toBe(true)
      },
    )
  }

  it('offers at least twelve distinct font families with explicit supported weights', () => {
    expect(PATTERN_FONTS.length).toBeGreaterThanOrEqual(12)
    expect(new Set(PATTERN_FONTS.map(({ id }) => id)).size).toBe(
      PATTERN_FONTS.length,
    )
    for (const { category, weights } of PATTERN_FONTS) {
      expect(category).toBeTruthy()
      expect(weights).toContain(400)
    }
    expect(
      PATTERN_FONTS.find(({ id }) => id === 'droid-sans-mono')?.weights,
    ).toEqual([400])
  })

  it('scales in physical units and protects cached outlines from callers', () => {
    const small = getTextContours('CMF', 'helvetiker', 10)
    const large = getTextContours('CMF', 'helvetiker', 20)
    expect(large).toEqual(
      small.map((points) => points.map(([x, y]) => [x * 2, y * 2])),
    )
    const reference = structuredClone(small)
    small[0][0][0] = 1000
    expect(getTextContours('CMF', 'helvetiker', 10)).toEqual(reference)
  })

  it.each(['helvetiker', 'optimer', 'droid-sans-mono'] as const)(
    'keeps the default %s outlines identical to its explicit regular face',
    (fontId) => {
      expect(getTextContours('Speaker', fontId, 10)).toEqual(
        getTextContours('Speaker', fontId, 10, 400),
      )
    },
  )

  it('produces distinct geometry for the selected fonts', () => {
    const outlines = PATTERN_FONTS.map(({ id }) =>
      JSON.stringify(getTextContours('Speaker', id, 10)),
    )
    expect(new Set(outlines).size).toBe(PATTERN_FONTS.length)
  })

  it('uses real, distinct outlines for every available weight of each family', () => {
    for (const { id, weights } of PATTERN_FONTS) {
      const outlines = weights.map((weight) =>
        JSON.stringify(getTextContours('Speaker', id, 10, weight)),
      )
      expect(new Set(outlines).size, id).toBe(weights.length)
    }
    const regular = getTextContours('BO', 'inter', 12, 400)
    const bold = getTextContours('BO', 'inter', 12, 700)
    const area = (contours: typeof regular) =>
      contours.reduce((total, points) => total + polygonSignedArea(points), 0)
    expect(area(bold)).toBeGreaterThan(area(regular))
  })

  it('keeps separate cached weight outlines and scales the selected face', () => {
    const regular = getTextContours('Cache', 'inter', 10)
    const bold = getTextContours('Cache', 'inter', 10, 700)
    expect(bold).not.toEqual(regular)
    expect(getTextContours('Cache', 'inter', 20, 700)).toEqual(
      bold.map((points) => points.map(([x, y]) => [x * 2, y * 2])),
    )
    bold[0][0][0] = 1000
    expect(getTextContours('Cache', 'inter', 10, 400)).toEqual(regular)
    expect(getTextContours('Cache', 'inter', 10, 700)[0][0][0]).not.toBe(1000)
  })

  it('rejects unsupported glyphs before FontLoader can silently substitute question marks', () => {
    expect(() => validatePatternText('Speaker 😀', 'helvetiker')).toThrow(
      /does not include.*U\+1F600/,
    )
    expect(() =>
      validatePatternText('Hello', 'unknown' as 'helvetiker'),
    ).toThrow(/supported text font/)
    expect(() => validatePatternText('   ', 'helvetiker')).toThrow(
      /visible character/,
    )
    expect(() => validatePatternText('x'.repeat(121), 'helvetiker')).toThrow(
      /120/,
    )
    expect(() => getTextContours('CMF', 'helvetiker', 0)).toThrow(/Font size/)
  })

  it('rejects unsupported weights instead of silently substituting regular outlines', () => {
    for (const weight of [300, 700, 450, NaN] as PatternFontWeight[]) {
      expect(() =>
        validatePatternText('CMF', 'droid-sans-mono', weight),
      ).toThrow(/weight/i)
      expect(() =>
        getTextContours('CMF', 'droid-sans-mono', 12, weight),
      ).toThrow(/weight/i)
    }
  })

  it('supports line breaks and rejects text beyond its outline budget', () => {
    expect(() =>
      validatePatternText('CMF\nSpeaker', 'helvetiker'),
    ).not.toThrow()
    expect(
      getTextContours('CMF\nSpeaker', 'helvetiker', 12).length,
    ).toBeGreaterThan(8)
    // Repeated curved glyphs exercise the geometry budget independently of the
    // character limit, so settings validation can prevent a later render error.
    expect(() => validatePatternText('B'.repeat(120), 'optimer')).toThrow(
      /outline points/,
    )
  })
})
