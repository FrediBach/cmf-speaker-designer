import type { SpeakerModel } from './panels'

export const MAX_FACE_DEPTH = 2

type Point = [number, number, number]
type Plane = { axis: 1 | 2; value: number }

/** The original panel has a 1 mm fillet between its front and 45° controls. */
export function getFaceFold(model: SpeakerModel) {
  const deckIntercept = model === 's' ? 23.5 : 61.5
  const frontY = deckIntercept - 3 - Math.SQRT2
  return { frontY, deckY: frontY + Math.SQRT1_2, deckIntercept }
}

/**
 * Extend the existing control slope to meet the deeper front with its original
 * 1 mm bend radius. Refinement is confined to the shifted fold and depth-map
 * boundaries: deforming large boolean triangles only at their original corners
 * would bend the entire otherwise planar face.
 * Shared, Float32 intersections keep adjacent triangles exactly watertight.
 * The input stays owned by its caller and is never changed.
 */
export function applyFaceDepth(
  positions: Float32Array,
  model: SpeakerModel,
  relief: number,
): Float32Array {
  if (!Number.isFinite(relief) || relief < 0 || relief > MAX_FACE_DEPTH)
    throw new RangeError(
      `Added face depth must be between 0 and ${MAX_FACE_DEPTH} mm.`,
    )
  if (relief === 0) return positions
  const { frontY, deckY, deckIntercept } = getFaceFold(model)
  const profile = (y: number) => {
    if (y <= frontY) return 4
    if (y >= deckY) return deckIntercept - y
    return 3 + Math.sqrt(1 - (y - frontY) ** 2)
  }
  const planes: Plane[] = [
    { axis: 2, value: 0.5 },
    { axis: 2, value: 4 },
  ]
  // Split both the new bend and the old bend that becomes part of the slope.
  // Float32 cut coordinates make adjacent faces agree with stored STL vertices.
  // Cuts continue through the rear so their shared edges have no T-junctions.
  const cuts = new Set([frontY - relief, deckY - relief, frontY, deckY])
  const bands = Math.ceil((deckY - frontY + relief) / 0.125)
  for (let band = 1; band < bands; band += 1)
    cuts.add(frontY - relief + ((deckY - frontY + relief) * band) / bands)
  for (const value of [...cuts].sort((a, b) => a - b))
    planes.push({ axis: 1, value: Math.fround(value) })

  const result: number[] = []
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
        (plane.value - first[plane.axis]) /
        (second[plane.axis] - first[plane.axis])
      crossing = first.map((coordinate, axis) =>
        axis === plane.axis
          ? plane.value
          : Math.fround(coordinate + (second[axis] - coordinate) * fraction),
      ) as Point
      intersections.set(key, crossing)
    }
    return crossing
  }
  const append = ([x, y, z]: Point) => {
    if (z <= 0.5 || y >= deckY) {
      result.push(x, y, z)
      return
    }
    const sourceFront = profile(y)
    // Translating the profile by (-relief, +relief) leaves the 45° deck in
    // place. Unlike a smoothstep fade, it cannot introduce an S-shaped ledge.
    const addedDepth = Math.max(0, relief + profile(y + relief) - sourceFront)
    const frontWeight = Math.min(1, (z - 0.5) / (sourceFront - 0.5))
    result.push(x, y, z + addedDepth * frontWeight)
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
    const minY = Math.min(...vertices.map((point) => point[1]))
    const maxY = Math.max(...vertices.map((point) => point[1]))
    const minZ = Math.min(...vertices.map((point) => point[2]))
    const maxZ = Math.max(...vertices.map((point) => point[2]))
    const crossings = planes.filter(({ axis, value }) =>
      axis === 1 ? minY < value && maxY > value : minZ < value && maxZ > value,
    )
    if (!crossings.length) {
      vertices.forEach(append)
      continue
    }
    let polygons = [vertices]
    for (const plane of crossings) {
      const next: Point[][] = []
      for (const polygon of polygons) {
        const coordinates = polygon.map((point) => point[plane.axis])
        if (
          Math.min(...coordinates) >= plane.value ||
          Math.max(...coordinates) <= plane.value
        ) {
          next.push(polygon)
          continue
        }
        const lower: Point[] = [],
          upper: Point[] = []
        for (let edge = 0; edge < polygon.length; edge += 1) {
          const a = polygon[edge],
            b = polygon[(edge + 1) % polygon.length]
          const aDistance = a[plane.axis] - plane.value
          const bDistance = b[plane.axis] - plane.value
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
  return new Float32Array(result)
}
