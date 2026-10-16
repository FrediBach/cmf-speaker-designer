import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HALO_SETTINGS,
  HALO_LIMITS,
  HALO_INNER_RADIUS,
  getHaloCutPivotRadius,
  getHaloLimits,
  normalizeHaloSettings,
  getHaloWaveFrequency,
  getHaloWaveAmplitude,
  getHaloWaveValue,
  getHaloModulatedHeight,
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
      ...DEFAULT_HALO_SETTINGS,
      mode: 'custom',
      outwardAngle: 0,
      depth: 1,
      thickness: 6,
      rimHeight: 0,
      cutAngle: 75,
      cutRotation: 360,
      waveAmplitude: 0.9,
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
      ...DEFAULT_HALO_SETTINGS,
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
      ...DEFAULT_HALO_SETTINGS,
      mode: 'original',
      outwardAngle: 45,
      depth: 1,
      thickness: 6,
      rimHeight: 0,
      cutAngle: 44,
      cutRotation: 360,
      waveAmplitude: 0.9,
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

  it('restores disabled wave defaults for old settings and malformed values', () => {
    expect(normalizeHaloSettings({ mode: 'custom' })).toEqual({
      ...DEFAULT_HALO_SETTINGS,
      mode: 'custom',
    })
    expect(
      normalizeHaloSettings({
        waveShape: 'invalid' as 'sine',
        waveSeamless: null as unknown as boolean,
        waveFrequency: NaN,
        wavePhase: Infinity,
      }).waveShape,
    ).toBe('none')
    expect(
      normalizeHaloSettings({
        waveFrequency: -5,
        wavePhase: 500,
        waveAmplitude: 100,
      }),
    ).toMatchObject({
      waveFrequency: 0.25,
      wavePhase: 360,
      waveAmplitude: 20,
      waveSeamless: true,
    })
    expect(
      normalizeHaloSettings({
        waveFrequency: 100,
        wavePhase: -5,
        waveAmplitude: -1,
      }),
    ).toMatchObject({ waveFrequency: 24, wavePhase: 0, waveAmplitude: 0 })
  })

  it('snaps to the nearest complete cycle while retaining the requested frequency', () => {
    for (const [requested, applied] of [
      [0.25, 1],
      [2.49, 2],
      [2.5, 3],
      [23.75, 24],
    ]) {
      expect(getHaloWaveFrequency({ waveFrequency: requested })).toBe(applied)
      expect(
        normalizeHaloSettings({ waveFrequency: requested }).waveFrequency,
      ).toBe(requested)
      expect(
        getHaloWaveFrequency({ waveFrequency: requested, waveSeamless: false }),
      ).toBe(requested)
    }
    for (const waveShape of [
      'sine',
      'triangle',
      'square',
      'sawtooth',
    ] as const) {
      const settings = { waveShape, waveFrequency: 2.6, wavePhase: 37 }
      expect(getHaloWaveValue(settings, 360)).toBeCloseTo(
        getHaloWaveValue(settings, 0),
        12,
      )
      for (const angle of [0, 45, 90, 180, 270, 359.5])
        expect(
          getHaloWaveValue(
            { ...settings, waveSeamless: false, wavePhase: 360 },
            angle,
          ),
        ).toBeCloseTo(
          getHaloWaveValue(
            { ...settings, waveSeamless: false, wavePhase: 0 },
            angle,
          ),
          12,
        )
    }
    expect(
      getHaloWaveValue(
        { waveShape: 'sine', waveFrequency: 2.6, waveSeamless: false },
        360,
      ),
    ).not.toBeCloseTo(0, 3)
  })

  it('samples the wave families with independent phase and frequency', () => {
    const samples = (waveShape: 'sine' | 'triangle' | 'square' | 'sawtooth') =>
      [0, 90, 180, 270].map((angle) =>
        getHaloWaveValue({ waveShape, waveFrequency: 1 }, angle),
      )
    for (const shape of ['sine', 'triangle'] as const)
      samples(shape).forEach((value, index) =>
        expect(value).toBeCloseTo([0, 1, 0, -1][index], 12),
      )
    expect(samples('square')).toEqual([1, 1, -1, -1])
    expect(samples('sawtooth')).toEqual([-1, -0.5, 0, 0.5])
    expect(
      getHaloWaveValue(
        { waveShape: 'sine', waveFrequency: 3, wavePhase: 90 },
        0,
      ),
    ).toBeCloseTo(1, 12)
    expect(
      getHaloWaveValue({ waveShape: 'triangle', waveFrequency: 3 }, 30),
    ).toBeCloseTo(1, 12)
    expect(getHaloWaveValue({ waveShape: 'none' }, 90)).toBe(0)
  })

  it('preserves the rim and scales the actual cut height without collapsing the wall', () => {
    const settings = {
      depth: 20,
      rimHeight: 5,
      waveShape: 'sine' as const,
      waveAmplitude: 6,
      waveFrequency: 1,
    }
    for (const height of [-3, 0, 5])
      expect(getHaloModulatedHeight(settings, height, 90)).toBe(height)
    expect(getHaloModulatedHeight(settings, 20, 90)).toBe(26)
    expect(getHaloModulatedHeight(settings, 12.5, 90)).toBe(15.5)
    expect(getHaloModulatedHeight(settings, 20, 270)).toBe(14)
    const shallow = { ...settings, depth: 6, waveAmplitude: 20 }
    expect(getHaloLimits(shallow).waveAmplitude.max).toBeCloseTo(0.9, 12)
    expect(getHaloWaveAmplitude(shallow)).toBeCloseTo(0.9, 12)
    expect(getHaloModulatedHeight(shallow, 6, 270)).toBeCloseTo(5.1, 12)
    expect(getHaloWaveAmplitude({ ...settings, depth: 5 })).toBe(0)
    expect(getHaloWaveAmplitude({ ...settings, waveShape: 'none' })).toBe(0)
  })
})
