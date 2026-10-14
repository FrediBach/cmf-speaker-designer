export type StepPoint = [number, number, number]
export type StepTriangle = [number, number, number]

export interface StepFace {
  /** The first loop bounds the face; subsequent loops bound holes. */
  loops: number[][]
  /** An original triangle supplies the plane and outward orientation. */
  triangle: StepTriangle
}

// Millimeters: only numerical noise is absorbed, never printable detail.
const planeTolerance = 1e-9

/**
 * Cancel interior edges between coplanar triangles. Boundary vertices remain
 * unchanged, so adjacent faces still share exactly the same edges. A fixed
 * original plane bounds each region's error and prevents tolerance drift.
 * Ambiguous boundaries retain their original triangles.
 */
export function mergeCoplanarFaces(
  vertices: StepPoint[],
  triangles: StepTriangle[],
): StepFace[] {
  const adjacent = new Int32Array(triangles.length * 3).fill(-1)
  const edges = new Map<string, number>()
  const normals = new Float64Array(triangles.length * 3)
  triangles.forEach((triangle, face) => {
    const [a, b, c] = triangle.map((vertex) => vertices[vertex])
    const ux = b[0] - a[0]
    const uy = b[1] - a[1]
    const uz = b[2] - a[2]
    const vx = c[0] - a[0]
    const vy = c[1] - a[1]
    const vz = c[2] - a[2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const length = Math.hypot(nx, ny, nz)
    normals.set([nx / length, ny / length, nz / length], face * 3)

    for (let edge = 0; edge < 3; edge += 1) {
      const start = triangle[edge]
      const end = triangle[(edge + 1) % 3]
      const key = start < end ? `${start},${end}` : `${end},${start}`
      const previous = edges.get(key)
      const current = face * 3 + edge
      if (previous === undefined) edges.set(key, current)
      else {
        adjacent[current] = Math.floor(previous / 3)
        adjacent[previous] = face
      }
    }
  })
  edges.clear()

  const groups = new Int32Array(triangles.length).fill(-1)
  const result: StepFace[] = []
  for (let seed = 0; seed < triangles.length; seed += 1) {
    if (groups[seed] !== -1) continue
    const triangle = triangles[seed]
    const origin = vertices[triangle[0]]
    const nx = normals[seed * 3]
    const ny = normals[seed * 3 + 1]
    const nz = normals[seed * 3 + 2]
    const region = [seed]
    groups[seed] = seed
    for (let cursor = 0; cursor < region.length; cursor += 1) {
      const face = region[cursor]
      for (let edge = 0; edge < 3; edge += 1) {
        const neighbor = adjacent[face * 3 + edge]
        if (neighbor === -1 || groups[neighbor] !== -1) continue
        if (
          nx * normals[neighbor * 3] +
            ny * normals[neighbor * 3 + 1] +
            nz * normals[neighbor * 3 + 2] <
          1 - 1e-12
        )
          continue
        if (
          triangles[neighbor].some((vertex) => {
            const point = vertices[vertex]
            return (
              Math.abs(
                nx * (point[0] - origin[0]) +
                  ny * (point[1] - origin[1]) +
                  nz * (point[2] - origin[2]),
              ) > planeTolerance
            )
          })
        )
          continue
        groups[neighbor] = seed
        region.push(neighbor)
      }
    }

    if (region.length === 1) {
      result.push({ loops: [[...triangle]], triangle })
      continue
    }

    const boundary = new Map<number, number>()
    let simple = true
    for (const face of region) {
      for (let edge = 0; edge < 3; edge += 1) {
        const neighbor = adjacent[face * 3 + edge]
        if (neighbor !== -1 && groups[neighbor] === seed) continue
        const start = triangles[face][edge]
        const end = triangles[face][(edge + 1) % 3]
        if (boundary.has(start)) simple = false
        boundary.set(start, end)
      }
    }

    const loops: number[][] = []
    const areas: number[] = []
    while (simple && boundary.size) {
      const start = boundary.keys().next().value!
      const loop: number[] = []
      let current = start
      do {
        loop.push(current)
        const next = boundary.get(current)
        if (next === undefined) {
          simple = false
          break
        }
        boundary.delete(current)
        current = next
      } while (current !== start)
      if (loop.length < 3) simple = false
      if (!simple) break

      // Signed projected area distinguishes the outer loop from its holes.
      // Subtracting the seed origin avoids cancellation on translated parts.
      let area = 0
      for (let i = 0; i < loop.length; i += 1) {
        const a = vertices[loop[i]]
        const b = vertices[loop[(i + 1) % loop.length]]
        const ax = a[0] - origin[0]
        const ay = a[1] - origin[1]
        const az = a[2] - origin[2]
        const bx = b[0] - origin[0]
        const by = b[1] - origin[1]
        const bz = b[2] - origin[2]
        area +=
          nx * (ay * bz - az * by) +
          ny * (az * bx - ax * bz) +
          nz * (ax * by - ay * bx)
      }
      loops.push(loop)
      areas.push(area)
    }

    if (
      !simple ||
      areas.filter((area) => area > 0).length !== 1 ||
      areas.some((area) => area === 0)
    ) {
      for (const face of region)
        result.push({
          loops: [[...triangles[face]]],
          triangle: triangles[face],
        })
      continue
    }
    const outer = areas.findIndex((area) => area > 0)
    ;[loops[0], loops[outer]] = [loops[outer], loops[0]]
    result.push({ loops, triangle })
  }
  return result
}
