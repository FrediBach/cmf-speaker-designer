export interface HaloSettings {
  mode: 'original' | 'custom'
  outwardAngle: number
  depth: number
  thickness: number
  rimHeight: number
  cutAngle: number
  cutRotation: number
}

export const DEFAULT_HALO_SETTINGS: HaloSettings = {
  mode: 'original',
  outwardAngle: 12.5,
  depth: 24,
  thickness: 4.5,
  rimHeight: 0,
  cutAngle: 0,
  cutRotation: 0,
}

export const HALO_LIMITS = {
  outwardAngle: { min: 0, max: 45 },
  depth: { min: 1, max: 40 },
  thickness: { min: 1, max: 6 },
  rimHeight: { min: 0, max: 5 },
  cutAngle: { min: 0, max: 75 },
  cutRotation: { min: 0, max: 360 },
} as const

const maximumCutAngle = (outwardAngle: number) =>
  Math.min(HALO_LIMITS.cutAngle.max, 89 - outwardAngle)

/** All dimensions are millimeters; wall thickness is measured radially. */
export function normalizeHaloSettings(
  input: Partial<HaloSettings> = {},
): HaloSettings {
  const values = Object.fromEntries(
    Object.entries(HALO_LIMITS).map(([key, range]) => {
      const name = key as keyof typeof HALO_LIMITS
      const value = input[name]
      return [
        name,
        typeof value === 'number' && Number.isFinite(value)
          ? Math.min(range.max, Math.max(range.min, value))
          : DEFAULT_HALO_SETTINGS[name],
      ]
    }),
  ) as Pick<HaloSettings, keyof typeof HALO_LIMITS>
  // A trim plane must cross the flared wall rather than run along or beyond it.
  // Keep one degree of clearance from the parallel (90° combined) condition.
  values.cutAngle = Math.min(
    values.cutAngle,
    maximumCutAngle(values.outwardAngle),
  )
  values.rimHeight = Math.min(values.rimHeight, values.depth)
  return { ...values, mode: input.mode === 'custom' ? 'custom' : 'original' }
}

export function getHaloLimits(input: Partial<HaloSettings> = {}) {
  const settings = normalizeHaloSettings(input)
  return {
    ...HALO_LIMITS,
    cutAngle: {
      min: HALO_LIMITS.cutAngle.min,
      max: maximumCutAngle(settings.outwardAngle),
    },
    rimHeight: {
      min: HALO_LIMITS.rimHeight.min,
      max: Math.min(HALO_LIMITS.rimHeight.max, settings.depth),
    },
  }
}

// Clear the source aperture even between adjacent polygon vertices. The small
// gap in radii is backed by the source panel and does not narrow the opening.
export const HALO_INNER_RADIUS = 32.8
export const HALO_CIRCULAR_SEGMENTS = 256

/** Actual outer-tip support in the cutting direction, shared by CAD and preview. */
export function getHaloCutPivotRadius(input: Partial<HaloSettings> = {}) {
  const settings = normalizeHaloSettings(input)
  const topOuterRadius =
    HALO_INNER_RADIUS +
    settings.thickness +
    Math.tan((settings.outwardAngle * Math.PI) / 180) * settings.depth
  const step = (2 * Math.PI) / HALO_CIRCULAR_SEGMENTS
  const direction = Math.PI / 2 - (settings.cutRotation * Math.PI) / 180
  const facetAngle = direction - Math.round(direction / step) * step
  return topOuterRadius * Math.cos(facetAngle)
}
