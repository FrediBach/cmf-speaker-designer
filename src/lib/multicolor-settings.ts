import { validatePatternText } from './multicolor-fonts'
import {
  PATTERN_FONTS,
  getPatternFont,
  type PatternFontId,
  type PatternFontWeight,
} from './multicolor-font-catalog'

export {
  PATTERN_FONTS,
  PATTERN_FONT_WEIGHT_LABELS,
  getPatternFont,
  nearestPatternFontWeight,
  type PatternFontId,
  type PatternFontWeight,
} from './multicolor-font-catalog'

export type PatternKind =
  'stripe' | 'cross' | 'circle' | 'polygon' | 'svg' | 'text'
export type PatternFrame = {
  centerX: number
  centerY: number
  width: number
  height: number
}
export type PatternMaterial = { id: string; name: string; color: string }
export type PatternPoint = [number, number]
export type ElementCommon = {
  id: string
  name: string
  visible: boolean
  materialId: string
  groupId?: string
  x: number
  y: number
  rotation: number
}
export type PatternElement = ElementCommon &
  (
    | { kind: 'stripe'; width: number; height: number }
    | {
        kind: 'cross'
        left: number
        right: number
        top: number
        bottom: number
        horizontalThickness: number
        verticalThickness: number
      }
    | { kind: 'circle'; radius: number; innerRadius: number }
    | { kind: 'polygon'; points: PatternPoint[] }
    | {
        kind: 'svg'
        sourceName: string
        width: number
        height: number
        /** Centered unit contours, with counterclockwise exteriors and clockwise holes. */
        contours: PatternPoint[][]
      }
    | {
        kind: 'text'
        text: string
        fontId: PatternFontId
        fontWeight: PatternFontWeight
        fontSize: number
      }
  )
export type PatternGroup = {
  id: string
  name: string
  generator?: {
    type: 'stripes'
    count: number
    angle: number
    gap: number
    weights?: number[]
  }
}
export type MulticolorSettings = {
  version: 1
  enabled: boolean
  mapping: 'front-projection'
  depthMode: 'full-depth'
  frame: PatternFrame
  materials: PatternMaterial[]
  elements: PatternElement[]
  groups: PatternGroup[]
  preset?: { id: string; revision: number; layout: 'panel' | 'proportional' }
}

/** Browser resource limits, not restrictions on flag recipes. */
export const MULTICOLOR_LIMITS = {
  elements: 128,
  polygonVertices: 128,
  svgBytes: 256 * 1024,
  vectorContours: 512,
  vectorVertices: 20_000,
  textLength: 120,
  materials: 128,
  groups: 128,
  coordinate: 10_000,
  nameLength: 80,
  idLength: 100,
  payloadBytes: 512_000,
} as const

export class MulticolorValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MulticolorValidationError'
  }
}

export function getDefaultMulticolorSettings(
  model: 's' | 'm' = 's',
): MulticolorSettings {
  return {
    version: 1,
    enabled: false,
    mapping: 'front-projection',
    depthMode: 'full-depth',
    frame: {
      centerX: 0,
      centerY: 0,
      width: 85,
      height: model === 'm' ? 225 : 131,
    },
    materials: [],
    elements: [],
    groups: [],
  }
}

export function normalizePatternAngle(value: number): number {
  return ((value % 360) + 360) % 360
}

const fail = (message: string): never => {
  throw new MulticolorValidationError(message)
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail(`${label} must be an object.`)
  return value as Record<string, unknown>
}
function number(value: unknown, label: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.abs(value) > MULTICOLOR_LIMITS.coordinate
  )
    return fail(
      `${label} must be a finite number between -${MULTICOLOR_LIMITS.coordinate} and ${MULTICOLOR_LIMITS.coordinate}.`,
    )
  return value
}
function positive(value: unknown, label: string, fallback?: number): number {
  const result = number(value, label, fallback)
  if (result <= 0) return fail(`${label} must be greater than zero.`)
  return result
}
function text(
  value: unknown,
  label: string,
  fallback?: string,
  max: number = MULTICOLOR_LIMITS.nameLength,
): string {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    return fail(`${label} must contain 1–${max} characters.`)
  return value.trim()
}
function identifier(value: unknown, label: string): string {
  const id = text(value, label, undefined, MULTICOLOR_LIMITS.idLength)
  if (!/^[a-zA-Z0-9_.:-]+$/.test(id))
    return fail(`${label} contains unsupported characters.`)
  return id
}
function list(value: unknown, label: string, max: number): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) return fail(`${label} must be a list.`)
  if (value.length > max)
    return fail(
      `${label} supports at most ${max} entries. Nothing was removed.`,
    )
  return value
}
function unique(id: string, ids: Set<string>, label: string) {
  if (ids.has(id)) fail(`${label} contains duplicate ID “${id}”.`)
  ids.add(id)
}
function boolean(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') return fail(`${label} must be true or false.`)
  return value
}

export function polygonSignedArea(points: readonly PatternPoint[]): number {
  return (
    points.reduce((area, [x, y], index) => {
      const [nextX, nextY] = points[(index + 1) % points.length]
      return area + x * nextY - nextX * y
    }, 0) / 2
  )
}

/** Reject crossings and touching nonadjacent edges, which cannot define one simple contour. */
export function isSimplePatternPolygon(
  points: readonly PatternPoint[],
): boolean {
  if (points.length < 3 || Math.abs(polygonSignedArea(points)) < 1e-8)
    return false
  const cross = (a: PatternPoint, b: PatternPoint, c: PatternPoint) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const onSegment = (a: PatternPoint, b: PatternPoint, p: PatternPoint) =>
    Math.abs(cross(a, b, p)) < 1e-8 &&
    p[0] >= Math.min(a[0], b[0]) - 1e-8 &&
    p[0] <= Math.max(a[0], b[0]) + 1e-8 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-8 &&
    p[1] <= Math.max(a[1], b[1]) + 1e-8
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i],
      b = points[(i + 1) % points.length]
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-8) return false
    for (let j = i + 1; j < points.length; j += 1) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue
      const c = points[j],
        d = points[(j + 1) % points.length]
      const abC = cross(a, b, c),
        abD = cross(a, b, d),
        cdA = cross(c, d, a),
        cdB = cross(c, d, b)
      if (
        (abC * abD < 0 && cdA * cdB < 0) ||
        onSegment(a, b, c) ||
        onSegment(a, b, d) ||
        onSegment(c, d, a) ||
        onSegment(c, d, b)
      )
        return false
    }
  }
  return true
}

/** Additive legacy defaults, with explicit rejection rather than partial imports. */
export function normalizeMulticolorSettings(
  input: unknown,
  model: 's' | 'm' = 's',
): MulticolorSettings {
  const defaults = getDefaultMulticolorSettings(model)
  if (input === undefined || input === null) return defaults
  const data = record(input, 'Multicolor settings')
  if (data.version !== undefined && data.version !== 1)
    fail('This multicolor document uses an unsupported version.')
  if (data.mapping !== undefined && data.mapping !== 'front-projection')
    fail('Unsupported multicolor mapping.')
  if (data.depthMode !== undefined && data.depthMode !== 'full-depth')
    fail('Unsupported multicolor depth mode.')
  const rawFrame =
    data.frame === undefined ? {} : record(data.frame, 'Artwork frame')
  const frame: PatternFrame = {
    centerX: number(rawFrame.centerX, 'Frame X', defaults.frame.centerX),
    centerY: number(rawFrame.centerY, 'Frame Y', defaults.frame.centerY),
    width: positive(rawFrame.width, 'Frame width', defaults.frame.width),
    height: positive(rawFrame.height, 'Frame height', defaults.frame.height),
  }
  const materialIds = new Set(['base'])
  const materials = list(
    data.materials,
    'Materials',
    MULTICOLOR_LIMITS.materials,
  ).map((raw): PatternMaterial => {
    const material = record(raw, 'Material')
    const id = identifier(material.id, 'Material ID')
    unique(id, materialIds, 'Materials')
    if (
      typeof material.color !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(material.color)
    )
      fail('Material colors must be opaque six-digit hex colors.')
    return {
      id,
      name: text(material.name, 'Material name', id),
      color: (material.color as string).toLowerCase(),
    }
  })
  const groupIds = new Set<string>()
  const groups = list(data.groups, 'Groups', MULTICOLOR_LIMITS.groups).map(
    (raw): PatternGroup => {
      const group = record(raw, 'Group')
      const id = identifier(group.id, 'Group ID')
      unique(id, groupIds, 'Groups')
      const result: PatternGroup = {
        id,
        name: text(group.name, 'Group name', 'Stripes'),
      }
      if (group.generator !== undefined) {
        const generator = record(group.generator, 'Stripe generator')
        if (generator.type !== 'stripes') fail('Unsupported group generator.')
        const count = positive(generator.count, 'Stripe count')
        if (!Number.isInteger(count) || count > MULTICOLOR_LIMITS.elements)
          fail(
            `Stripe count must be an integer from 1 to ${MULTICOLOR_LIMITS.elements}.`,
          )
        const gap = number(generator.gap, 'Stripe gap', 0)
        if (gap < 0) fail('Stripe gap cannot be negative.')
        let weights: number[] | undefined
        if (generator.weights !== undefined) {
          weights = list(
            generator.weights,
            'Stripe weights',
            MULTICOLOR_LIMITS.elements,
          ).map((weight) => positive(weight, 'Stripe weight'))
          if (weights.length !== count)
            fail('Stripe weights must match the stripe count.')
        }
        result.generator = {
          type: 'stripes',
          count,
          angle: normalizePatternAngle(
            number(generator.angle, 'Stripe angle', 0),
          ),
          gap,
          ...(weights ? { weights } : {}),
        }
      }
      return result
    },
  )
  const elementIds = new Set<string>()
  const elements = list(
    data.elements,
    'Elements',
    MULTICOLOR_LIMITS.elements,
  ).map((raw): PatternElement => {
    const element = record(raw, 'Element')
    const id = identifier(element.id, 'Element ID')
    unique(id, elementIds, 'Elements')
    const materialId =
      element.materialId === undefined
        ? 'base'
        : identifier(element.materialId, 'Element material')
    if (!materialIds.has(materialId))
      fail(`Element “${id}” references a missing material.`)
    const groupId =
      element.groupId === undefined
        ? undefined
        : identifier(element.groupId, 'Element group')
    if (groupId && !groupIds.has(groupId))
      fail(`Element “${id}” references a missing group.`)
    const common: ElementCommon = {
      id,
      name: text(element.name, 'Element name', id),
      visible: boolean(element.visible, 'Element visibility', true),
      materialId,
      ...(groupId ? { groupId } : {}),
      x: number(element.x, 'Element X', 0),
      y: number(element.y, 'Element Y', 0),
      rotation: normalizePatternAngle(
        number(element.rotation, 'Element rotation', 0),
      ),
    }
    switch (element.kind) {
      case 'stripe':
        return {
          ...common,
          kind: 'stripe',
          width: positive(element.width, 'Stripe width'),
          height: positive(element.height, 'Stripe height'),
        }
      case 'cross': {
        const left = positive(element.left, 'Left arm'),
          right = positive(element.right, 'Right arm'),
          top = positive(element.top, 'Top arm'),
          bottom = positive(element.bottom, 'Bottom arm')
        const horizontalThickness = positive(
            element.horizontalThickness,
            'Horizontal thickness',
          ),
          verticalThickness = positive(
            element.verticalThickness,
            'Vertical thickness',
          )
        if (
          Math.min(left, right) < verticalThickness / 2 ||
          Math.min(top, bottom) < horizontalThickness / 2
        )
          fail(
            'Cross arms must extend at least halfway across the intersecting bar thickness.',
          )
        return {
          ...common,
          kind: 'cross',
          left,
          right,
          top,
          bottom,
          horizontalThickness,
          verticalThickness,
        }
      }
      case 'circle': {
        const radius = positive(element.radius, 'Circle radius'),
          innerRadius = number(element.innerRadius, 'Inner radius', 0)
        if (innerRadius < 0 || innerRadius >= radius)
          fail('Inner radius must be zero or smaller than the outer radius.')
        return { ...common, kind: 'circle', radius, innerRadius }
      }
      case 'polygon': {
        const points = list(
          element.points,
          'Polygon vertices',
          MULTICOLOR_LIMITS.polygonVertices,
        ).map((rawPoint): PatternPoint => {
          if (!Array.isArray(rawPoint) || rawPoint.length !== 2)
            return fail('Each polygon vertex must contain X and Y coordinates.')
          return [
            number(rawPoint[0], 'Vertex X'),
            number(rawPoint[1], 'Vertex Y'),
          ]
        })
        if (!isSimplePatternPolygon(points))
          fail(
            `Polygon “${common.name}” vertices must form a nonzero simple shape without crossing edges.`,
          )
        return { ...common, kind: 'polygon', points }
      }
      case 'svg': {
        let vertexCount = 0
        const contours = list(
          element.contours,
          'SVG contours',
          MULTICOLOR_LIMITS.vectorContours,
        ).map((rawContour): PatternPoint[] => {
          const points = list(
            rawContour,
            'SVG contour points',
            MULTICOLOR_LIMITS.vectorVertices,
          ).map((rawPoint): PatternPoint => {
            if (!Array.isArray(rawPoint) || rawPoint.length !== 2)
              return fail('Each SVG point must contain X and Y coordinates.')
            const x = number(rawPoint[0], 'SVG point X')
            const y = number(rawPoint[1], 'SVG point Y')
            if (Math.abs(x) > 0.500001 || Math.abs(y) > 0.500001)
              fail('SVG contours must fit within their normalized bounds.')
            return [x, y]
          })
          vertexCount += points.length
          if (vertexCount > MULTICOLOR_LIMITS.vectorVertices)
            fail(
              `SVG shapes support at most ${MULTICOLOR_LIMITS.vectorVertices} points.`,
            )
          if (points.length < 3 || Math.abs(polygonSignedArea(points)) < 1e-12)
            fail('SVG contours must enclose a nonzero area.')
          return points
        })
        if (!contours.length) fail('The SVG needs at least one filled contour.')
        return {
          ...common,
          kind: 'svg',
          sourceName: text(
            element.sourceName,
            'SVG file name',
            'Artwork.svg',
            255,
          ),
          width: positive(element.width, 'SVG width'),
          height: positive(element.height, 'SVG height'),
          contours,
        }
      }
      case 'text': {
        const content = text(
          element.text,
          'Text',
          undefined,
          MULTICOLOR_LIMITS.textLength,
        )
        if (!PATTERN_FONTS.some(({ id }) => id === element.fontId))
          fail('Choose a supported text font.')
        const fontId = element.fontId as PatternFontId
        const fontWeight = number(
          element.fontWeight,
          'Font weight',
          400,
        ) as PatternFontWeight
        if (!getPatternFont(fontId).weights.includes(fontWeight))
          fail('Choose a weight available for the selected font.')
        validatePatternText(content, fontId, fontWeight)
        return {
          ...common,
          kind: 'text',
          text: content,
          fontId,
          fontWeight,
          fontSize: positive(element.fontSize, 'Font size'),
        }
      }
      default:
        return fail('Unsupported pattern element kind.')
    }
  })
  const settings: MulticolorSettings = {
    ...defaults,
    enabled: boolean(data.enabled, 'Multicolor enabled', false),
    frame,
    materials,
    groups,
    elements,
  }
  if (data.preset !== undefined) {
    const preset = record(data.preset, 'Preset metadata')
    const revision = positive(preset.revision, 'Preset revision', 1)
    if (!Number.isInteger(revision)) fail('Preset revision must be an integer.')
    if (preset.layout !== 'panel' && preset.layout !== 'proportional')
      fail('Unsupported preset layout.')
    settings.preset = {
      id: identifier(preset.id, 'Preset ID'),
      revision,
      layout: preset.layout as 'panel' | 'proportional',
    }
  }
  if (
    new TextEncoder().encode(JSON.stringify(settings)).length >
    MULTICOLOR_LIMITS.payloadBytes
  )
    fail(
      'The multicolor document exceeds the supported payload size. Nothing was removed.',
    )
  return settings
}
