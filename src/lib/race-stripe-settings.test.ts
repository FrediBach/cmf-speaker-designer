import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RACE_STRIPE_SETTINGS,
  RACE_STRIPE_MAX_SPAN,
  getRaceStripeIntervals,
  getRaceStripeLimits,
  normalizeRaceStripeSettings,
} from './race-stripe-settings'

describe('recessed race stripe settings', () => {
  it('leaves existing designs unchanged and accepts only an explicit enable flag', () => {
    expect(normalizeRaceStripeSettings()).toEqual(DEFAULT_RACE_STRIPE_SETTINGS)
    expect(getRaceStripeIntervals()).toEqual([])
    for (const enabled of ['true', 1, {}, null, undefined]) {
      expect(normalizeRaceStripeSettings({ enabled } as never).enabled).toBe(
        false,
      )
    }
  })

  it('normalizes finite dimensions, rounds the count, and restores invalid defaults', () => {
    expect(
      normalizeRaceStripeSettings({ count: 2.7, width: -1, gap: 40 }),
    ).toEqual({
      enabled: false,
      count: 3,
      width: 1,
      gap: 20,
    })
    expect(
      normalizeRaceStripeSettings({
        count: NaN,
        width: Infinity,
        gap: -Infinity,
      }),
    ).toEqual(DEFAULT_RACE_STRIPE_SETTINGS)
    expect(
      normalizeRaceStripeSettings({ count: 0, width: 5.74, gap: 4.26 }),
    ).toMatchObject({ count: 1, width: 5.7, gap: 4.3 })
  })

  it.each([1, 2, 3])(
    'centers %s stripes with the requested width and clear gap',
    (count) => {
      const intervals = getRaceStripeIntervals({
        enabled: true,
        count,
        width: 6,
        gap: 4,
      })
      expect(intervals).toHaveLength(count)
      expect(intervals[0].minX).toBe(-intervals.at(-1)!.maxX)
      intervals.forEach(({ minX, maxX }, index) => {
        expect(maxX - minX).toBeCloseTo(6, 8)
        if (index > 0)
          expect(minX - intervals[index - 1].maxX).toBeCloseTo(4, 8)
      })
    },
  )

  it('keeps the stripe group inside the narrowest handle for all dimension extremes', () => {
    for (const count of [1, 2, 3]) {
      for (const width of [1, 6, 20, 100]) {
        for (const gap of [1, 4, 20, 100]) {
          const settings = normalizeRaceStripeSettings({
            enabled: true,
            count,
            width,
            gap,
          })
          const limits = getRaceStripeLimits(settings)
          const intervals = getRaceStripeIntervals(settings)
          expect(intervals[0].minX).toBeGreaterThanOrEqual(
            -RACE_STRIPE_MAX_SPAN / 2,
          )
          expect(intervals.at(-1)!.maxX).toBeLessThanOrEqual(
            RACE_STRIPE_MAX_SPAN / 2,
          )
          expect(settings.width).toBeGreaterThanOrEqual(limits.width.min)
          expect(settings.width).toBeLessThanOrEqual(limits.width.max)
          expect(settings.gap).toBeGreaterThanOrEqual(limits.gap.min)
          expect(settings.gap).toBeLessThanOrEqual(limits.gap.max)
          expect(normalizeRaceStripeSettings(settings)).toEqual(settings)
        }
      }
    }
  })

  it('retains a single stripe gap for later and reduces width when count increases', () => {
    const single = normalizeRaceStripeSettings({
      enabled: true,
      count: 1,
      width: 20,
      gap: 20,
    })
    expect(single.gap).toBe(20)
    expect(getRaceStripeIntervals(single)).toEqual([{ minX: -10, maxX: 10 }])
    const triple = normalizeRaceStripeSettings({ ...single, count: 3 })
    expect(triple.width).toBe(4.6)
    expect(triple.gap).toBe(20)
    expect(getRaceStripeLimits({ count: 3, width: 16, gap: 2 }).gap.max).toBe(3)
    expect(getRaceStripeLimits({ count: 3, width: 20, gap: 1 }).gap).toEqual({
      min: 1,
      max: 1,
    })
  })
})
