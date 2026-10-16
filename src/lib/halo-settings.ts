export const HALO_WAVE_SHAPES = [
  'none',
  'sine',
  'triangle',
  'square',
  'sawtooth',
] as const
export type HaloWaveShape = (typeof HALO_WAVE_SHAPES)[number]

export interface HaloSettings {
  mode: 'original' | 'custom'
  outwardAngle: number
  depth: number
  thickness: number
  rimHeight: number
  cutAngle: number
  cutRotation: number
  waveShape: HaloWaveShape
  waveAmplitude: number
  waveFrequency: number
  wavePhase: number
  waveSeamless: boolean
}

export const DEFAULT_HALO_SETTINGS: HaloSettings = {
  mode: 'original',
  outwardAngle: 12.5,
  depth: 24,
  thickness: 4.5,
  rimHeight: 0,
  cutAngle: 0,
  cutRotation: 0,
  waveShape: 'none',
  waveAmplitude: 4,
  waveFrequency: 3,
  wavePhase: 0,
  waveSeamless: true,
}

export const HALO_LIMITS = {
  outwardAngle: { min: 0, max: 45 },
  depth: { min: 1, max: 40 },
  thickness: { min: 1, max: 6 },
  rimHeight: { min: 0, max: 5 },
  cutAngle: { min: 0, max: 75 },
  cutRotation: { min: 0, max: 360 },
  waveAmplitude: { min: 0, max: 20 },
  waveFrequency: { min: 0.25, max: 24 },
  wavePhase: { min: 0, max: 360 },
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
  // Leave at least 10% of the wall above the rim at the deepest trough.
  values.waveAmplitude = Math.min(
    values.waveAmplitude,
    maximumWaveAmplitude(values),
  )
  return {
    ...values,
    mode: input.mode === 'custom' ? 'custom' : 'original',
    waveShape: HALO_WAVE_SHAPES.includes(input.waveShape as HaloWaveShape)
      ? input.waveShape!
      : DEFAULT_HALO_SETTINGS.waveShape,
    waveSeamless:
      typeof input.waveSeamless === 'boolean'
        ? input.waveSeamless
        : DEFAULT_HALO_SETTINGS.waveSeamless,
  }
}

const maximumWaveAmplitude = (
  settings: Pick<HaloSettings, 'depth' | 'rimHeight'>,
) =>
  Math.min(
    HALO_LIMITS.waveAmplitude.max,
    0.9 * (settings.depth - settings.rimHeight),
  )

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
    waveAmplitude: {
      min: HALO_LIMITS.waveAmplitude.min,
      max: maximumWaveAmplitude(settings),
    },
  }
}

/** Number of cycles around the ring, optionally snapped to a full-cycle join. */
export function getHaloWaveFrequency(input: Partial<HaloSettings> = {}) {
  return waveFrequency(normalizeHaloSettings(input))
}

function waveFrequency(settings: HaloSettings) {
  return settings.waveSeamless
    ? Math.max(1, Math.round(settings.waveFrequency))
    : settings.waveFrequency
}

/** Peak displacement at the original full-height tip, in millimeters. */
export function getHaloWaveAmplitude(input: Partial<HaloSettings> = {}) {
  const settings = normalizeHaloSettings(input)
  return settings.waveShape === 'none' ? 0 : settings.waveAmplitude
}

/** A unit waveform; angle zero is +Y and positive angles turn toward +X. */
export function getHaloWaveValue(
  input: Partial<HaloSettings>,
  angleDegrees: number,
) {
  return waveValue(normalizeHaloSettings(input), angleDegrees)
}

function waveValue(settings: HaloSettings, angleDegrees: number) {
  const cycles =
    (angleDegrees * waveFrequency(settings) + (settings.wavePhase % 360)) / 360
  const fraction = ((cycles % 1) + 1) % 1
  switch (settings.waveShape) {
    case 'sine':
      return Math.sin(2 * Math.PI * fraction)
    case 'triangle':
      return 1 - 4 * Math.abs(((fraction + 0.25) % 1) - 0.5)
    case 'square':
      return fraction < 0.5 ? 1 : -1
    case 'sawtooth':
      return 2 * fraction - 1
    default:
      return 0
  }
}

/** Warp an existing height above the panel face, preserving the raised rim. */
export function getHaloModulatedHeight(
  input: Partial<HaloSettings>,
  heightAboveFace: number,
  angleDegrees: number,
) {
  return createHaloHeightModulator(input)(heightAboveFace, angleDegrees)
}

/** Prepare a reusable sampler for dense mesh deformation without renormalizing vertices. */
export function createHaloHeightModulator(input: Partial<HaloSettings>) {
  const settings = normalizeHaloSettings(input)
  const remaining = settings.depth - settings.rimHeight
  return (heightAboveFace: number, angleDegrees: number) => {
    if (
      heightAboveFace <= settings.rimHeight ||
      remaining <= 0 ||
      settings.waveShape === 'none'
    )
      return heightAboveFace
    return (
      heightAboveFace +
      ((heightAboveFace - settings.rimHeight) / remaining) *
        settings.waveAmplitude *
        waveValue(settings, angleDegrees)
    )
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
