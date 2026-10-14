import type { SpeakerModel } from './panels'
import { normalizeSvgCutout, type SvgCutout } from './svg-cutout'
import {
  getRaceStripeIntervals,
  type RaceStripeSettings,
} from './race-stripe-settings'

export type HandleCutout = 'none' | 'circle' | 'slot' | 'slits' | 'svg'
export type HandleTopShape = 'straight' | 'outward' | 'inward'
export interface HandleSettings {
  mode: 'original' | 'custom'
  legoStuds: boolean
  height: number
  width: number
  cornerRadius: number
  topAngle: number
  topShape: HandleTopShape
  topCurve: number
  cutout: HandleCutout
  svgCutout: SvgCutout | null
  holeCount: number
  holeWidth: number
  holeHeight: number
  holeGap: number
  offsetX: number
  offsetY: number
}
export type HandleNumericKey = Exclude<
  keyof HandleSettings,
  'mode' | 'legoStuds' | 'cutout' | 'svgCutout' | 'topShape'
>
export type HandleLimits = Record<
  HandleNumericKey,
  { min: number; max: number }
>

export const HANDLE_THICKNESS = 4
export const HANDLE_MIN_WEB = 3
export const HANDLE_SHOULDER_HEIGHT = 4
export const HANDLE_STUD_DIAMETER = 4.8
export const HANDLE_STUD_HEIGHT = 1.8
export const HANDLE_STUD_PITCH = 8
export const DEFAULT_HANDLE_SETTINGS: HandleSettings = {
  mode: 'original',
  legoStuds: false,
  height: 24,
  width: 85,
  cornerRadius: 3,
  topAngle: 0,
  topShape: 'straight',
  topCurve: 10,
  cutout: 'slot',
  svgCutout: null,
  holeCount: 1,
  holeWidth: 40,
  holeHeight: 12,
  holeGap: 6,
  offsetX: 0,
  offsetY: 0,
}

export function getDefaultHandleSettings(model: SpeakerModel): HandleSettings {
  return { ...DEFAULT_HANDLE_SETTINGS, height: model === 's' ? 24 : 27 }
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)
const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

function topLimits(height: number, width: number, radius: number, angle = 0) {
  const room = height - HANDLE_SHOULDER_HEIGHT - HANDLE_MIN_WEB - radius
  return {
    angle: Math.min(45, (Math.atan(room / width) * 180) / Math.PI),
    curve: Math.max(
      0,
      Math.min(30, room - width * Math.abs(Math.tan((angle * Math.PI) / 180))),
    ),
  }
}

/**
 * Bound requested openings to the flat handle's conservative interior, keeping
 * their spacing and dimensions stable when the top profile changes. Geometry
 * helpers omit individual openings that cannot retain a 3 mm web in that profile.
 * The bottom 4 mm is a shoulder joining the original-width attachment collar.
 */
export function normalizeHandleSettings(
  model: SpeakerModel,
  input: Partial<HandleSettings> = {},
): HandleSettings {
  const defaults = getDefaultHandleSettings(model)
  const height = clamp(finite(input.height, defaults.height), 16, 70)
  const width = clamp(finite(input.width, defaults.width), 60, 110)
  const cornerRadius = clamp(
    finite(input.cornerRadius, defaults.cornerRadius),
    0,
    Math.min(16, (width - 30) / 2, (height - 4) / 2),
  )
  const maxAngle = topLimits(height, width, cornerRadius).angle
  const topAngle = clamp(
    finite(input.topAngle, defaults.topAngle),
    -maxAngle,
    maxAngle,
  )
  const topShape =
    input.topShape === 'outward' || input.topShape === 'inward'
      ? input.topShape
      : 'straight'
  const topCurve = clamp(
    finite(input.topCurve, defaults.topCurve),
    0,
    topLimits(height, width, cornerRadius, topAngle).curve,
  )
  const cutout =
    input.cutout === 'none' ||
    input.cutout === 'circle' ||
    input.cutout === 'slot' ||
    input.cutout === 'slits' ||
    input.cutout === 'svg'
      ? input.cutout
      : defaults.cutout
  const svgCutout = normalizeSvgCutout(input.svgCutout)
  const aspectRatio = svgCutout?.aspectRatio ?? 1
  const slits = cutout === 'slits'
  const availableWidth = width - 2 * (cornerRadius + HANDLE_MIN_WEB)
  const availableHeight = height - HANDLE_SHOULDER_HEIGHT - 2 * HANDLE_MIN_WEB
  const maxDepth = height - HANDLE_SHOULDER_HEIGHT - HANDLE_MIN_WEB
  const minWidth = slits ? 3 : 6
  const maxCount = slits ? Math.min(7, Math.floor((availableWidth + 3) / 6)) : 3
  const holeCount =
    cutout === 'svg'
      ? 1
      : clamp(
          Math.round(finite(input.holeCount, defaults.holeCount)),
          1,
          maxCount,
        )
  const maxGap =
    holeCount > 1
      ? Math.min(20, (availableWidth - holeCount * minWidth) / (holeCount - 1))
      : 20
  const holeGap = clamp(finite(input.holeGap, defaults.holeGap), 3, maxGap)
  const maxWidth = Math.min(
    64,
    (availableWidth - (holeCount - 1) * holeGap) / holeCount,
    cutout === 'circle'
      ? availableHeight
      : cutout === 'svg'
        ? availableHeight * aspectRatio
        : slits
          ? maxDepth * 2
          : 64,
  )
  const holeWidth = clamp(
    finite(input.holeWidth, defaults.holeWidth),
    cutout === 'svg' ? Math.min(6, maxWidth) : minWidth,
    maxWidth,
  )
  const holeHeight =
    cutout === 'circle'
      ? holeWidth
      : cutout === 'svg'
        ? holeWidth / aspectRatio
        : slits
          ? clamp(
              finite(input.holeHeight, defaults.holeHeight),
              Math.max(3, holeWidth / 2),
              maxDepth,
            )
          : clamp(
              finite(input.holeHeight, defaults.holeHeight),
              6,
              Math.min(30, availableHeight, holeWidth),
            )
  const groupWidth = holeCount * holeWidth + (holeCount - 1) * holeGap
  const xRoom = Math.min(30, Math.max(0, (availableWidth - groupWidth) / 2))
  const yRoom = Math.min(24, Math.max(0, (availableHeight - holeHeight) / 2))
  return {
    mode: input.mode === 'custom' ? 'custom' : 'original',
    legoStuds: input.legoStuds === true,
    height,
    width,
    cornerRadius,
    topAngle,
    topShape,
    topCurve,
    cutout,
    svgCutout,
    holeCount,
    holeWidth,
    holeHeight,
    holeGap,
    offsetX: clamp(finite(input.offsetX, defaults.offsetX), -xRoom, xRoom),
    offsetY: slits
      ? 0
      : clamp(finite(input.offsetY, defaults.offsetY), -yRoom, yRoom),
  }
}

export function getHandleLimits(
  model: SpeakerModel,
  input: Partial<HandleSettings>,
): HandleLimits {
  const settings = normalizeHandleSettings(model, input)
  const availableWidth =
    settings.width - 2 * (settings.cornerRadius + HANDLE_MIN_WEB)
  const availableHeight =
    settings.height - HANDLE_SHOULDER_HEIGHT - 2 * HANDLE_MIN_WEB
  const slits = settings.cutout === 'slits'
  const maxDepth = settings.height - HANDLE_SHOULDER_HEIGHT - HANDLE_MIN_WEB
  const minWidth = slits ? 3 : 6
  const groupWidth =
    settings.holeCount * settings.holeWidth +
    (settings.holeCount - 1) * settings.holeGap
  const xRoom = Math.min(30, Math.max(0, (availableWidth - groupWidth) / 2))
  const yRoom = Math.min(
    24,
    Math.max(0, (availableHeight - settings.holeHeight) / 2),
  )
  const maxWidth = Math.min(
    64,
    (availableWidth - (settings.holeCount - 1) * settings.holeGap) /
      settings.holeCount,
    settings.cutout === 'circle'
      ? availableHeight
      : settings.cutout === 'svg'
        ? availableHeight * (settings.svgCutout?.aspectRatio ?? 1)
        : slits
          ? maxDepth * 2
          : 64,
  )
  return {
    height: { min: 16, max: 70 },
    width: { min: 60, max: 110 },
    cornerRadius: {
      min: 0,
      max: Math.min(16, (settings.width - 30) / 2, (settings.height - 4) / 2),
    },
    topAngle: {
      min: -topLimits(settings.height, settings.width, settings.cornerRadius)
        .angle,
      max: topLimits(settings.height, settings.width, settings.cornerRadius)
        .angle,
    },
    topCurve: {
      min: 0,
      max: topLimits(
        settings.height,
        settings.width,
        settings.cornerRadius,
        settings.topAngle,
      ).curve,
    },
    holeCount: {
      min: 1,
      max:
        settings.cutout === 'svg'
          ? 1
          : slits
            ? Math.min(7, Math.floor((availableWidth + 3) / 6))
            : 3,
    },
    holeWidth: {
      min: settings.cutout === 'svg' ? Math.min(6, maxWidth) : minWidth,
      max: maxWidth,
    },
    holeHeight:
      settings.cutout === 'circle' || settings.cutout === 'svg'
        ? { min: settings.holeHeight, max: settings.holeHeight }
        : slits
          ? { min: Math.max(3, settings.holeWidth / 2), max: maxDepth }
          : { min: 6, max: Math.min(30, availableHeight, settings.holeWidth) },
    holeGap: {
      min: 3,
      max:
        settings.holeCount > 1
          ? Math.min(
              20,
              (availableWidth - settings.holeCount * minWidth) /
                (settings.holeCount - 1),
            )
          : 20,
    },
    offsetX: { min: -xRoom, max: xRoom },
    offsetY: slits ? { min: 0, max: 0 } : { min: -yRoom, max: yRoom },
  }
}

type Point = [number, number]

/** The top is sampled from right to left; its highest vertex defines height. */
function topEdge(settings: HandleSettings): Point[] {
  const half = settings.width / 2
  const radius = settings.cornerRadius
  const slope = Math.tan((settings.topAngle * Math.PI) / 180)
  const bow =
    settings.topShape === 'straight'
      ? 0
      : settings.topCurve * (settings.topShape === 'outward' ? 1 : -1)
  const elevation = (x: number) => slope * x + bow * (1 - (x / half) ** 2)
  const points: Point[] = []
  if (radius > 0) {
    for (let step = 0; step <= 16; step += 1) {
      const angle = (step * Math.PI) / 32
      const x = half - radius + radius * Math.cos(angle)
      points.push([x, elevation(x) - radius + radius * Math.sin(angle)])
    }
  } else points.push([half, elevation(half)])
  const segments = bow === 0 ? 1 : 96
  for (let step = 1; step <= segments; step += 1) {
    const x = (half - radius) * (1 - (2 * step) / segments)
    points.push([x, elevation(x)])
  }
  if (radius > 0) {
    for (let step = 1; step <= 16; step += 1) {
      const angle = Math.PI / 2 + (step * Math.PI) / 32
      const x = -half + radius + radius * Math.cos(angle)
      points.push([x, elevation(x) - radius + radius * Math.sin(angle)])
    }
  }
  const highest = Math.max(...points.map(([, y]) => y))
  return points.map(([x, y]) => [x, settings.height + y - highest])
}

function topYAt(top: Point[], x: number) {
  const boundedX = clamp(x, top[top.length - 1][0], top[0][0])
  for (let index = 1; index < top.length; index += 1) {
    const [ax, ay] = top[index - 1]
    const [bx, by] = top[index]
    if (ax === bx) continue
    if (boundedX >= bx) return ay + ((boundedX - ax) * (by - ay)) / (bx - ax)
  }
  return top[top.length - 1][1]
}

/** Actual faceted silhouette height at X, before cutting any open slits. */
export function getHandleTopY(
  model: SpeakerModel,
  input: Partial<HandleSettings>,
  x: number,
) {
  return topYAt(topEdge(normalizeHandleSettings(model, input)), x)
}

export interface HandleSlit {
  x: number
  width: number
  depth: number
  topY: number
  bottomY: number
  leftTopY: number
  rightTopY: number
}

function handleSlits(
  settings: HandleSettings,
  top = topEdge(settings),
): HandleSlit[] {
  if (settings.cutout !== 'slits') return []
  return Array.from({ length: settings.holeCount }, (_, index) => {
    const x =
      settings.offsetX +
      (index - (settings.holeCount - 1) / 2) *
        (settings.holeWidth + settings.holeGap)
    const topY = topYAt(top, x)
    return {
      x,
      width: settings.holeWidth,
      depth: settings.holeHeight,
      topY,
      bottomY: topY - settings.holeHeight,
      leftTopY: topYAt(top, x - settings.holeWidth / 2),
      rightTopY: topYAt(top, x + settings.holeWidth / 2),
    }
  }).filter((slit) => {
    if (slit.bottomY < HANDLE_SHOULDER_HEIGHT + HANDLE_MIN_WEB - 1e-8)
      return false
    // Keep the entire semicircular bottom below the local top. This also
    // prevents a shallow slit crossing back through a steep or concave top.
    const left = slit.x - slit.width / 2
    const right = slit.x + slit.width / 2
    const lowestTop = Math.min(
      slit.leftTopY,
      slit.rightTopY,
      ...top.filter(([x]) => x > left && x < right).map(([, y]) => y),
    )
    return lowestTop >= slit.bottomY + slit.width / 2 - 1e-8
  })
}

/** Accepted slits follow the local top; depth includes their rounded bottom. */
export function getHandleSlits(
  model: SpeakerModel,
  input: Partial<HandleSettings>,
): HandleSlit[] {
  return handleSlits(normalizeHandleSettings(model, input))
}

function handleOutline(settings: HandleSettings, baseWidth = 84.9715): Point[] {
  const half = settings.width / 2
  const top = topEdge(settings)
  const points: Point[] = [
    [-baseWidth / 2, -0.25],
    [baseWidth / 2, -0.25],
    [baseWidth / 2, 0],
    [half, HANDLE_SHOULDER_HEIGHT],
  ]
  const append = (point: Point) => {
    const previous = points[points.length - 1]
    if (Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-10)
      points.push(point)
  }
  let topIndex = 0
  for (const slit of handleSlits(settings, top).reverse()) {
    const radius = slit.width / 2
    const right = slit.x + radius
    const left = slit.x - radius
    while (topIndex < top.length && top[topIndex][0] > right)
      append(top[topIndex++])
    append([right, slit.rightTopY])
    const centerY = slit.bottomY + radius
    append([right, centerY])
    for (let step = 1; step <= 32; step += 1) {
      const angle = (-step * Math.PI) / 32
      append([
        slit.x + Math.cos(angle) * radius,
        centerY + Math.sin(angle) * radius,
      ])
    }
    append([left, slit.leftTopY])
    while (topIndex < top.length && top[topIndex][0] >= left) topIndex += 1
  }
  while (topIndex < top.length) append(top[topIndex++])
  append([-half, HANDLE_SHOULDER_HEIGHT])
  append([-baseWidth / 2, 0])
  return points
}

/** Profile coordinates are relative to the join with the existing control deck. */
export function getHandleOutline(
  model: SpeakerModel,
  input: Partial<HandleSettings>,
  baseWidth = 84.9715,
): Point[] {
  return handleOutline(normalizeHandleSettings(model, input), baseWidth)
}

function pointInside([x, y]: Point, polygon: Point[]) {
  let inside = false
  for (let index = 0; index < polygon.length; index += 1) {
    const [ax, ay] = polygon[index]
    const [bx, by] = polygon[(index + 1) % polygon.length]
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
      inside = !inside
  }
  return inside
}

function pointSegmentDistance(point: Point, a: Point, b: Point) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  const t =
    lengthSquared === 0
      ? 0
      : clamp(
          ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared,
          0,
          1,
        )
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy)
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  const cross = (p: Point, q: Point, r: Point) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const abC = cross(a, b, c)
  const abD = cross(a, b, d)
  const cdA = cross(c, d, a)
  const cdB = cross(c, d, b)
  if (abC * abD < 0 && cdA * cdB < 0) return 0
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  )
}

function supportedSegment(
  a: Point,
  b: Point,
  outline: Point[],
  clearance: number,
) {
  if (!pointInside(a, outline) || !pointInside(b, outline)) return false
  return outline.every(
    (point, index) =>
      segmentDistance(a, b, point, outline[(index + 1) % outline.length]) >=
      clearance - 1e-8,
  )
}

function handleHoles(
  settings: HandleSettings,
  outline = handleOutline(settings),
) {
  if (settings.cutout !== 'circle' && settings.cutout !== 'slot') return []
  return Array.from({ length: settings.holeCount }, (_, index) => ({
    x:
      settings.offsetX +
      (index - (settings.holeCount - 1) / 2) *
        (settings.holeWidth + settings.holeGap),
    y: settings.height / 2 + HANDLE_SHOULDER_HEIGHT / 2 + settings.offsetY,
    width: settings.holeWidth,
    height:
      settings.cutout === 'circle' ? settings.holeWidth : settings.holeHeight,
  })).filter((hole) => {
    const radius = hole.height / 2
    const halfSegment = (hole.width - hole.height) / 2
    return (
      hole.y - radius >= HANDLE_SHOULDER_HEIGHT + HANDLE_MIN_WEB - 1e-8 &&
      supportedSegment(
        [hole.x - halfSegment, hole.y],
        [hole.x + halfSegment, hole.y],
        outline,
        radius + HANDLE_MIN_WEB,
      )
    )
  })
}

/** Requested openings keep their positions; unsafe ones are omitted individually. */
export function getHandleHoleCenters(
  model: SpeakerModel,
  input: Partial<HandleSettings>,
) {
  return handleHoles(normalizeHandleSettings(model, input))
}

function handleSvgPaths(
  settings: HandleSettings,
  outline = handleOutline(settings),
): SvgCutout['paths'] {
  if (settings.cutout !== 'svg' || !settings.svgCutout) return []
  const centerY =
    settings.height / 2 + HANDLE_SHOULDER_HEIGHT / 2 + settings.offsetY
  return settings.svgCutout.paths
    .map((path) => ({
      fillRule: path.fillRule,
      contours: path.contours.map((contour) =>
        contour.map(([x, y]): Point => [
          settings.offsetX + x * settings.holeWidth,
          centerY - y * settings.holeHeight,
        ]),
      ),
    }))
    .filter((path) =>
      path.contours.every((contour) =>
        contour.every(
          (point, index) =>
            point[1] >= HANDLE_SHOULDER_HEIGHT + HANDLE_MIN_WEB - 1e-8 &&
            supportedSegment(
              point,
              contour[(index + 1) % contour.length],
              outline,
              HANDLE_MIN_WEB,
            ),
        ),
      ),
    )
}

/** SVG's downward Y axis is flipped; only complete, supported paths are cut. */
export function getHandleSvgPaths(
  model: SpeakerModel,
  input: Partial<HandleSettings>,
): SvgCutout['paths'] {
  return handleSvgPaths(normalizeHandleSettings(model, input))
}

/** Stud centers share one square grid on the front face, above the shoulder. */
export function getHandleStudCenters(
  model: SpeakerModel,
  input: Partial<HandleSettings>,
  raceStripes?: Partial<RaceStripeSettings>,
): { x: number; y: number }[] {
  const settings = normalizeHandleSettings(model, input)
  if (settings.mode !== 'custom' || !settings.legoStuds) return []

  // A small margin keeps the whole footprint supported, including the faceted
  // outline's rounded corners, and avoids tangent boolean intersections.
  const clearance = HANDLE_STUD_DIAMETER / 2 + 0.25
  const stripes = getRaceStripeIntervals(raceStripes)
  const outline = handleOutline(settings)
  const holes = handleHoles(settings, outline)
  const svgBounds = handleSvgPaths(settings, outline).map((path) => {
    const points = path.contours.flat()
    return {
      minX: Math.min(...points.map(([x]) => x)),
      maxX: Math.max(...points.map(([x]) => x)),
      minY: Math.min(...points.map(([, y]) => y)),
      maxY: Math.max(...points.map(([, y]) => y)),
    }
  })
  const centerY = (settings.height + HANDLE_SHOULDER_HEIGHT) / 2
  const supported = (x: number, y: number) => {
    if (
      stripes.some(
        ({ minX, maxX }) => x + clearance > minX && x - clearance < maxX,
      )
    )
      return false
    if (y < HANDLE_SHOULDER_HEIGHT + clearance) return false
    let inside = false
    for (let index = 0; index < outline.length; index += 1) {
      const [ax, ay] = outline[index]
      const [bx, by] = outline[(index + 1) % outline.length]
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
        inside = !inside
      const dx = bx - ax
      const dy = by - ay
      const t = clamp(
        ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy),
        0,
        1,
      )
      if (Math.hypot(x - ax - t * dx, y - ay - t * dy) < clearance) return false
    }
    if (!inside) return false

    for (const hole of holes) {
      // Distance to a capsule's straight center segment also handles circles.
      const dx = Math.max(
        Math.abs(x - hole.x) - (hole.width - hole.height) / 2,
        0,
      )
      if (Math.hypot(dx, y - hole.y) < hole.height / 2 + clearance) return false
    }
    for (const bounds of svgBounds) {
      // Reserve each accepted path's bounds so studs cannot bridge any of its
      // contours. A path omitted for safety no longer excludes nearby studs.
      const dx = Math.max(bounds.minX - x, x - bounds.maxX, 0)
      const dy = Math.max(bounds.minY - y, y - bounds.maxY, 0)
      if (Math.hypot(dx, dy) < clearance) return false
    }
    return true
  }

  const columns =
    Math.floor((settings.width - 2 * clearance) / HANDLE_STUD_PITCH) + 1
  const rows =
    Math.floor(
      (settings.height - HANDLE_SHOULDER_HEIGHT - 2 * clearance) /
        HANDLE_STUD_PITCH,
    ) + 1
  let best: { x: number; y: number }[] = []
  // Both lattice phases are centered on the handle. Choose the one with most
  // supported studs after accounting for the openings and rounded corners.
  for (const columnCount of [columns, columns - 1]) {
    for (const rowCount of [rows, rows - 1]) {
      const centers: { x: number; y: number }[] = []
      for (let row = 0; row < rowCount; row += 1) {
        const y = centerY + (row - (rowCount - 1) / 2) * HANDLE_STUD_PITCH
        for (let column = 0; column < columnCount; column += 1) {
          const x = (column - (columnCount - 1) / 2) * HANDLE_STUD_PITCH
          if (supported(x, y)) centers.push({ x, y })
        }
      }
      if (centers.length > best.length) best = centers
    }
  }
  return best
}
