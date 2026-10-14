export interface RaceStripeSettings {
  enabled: boolean
  count: number
  width: number
  gap: number
}

export const DEFAULT_RACE_STRIPE_SETTINGS: RaceStripeSettings = {
  enabled: false,
  count: 2,
  width: 6,
  gap: 4,
}

export const RACE_STRIPE_DEPTH = 0.8
// Leave 3 mm at both edges of even the narrowest (60 mm) custom handle.
export const RACE_STRIPE_MAX_SPAN = 54
export const RACE_STRIPE_LIMITS = {
  count: { min: 1, max: 3 },
  width: { min: 1, max: 20 },
  gap: { min: 1, max: 20 },
} as const

const floorTenth = (value: number) => Math.floor((value + 1e-8) * 10) / 10

/** Dimensions are millimeters. The complete stripe group stays centered. */
export function normalizeRaceStripeSettings(
  input: Partial<RaceStripeSettings> = {},
): RaceStripeSettings {
  const numeric = (key: keyof typeof RACE_STRIPE_LIMITS) => {
    const value = input[key]
    const { min, max } = RACE_STRIPE_LIMITS[key]
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : DEFAULT_RACE_STRIPE_SETTINGS[key]
  }
  const count = Math.round(numeric('count'))
  const gap = Math.round(numeric('gap') * 10) / 10
  const width = Math.min(
    Math.round(numeric('width') * 10) / 10,
    floorTenth((RACE_STRIPE_MAX_SPAN - (count - 1) * gap) / count),
  )
  return { enabled: input.enabled === true, count, width, gap }
}

export function getRaceStripeLimits(input: Partial<RaceStripeSettings> = {}) {
  const { count, width, gap } = normalizeRaceStripeSettings(input)
  return {
    ...RACE_STRIPE_LIMITS,
    width: {
      min: RACE_STRIPE_LIMITS.width.min,
      max: Math.min(
        RACE_STRIPE_LIMITS.width.max,
        floorTenth((RACE_STRIPE_MAX_SPAN - (count - 1) * gap) / count),
      ),
    },
    gap: {
      min: RACE_STRIPE_LIMITS.gap.min,
      max:
        count === 1
          ? RACE_STRIPE_LIMITS.gap.max
          : Math.min(
              RACE_STRIPE_LIMITS.gap.max,
              floorTenth((RACE_STRIPE_MAX_SPAN - count * width) / (count - 1)),
            ),
    },
  }
}

/** Horizontal intervals shared by recess geometry and stud clearance. */
export function getRaceStripeIntervals(
  input: Partial<RaceStripeSettings> = {},
) {
  const { enabled, count, width, gap } = normalizeRaceStripeSettings(input)
  if (!enabled) return []
  const span = count * width + (count - 1) * gap
  return Array.from({ length: count }, (_, index) => {
    const minX = -span / 2 + index * (width + gap)
    return { minX, maxX: minX + width }
  })
}
