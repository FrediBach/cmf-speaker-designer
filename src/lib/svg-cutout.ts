export type SvgPoint = [number, number]

export type SvgCutout = {
  name: string
  aspectRatio: number
  paths: { contours: SvgPoint[][]; fillRule: 'nonzero' | 'evenodd' }[]
}

export const SVG_MAX_FILE_SIZE = 256 * 1024
const MAX_POINTS = 4096
const MAX_CONTOURS = 256
const MAX_PATHS = 128

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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

/** Validate persisted geometry without needing a DOM, including in the worker. */
export function normalizeSvgCutout(value: unknown): SvgCutout | null {
  if (
    !record(value) ||
    typeof value.aspectRatio !== 'number' ||
    !Number.isFinite(value.aspectRatio) ||
    value.aspectRatio < 0.001 ||
    value.aspectRatio > 1000 ||
    !Array.isArray(value.paths) ||
    value.paths.length < 1 ||
    value.paths.length > MAX_PATHS
  )
    return null

  let pointCount = 0
  let contourCount = 0
  const paths: SvgCutout['paths'] = []
  for (const path of value.paths) {
    if (
      !record(path) ||
      (path.fillRule !== 'nonzero' && path.fillRule !== 'evenodd') ||
      !Array.isArray(path.contours) ||
      !path.contours.length
    )
      return null
    const contours: SvgPoint[][] = []
    for (const contour of path.contours) {
      if (
        !Array.isArray(contour) ||
        contour.length < 3 ||
        ++contourCount > MAX_CONTOURS ||
        (pointCount += contour.length) > MAX_POINTS
      )
        return null
      const points: SvgPoint[] = []
      for (const point of contour) {
        if (
          !Array.isArray(point) ||
          point.length !== 2 ||
          point.some(
            (coordinate) =>
              typeof coordinate !== 'number' ||
              !Number.isFinite(coordinate) ||
              Math.abs(coordinate) > 0.500001,
          )
        )
          return null
        const rounded: SvgPoint = [round(point[0]), round(point[1])]
        if (!points.length || !samePoint(points[points.length - 1], rounded))
          points.push(rounded)
      }
      if (samePoint(points[0], points[points.length - 1])) points.pop()
      if (points.length < 3 || !hasArea(points)) return null
      contours.push(points)
    }
    paths.push({ contours, fillRule: path.fillRule })
  }

  return {
    name:
      typeof value.name === 'string'
        ? value.name
            .replace(/[\u0000-\u001f\u007f]/g, '')
            .trim()
            .slice(0, 120) || 'Custom cutout.svg'
        : 'Custom cutout.svg',
    aspectRatio: round(value.aspectRatio),
    paths,
  }
}
