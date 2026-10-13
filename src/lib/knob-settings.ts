export type KnobStyle = 'ring' | 'bar' | 'cross' | 'fluted' | 'hex'
export type KnobFlutePath = 'straight' | 'spiral' | 'chevron'

export interface KnobSettings {
  style: KnobStyle
  height: number
  taper: number
  fluteCount: number
  fluteDepth: number
  flutePath: KnobFlutePath
  facets: number
}

export type KnobNumericKey = Exclude<keyof KnobSettings, 'style' | 'flutePath'>
export type KnobLimits = Record<KnobNumericKey, { min: number; max: number }>

export const KNOB_STYLES: readonly {
  id: KnobStyle
  label: string
  description: string
  collection: 'original' | 'studio'
}[] = [
  {
    id: 'ring',
    label: 'Ring',
    description: 'The original recessed circular grip.',
    collection: 'original',
  },
  {
    id: 'bar',
    label: 'Bar',
    description: 'The original straight raised grip.',
    collection: 'original',
  },
  {
    id: 'cross',
    label: 'Cross',
    description: 'The original four-way rounded grip.',
    collection: 'original',
  },
  {
    id: 'fluted',
    label: 'Fluted',
    description: 'A recessed dial with adjustable scalloped edges.',
    collection: 'studio',
  },
  {
    id: 'hex',
    label: 'Faceted',
    description: 'A recessed dial with an adjustable number of grip faces.',
    collection: 'studio',
  },
]

export const DEFAULT_KNOB_SETTINGS: KnobSettings = {
  style: 'bar',
  height: 16,
  taper: 0,
  fluteCount: 16,
  fluteDepth: 0.8,
  flutePath: 'straight',
  facets: 6,
}

/** The source mounting stem, blind socket, and complete base stay unchanged. */
export const KNOB_MOUNT_HEIGHT = 5
export const KNOB_BASE_HEIGHT = 8

export function getDefaultKnobSettings(style: KnobStyle = 'bar'): KnobSettings {
  return {
    ...DEFAULT_KNOB_SETTINGS,
    style,
  }
}

export function getKnobLimits(input: Partial<KnobSettings> = {}): KnobLimits {
  const { height } = getDefaultKnobSettings(input.style)
  return {
    height: { min: height - 4, max: height + 8 },
    taper: { min: 0, max: 1 },
    fluteCount: { min: 8, max: 32 },
    fluteDepth: { min: 0.3, max: 1.4 },
    facets: { min: 5, max: 12 },
  }
}

export function normalizeKnobSettings(
  input: Partial<KnobSettings> = {},
): KnobSettings {
  const style = KNOB_STYLES.some(({ id }) => id === input.style)
    ? input.style!
    : DEFAULT_KNOB_SETTINGS.style
  const defaults = getDefaultKnobSettings(style)
  const limits = getKnobLimits({ style })
  const number = (key: KnobNumericKey) => {
    const value = input[key]
    const safe =
      typeof value === 'number' && Number.isFinite(value)
        ? value
        : defaults[key]
    return Math.min(limits[key].max, Math.max(limits[key].min, safe))
  }
  return {
    style,
    height: number('height'),
    taper: number('taper'),
    fluteCount: Math.round(number('fluteCount')),
    fluteDepth: number('fluteDepth'),
    flutePath:
      input.flutePath === 'spiral' || input.flutePath === 'chevron'
        ? input.flutePath
        : 'straight',
    facets: Math.round(number('facets')),
  }
}
