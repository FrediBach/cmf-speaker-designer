import {
  FontLoader,
  type Font,
  type FontData,
} from 'three/examples/jsm/loaders/FontLoader.js'
import { strFromU8, unzlibSync } from 'three/addons/libs/fflate.module.js'
import type { Path } from 'three'
import helvetiker from '../assets/fonts/helvetiker_regular.typeface.json' with { type: 'json' }
import helvetikerBold from '../assets/fonts/helvetiker_bold.typeface.json' with { type: 'json' }
import optimer from '../assets/fonts/optimer_regular.typeface.json' with { type: 'json' }
import optimerBold from '../assets/fonts/optimer_bold.typeface.json' with { type: 'json' }
import droidSansMono from '../assets/fonts/droid_sans_mono_regular.typeface.json' with { type: 'json' }
import inter from '../assets/fonts/inter.typefaces.json' with { type: 'json' }
import roboto from '../assets/fonts/roboto.typefaces.json' with { type: 'json' }
import montserrat from '../assets/fonts/montserrat.typefaces.json' with { type: 'json' }
import dmSans from '../assets/fonts/dm-sans.typefaces.json' with { type: 'json' }
import oswald from '../assets/fonts/oswald.typefaces.json' with { type: 'json' }
import lato from '../assets/fonts/lato.typefaces.json' with { type: 'json' }
import merriweather from '../assets/fonts/merriweather.typefaces.json' with { type: 'json' }
import playfairDisplay from '../assets/fonts/playfair-display.typefaces.json' with { type: 'json' }
import spaceMono from '../assets/fonts/space-mono.typefaces.json' with { type: 'json' }
import {
  getPatternFont,
  type PatternFontId,
  type PatternFontWeight,
} from './multicolor-font-catalog'
import type { PatternPoint } from './multicolor-settings'

const loader = new FontLoader()
const faces: Record<
  PatternFontId,
  Partial<Record<PatternFontWeight, FontData | string>>
> = {
  helvetiker: { 400: helvetiker as FontData, 700: helvetikerBold as FontData },
  optimer: { 400: optimer as FontData, 700: optimerBold as FontData },
  'droid-sans-mono': { 400: droidSansMono as FontData },
  inter,
  roboto,
  montserrat,
  'dm-sans': dmSans,
  oswald,
  lato,
  merriweather,
  'playfair-display': playfairDisplay,
  'space-mono': spaceMono,
}
const fontCache = new Map<string, Font>()

/** Bundled compressed outlines are only expanded when their face is used. */
function getFont(fontId: PatternFontId, weight: PatternFontWeight): Font {
  const metadata = getPatternFont(fontId)
  if (!metadata.weights.includes(weight))
    throw new Error('Choose a weight available for the selected font.')
  const key = `${fontId}:${weight}`
  const cached = fontCache.get(key)
  if (cached) return cached
  const source = faces[fontId][weight]
  if (!source) throw new Error('The selected font weight could not be loaded.')
  const data =
    typeof source === 'string'
      ? (JSON.parse(
          strFromU8(
            unzlibSync(
              Uint8Array.from(atob(source), (character) =>
                character.charCodeAt(0),
              ),
            ),
          ),
        ) as FontData)
      : source
  const font = loader.parse(data)
  fontCache.set(key, font)
  return font
}

// Keep this module independent of settings at runtime: settings validation and
// the geometry worker both use these same locally bundled outlines.
const MAX_TEXT_LENGTH = 120
const MAX_CONTOURS = 512
const MAX_VERTICES = 20_000
const cache = new Map<string, PatternPoint[][]>()

function signedArea(points: PatternPoint[]) {
  return (
    points.reduce((area, [x, y], index) => {
      const next = points[(index + 1) % points.length]
      return area + x * next[1] - next[0] * y
    }, 0) / 2
  )
}

function contour(path: Path, clockwise: boolean): PatternPoint[] {
  const points = path
    .getPoints(16)
    .map(({ x, y }): PatternPoint => [x, y])
    .filter(
      ([x, y], index, all) =>
        index === 0 || x !== all[index - 1][0] || y !== all[index - 1][1],
    )
  if (
    points.length > 1 &&
    points[0][0] === points.at(-1)![0] &&
    points[0][1] === points.at(-1)![1]
  )
    points.pop()
  if (signedArea(points) < 0 !== clockwise) points.reverse()
  return points
}

function textContours(
  text: string,
  fontId: PatternFontId,
  fontWeight: PatternFontWeight,
): PatternPoint[][] {
  const font = getFont(fontId, fontWeight)
  if (
    typeof text !== 'string' ||
    !text.trim() ||
    text.length > MAX_TEXT_LENGTH
  ) {
    throw new Error(
      `Text must contain 1–${MAX_TEXT_LENGTH} characters, including at least one visible character.`,
    )
  }
  const unsupported = [
    ...new Set(
      Array.from(text).filter(
        (character) =>
          character !== '\n' && !Object.hasOwn(font.data.glyphs, character),
      ),
    ),
  ]
  if (unsupported.length) {
    const characters = unsupported
      .slice(0, 5)
      .map(
        (character) =>
          `“${character}” (U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`,
      )
      .join(', ')
    throw new Error(
      `${getPatternFont(fontId).name} does not include ${characters}. Choose another font or change the text.`,
    )
  }
  const key = `${fontId}:${fontWeight}:${text}`
  const cached = cache.get(key)
  if (cached) return cached
  const contours: PatternPoint[][] = []
  let vertices = 0
  for (const shape of font.generateShapes(text, 1)) {
    for (const points of [
      contour(shape, false),
      ...shape.holes.map((hole) => contour(hole, true)),
    ]) {
      if (points.length < 3 || Math.abs(signedArea(points)) < 1e-12) continue
      vertices += points.length
      if (vertices > MAX_VERTICES || contours.length >= MAX_CONTOURS) {
        throw new Error(
          'This text has too many outline points. Shorten the text or choose a simpler font.',
        )
      }
      contours.push(points)
    }
  }
  if (!contours.length)
    throw new Error('Enter text with at least one visible character.')
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const points of contours) {
    for (const [x, y] of points) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  const centerX = (minX + maxX) / 2,
    centerY = (minY + maxY) / 2
  for (const points of contours) {
    for (const point of points) {
      point[0] -= centerX
      point[1] -= centerY
    }
  }
  if (cache.size >= 32) cache.delete(cache.keys().next().value!)
  cache.set(key, contours)
  return contours
}

/** Validate glyph availability and bounded geometry before accepting an edit. */
export function validatePatternText(
  text: string,
  fontId: PatternFontId,
  fontWeight: PatternFontWeight = 400,
): void {
  textContours(text, fontId, fontWeight)
}

/** Centered XY, y-up, in mm; CCW exteriors and CW holes, with no closing duplicate. */
export function getTextContours(
  text: string,
  fontId: PatternFontId,
  fontSize: number,
  fontWeight: PatternFontWeight = 400,
): PatternPoint[][] {
  if (!Number.isFinite(fontSize) || fontSize <= 0)
    throw new Error('Font size must be greater than zero.')
  return textContours(text, fontId, fontWeight).map((points) =>
    points.map(([x, y]): PatternPoint => [x * fontSize, y * fontSize]),
  )
}
