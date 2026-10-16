import {
  PATTERN_FONTS,
  nearestPatternFontWeight,
  type PatternFontId,
  type PatternFontWeight,
} from './multicolor-font-catalog'
import { validateKnobText } from './knob-text'

export type KnobStyle =
  | 'ring'
  | 'bar'
  | 'cross'
  | 'fluted'
  | 'hex'
  | 'triangle'
  | 'arrow'
  | 'v'
  | 'text'
export type KnobFlutePath = 'straight' | 'spiral' | 'chevron'

export interface KnobSettings {
  style: KnobStyle
  height: number
  taper: number
  fluteCount: number
  fluteDepth: number
  flutePath: KnobFlutePath
  facets: number
  gripWidth: number
  gripDepth: number
  gripThickness: number
  text: string
  fontId: PatternFontId
  fontWeight: PatternFontWeight
}

export type KnobNumericKey = Exclude<
  keyof KnobSettings,
  'style' | 'flutePath' | 'text' | 'fontId' | 'fontWeight'
>
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
  {
    id: 'triangle',
    label: 'Triangle',
    description: 'A raised triangular grip with adjustable width and depth.',
    collection: 'studio',
  },
  {
    id: 'arrow',
    label: 'Arrow',
    description: 'A directional grip with an adjustable head and shaft width.',
    collection: 'studio',
  },
  {
    id: 'v',
    label: 'V',
    description:
      'An open V-shaped grip with adjustable proportions and stroke width.',
    collection: 'studio',
  },
  {
    id: 'text',
    label: 'Text',
    description: 'One or two characters, automatically fitted to the knob.',
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
  gripWidth: 13,
  gripDepth: 12,
  gripThickness: 3,
  text: 'A',
  fontId: 'inter',
  fontWeight: 700,
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
  const span = (value: number | undefined, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(16, Math.max(8, value))
      : fallback
  // Leave a small margin inside the fixed 18 mm collar, including corners.
  const maxSpan = (other: number) =>
    Math.min(16, Math.floor(Math.sqrt(17.9 ** 2 - other ** 2) * 10) / 10)
  const width = span(input.gripWidth, DEFAULT_KNOB_SETTINGS.gripWidth)
  const depth = span(input.gripDepth, DEFAULT_KNOB_SETTINGS.gripDepth)
  return {
    height: { min: height - 4, max: height + 8 },
    taper: { min: 0, max: 1 },
    fluteCount: { min: 8, max: 32 },
    fluteDepth: { min: 0.3, max: 1.4 },
    facets: { min: 5, max: 12 },
    gripWidth: {
      min: 8,
      max: maxSpan(depth),
    },
    gripDepth: {
      min: 8,
      max: maxSpan(width),
    },
    gripThickness: {
      min: 2,
      max:
        input.style === 'v'
          ? Math.min(
              5,
              Math.floor(
                ((0.75 * depth) / Math.hypot(1, (2 * depth) / width)) * 10,
              ) / 10,
            )
          : 5,
    },
  }
}

export function normalizeKnobSettings(
  input: Partial<KnobSettings> = {},
): KnobSettings {
  const style = KNOB_STYLES.some(({ id }) => id === input.style)
    ? input.style!
    : DEFAULT_KNOB_SETTINGS.style
  const defaults = getDefaultKnobSettings(style)
  const fontId = PATTERN_FONTS.some(({ id }) => id === input.fontId)
    ? input.fontId!
    : defaults.fontId
  const fontWeight = nearestPatternFontWeight(
    fontId,
    typeof input.fontWeight === 'number' && Number.isFinite(input.fontWeight)
      ? input.fontWeight
      : defaults.fontWeight,
  )
  let text = input.text ?? defaults.text
  try {
    validateKnobText(text, fontId, fontWeight)
  } catch {
    text = defaults.text
  }
  const limits = getKnobLimits({ style, gripWidth: 8, gripDepth: 8 })
  const number = (key: KnobNumericKey) => {
    const value = input[key]
    const safe =
      typeof value === 'number' && Number.isFinite(value)
        ? value
        : defaults[key]
    return Math.min(limits[key].max, Math.max(limits[key].min, safe))
  }
  // Match the precision of the coupled slider limits so a valid saved value
  // cannot sit above the maximum shown by its control.
  let gripWidth = Math.round(number('gripWidth') * 10) / 10
  let gripDepth = Math.round(number('gripDepth') * 10) / 10
  const diagonal = Math.hypot(gripWidth, gripDepth)
  if (diagonal > 17.9) {
    const scale = 17.9 / diagonal
    gripWidth = Math.floor(gripWidth * scale * 10) / 10
    gripDepth = Math.floor(gripDepth * scale * 10) / 10
  }
  return {
    style,
    text,
    fontId,
    fontWeight,
    height: number('height'),
    taper: number('taper'),
    fluteCount: Math.round(number('fluteCount')),
    fluteDepth: number('fluteDepth'),
    flutePath:
      input.flutePath === 'spiral' || input.flutePath === 'chevron'
        ? input.flutePath
        : 'straight',
    facets: Math.round(number('facets')),
    gripWidth,
    gripDepth,
    gripThickness: Math.min(
      getKnobLimits({ style, gripWidth, gripDepth }).gripThickness.max,
      // The V's stroke limit depends on its final normalized proportions.
      typeof input.gripThickness === 'number' &&
        Number.isFinite(input.gripThickness)
        ? Math.max(2, input.gripThickness)
        : defaults.gripThickness,
    ),
  }
}
