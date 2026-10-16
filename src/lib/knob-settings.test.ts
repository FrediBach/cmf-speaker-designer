import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KNOB_SETTINGS,
  KNOB_STYLES,
  getDefaultKnobSettings,
  getKnobLimits,
  normalizeKnobSettings,
  type KnobNumericKey,
} from './knob-settings'

const newStyles = ['triangle', 'arrow', 'v'] as const

describe('parametric knob settings', () => {
  it('backfills the new dimensions without changing legacy grip settings', () => {
    const legacy = {
      style: 'fluted',
      height: 18,
      taper: 0.4,
      fluteCount: 20,
      fluteDepth: 1,
      flutePath: 'chevron',
      facets: 8,
    } as const
    expect(normalizeKnobSettings(legacy)).toEqual({
      ...legacy,
      gripWidth: 13,
      gripDepth: 12,
      gripThickness: 3,
    })
    expect(normalizeKnobSettings()).toEqual(DEFAULT_KNOB_SETTINGS)
  })

  it.each(newStyles)(
    'accepts %s and supplies its default dimensions',
    (style) => {
      expect(KNOB_STYLES.some(({ id }) => id === style)).toBe(true)
      expect(normalizeKnobSettings({ style })).toEqual(
        getDefaultKnobSettings(style),
      )
      expect(normalizeKnobSettings({ style })).toMatchObject({
        style,
        gripWidth: 13,
        gripDepth: 12,
        gripThickness: 3,
      })
    },
  )

  it.each([NaN, Infinity, -Infinity, '12', null])(
    'restores finite defaults for invalid dimensions %s',
    (invalid) => {
      for (const style of newStyles) {
        expect(
          normalizeKnobSettings({
            style,
            gripWidth: invalid as never,
            gripDepth: invalid as never,
            gripThickness: invalid as never,
          }),
        ).toEqual(getDefaultKnobSettings(style))
      }
    },
  )

  it('limits the coupled dimensions inside the original collar', () => {
    expect(
      normalizeKnobSettings({
        style: 'triangle',
        gripWidth: 100,
        gripDepth: 100,
      }),
    ).toMatchObject({ gripWidth: 12.6, gripDepth: 12.6 })
    for (const [gripWidth, gripDepth] of [
      [16, 8],
      [8, 16],
      [8, 8],
    ])
      expect(
        normalizeKnobSettings({ style: 'arrow', gripWidth, gripDepth }),
      ).toMatchObject({ gripWidth, gripDepth })
    expect(
      normalizeKnobSettings({ style: 'v', gripWidth: -100, gripDepth: -100 }),
    ).toMatchObject({ gripWidth: 8, gripDepth: 8 })
    expect(getKnobLimits()).toMatchObject({
      gripWidth: { min: 8, max: 13.2 },
      gripDepth: { min: 8, max: 12.3 },
    })
  })

  it('rounds manually entered spans to the precision of their slider bounds', () => {
    expect(
      normalizeKnobSettings({
        style: 'triangle',
        gripWidth: 13.24,
        gripDepth: 12,
      }),
    ).toMatchObject({ gripWidth: 13.2, gripDepth: 12 })
    expect(
      normalizeKnobSettings({
        style: 'arrow',
        gripWidth: 11.1111,
        gripDepth: 9.9999,
      }),
    ).toMatchObject({ gripWidth: 11.1, gripDepth: 10 })
    const rounded = normalizeKnobSettings({
      style: 'triangle',
      gripWidth: 13.299,
      gripDepth: 11.999,
    })
    expect(
      Math.hypot(rounded.gripWidth, rounded.gripDepth),
    ).toBeLessThanOrEqual(17.9)
  })

  it.each(newStyles)(
    'keeps normalized %s values within every displayed limit and stable on reload',
    (style) => {
      const spans = [
        -100, 8, 8.01, 8.09, 9.876, 11.111, 12, 13.24, 15.999, 16, 100,
      ]
      for (const gripWidth of spans)
        for (const gripDepth of spans) {
          const settings = normalizeKnobSettings({
            style,
            gripWidth,
            gripDepth,
            gripThickness: 3.333,
          })
          const limits = getKnobLimits(settings)
          for (const key of Object.keys(limits) as KnobNumericKey[]) {
            expect(Number.isFinite(settings[key])).toBe(true)
            expect(settings[key]).toBeGreaterThanOrEqual(limits[key].min)
            expect(settings[key]).toBeLessThanOrEqual(limits[key].max)
          }
          expect(
            Math.hypot(settings.gripWidth, settings.gripDepth),
          ).toBeLessThanOrEqual(17.9)
          expect(normalizeKnobSettings(settings)).toEqual(settings)
        }
    },
  )

  it('preserves at least one quarter of the V depth as an open notch', () => {
    for (const [gripWidth, gripDepth] of [
      [8, 8],
      [8, 16],
      [16, 8],
      [11, 10],
      [13.24, 12.03],
    ])
      for (const gripThickness of [-100, 2, 3.333, 5, 100, NaN]) {
        const settings = normalizeKnobSettings({
          style: 'v',
          gripWidth,
          gripDepth,
          gripThickness,
        })
        const insetDepth =
          settings.gripThickness *
          Math.hypot(1, (2 * settings.gripDepth) / settings.gripWidth)
        expect(settings.gripThickness).toBeGreaterThanOrEqual(2)
        expect(settings.gripThickness).toBeLessThanOrEqual(5)
        expect(settings.gripDepth - insetDepth).toBeGreaterThanOrEqual(
          settings.gripDepth / 4,
        )
      }
    expect(
      normalizeKnobSettings({
        style: 'v',
        gripWidth: 11,
        gripDepth: 10,
        gripThickness: 5,
      }).gripThickness,
    ).toBe(3.6)
    expect(
      normalizeKnobSettings({
        style: 'arrow',
        gripWidth: 11,
        gripDepth: 10,
        gripThickness: 5,
      }).gripThickness,
    ).toBe(5)
  })
})
