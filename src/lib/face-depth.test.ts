import { readFileSync } from 'node:fs'
import { BoxGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { applyFaceDepth } from './face-depth'
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
      const faceTop = model === 's' ? 19 : 57
      const box = new BoxGeometry(80, 100, 6).toNonIndexed()
      box.translate(0, faceTop - 30, 1)
      const source = new Float32Array(box.getAttribute('position').array)
      box.dispose()
      const original = source.slice()
      const result = applyFaceDepth(source, model, 2)
      expect(source).toEqual(original)
      expect(invalidEdges(result)).toBe(0)
      // Both source triangles span well beyond the 3 mm transition. Every
      // resulting front triangle must stay within one deformation band.
      let frontTriangles = 0
      for (let triangle = 0; triangle < result.length; triangle += 9) {
        const ys = [1, 4, 7].map((corner) => result[triangle + corner])
        const zs = [2, 5, 8].map((corner) => result[triangle + corner])
        if (!zs.every((z) => z >= 4)) continue
        frontTriangles += 1
        if (Math.max(...ys) <= faceTop - 3) {
          expect(zs).toEqual([6, 6, 6])
        } else if (Math.min(...ys) >= faceTop) {
          expect(zs).toEqual([4, 4, 4])
        } else {
          expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(0.25)
          const y = ys.reduce((sum, value) => sum + value, 0) / 3
          const t = (y - faceTop + 3) / 3
          const expectedZ = 4 + 2 * (1 - t * t * (3 - 2 * t))
          const actualZ = zs.reduce((sum, value) => sum + value, 0) / 3
          expect(Math.abs(expectedZ - actualZ)).toBeLessThan(0.011)
        }
      }
      expect(frontTriangles).toBeGreaterThan(20)
      expect(applyFaceDepth(source, model, 0)).toBe(source)
    },
  )

  it.each(['s', 'm'] as const)(
    'preserves exact watertight edges for original and simplified custom %s panels',
    async (model) => {
      const original = sourcePositions(model)
      const refined = applyFaceDepth(original, model, 2)
      expect(invalidEdges(refined)).toBe(0)
      // Refinement is confined to intersecting faces, not a global subdivision.
      expect(refined.length).toBeLessThan(original.length * 1.15)

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
