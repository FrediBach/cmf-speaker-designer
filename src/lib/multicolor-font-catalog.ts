/** Available outline faces; weights always refer to real font variants. */
export type PatternFontWeight = 300 | 400 | 500 | 600 | 700 | 800 | 900

export const PATTERN_FONT_WEIGHT_LABELS: Record<PatternFontWeight, string> = {
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semi Bold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black',
}

export const PATTERN_FONTS = [
  {
    id: 'helvetiker',
    name: 'Helvetiker',
    category: 'Sans serif',
    weights: [400, 700],
  },
  { id: 'optimer', name: 'Optimer', category: 'Serif', weights: [400, 700] },
  {
    id: 'droid-sans-mono',
    name: 'Droid Sans Mono',
    category: 'Monospace',
    weights: [400],
  },
  {
    id: 'inter',
    name: 'Inter',
    category: 'Sans serif',
    weights: [300, 400, 500, 600, 700, 800],
  },
  {
    id: 'roboto',
    name: 'Roboto',
    category: 'Sans serif',
    weights: [300, 400, 500, 600, 700, 800],
  },
  {
    id: 'montserrat',
    name: 'Montserrat',
    category: 'Sans serif',
    weights: [300, 400, 500, 600, 700, 800],
  },
  {
    id: 'dm-sans',
    name: 'DM Sans',
    category: 'Sans serif',
    weights: [300, 400, 500, 600, 700, 800],
  },
  {
    id: 'oswald',
    name: 'Oswald',
    category: 'Display',
    weights: [300, 400, 500, 600, 700],
  },
  {
    id: 'lato',
    name: 'CMF Humanist',
    category: 'Sans serif',
    weights: [300, 400, 700],
  },
  {
    id: 'merriweather',
    name: 'CMF Book Serif',
    category: 'Serif',
    weights: [300, 400, 500, 600, 700, 800],
  },
  {
    id: 'playfair-display',
    name: 'CMF Editorial Serif',
    category: 'Serif',
    weights: [400, 500, 600, 700, 800],
  },
  {
    id: 'space-mono',
    name: 'Space Mono',
    category: 'Monospace',
    weights: [400, 700],
  },
] as const

export type PatternFontId = (typeof PATTERN_FONTS)[number]['id']
export type PatternFont = {
  readonly id: PatternFontId
  readonly name: string
  readonly category: (typeof PATTERN_FONTS)[number]['category']
  readonly weights: readonly PatternFontWeight[]
}

export function getPatternFont(fontId: PatternFontId): PatternFont {
  const font = PATTERN_FONTS.find(({ id }) => id === fontId)
  if (!font) throw new Error('Choose a supported text font.')
  return font
}

/** Preserve the selected weight when possible; prefer the lighter face on a tie. */
export function nearestPatternFontWeight(
  fontId: PatternFontId,
  weight: PatternFontWeight,
): PatternFontWeight {
  return getPatternFont(fontId).weights.reduce((nearest, candidate) =>
    Math.abs(candidate - weight) < Math.abs(nearest - weight)
      ? candidate
      : nearest,
  )
}
