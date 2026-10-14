import type { SpeakerModel } from './panels'

export const MAX_PANEL_EXTENSION = 10

type Point = [number, number, number]
type Plane = { axis: 0 | 1 | 2 | 'deck'; value: number }

const INNER_BORDER = Math.fround(39.1)
const OUTER_BORDER = 41
const coordinate = (point: Point, axis: Plane['axis']) =>
  axis === 'deck' ? point[1] + point[2] : point[axis]
const distance = (point: Point, plane: Plane) => {
  const value = coordinate(point, plane.axis) - plane.value
  // The source's planar deck is stored in Float32. Treat its sub-micron
  // coordinate noise as on-plane, avoiding duplicate cuts along the rear face.
  return plane.axis === 'deck' && Math.abs(value) < 0.00002 ? 0 : value
}

/**
 * Widen the two outer borders without scaling the driver or control openings.
 * Follow the front and 45° deck while preserving their inner mounting surfaces.
 * The original handle returns to its own width through its bottom 4 mm shoulder.
 * Custom handles are generated afterward from the widened attachment collar.
 * Split triangles at the deformation boundaries before moving their corners so
 * sparse CSG faces cannot pull the unchanged center or rear out of position.
 */
export function applyPanelExtension(
  positions: Float32Array,
  model: SpeakerModel,
  extensionMm: number,
): Float32Array {
  if (
    !Number.isFinite(extensionMm) ||
    extensionMm < 0 ||
    extensionMm > MAX_PANEL_EXTENSION
  )
    throw new RangeError(
      `Panel side extension must be between 0 and ${MAX_PANEL_EXTENSION} mm.`,
    )
  if (extensionMm === 0) return positions

  const deckIntercept = model === 's' ? 23.5 : 61.5
  const deckBack = Math.fround(deckIntercept - 3.5 * Math.SQRT2)
  const deckTransition = Math.fround(deckBack + 0.5 * Math.SQRT2)
  // These fixed joins belong to the original source panels. Handle height and
  // width are independent: their geometry is generated after this deformation.
  const handleSeam = model === 's' ? 41.48455047607422 : 85.48455047607422

  const planes: Plane[] = [
    { axis: 0, value: -OUTER_BORDER },
    { axis: 0, value: -INNER_BORDER },
    { axis: 0, value: INNER_BORDER },
    { axis: 0, value: OUTER_BORDER },
    { axis: 2, value: 0.5 },
    { axis: 2, value: 1 },
    { axis: 'deck', value: deckBack },
    { axis: 'deck', value: deckTransition },
    { axis: 1, value: handleSeam },
    { axis: 1, value: handleSeam + 4 },
  ]
  const output: number[] = []
  const intersections = new Map<string, Point>()
  const pointKey = (point: Point) => point.join(',')
  const intersection = (a: Point, b: Point, plane: Plane): Point => {
    let first = a,
      second = b
    if (pointKey(first) > pointKey(second)) [first, second] = [second, first]
    const key = `${pointKey(first)}:${pointKey(second)}:${plane.axis}:${plane.value}`
    let crossing = intersections.get(key)
    if (!crossing) {
      const fraction =
        (plane.value - coordinate(first, plane.axis)) /
        (coordinate(second, plane.axis) - coordinate(first, plane.axis))
      crossing = first.map((coordinate, axis) =>
        axis === plane.axis
          ? plane.value
          : Math.fround(coordinate + (second[axis] - coordinate) * fraction),
      ) as Point
      if (plane.axis === 'deck') {
        // Keep horizontal surfaces exactly horizontal at diagonal cuts.
        if (first[2] === second[2])
          crossing[1] = Math.fround(plane.value - crossing[2])
        else crossing[2] = Math.fround(plane.value - crossing[1])
      }
      intersections.set(key, crossing)
    }
    return crossing
  }
  const append = ([x, y, z]: Point) => {
    const sideWeight = Math.min(
      1,
      Math.max(0, (Math.abs(x) - INNER_BORDER) / (OUTER_BORDER - INNER_BORDER)),
    )
    const frontWeight = Math.min(
      1,
      Math.max(
        0,
        (z - 0.5) / 0.5,
        distance([x, y, z], { axis: 'deck', value: deckBack }) /
          (deckTransition - deckBack),
      ),
    )
    const handleWeight = Math.min(1, Math.max(0, (handleSeam + 4 - y) / 4))
    output.push(
      x + Math.sign(x) * extensionMm * sideWeight * frontWeight * handleWeight,
      y,
      z,
    )
  }
  const emit = (polygon: Point[]) => {
    const unique = polygon.filter(
      (point, index) =>
        !polygon
          .slice(0, index)
          .some((other) =>
            point.every((coordinate, axis) => coordinate === other[axis]),
          ),
    )
    for (let corner = 1; corner < unique.length - 1; corner += 1) {
      append(unique[0])
      append(unique[corner])
      append(unique[corner + 1])
    }
  }
  for (let triangle = 0; triangle < positions.length; triangle += 9) {
    const vertices: Point[] = [0, 3, 6].map((corner) => [
      positions[triangle + corner],
      positions[triangle + corner + 1],
      positions[triangle + corner + 2],
    ])
    const crossings = planes.filter((plane) => {
      const distances = vertices.map((point) => distance(point, plane))
      return Math.min(...distances) < 0 && Math.max(...distances) > 0
    })
    if (!crossings.length) {
      vertices.forEach(append)
      continue
    }
    let polygons = [vertices]
    for (const plane of crossings) {
      const next: Point[][] = []
      for (const polygon of polygons) {
        const distances = polygon.map((point) => distance(point, plane))
        if (Math.min(...distances) >= 0 || Math.max(...distances) <= 0) {
          next.push(polygon)
          continue
        }
        const lower: Point[] = [],
          upper: Point[] = []
        for (let edge = 0; edge < polygon.length; edge += 1) {
          const a = polygon[edge],
            b = polygon[(edge + 1) % polygon.length]
          const aDistance = distance(a, plane)
          const bDistance = distance(b, plane)
          if (aDistance <= 0) lower.push(a)
          if (aDistance >= 0) upper.push(a)
          if (aDistance * bDistance < 0) {
            const crossing = intersection(a, b, plane)
            lower.push(crossing)
            upper.push(crossing)
          }
        }
        next.push(lower, upper)
      }
      polygons = next
    }
    polygons.forEach(emit)
  }
  return new Float32Array(output)
}
