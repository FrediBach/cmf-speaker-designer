import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import {
  SVG_MAX_FILE_SIZE,
  normalizeSvgCutout,
  type SvgCutout,
  type SvgPoint,
} from './svg-cutout'

const MAX_POINTS = 4096
const MAX_CONTOURS = 256
const MAX_PATHS = 128
const COMPLEXITY_ERROR =
  'This SVG is too complex. Simplify the paths and upload it again (maximum 4,096 points).'
const EMPTY_ERROR =
  'This SVG has no visible filled shapes. Convert text and strokes to filled paths before uploading.'
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000 || 0
}

function samePoint(a: SvgPoint, b: SvgPoint) {
  return a[0] === b[0] && a[1] === b[1]
}

// Unlike signed area, this also accepts valid self-intersecting filled paths.
function hasArea(points: SvgPoint[]) {
  const a = points[0]
  const b = points[1]
  return points
    .slice(2)
    .some(
      (c) =>
        Math.abs(
          (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
        ) > 1e-12,
    )
}

const SHAPES = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'polygon',
  'polyline',
  'line',
])
const GEOMETRY_ATTRIBUTES = [
  'd',
  'points',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'rx',
  'ry',
  'r',
  'cx',
  'cy',
]
const NUMBER = /[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?/gi

function numbers(source: string) {
  const tokens = source.match(NUMBER) ?? []
  if (
    source.replace(NUMBER, '').replace(/[\s,]/g, '') ||
    tokens.some((token) => !Number.isFinite(Number(token)))
  )
    throw new Error(
      'The SVG contains invalid coordinates. Re-export it and try again.',
    )
  return tokens.map(Number)
}

function arcNumbers(source: string) {
  const values: number[] = []
  let remaining = source
  while (remaining.replace(/[\s,]/g, '')) {
    remaining = remaining.replace(/^[\s,]+/, '')
    const position = values.length % 7
    const token = remaining.match(
      position === 3 || position === 4
        ? /^[01]/
        : /^[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?/i,
    )
    if (!token || !Number.isFinite(Number(token[0])))
      throw new Error(
        'The SVG contains an invalid arc. Re-export it and try again.',
      )
    values.push(Number(token[0]))
    remaining = remaining.slice(token[0].length)
  }
  return values
}

function normalizePath(source: string) {
  if (!source.trim() || source.trim() === 'none') return source
  if (!/^\s*[mM]/.test(source))
    throw new Error(
      'The SVG contains an invalid path. Re-export it and try again.',
    )
  const counts: Record<string, number> = {
    m: 2,
    l: 2,
    h: 1,
    v: 1,
    c: 6,
    s: 4,
    q: 4,
    t: 2,
    a: 7,
    z: 0,
  }
  const commands = source.match(/[a-df-z][^a-df-z]*/gi) ?? []
  const normalized: string[] = []
  let previous = ''
  for (const command of commands) {
    const kind = command[0].toLowerCase()
    // SVGLoader shares one reflected control between quadratic/cubic curves.
    // Reject this rare unsupported combination instead of altering the artwork.
    if (
      (kind === 's' && ['q', 't', 'z'].includes(previous)) ||
      (kind === 't' && ['c', 's', 'z'].includes(previous))
    )
      throw new Error(
        'Expand mixed SVG smooth curves into explicit curve commands before uploading.',
      )
    previous = kind
    const count = counts[kind]
    const values =
      kind === 'a' ? arcNumbers(command.slice(1)) : numbers(command.slice(1))
    if (
      count === undefined ||
      (count === 0
        ? values.length !== 0
        : !values.length || values.length % count !== 0)
    )
      throw new Error(
        'The SVG contains an invalid path. Re-export it and try again.',
      )
    if (kind === 'a') {
      for (let index = 0; index < values.length; index += 7) {
        if (
          values[index] < 0 ||
          values[index + 1] < 0 ||
          ![0, 1].includes(values[index + 3]) ||
          ![0, 1].includes(values[index + 4])
        )
          throw new Error(
            'The SVG contains an invalid arc. Re-export it and try again.',
          )
      }
    }
    normalized.push(`${command[0]}${values.join(' ')}`)
  }
  return normalized.join(' ')
}

function normalizeTransform(source: string) {
  const expression = /([a-z]+)\s*\(([^)]*)\)/gi
  const transforms = Array.from(source.matchAll(expression))
  if (source.replace(expression, '').replace(/[\s,]/g, ''))
    throw new Error(
      'The SVG contains an unsupported transform. Flatten transforms before uploading.',
    )
  const counts: Record<string, number[]> = {
    matrix: [6],
    translate: [1, 2],
    scale: [1, 2],
    rotate: [1, 3],
    skewX: [1],
    skewY: [1],
  }
  return transforms
    .map((transform) => {
      const values = numbers(transform[2])
      if (!counts[transform[1]]?.includes(values.length))
        throw new Error(
          'The SVG contains an unsupported transform. Flatten transforms before uploading.',
        )
      return `${transform[1]}(${values.join(' ')})`
    })
    .join(' ')
}

type FillStyle = {
  fill: string
  fillRule: 'nonzero' | 'evenodd'
  fillOpacity: number
  stroke: string
  strokeOpacity: number
  strokeWidth: number
  visibility: string
}

function numericStyle(value: string, fallback: number) {
  if (!value || value === 'inherit') return fallback
  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric))
    throw new Error(
      'The SVG contains an invalid style. Re-export it as filled paths.',
    )
  return value.endsWith('%') ? numeric / 100 : numeric
}

function transparentPaint(paint: string) {
  if (paint === 'none' || paint === 'transparent') return true
  if (/^#[\da-f]{4}$/i.test(paint)) return paint.endsWith('0')
  if (/^#[\da-f]{8}$/i.test(paint)) return paint.endsWith('00')
  const alpha = paint.match(/(?:\/|,)[\s]*([\d.]+%?)\s*\)$/)
  return (
    !!alpha &&
    Number.parseFloat(alpha[1]) === 0 &&
    (/^(?:rgba|hsla)\(/i.test(paint) || paint.includes('/'))
  )
}

/** Parse an inert SVG document; only numeric geometry is retained or rendered. */
export function parseSvgCutout(source: string, name: string): SvgCutout {
  if (new TextEncoder().encode(source).length > SVG_MAX_FILE_SIZE)
    throw new Error('Choose an SVG smaller than 256 KB.')
  if (/<!ENTITY/i.test(source))
    throw new Error(
      'SVG entities are not supported. Re-export the SVG as filled paths.',
    )
  if (/<\?xml-stylesheet/i.test(source))
    throw new Error(
      'Export this SVG with inline styles instead of an external stylesheet.',
    )
  const document = new DOMParser().parseFromString(source, 'image/svg+xml')
  const root = document.documentElement
  if (
    document.querySelector('parsererror') ||
    root.localName !== 'svg' ||
    (root.namespaceURI && root.namespaceURI !== SVG_NAMESPACE)
  )
    throw new Error(
      'This file is not a valid SVG. Choose an SVG with filled paths.',
    )

  // SVGLoader does not consistently handle display, group opacity or all CSS.
  // Resolve the supported style subset and serialize a fresh, inert geometry tree.
  const cleanDocument = document.implementation.createDocument(
    SVG_NAMESPACE,
    'svg',
  )
  let elementCount = 0
  let shapeCount = 0
  const visit = (
    node: Element,
    target: Element,
    inherited: FillStyle,
    depth: number,
  ) => {
    if (++elementCount > 1024 || depth > 64) throw new Error(COMPLEXITY_ERROR)
    const tag = node.localName
    if (['title', 'desc', 'metadata'].includes(tag)) return
    if (tag === 'style')
      throw new Error(
        'Export this SVG with inline styles or presentation attributes instead of a stylesheet.',
      )
    if (tag === 'defs') {
      if (node.querySelector('style'))
        throw new Error(
          'Export this SVG with inline styles or presentation attributes instead of a stylesheet.',
        )
      return
    }
    if (tag === 'text' || tag === 'tspan' || tag === 'textPath')
      throw new Error('Convert SVG text to filled paths before uploading.')
    if (tag === 'svg' && node !== root)
      throw new Error(
        'Nested SVGs are not supported. Flatten the SVG before uploading.',
      )
    if (!SHAPES.has(tag) && tag !== 'g' && tag !== 'svg')
      throw new Error(
        `SVG ${tag} elements are not supported. Expand the artwork into filled paths.`,
      )

    const inline = (node as SVGElement).style
    const property = (key: string) =>
      (inline?.getPropertyValue(key) || node.getAttribute(key) || '').trim()
    for (const effect of [
      'clip-path',
      'mask',
      'filter',
      'marker-start',
      'marker-mid',
      'marker-end',
    ]) {
      if (property(effect) && property(effect) !== 'none')
        throw new Error(
          'Expand SVG clips, masks, filters and markers into filled paths before uploading.',
        )
    }
    if (inline?.getPropertyValue('transform') || property('transform-origin'))
      throw new Error('Flatten CSS transforms in the SVG before uploading.')
    if (
      property('display') === 'none' ||
      numericStyle(property('opacity'), 1) <= 0
    )
      return
    const inheritedProperty = (key: string, fallback: string) => {
      const value = property(key)
      return !value || value === 'inherit' ? fallback : value
    }
    const fillRule = inheritedProperty('fill-rule', inherited.fillRule)
    if (fillRule !== 'evenodd' && fillRule !== 'nonzero')
      throw new Error(
        'This SVG uses an unsupported fill rule. Use evenodd or nonzero.',
      )
    const style: FillStyle = {
      fill: inheritedProperty('fill', inherited.fill),
      fillRule,
      fillOpacity: numericStyle(
        property('fill-opacity'),
        inherited.fillOpacity,
      ),
      stroke: inheritedProperty('stroke', inherited.stroke),
      strokeOpacity: numericStyle(
        property('stroke-opacity'),
        inherited.strokeOpacity,
      ),
      strokeWidth: numericStyle(
        property('stroke-width'),
        inherited.strokeWidth,
      ),
      visibility: inheritedProperty('visibility', inherited.visibility),
    }
    const clean = cleanDocument.createElementNS(
      SVG_NAMESPACE,
      tag === 'svg' ? 'g' : tag,
    )
    const transform = node.getAttribute('transform')
    if (transform) {
      clean.setAttribute('transform', normalizeTransform(transform))
    }
    if (SHAPES.has(tag)) {
      if (style.visibility === 'hidden' || style.visibility === 'collapse')
        return
      if (
        !transparentPaint(style.stroke) &&
        style.strokeOpacity > 0 &&
        style.strokeWidth > 0
      )
        throw new Error('Convert SVG strokes to filled paths before uploading.')
      if (transparentPaint(style.fill) || style.fillOpacity <= 0) return
      if (/url\s*\(/i.test(style.fill))
        throw new Error(
          'Replace SVG gradients and patterns with solid filled paths before uploading.',
        )
      if (++shapeCount > MAX_PATHS) throw new Error(COMPLEXITY_ERROR)
      for (const attribute of GEOMETRY_ATTRIBUTES) {
        const value = node.getAttribute(attribute)
        if (value === null) continue
        if (attribute === 'd') {
          clean.setAttribute(attribute, normalizePath(value))
          continue
        } else if (attribute === 'points') {
          const coordinates = numbers(value)
          if (coordinates.length % 2)
            throw new Error(
              'The SVG contains invalid polygon points. Re-export it and try again.',
            )
          clean.setAttribute(attribute, coordinates.join(' '))
          continue
        } else {
          const length = value
            .trim()
            .match(
              /^([+-]?(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?)(px|mm|cm|in|pt|pc)?$/i,
            )
          if (!length)
            throw new Error(
              'Use absolute SVG coordinates instead of percentages or relative units.',
            )
          const units: Record<string, number> = {
            px: 1,
            mm: 96 / 25.4,
            cm: 96 / 2.54,
            in: 96,
            pt: 96 / 72,
            pc: 16,
          }
          const coordinate =
            Number(length[1]) * units[length[2]?.toLowerCase() ?? 'px']
          if (
            !Number.isFinite(coordinate) ||
            (['width', 'height', 'r', 'rx', 'ry'].includes(attribute) &&
              coordinate < 0)
          )
            throw new Error(
              'The SVG contains invalid dimensions. Re-export it as filled paths.',
            )
          clean.setAttribute(attribute, String(coordinate))
          continue
        }
      }
      if (
        tag === 'rect' &&
        (clean.hasAttribute('rx') || clean.hasAttribute('ry'))
      ) {
        const rx = Number(clean.getAttribute('rx') ?? clean.getAttribute('ry'))
        const ry = Number(clean.getAttribute('ry') ?? clean.getAttribute('rx'))
        clean.setAttribute(
          'rx',
          String(Math.min(rx, Number(clean.getAttribute('width')) / 2)),
        )
        clean.setAttribute(
          'ry',
          String(Math.min(ry, Number(clean.getAttribute('height')) / 2)),
        )
      }
      clean.setAttribute('fill', '#000')
      clean.setAttribute('fill-rule', style.fillRule)
    }
    target.appendChild(clean)
    for (const child of node.children) visit(child, clean, style, depth + 1)
  }
  visit(
    root,
    cleanDocument.documentElement,
    {
      fill: '#000',
      fillRule: 'nonzero',
      fillOpacity: 1,
      stroke: 'none',
      strokeOpacity: 1,
      strokeWidth: 1,
      visibility: 'visible',
    },
    0,
  )

  let parsed: ReturnType<SVGLoader['parse']>
  try {
    parsed = new SVGLoader().parse(
      new XMLSerializer().serializeToString(cleanDocument),
    )
  } catch {
    throw new Error(
      'The SVG contains invalid geometry. Re-export it as filled paths.',
    )
  }

  let pointCount = 0
  let contourCount = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const paths: SvgCutout['paths'] = []
  for (const path of parsed.paths) {
    const contours: SvgPoint[][] = []
    for (const subPath of path.subPaths) {
      if (subPath.curves.length > MAX_POINTS || ++contourCount > MAX_CONTOURS)
        throw new Error(COMPLEXITY_ERROR)
      const points = subPath.getPoints(16).map(({ x, y }): SvgPoint => [x, y])
      if (points.length && samePoint(points[0], points[points.length - 1]))
        points.pop()
      if (
        points.some((point) =>
          point.some((coordinate) => !Number.isFinite(coordinate)),
        )
      )
        throw new Error(
          'The SVG contains invalid geometry. Re-export it as filled paths.',
        )
      if (points.length < 3 || !hasArea(points)) continue
      if ((pointCount += points.length) > MAX_POINTS)
        throw new Error(COMPLEXITY_ERROR)
      for (const [x, y] of points) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
      contours.push(points)
    }
    if (contours.length)
      paths.push({
        contours,
        fillRule:
          (path.userData?.style as { fillRule?: string } | undefined)
            ?.fillRule === 'evenodd'
            ? 'evenodd'
            : 'nonzero',
      })
  }
  const width = maxX - minX
  const height = maxY - minY
  if (!paths.length || width <= 0 || height <= 0) throw new Error(EMPTY_ERROR)
  if (width / height < 0.001 || width / height > 1000)
    throw new Error(
      'This SVG is too narrow. Use artwork with a wider filled shape.',
    )
  for (const path of paths) {
    for (const contour of path.contours) {
      for (const point of contour) {
        point[0] = round((point[0] - minX) / width - 0.5)
        point[1] = round((point[1] - minY) / height - 0.5)
      }
    }
  }
  const result = normalizeSvgCutout({
    name,
    aspectRatio: width / height,
    paths,
  })
  if (!result) throw new Error(EMPTY_ERROR)
  return result
}
