import { describe, expect, it } from 'vitest'
import { getTextContours, validatePatternText } from './multicolor-fonts'
import { PATTERN_FONTS, polygonSignedArea } from './multicolor-settings'

describe('multicolor text outlines', () => {
  for (const { id, name } of PATTERN_FONTS) {
    it(`preserves holes and centers ${name} text at its visible bounds`, () => {
      const contours = getTextContours('B O', id, 12)
      expect(
        contours.filter((points) => polygonSignedArea(points) > 0),
      ).toHaveLength(2)
      expect(
        contours.filter((points) => polygonSignedArea(points) < 0),
      ).toHaveLength(3)
      const x = contours.flat().map((point) => point[0])
      const y = contours.flat().map((point) => point[1])
      expect(Math.min(...x) + Math.max(...x)).toBeCloseTo(0)
      expect(Math.min(...y) + Math.max(...y)).toBeCloseTo(0)
      expect(
        contours.every(
          (points) =>
            points.length > 2 &&
            points[0].some((value, index) => value !== points.at(-1)![index]),
        ),
      ).toBe(true)
    })
  }

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

  it('produces distinct geometry for the selected fonts', () => {
    const outlines = PATTERN_FONTS.map(({ id }) =>
      JSON.stringify(getTextContours('Speaker', id, 10)),
    )
    expect(new Set(outlines).size).toBe(PATTERN_FONTS.length)
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
