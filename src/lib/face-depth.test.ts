import { readFileSync } from 'node:fs'
import {
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from 'three'
import { describe, expect, it } from 'vitest'
import { applyFaceDepth, getFaceFold } from './face-depth'
import { createHandleEngine } from './handle-geometry'
import { getDefaultHandleSettings } from './handle-settings'
import { parsePanelGeometry, type SpeakerModel } from './panels'

function invalidEdges(positions: Float32Array) {
  const vertices = new Map<string, number>()
  const ids: number[] = []
  for (let index = 0; index < positions.length; index += 3) {
    const key = `${positions[index]},${positions[index + 1]},${positions[index + 2]}`
    let id = vertices.get(key)
    if (id === undefined) {
      id = vertices.size
      vertices.set(key, id)
    }
    ids.push(id)
  }
  const edges = new Map<number, number>()
  for (let triangle = 0; triangle < ids.length; triangle += 3)
    for (let edge = 0; edge < 3; edge += 1) {
      const a = ids[triangle + edge]
      const b = ids[triangle + ((edge + 1) % 3)]
      if (a === b) throw new Error('Collapsed triangle edge')
      const key = Math.min(a, b) * vertices.size + Math.max(a, b)
      edges.set(key, (edges.get(key) ?? 0) + (a < b ? 11 : 9))
    }
  return [...edges.values()].filter((count) => count !== 20).length
}

function sourcePositions(model: SpeakerModel) {
  const bytes = readFileSync(
    new URL(
      `../../resources/stl-files/cmf-speaker-${model}-3d-printing-panel-original-v1.stl`,
      import.meta.url,
    ),
  )
  const data = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(data).set(bytes)
  const geometry = parsePanelGeometry(data, model)
  const positions = new Float32Array(geometry.getAttribute('position').array)
  geometry.dispose()
  return positions
}

describe('localized face-depth refinement', () => {
  it.each(['s', 'm'] as const)(
    'keeps a sparse %s front planar below the control transition',
    (model) => {
      const { frontY, deckY, deckIntercept } = getFaceFold(model)
      const box = new BoxGeometry(80, 100, 6).toNonIndexed()
      box.translate(0, frontY - 30, 1)
      const source = new Float32Array(box.getAttribute('position').array)
      box.dispose()
      const original = source.slice()
      const result = applyFaceDepth(source, model, 2)
      expect(source).toEqual(original)
      expect(invalidEdges(result)).toBe(0)
      // Large flat triangles left by a boolean must gain the new tangent and
      // bend locally, leaving the rest of the front completely planar.
      let frontTriangles = 0
      for (let triangle = 0; triangle < result.length; triangle += 9) {
        const ys = [1, 4, 7].map((corner) => result[triangle + corner])
        const zs = [2, 5, 8].map((corner) => result[triangle + corner])
        if (!zs.every((z) => z >= 4)) continue
        frontTriangles += 1
        if (Math.max(...ys) <= Math.fround(frontY - 2)) {
          expect(zs).toEqual([6, 6, 6])
        } else if (Math.min(...ys) >= Math.fround(deckY)) {
          expect(zs).toEqual([4, 4, 4])
        } else if (Math.max(...ys) <= frontY) {
          expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(0.125)
          const y = ys.reduce((sum, value) => sum + value, 0) / 3
          const expectedZ =
            y <= frontY - 2
              ? 6
              : y >= deckY - 2
                ? deckIntercept - y
                : 5 + Math.sqrt(1 - (y - frontY + 2) ** 2)
          const actualZ = zs.reduce((sum, value) => sum + value, 0) / 3
          expect(Math.abs(expectedZ - actualZ)).toBeLessThan(0.004)
        }
      }
      expect(frontTriangles).toBeGreaterThan(20)
      expect(applyFaceDepth(source, model, 0)).toBe(source)
    },
  )

  it.each(['s', 'm'] as const)(
    'joins the deeper %s face to the control deck with one convex 1 mm bend',
    (model) => {
      const source = sourcePositions(model)
      const { frontY, deckY, deckIntercept } = getFaceFold(model)
      const material = new MeshBasicMaterial({ side: DoubleSide })
      try {
        for (const relief of [0.5, 1, 2]) {
          const geometry = new BufferGeometry()
          geometry.setAttribute(
            'position',
            new Float32BufferAttribute(
              applyFaceDepth(source, model, relief),
              3,
            ),
          )
          const mesh = new Mesh(geometry, material)
          mesh.updateMatrixWorld(true)
          const ray = new Raycaster()
          const samples: number[] = []
          // This section crosses the actual fillet, outside the control holes.
          for (let step = 0; step <= 40; step += 1) {
            const y = frontY - relief - 0.3 + step / 10
            ray.set(new Vector3(35, y, 20), new Vector3(0, 0, -1))
            const front = ray.intersectObject(mesh)[0]?.point.z
            expect(front).toBeDefined()
            const expected =
              y <= frontY - relief
                ? 4 + relief
                : y >= deckY - relief
                  ? deckIntercept - y
                  : 3 + relief + Math.sqrt(1 - (y - frontY + relief) ** 2)
            // Original STL fillet facets deviate slightly from a true circle.
            expect(Math.abs(front! - expected)).toBeLessThan(0.012)
            samples.push(front!)
          }
          const slopes = samples
            .slice(1)
            .map((z, index) => (z - samples[index]) * 10)
          expect(Math.max(...slopes)).toBeLessThan(0.03)
          expect(Math.min(...slopes)).toBeGreaterThan(-1.12)
          // A returning shoulder would turn the slope back toward zero.
          for (let index = 1; index < slopes.length; index += 1)
            expect(slopes[index] - slopes[index - 1]).toBeLessThan(0.12)
          geometry.dispose()
        }
      } finally {
        material.dispose()
      }
    },
    30_000,
  )

  it.each(['s', 'm'] as const)(
    'preserves exact watertight edges for original and simplified custom %s panels',
    async (model) => {
      const original = sourcePositions(model)
      const refined = applyFaceDepth(original, model, 2)
      expect(invalidEdges(refined)).toBe(0)
      const preserved = new Set<string>()
      for (let index = 0; index < refined.length; index += 3)
        preserved.add(
          `${refined[index]},${refined[index + 1]},${refined[index + 2]}`,
        )
      const { deckY } = getFaceFold(model)
      for (let index = 0; index < original.length; index += 3)
        if (original[index + 2] <= 0.5 || original[index + 1] >= deckY)
          expect(
            preserved.has(
              `${original[index]},${original[index + 1]},${original[index + 2]}`,
            ),
          ).toBe(true)
      // Refinement is confined to intersecting faces, not a global subdivision.
      expect(refined.length).toBeLessThan(original.length * 1.2)

      const engine = await createHandleEngine()
      try {
        const handled = engine.build(
          model,
          'original',
          { ...getDefaultHandleSettings(model), mode: 'custom' },
          original,
        ).positions
        const customized = applyFaceDepth(handled, model, 2)
        expect(invalidEdges(customized)).toBe(0)
        expect(customized.length).toBeLessThan(handled.length * 1.5)
      } finally {
        engine.dispose()
      }
    },
    30_000,
  )
})
