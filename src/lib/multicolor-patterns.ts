import {
  MULTICOLOR_LIMITS,
  MulticolorValidationError,
  normalizeMulticolorSettings,
  polygonSignedArea,
  type MulticolorSettings,
  type PatternElement,
  type PatternFrame,
  type PatternKind,
  type PatternPoint,
} from './multicolor-settings'
import { getTextContours } from './multicolor-fonts'

export const CIRCLE_CHORD_ERROR_MM = 0.025
let nextId = 0
export function createPatternId(prefix = 'shape'): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${++nextId}`}`
}

export function createPatternElement(
  kind: PatternKind,
  frame: PatternFrame,
  materialId = 'base',
): PatternElement {
  const size = Math.min(frame.width, frame.height)
  const common = {
    id: createPatternId(),
    name: {
      stripe: 'Stripe',
      cross: 'Cross',
      circle: 'Circle',
      polygon: 'Polygon',
      svg: 'SVG',
      text: 'Text',
    }[kind],
    visible: true,
    materialId,
    x: frame.centerX,
    y: frame.centerY,
    rotation: 0,
  }
  switch (kind) {
    case 'stripe':
      return { ...common, kind, width: frame.width / 3, height: frame.height }
    case 'cross':
      return {
        ...common,
        kind,
        left: size * 0.3,
        right: size * 0.3,
        top: size * 0.3,
        bottom: size * 0.3,
        horizontalThickness: size * 0.12,
        verticalThickness: size * 0.12,
      }
    case 'circle':
      return { ...common, kind, radius: size * 0.2, innerRadius: 0 }
    case 'polygon':
      return {
        ...common,
        kind,
        points: [
          [-size * 0.25, -size * 0.2],
          [size * 0.25, -size * 0.2],
          [0, size * 0.25],
        ],
      }
    case 'svg':
      return {
        ...common,
        kind,
        sourceName: 'Artwork.svg',
        width: size * 0.6,
        height: size * 0.6,
        contours: [
          [
            [-0.5, -0.5],
            [0.5, -0.5],
            [0.5, 0.5],
            [-0.5, 0.5],
          ],
        ],
      }
    case 'text':
      return {
        ...common,
        kind,
        text: 'CMF',
        fontId: 'helvetiker',
        fontWeight: 400,
        fontSize: size * 0.2,
      }
  }
}

/** XY contours, counterclockwise exteriors and clockwise holes. No repeated closing point. */
export function getElementContours(element: PatternElement): PatternPoint[][] {
  let contours: PatternPoint[][]
  switch (element.kind) {
    case 'stripe': {
      const w = element.width / 2,
        h = element.height / 2
      contours = [
        [
          [-w, -h],
          [w, -h],
          [w, h],
          [-w, h],
        ],
      ]
      break
    }
    case 'cross': {
      const w = element.verticalThickness / 2,
        h = element.horizontalThickness / 2
      contours = [
        [
          [-w, -element.bottom],
          [w, -element.bottom],
          [w, -h],
          [element.right, -h],
          [element.right, h],
          [w, h],
          [w, element.top],
          [-w, element.top],
          [-w, h],
          [-element.left, h],
          [-element.left, -h],
          [-w, -h],
        ],
      ]
      // An arm ending at the bar edge can repeat a vertex; remove redundant points.
      contours[0] = contours[0].filter((point, index, points) => {
        const previous = points[(index + points.length - 1) % points.length]
        return point[0] !== previous[0] || point[1] !== previous[1]
      })
      break
    }
    case 'circle': {
      // A bounded geometric error is preferable to a fixed segment count.
      const segments = Math.max(
        32,
        Math.ceil(
          Math.PI /
            Math.acos(Math.max(-1, 1 - CIRCLE_CHORD_ERROR_MM / element.radius)),
        ),
      )
      const circle = (radius: number, clockwise = false): PatternPoint[] =>
        Array.from({ length: segments }, (_, index) => {
          const angle = ((clockwise ? -1 : 1) * index * Math.PI * 2) / segments
          return [Math.cos(angle) * radius, Math.sin(angle) * radius]
        })
      contours = [circle(element.radius)]
      if (element.innerRadius > 0)
        contours.push(circle(element.innerRadius, true))
      break
    }
    case 'polygon': {
      const points = element.points.map(([x, y]): PatternPoint => [x, y])
      if (polygonSignedArea(points) < 0) points.reverse()
      contours = [points]
      break
    }
    case 'svg':
      contours = element.contours.map((contour) =>
        contour.map(([x, y]): PatternPoint => [
          x * element.width,
          y * element.height,
        ]),
      )
      break
    case 'text':
      contours = getTextContours(
        element.text,
        element.fontId,
        element.fontSize,
        element.fontWeight,
      )
      break
  }
  const angle = (element.rotation * Math.PI) / 180,
    cosine = Math.cos(angle),
    sine = Math.sin(angle)
  return contours.map((points) =>
    points.map(([x, y]): PatternPoint => [
      element.x + x * cosine - y * sine,
      element.y + x * sine + y * cosine,
    ]),
  )
}

export type StripeGeneratorOptions = {
  count: number
  angle: number
  gap: number
  colors?: string[]
  weights?: number[]
}

/** Append an editable group. Rotation is CCW: 0° orders left→right; 270° top→bottom. */
export function generateStripes(
  input: MulticolorSettings,
  options: StripeGeneratorOptions,
): MulticolorSettings {
  const settings = normalizeMulticolorSettings(input)
  const { count, gap } = options
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    settings.elements.length + count > MULTICOLOR_LIMITS.elements
  )
    throw new MulticolorValidationError(
      `Choose a stripe count that keeps the total at ${MULTICOLOR_LIMITS.elements} elements or fewer.`,
    )
  if (!Number.isFinite(options.angle) || !Number.isFinite(gap) || gap < 0)
    throw new MulticolorValidationError(
      'Stripe angle and nonnegative gap must be finite.',
    )
  const weights = options.weights ?? Array.from({ length: count }, () => 1)
  if (
    weights.length !== count ||
    weights.some((weight) => !Number.isFinite(weight) || weight <= 0)
  )
    throw new MulticolorValidationError(
      'Provide one positive weight for each stripe.',
    )
  const angle = (options.angle * Math.PI) / 180,
    cosine = Math.cos(angle),
    sine = Math.sin(angle)
  const span =
    Math.abs(cosine) * settings.frame.width +
    Math.abs(sine) * settings.frame.height
  const length =
    Math.abs(sine) * settings.frame.width +
    Math.abs(cosine) * settings.frame.height
  const available = span - gap * (count - 1)
  if (available <= 0)
    throw new MulticolorValidationError(
      'Stripe gaps leave no room for the stripes. Reduce the gap or count.',
    )
  const colors =
    options.colors ??
    (settings.materials.length
      ? settings.materials.map((material) => material.color)
      : ['#f45427', '#eeeae1', '#303538'])
  if (!colors.length || colors.some((color) => !/^#[0-9a-f]{6}$/i.test(color)))
    throw new MulticolorValidationError(
      'Choose at least one valid six-digit hex stripe color.',
    )
  const materialIds = colors.map((color) => {
    const normalized = color.toLowerCase()
    const existing = settings.materials.find(
      (material) => material.color === normalized,
    )
    if (existing) return existing.id
    const id = createPatternId('material')
    settings.materials.push({
      id,
      name: `Color ${settings.materials.length + 1}`,
      color: normalized,
    })
    return id
  })
  const groupId = createPatternId('stripes')
  settings.groups.push({
    id: groupId,
    name: `${count} stripes`,
    generator: {
      type: 'stripes',
      count,
      angle: options.angle,
      gap,
      ...(options.weights ? { weights: [...weights] } : {}),
    },
  })
  const totalWeight = weights.reduce((total, weight) => total + weight, 0)
  let cursor = -span / 2
  for (let index = 0; index < count; index += 1) {
    const width = (available * weights[index]) / totalWeight
    const center = cursor + width / 2
    const element = createPatternElement(
      'stripe',
      settings.frame,
      materialIds[index % materialIds.length],
    )
    settings.elements.push({
      ...element,
      kind: 'stripe',
      name: `Stripe ${index + 1}`,
      groupId,
      x: settings.frame.centerX + center * cosine,
      y: settings.frame.centerY + center * sine,
      rotation: options.angle,
      width,
      height: length,
    })
    cursor += width + gap
  }
  settings.enabled = true
  delete settings.preset
  return normalizeMulticolorSettings(settings)
}

/** Uniformly fit artwork without stretching circular or rotated primitives. */
export function fitMulticolorArtwork(
  input: MulticolorSettings,
  target: PatternFrame,
): MulticolorSettings {
  const settings = normalizeMulticolorSettings(input)
  const scale = Math.min(
    target.width / settings.frame.width,
    target.height / settings.frame.height,
  )
  if (!Number.isFinite(scale) || scale <= 0)
    throw new MulticolorValidationError(
      'The destination frame must have positive dimensions.',
    )
  const source = settings.frame
  settings.elements = settings.elements.map((element): PatternElement => {
    const common = {
      ...element,
      x: target.centerX + (element.x - source.centerX) * scale,
      y: target.centerY + (element.y - source.centerY) * scale,
    }
    switch (element.kind) {
      case 'stripe':
        return {
          ...common,
          kind: 'stripe',
          width: element.width * scale,
          height: element.height * scale,
        }
      case 'cross':
        return {
          ...common,
          kind: 'cross',
          left: element.left * scale,
          right: element.right * scale,
          top: element.top * scale,
          bottom: element.bottom * scale,
          horizontalThickness: element.horizontalThickness * scale,
          verticalThickness: element.verticalThickness * scale,
        }
      case 'circle':
        return {
          ...common,
          kind: 'circle',
          radius: element.radius * scale,
          innerRadius: element.innerRadius * scale,
        }
      case 'polygon':
        return {
          ...common,
          kind: 'polygon',
          points: element.points.map(([x, y]) => [x * scale, y * scale]),
        }
      case 'svg':
        return {
          ...element,
          x: common.x,
          y: common.y,
          width: element.width * scale,
          height: element.height * scale,
        }
      case 'text':
        return {
          ...element,
          x: common.x,
          y: common.y,
          fontSize: element.fontSize * scale,
        }
    }
  })
  settings.frame = {
    centerX: target.centerX,
    centerY: target.centerY,
    width: source.width * scale,
    height: source.height * scale,
  }
  settings.groups = settings.groups.map((group) =>
    group.generator
      ? {
          ...group,
          generator: { ...group.generator, gap: group.generator.gap * scale },
        }
      : group,
  )
  return normalizeMulticolorSettings(settings)
}
