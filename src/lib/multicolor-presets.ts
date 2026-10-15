import {
  MulticolorValidationError,
  normalizeMulticolorSettings,
  type MulticolorSettings,
  type PatternElement,
  type PatternFrame,
  type PatternPoint,
} from './multicolor-settings'
import { createPatternElement, generateStripes } from './multicolor-patterns'

/** RGB values are approximate display colors, not filament specifications. */
export const MULTICOLOR_PRESETS = [
  { id: 'france', name: 'France', aspectRatio: 3 / 2 },
  { id: 'italy', name: 'Italy', aspectRatio: 3 / 2 },
  { id: 'germany', name: 'Germany', aspectRatio: 5 / 3 },
  { id: 'switzerland', name: 'Switzerland', aspectRatio: 1 },
  { id: 'norway', name: 'Norway', aspectRatio: 22 / 16 },
  { id: 'united-kingdom', name: 'United Kingdom', aspectRatio: 5 / 3 },
  { id: 'rainbow', name: 'Rainbow', aspectRatio: 3 / 2 },
  { id: 'japan', name: 'Japan', aspectRatio: 3 / 2 },
] as const

export type MulticolorPresetId = (typeof MULTICOLOR_PRESETS)[number]['id']

function clipPolygon(
  points: PatternPoint[],
  axis: 0 | 1,
  boundary: number,
  keepGreater: boolean,
): PatternPoint[] {
  const result: PatternPoint[] = []
  const inside = (point: PatternPoint) =>
    keepGreater ? point[axis] >= boundary : point[axis] <= boundary
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index],
      b = points[(index + 1) % points.length]
    const aInside = inside(a),
      bInside = inside(b)
    if (aInside) result.push(a)
    if (aInside !== bInside) {
      const amount = (boundary - a[axis]) / (b[axis] - a[axis])
      result.push([
        a[0] + amount * (b[0] - a[0]),
        a[1] + amount * (b[1] - a[1]),
      ])
    }
  }
  return result
}

/** A band measured perpendicular to a 50×30 reference flag's diagonal. */
function unionDiagonal(
  slope: 1 | -1,
  width: number,
  offset: number,
  half?: 'left' | 'right',
): PatternPoint[] {
  const length = Math.hypot(50, 30),
    ux = 50 / length,
    uy = (slope * 30) / length
  const nx = -uy,
    ny = ux
  let points: PatternPoint[] = [
    [
      -100 * ux + nx * (offset - width / 2),
      -100 * uy + ny * (offset - width / 2),
    ],
    [
      100 * ux + nx * (offset - width / 2),
      100 * uy + ny * (offset - width / 2),
    ],
    [
      100 * ux + nx * (offset + width / 2),
      100 * uy + ny * (offset + width / 2),
    ],
    [
      -100 * ux + nx * (offset + width / 2),
      -100 * uy + ny * (offset + width / 2),
    ],
  ]
  points = clipPolygon(points, 0, half === 'right' ? 0 : -25, true)
  points = clipPolygon(points, 0, half === 'left' ? 0 : 25, false)
  points = clipPolygon(points, 1, -15, true)
  return clipPolygon(points, 1, 15, false).filter((point, index, vertices) => {
    const previous = vertices[(index + vertices.length - 1) % vertices.length]
    return Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-8
  })
}

/** Presets compile to the same independently editable shapes as manual authoring. */
export function applyMulticolorPreset(
  id: string,
  currentSettings: MulticolorSettings,
  layout: 'panel' | 'proportional' = 'panel',
): { settings: MulticolorSettings; panelColor: string } {
  const recipe = MULTICOLOR_PRESETS.find((preset) => preset.id === id)
  if (!recipe) throw new MulticolorValidationError('Unknown multicolor preset.')
  let settings = normalizeMulticolorSettings(currentSettings)
  let frame: PatternFrame = { ...settings.frame }
  if (layout === 'proportional') {
    const width = Math.min(frame.width, frame.height * recipe.aspectRatio)
    frame = { ...frame, width, height: width / recipe.aspectRatio }
  }
  settings = {
    ...settings,
    enabled: true,
    frame,
    materials: [],
    elements: [],
    groups: [],
  }
  delete settings.preset
  let panelColor = '#ffffff'
  const material = (name: string, color: string) => {
    const materialId = `preset-${name.toLowerCase()}`
    settings.materials.push({ id: materialId, name, color })
    return materialId
  }
  const cross = (
    name: string,
    materialId: string,
    x: number,
    y: number,
    horizontalThickness: number,
    verticalThickness: number,
    left: number,
    right: number,
    top: number,
    bottom: number,
  ) => {
    settings.elements.push({
      ...createPatternElement('cross', frame, materialId),
      kind: 'cross',
      name,
      x,
      y,
      horizontalThickness,
      verticalThickness,
      left,
      right,
      top,
      bottom,
    })
  }
  switch (recipe.id) {
    case 'france':
      settings = generateStripes(settings, {
        count: 3,
        angle: 0,
        gap: 0,
        colors: ['#0055a4', '#ffffff', '#ef4135'],
      })
      break
    case 'italy':
      settings = generateStripes(settings, {
        count: 3,
        angle: 0,
        gap: 0,
        colors: ['#009246', '#ffffff', '#ce2b37'],
      })
      break
    case 'germany':
      settings = generateStripes(settings, {
        count: 3,
        angle: 270,
        gap: 0,
        colors: ['#000000', '#dd0000', '#ffce00'],
      })
      break
    case 'rainbow':
      settings = generateStripes(settings, {
        count: 6,
        angle: 270,
        gap: 0,
        colors: [
          '#e40303',
          '#ff8c00',
          '#ffed00',
          '#008026',
          '#24408e',
          '#732982',
        ],
      })
      break
    case 'switzerland': {
      panelColor = '#ff0000'
      const unit = Math.min(frame.width, frame.height) / 32
      cross(
        'White Swiss cross',
        material('White', '#ffffff'),
        frame.centerX,
        frame.centerY,
        unit * 6,
        unit * 6,
        unit * 10,
        unit * 10,
        unit * 10,
        unit * 10,
      )
      break
    }
    case 'norway': {
      panelColor = '#ba0c2f'
      const x = frame.centerX - frame.width / 2 + (frame.width * 8) / 22
      const left = (frame.width * 8) / 22,
        right = (frame.width * 14) / 22
      cross(
        'White Nordic cross',
        material('White', '#ffffff'),
        x,
        frame.centerY,
        (frame.height * 4) / 16,
        (frame.width * 4) / 22,
        left,
        right,
        frame.height / 2,
        frame.height / 2,
      )
      cross(
        'Blue Nordic cross',
        material('Blue', '#00205b'),
        x,
        frame.centerY,
        (frame.height * 2) / 16,
        (frame.width * 2) / 22,
        left,
        right,
        frame.height / 2,
        frame.height / 2,
      )
      break
    }
    case 'japan': {
      panelColor = '#ffffff'
      const element = createPatternElement(
        'circle',
        frame,
        material('Red', '#bc002d'),
      )
      settings.elements.push({
        ...element,
        kind: 'circle',
        name: 'Red sun',
        radius: Math.min(frame.width, frame.height) * 0.3,
        innerRadius: 0,
      })
      break
    }
    case 'united-kingdom': {
      // Flag Institute's 3:5 specification: 6-unit diagonals contain 3 white,
      // 2 red, 1 white; broad white margins are uppermost at the left-hand hoist.
      // https://www.flaginstitute.org/wp/uk-flags/union-flag-specification/
      panelColor = '#012169'
      const white = material('White', '#ffffff'),
        red = material('Red', '#c8102e')
      const addPolygon = (
        name: string,
        materialId: string,
        points: PatternPoint[],
      ) => {
        const element: PatternElement = {
          ...createPatternElement('polygon', frame, materialId),
          kind: 'polygon',
          name,
          points: points.map(([x, y]) => [
            (x * frame.width) / 50,
            (y * frame.height) / 30,
          ]),
        }
        settings.elements.push(element)
      }
      for (const slope of [1, -1] as const)
        addPolygon(
          `White diagonal ${slope === 1 ? 'rising' : 'falling'}`,
          white,
          unionDiagonal(slope, 6, 0),
        )
      for (const slope of [1, -1] as const) {
        addPolygon(
          `Red ${slope === 1 ? 'lower' : 'upper'} hoist diagonal`,
          red,
          unionDiagonal(slope, 2, -1, 'left'),
        )
        addPolygon(
          `Red ${slope === 1 ? 'upper' : 'lower'} fly diagonal`,
          red,
          unionDiagonal(slope, 2, 1, 'right'),
        )
      }
      cross(
        'White upright cross border',
        white,
        frame.centerX,
        frame.centerY,
        (frame.height * 10) / 30,
        (frame.width * 10) / 50,
        frame.width / 2,
        frame.width / 2,
        frame.height / 2,
        frame.height / 2,
      )
      cross(
        'Red upright cross',
        red,
        frame.centerX,
        frame.centerY,
        (frame.height * 6) / 30,
        (frame.width * 6) / 50,
        frame.width / 2,
        frame.width / 2,
        frame.height / 2,
        frame.height / 2,
      )
      break
    }
  }
  settings.preset = { id: recipe.id, revision: 1, layout }
  return { settings: normalizeMulticolorSettings(settings), panelColor }
}
