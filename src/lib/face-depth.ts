import type { SpeakerModel } from './panels'

export const MAX_FACE_DEPTH = 2

type Point = [number, number, number]
type Plane = { axis: 1 | 2; value: number }

/**
 * Refine only triangles crossing the depth-map boundaries and its 3 mm curved
 * transition. Boolean simplification can leave very large triangles here;
 * deforming only their corners would bend the entire otherwise planar face.
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
  const faceTop = model === 's' ? 19 : 57
  const planes: Plane[] = [
    { axis: 2, value: 0.5 },
    { axis: 2, value: 4 },
  ]
  // On the flat front, interpolation error at maximum relief is below 0.011 mm.
  // Cuts continue through the rear so their shared edges have no T-junctions.
  for (let band = 0; band <= 12; band += 1)
    planes.push({ axis: 1, value: faceTop - 3 + band / 4 })

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
    const frontWeight = Math.min(1, Math.max(0, (z - 0.5) / 3.5))
    const t = Math.min(1, Math.max(0, (y - faceTop + 3) / 3))
    const controlWeight = 1 - t * t * (3 - 2 * t)
    result.push(x, y, z + relief * frontWeight * controlWeight)
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
