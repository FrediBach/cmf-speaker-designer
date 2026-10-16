import {
  BufferGeometry,
  Float32BufferAttribute,
  ShapeUtils,
  Vector2,
} from 'three'
import { KNOB_BASE_HEIGHT, type KnobSettings } from './knob-settings'

type Point = [number, number, number]
interface GripBase {
  positions: number[]
  outline: Vector2[]
}

const bases = new WeakMap<BufferGeometry, GripBase>()

/** Retain the source collar and socket, opening only its horizontal top. */
function gripBase(source: BufferGeometry): GripBase {
  const cached = bases.get(source)
  if (cached) return cached
  const vertices = source.getAttribute('position')
  const positions: number[] = []
  const edges = new Map<string, { a: Point; b: Point; count: number }>()
  const pointKey = (point: Point) => point.join(',')
  for (let triangle = 0; triangle < vertices.count; triangle += 3) {
    const points: Point[] = [0, 1, 2].map((corner) => {
      const index = triangle + corner
      return [vertices.getX(index), vertices.getY(index), vertices.getZ(index)]
    })
    if (points.some((point) => point[2] > KNOB_BASE_HEIGHT)) continue
    // The source's nominal 8 mm recess floor is 7.999999 mm in Float32.
    // Remove that cap and the sub-micron wall above it together. Lower
    // collar/shaft/socket triangles and their coordinates remain unchanged.
    if (points.every((point) => point[2] > KNOB_BASE_HEIGHT - 0.00001)) continue
    positions.push(...points.flat())
    for (let index = 0; index < 3; index += 1) {
      const a = points[index],
        b = points[(index + 1) % 3]
      const key = [pointKey(a), pointKey(b)].sort().join(':')
      const edge = edges.get(key)
      if (edge) edge.count += 1
      else edges.set(key, { a, b, count: 1 })
    }
  }
  const boundary = [...edges.values()].filter(({ count }) => count === 1)
  if (!boundary.length) throw new Error('The knob base has no grip boundary.')
  const next = new Map(boundary.map(({ a, b }) => [pointKey(a), b]))
  const outline: Vector2[] = []
  const start = boundary[0].a
  let point = start
  do {
    if (Math.abs(point[2] - KNOB_BASE_HEIGHT) > 0.00001)
      throw new Error('The knob base has an unexpected open surface.')
    outline.push(new Vector2(point[0], point[1]))
    const following = next.get(pointKey(point))
    if (!following || outline.length > boundary.length)
      throw new Error('The knob base grip boundary is incomplete.')
    point = following
  } while (pointKey(point) !== pointKey(start))
  if (outline.length !== boundary.length)
    throw new Error('The knob base has more than one grip boundary.')
  if (ShapeUtils.isClockWise(outline)) outline.reverse()
  const base = { positions, outline }
  bases.set(source, base)
  return base
}

function gripOutline(settings: KnobSettings): Vector2[] {
  const width = settings.gripWidth / 2
  const depth = settings.gripDepth / 2
  const stroke = settings.gripThickness
  let points: number[][]
  if (settings.style === 'triangle') {
    points = [
      [-width, -depth],
      [width, -depth],
      [0, depth],
    ]
  } else if (settings.style === 'arrow') {
    const shaft = stroke / 2
    points = [
      [-shaft, -depth],
      [shaft, -depth],
      [shaft, 0],
      [width, 0],
      [0, depth],
      [-width, 0],
      [-shaft, 0],
    ]
  } else {
    // Offset both V arms by a true perpendicular stroke distance. The
    // normalized thickness keeps a clear opening at every supported size.
    const horizontal = stroke * Math.hypot(1, width / (2 * depth))
    const vertical = stroke * Math.hypot(1, (2 * depth) / width)
    points = [
      [0, -depth],
      [width, depth],
      [width - horizontal, depth],
      [0, -depth + vertical],
      [-width + horizontal, depth],
      [-width, depth],
    ]
  }
  // Match STL precision before triangulation, including every shared edge.
  return points.map(([x, y]) => new Vector2(Math.fround(x), Math.fround(y)))
}

function triangulateCap(contour: Vector2[], hole: Vector2[]) {
  const points = [...contour, ...hole]
  const triangles = ShapeUtils.triangulateShape([...contour], [hole])
  // Earcut can omit a collinear vertex where its hole bridge meets an arrow
  // shoulder. Split that edge at the omitted point so the cap and grip share
  // identical edges, with no T junction left in the exported STL.
  for (let triangle = 0; triangle < triangles.length; triangle += 1) {
    const indices = triangles[triangle]
    let split = false
    for (let edge = 0; edge < 3 && !split; edge += 1) {
      const a = indices[edge],
        b = indices[(edge + 1) % 3],
        c = indices[(edge + 2) % 3]
      const start = points[a],
        end = points[b]
      const dx = end.x - start.x,
        dy = end.y - start.y
      const lengthSquared = dx * dx + dy * dy
      for (let index = 0; index < points.length; index += 1) {
        if (indices.includes(index)) continue
        const px = points[index].x - start.x,
          py = points[index].y - start.y
        const along = px * dx + py * dy
        if (along <= 1e-10 || along >= lengthSquared - 1e-10) continue
        if (Math.abs(px * dy - py * dx) > 1e-10) continue
        triangles[triangle] = [a, index, c]
        triangles.push([index, b, c])
        triangle -= 1
        split = true
        break
      }
    }
  }
  return { points, triangles }
}

/** Join a shaped grip to the source base as one closed surface. */
export function shapedKnobGeometry(
  source: BufferGeometry,
  settings: KnobSettings,
): BufferGeometry {
  const base = gripBase(source)
  const outline = gripOutline(settings)
  const result = [...base.positions]
  const emit = (
    a: Vector2,
    az: number,
    b: Vector2,
    bz: number,
    c: Vector2,
    cz: number,
  ) => result.push(a.x, a.y, az, b.x, b.y, bz, c.x, c.y, cz)

  // A hole in the base's top face is exactly the grip's lower perimeter.
  // Sharing those vertices avoids overlapping shells and internal faces.
  const hole = [...outline].reverse()
  const cap = triangulateCap(base.outline, hole)
  for (const [a, b, c] of cap.triangles)
    emit(
      cap.points[a],
      KNOB_BASE_HEIGHT,
      cap.points[b],
      KNOB_BASE_HEIGHT,
      cap.points[c],
      KNOB_BASE_HEIGHT,
    )

  // A uniform inward taper preserves the concave arrow/V outline and never
  // closes the notch. Even the smallest stroke retains at least 1.5 mm.
  const scale =
    1 - (2 * settings.taper) / Math.min(settings.gripWidth, settings.gripDepth)
  const top = outline.map(
    ({ x, y }) => new Vector2(Math.fround(x * scale), Math.fround(y * scale)),
  )
  for (let index = 0; index < outline.length; index += 1) {
    const next = (index + 1) % outline.length
    emit(
      outline[index],
      KNOB_BASE_HEIGHT,
      outline[next],
      KNOB_BASE_HEIGHT,
      top[next],
      settings.height,
    )
    emit(
      outline[index],
      KNOB_BASE_HEIGHT,
      top[next],
      settings.height,
      top[index],
      settings.height,
    )
  }
  for (const [a, b, c] of ShapeUtils.triangulateShape([...top], []))
    emit(
      top[a],
      settings.height,
      top[b],
      settings.height,
      top[c],
      settings.height,
    )
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(result, 3))
  return geometry
}
