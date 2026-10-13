import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HALO_SETTINGS,
  HALO_LIMITS,
  HALO_INNER_RADIUS,
  getHaloCutPivotRadius,
  getHaloLimits,
  normalizeHaloSettings,
} from './halo-settings'

describe('generative halo settings', () => {
  it('uses the example halo proportions and permits the full cut range on straight walls', () => {
    expect(normalizeHaloSettings()).toEqual(DEFAULT_HALO_SETTINGS)
    expect(getHaloLimits()).toEqual(HALO_LIMITS)
    expect(
      normalizeHaloSettings({
        mode: 'custom',
        outwardAngle: 0,
        depth: 1,
        thickness: 6,
        cutAngle: 75,
        cutRotation: 360,
      }),
    ).toEqual({
      mode: 'custom',
      outwardAngle: 0,
      depth: 1,
      thickness: 6,
      rimHeight: 0,
      cutAngle: 75,
      cutRotation: 360,
    })
  })

  it('clamps dimensions and restores finite defaults for invalid values', () => {
    expect(
      normalizeHaloSettings({
        outwardAngle: -20,
        depth: 100,
        thickness: NaN,
        cutAngle: Infinity,
        cutRotation: -90,
      }),
    ).toEqual({
      mode: 'original',
      outwardAngle: 0,
      depth: 40,
      thickness: 4.5,
      rimHeight: 0,
      cutAngle: 0,
      cutRotation: 0,
    })
    expect(
      normalizeHaloSettings({
        outwardAngle: 100,
        depth: -5,
        thickness: 100,
        cutAngle: 100,
        cutRotation: 400,
      }),
    ).toEqual({
      mode: 'original',
      outwardAngle: 45,
      depth: 1,
      thickness: 6,
      rimHeight: 0,
      cutAngle: 44,
      cutRotation: 360,
    })
  })

  it('keeps the cutting plane across the wall as flare changes', () => {
    for (const [outwardAngle, maximum] of [
      [0, 75],
      [14, 75],
      [20, 69],
      [30, 59],
      [45, 44],
    ]) {
      expect(getHaloLimits({ outwardAngle }).cutAngle).toEqual({
        min: 0,
        max: maximum,
      })
      expect(
        normalizeHaloSettings({ outwardAngle, cutAngle: 75 }).cutAngle,
      ).toBe(maximum)
      expect(
        normalizeHaloSettings({ outwardAngle, cutAngle: 0 }).cutAngle,
      ).toBe(0)
    }
    const steep = normalizeHaloSettings({ outwardAngle: 0, cutAngle: 75 })
    expect(normalizeHaloSettings({ ...steep, outwardAngle: 45 }).cutAngle).toBe(
      44,
    )
  })

  it('anchors the cut at the polygon outer tip instead of the base rim', () => {
    const settings = {
      outwardAngle: 30,
      depth: 24,
      thickness: 3,
      cutRotation: 0,
    }
    const tip = HALO_INNER_RADIUS + 3 + Math.tan(Math.PI / 6) * 24
    expect(getHaloCutPivotRadius(settings)).toBeCloseTo(tip, 10)
    const rotated = getHaloCutPivotRadius({ ...settings, cutRotation: 137 })
    expect(rotated).toBeLessThan(tip)
    expect(rotated).toBeGreaterThan(tip - 0.01)
  })

  it('defaults existing halos to flush and keeps a raised rim within halo depth', () => {
    expect(normalizeHaloSettings({ mode: 'custom' }).rimHeight).toBe(0)
    expect(normalizeHaloSettings({ rimHeight: NaN }).rimHeight).toBe(0)
    expect(normalizeHaloSettings({ rimHeight: -5 }).rimHeight).toBe(0)
    expect(normalizeHaloSettings({ rimHeight: 10 }).rimHeight).toBe(5)
    expect(normalizeHaloSettings({ rimHeight: 2 }).rimHeight).toBe(2)
    expect(getHaloLimits().rimHeight).toEqual({ min: 0, max: 5 })
    expect(getHaloLimits({ depth: 1 }).rimHeight).toEqual({ min: 0, max: 1 })
    expect(normalizeHaloSettings({ depth: 1, rimHeight: 5 }).rimHeight).toBe(1)
    const raised = normalizeHaloSettings({ depth: 20, rimHeight: 5 })
    expect(normalizeHaloSettings({ ...raised, depth: 3 }).rimHeight).toBe(3)
  })
})
