import { describe, expect, it } from 'vitest'
import {
  mergeCoplanarFaces,
  type StepPoint,
  type StepTriangle,
} from './step-faces'

function boundaryEdges(loops: number[][]): string[] {
  const edges = new Set<string>()
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i]
      const b = loop[(i + 1) % loop.length]
      const reverse = `${b},${a}`
      if (!edges.delete(reverse)) edges.add(`${a},${b}`)
    }
  }
  return [...edges].sort()
}

describe('coplanar STEP faces', () => {
  it('removes planar internal edges and retains every boundary vertex', () => {
    const vertices: StepPoint[] = [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [2, 1, 0],
      [1, 1, 0],
      [0, 1, 0],
    ]
    const triangles: StepTriangle[] = [
      [0, 1, 5],
      [1, 4, 5],
      [1, 2, 4],
      [2, 3, 4],
    ]
    const before = structuredClone({ vertices, triangles })
    const faces = mergeCoplanarFaces(vertices, triangles)
    expect(faces).toHaveLength(1)
    expect(faces[0].loops[0]).toHaveLength(6)
    expect(boundaryEdges(faces.flatMap((face) => face.loops))).toEqual(
      boundaryEdges(triangles),
    )
    expect({ vertices, triangles }).toEqual(before)
  })

  it('keeps holes and their opposite orientation on the merged face', () => {
    const vertices: StepPoint[] = [
      [-2, -2, 0],
      [2, -2, 0],
      [2, 2, 0],
      [-2, 2, 0],
      [-1, -1, 0],
      [1, -1, 0],
      [1, 1, 0],
      [-1, 1, 0],
    ]
    const triangles: StepTriangle[] = []
    for (let i = 0; i < 4; i += 1) {
      const next = (i + 1) % 4
      triangles.push([i, next, next + 4], [i, next + 4, i + 4])
    }
    const [face] = mergeCoplanarFaces(vertices, triangles)
    expect(face.loops).toHaveLength(2)
    expect(new Set(face.loops[0])).toEqual(new Set([0, 1, 2, 3]))
    expect(new Set(face.loops[1])).toEqual(new Set([4, 5, 6, 7]))
    expect(boundaryEdges(face.loops)).toEqual(boundaryEdges(triangles))
  })

  it('retains even shallow bends beyond floating point tolerance', () => {
    const vertices: StepPoint[] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 1e-6],
    ]
    const triangles: StepTriangle[] = [
      [0, 1, 2],
      [1, 3, 2],
    ]
    expect(mergeCoplanarFaces(vertices, triangles)).toHaveLength(2)
  })

  it('uses a fixed original plane so tiny neighbor errors cannot accumulate', () => {
    const vertices: StepPoint[] = []
    const triangles: StepTriangle[] = []
    for (let i = 0; i <= 20; i += 1) {
      vertices.push([i, 0, i * i * 5e-11], [i, 1, i * i * 5e-11])
      if (i > 0) {
        const a = (i - 1) * 2
        triangles.push([a, a + 2, a + 1], [a + 2, a + 3, a + 1])
      }
    }
    const faces = mergeCoplanarFaces(vertices, triangles)
    expect(faces.length).toBeGreaterThan(1)
    expect(faces.length).toBeLessThan(triangles.length)
    for (const face of faces) {
      const [a, b, c] = face.triangle.map((vertex) => vertices[vertex])
      const u = b.map((value, axis) => value - a[axis])
      const v = c.map((value, axis) => value - a[axis])
      const normal = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ]
      for (const vertex of face.loops.flat()) {
        const distance = Math.abs(
          normal.reduce(
            (sum, value, axis) =>
              sum +
              (value * (vertices[vertex][axis] - a[axis])) /
                Math.hypot(...normal),
            0,
          ),
        )
        expect(distance).toBeLessThanOrEqual(1e-9)
      }
    }
    expect(boundaryEdges(faces.flatMap((face) => face.loops))).toEqual(
      boundaryEdges(triangles),
    )
  })

  it('retains original triangles when an outer boundary touches a hole', () => {
    const vertices: StepPoint[] = []
    const triangles: StepTriangle[] = []
    for (let y = 0; y <= 3; y += 1)
      for (let x = 0; x <= 3; x += 1) vertices.push([x, y, 0])
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        if ((x === 1 && y === 1) || (x === 2 && y === 2)) continue
        const a = y * 4 + x
        triangles.push([a, a + 1, a + 4], [a + 1, a + 5, a + 4])
      }
    }
    const faces = mergeCoplanarFaces(vertices, triangles)
    expect(faces).toHaveLength(triangles.length)
    expect(boundaryEdges(faces.flatMap((face) => face.loops))).toEqual(
      boundaryEdges(triangles),
    )
  })
})
