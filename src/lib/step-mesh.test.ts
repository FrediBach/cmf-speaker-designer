import { readFileSync } from 'node:fs'
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  TorusGeometry,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { KNOB_STYLES } from './knob-settings'
import { customizeKnobGeometry, parseKnobGeometry } from './knobs'
import { parsePanelGeometry } from './panels'
import { createStepMeshPreparer } from './step-mesh'
import { STEP_TOLERANCE_MM } from './step-settings'

function asset(name: string): ArrayBuffer {
  const bytes = readFileSync(
    new URL(`../../resources/stl-files/${name}`, import.meta.url),
  )
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

/** Independent edge, Euler-characteristic and signed-volume measurements. */
function measure(geometry: BufferGeometry) {
  const positions = geometry.getAttribute('position')
  const indices = geometry.getIndex()
  const count = indices?.count ?? positions.count
  const unique = new Map<string, number>()
  const parents: number[] = []
  const edges = new Map<string, number>()
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const root = (id: number): number => {
    while (parents[id] !== id) {
      parents[id] = parents[parents[id]]
      id = parents[id]
    }
    return id
  }
  let volume = 0
  for (let corner = 0; corner < count; corner += 3) {
    const ids: number[] = []
    const points: number[][] = []
    for (let offset = 0; offset < 3; offset += 1) {
      const vertex = indices ? indices.getX(corner + offset) : corner + offset
      const point = [
        positions.getX(vertex),
        positions.getY(vertex),
        positions.getZ(vertex),
      ]
      if (!point.every(Number.isFinite)) throw new Error('Invalid coordinate')
      point.forEach((value, axis) => {
        min[axis] = Math.min(min[axis], value)
        max[axis] = Math.max(max[axis], value)
      })
      const key = point.map((value) => Math.round(value * 1e9)).join(',')
      let id = unique.get(key)
      if (id === undefined) {
        id = unique.size
        unique.set(key, id)
        parents.push(id)
      }
      ids.push(id)
      points.push(point)
    }
    const [a, b, c] = points
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6
    for (let edge = 0; edge < 3; edge += 1) {
      const a = ids[edge]
      const b = ids[(edge + 1) % 3]
      if (a === b) throw new Error('Collapsed triangle')
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`
      edges.set(key, (edges.get(key) ?? 0) + (a < b ? 11 : 9))
      parents[root(a)] = root(b)
    }
  }
  const components = new Set(parents.map((_, id) => root(id))).size
  return {
    triangles: count / 3,
    invalidEdges: [...edges.values()].filter((value) => value !== 20).length,
    components,
    genus: components - (unique.size - edges.size + count / 3) / 2,
    volume,
    min,
    max,
  }
}

function expectPreserved(
  original: ReturnType<typeof measure>,
  result: ReturnType<typeof measure>,
) {
  expect(result.invalidEdges).toBe(0)
  expect(result.components).toBe(original.components)
  expect(result.genus).toBe(original.genus)
  expect(Math.abs(result.volume / original.volume - 1)).toBeLessThan(0.004)
  for (const side of ['min', 'max'] as const)
    original[side].forEach((value, axis) =>
      expect(Math.abs(value - result[side][axis])).toBeLessThanOrEqual(
        STEP_TOLERANCE_MM + 0.000001,
      ),
    )
}

describe('STEP mesh preparation', () => {
  let preparer: Awaited<ReturnType<typeof createStepMeshPreparer>>
  beforeAll(async () => {
    preparer = await createStepMeshPreparer()
  })

  it.each([false, true])(
    'preserves indexed/nonindexed dimensions without mutating input (%s)',
    (nonIndexed) => {
      const box = new BoxGeometry(7.25, 11.5, 19.75)
      const source = nonIndexed ? box.toNonIndexed() : box
      source.translate(-25, 14, 100)
      source.userData = { units: 'mm', part: 'panel' }
      const before = source.getAttribute('position').array.slice()
      const indexBefore = source.index?.array.slice()
      const result = preparer.prepare(source)
      expectPreserved(measure(source), measure(result))
      expect(result).not.toBe(source)
      expect(result.getAttribute('position').array).not.toBe(
        source.getAttribute('position').array,
      )
      expect(result.userData).toEqual({
        ...source.userData,
        stepToleranceMm: STEP_TOLERANCE_MM,
      })
      expect(source.getAttribute('position').array).toEqual(before)
      expect(source.index?.array).toEqual(indexBefore)
      expect(source.userData).toEqual({ units: 'mm', part: 'panel' })
      result.dispose()
      source.dispose()
      if (nonIndexed) box.dispose()
    },
  )

  it('retains through-holes, separate solids and reversed cavity shells', () => {
    const torus = new TorusGeometry(6, 1, 20, 64).translate(20, 0, 0)
    const outer = new BoxGeometry(10, 10, 10)
    const inner = new BoxGeometry(4, 4, 4)
    const indices = inner.getIndex()!
    for (let corner = 0; corner < indices.count; corner += 3) {
      const first = indices.getX(corner)
      indices.setX(corner, indices.getX(corner + 1))
      indices.setX(corner + 1, first)
    }
    const source = mergeGeometries([torus, outer, inner])
    const result = preparer.prepare(source)
    const original = measure(source)
    expect(original.components).toBe(3)
    expect(original.genus).toBe(1)
    expectPreserved(original, measure(result))
    for (const geometry of [torus, outer, inner, source, result])
      geometry.dispose()
  })

  it.each(['s', 'm'] as const)(
    'reduces the real %s panel while preserving mounting holes and dimensions',
    (model) => {
      const source = parsePanelGeometry(
        asset(`cmf-speaker-${model}-3d-printing-panel-original-v1.stl`),
        model,
      )
      const result = preparer.prepare(source)
      const original = measure(source)
      const simplified = measure(result)
      expectPreserved(original, simplified)
      expect(simplified.triangles).toBeLessThan(original.triangles / 4)
      expect(simplified.triangles).toBeLessThan(40000)
      source.dispose()
      result.dispose()
    },
  )

  it.each(KNOB_STYLES)(
    'reduces customized $label knobs while retaining their shaft mounts',
    ({ id }) => {
      const source = parseKnobGeometry(
        asset('cmf-speaker-sm-3d-printing-knob-original-v1.stl'),
        id,
      )
      const customized = customizeKnobGeometry(source, {
        style: id,
        height: 20,
        taper: 0.6,
        flutePath: 'spiral',
      })
      const result = preparer.prepare(customized)
      const original = measure(customized)
      const simplified = measure(result)
      expectPreserved(original, simplified)
      expect(simplified.triangles).toBeLessThan(original.triangles * 0.75)
      source.dispose()
      customized.dispose()
      result.dispose()
    },
  )

  it('rejects invalid coordinates, triangle indices, empty and open meshes', () => {
    const invalid = new BoxGeometry()
    invalid.getAttribute('position').setX(0, Infinity)
    expect(() => preparer.prepare(invalid)).toThrow('invalid coordinates')
    invalid.dispose()
    const badIndex = new BoxGeometry()
    badIndex.setIndex(new BufferAttribute(new Float32Array([-1, 1, 2]), 1))
    expect(() => preparer.prepare(badIndex)).toThrow('triangle index')
    badIndex.dispose()
    const empty = new BufferGeometry()
    expect(() => preparer.prepare(empty)).toThrow('non-empty triangle mesh')
    empty.dispose()
    const open = new BufferGeometry()
    open.setAttribute(
      'position',
      new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    )
    expect(() => preparer.prepare(open)).toThrow('closed mesh surfaces')
    open.dispose()
    // A rejected mesh must not poison the reusable kernel.
    const valid = new BoxGeometry()
    const result = preparer.prepare(valid)
    expect(measure(result).volume).toBeCloseTo(1)
    valid.dispose()
    result.dispose()
  })
})
