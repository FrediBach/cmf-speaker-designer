import { readFileSync } from 'node:fs'
import {
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  exportPowerButtonStl,
  loadPowerButtonGeometry,
  parsePowerButtonGeometry,
  powerButtonFilename,
  preparePowerButtonExportGeometry,
} from './power-button'

const bytes = readFileSync(
  new URL(
    '../../resources/stl-files/cmf-speaker-sm-3d-printing-power-button-original-v1.stl',
    import.meta.url,
  ),
)
const sourceData = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
) as ArrayBuffer

function topology(geometry: BufferGeometry) {
  const points = geometry.getAttribute('position')
  const vertices = new Map<string, number>()
  const parents: number[] = []
  const edges = new Map<string, number>()
  const root = (id: number): number => {
    while (parents[id] !== id) {
      parents[id] = parents[parents[id]]
      id = parents[id]
    }
    return id
  }
  let volume = 0
  for (let triangle = 0; triangle < points.count; triangle += 3) {
    const ids: number[] = []
    const coordinates: number[][] = []
    for (let corner = 0; corner < 3; corner += 1) {
      const index = triangle + corner
      const point = [points.getX(index), points.getY(index), points.getZ(index)]
      if (!point.every(Number.isFinite))
        throw new Error('Non-finite power button vertex')
      coordinates.push(point)
      const key = point.join(',')
      let id = vertices.get(key)
      if (id === undefined) {
        id = vertices.size
        vertices.set(key, id)
        parents.push(id)
      }
      ids.push(id)
    }
    const [a, b, c] = coordinates
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6
    for (let edge = 0; edge < 3; edge += 1) {
      const a = ids[edge],
        b = ids[(edge + 1) % 3]
      if (a === b) throw new Error('Collapsed power button triangle')
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`
      edges.set(key, (edges.get(key) ?? 0) + (a < b ? 11 : 9))
      parents[root(a)] = root(b)
    }
  }
  return {
    invalidEdges: [...edges.values()].filter((count) => count !== 20).length,
    components: new Set(parents.map((_, id) => root(id))).size,
    volume,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('original power button', () => {
  it('retains every source triangle, shaft axis, keyed flange, and original dimension', () => {
    const original = new STLLoader().parse(sourceData)
    original.computeBoundingBox()
    const button = parsePowerButtonGeometry(sourceData)
    const positions = button.getAttribute('position')
    const source = original.getAttribute('position')
    expect(positions.count / 3).toBe(7738)
    for (let index = 0; index < positions.count; index += 1) {
      expect(positions.getX(index)).toBe(source.getX(index))
      expect(positions.getY(index)).toBe(source.getY(index))
      expect(positions.getZ(index)).toBe(
        Math.fround(source.getZ(index) - original.boundingBox!.min.z),
      )
    }
    expect(button.boundingBox!.min.x).toBeCloseTo(-10.240629, 5)
    expect(button.boundingBox!.max.x).toBeCloseTo(10.240629, 5)
    expect(button.boundingBox!.min.y).toBeCloseTo(-10.240233, 5)
    expect(button.boundingBox!.max.y).toBeCloseTo(8.95, 5)
    expect(button.boundingBox!.min.z).toBe(0)
    expect(button.boundingBox!.max.z).toBeCloseTo(4.1, 5)
    const inspection = topology(button)
    expect(inspection.invalidEdges).toBe(0)
    expect(inspection.components).toBe(1)
    expect(inspection.volume).toBeCloseTo(958.5474, 3)
    original.dispose()
    button.dispose()
  })

  it('prints on its flat cap face with the actuator and keyed flange facing upwards', () => {
    const button = parsePowerButtonGeometry(sourceData)
    const material = new MeshBasicMaterial({ side: DoubleSide })
    const mesh = new Mesh(button, material)
    mesh.updateMatrixWorld(true)
    const hits = (x: number, y: number) => [
      ...new Set(
        new Raycaster(new Vector3(x, y, 10), new Vector3(0, 0, -1))
          .intersectObject(mesh)
          .map((hit) => Number(hit.point.z.toFixed(4))),
      ),
    ]
    expect(hits(0.1, 0.1)).toEqual([4.1, 0])
    expect(hits(0, 7)).toEqual([3.5, 0])
    // The key extends past the round cap on only one side; centering or
    // replacing this with a cylinder would break the original mounting fit.
    expect(hits(0, -9)).toEqual([3.5, 2.3])
    expect(hits(0, 9)).toEqual([])
    material.dispose()
    button.dispose()
  })

  it('exports the same watertight geometry without mutating the preview mesh', () => {
    const button = parsePowerButtonGeometry(sourceData)
    const coordinates = button.getAttribute('position').array.slice()
    const prepared = preparePowerButtonExportGeometry(button)
    expect(prepared).not.toBe(button)
    expect(prepared.getAttribute('position').array).toEqual(coordinates)
    const exported = new STLLoader().parse(exportPowerButtonStl(button))
    expect(exported.getAttribute('position').array).toEqual(coordinates)
    expect(button.getAttribute('position').array).toEqual(coordinates)
    expect(topology(exported)).toEqual(topology(button))
    expect(powerButtonFilename()).toBe('cmf-speaker-power-button-original.stl')
    button.translate(0, 0, 7)
    const grounded = preparePowerButtonExportGeometry(button)
    expect(grounded.boundingBox!.min.z).toBe(0)
    button.computeBoundingBox()
    expect(button.boundingBox!.min.z).toBe(7)
    for (const geometry of [button, prepared, exported, grounded])
      geometry.dispose()
  })

  it('allows failed downloads to retry, shares successful loads, and returns independently owned clones', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue({ ok: true, arrayBuffer: async () => sourceData })
    vi.stubGlobal('fetch', fetcher)
    await expect(loadPowerButtonGeometry()).rejects.toThrow(
      'Unable to load the power button (503).',
    )
    const [first, second] = await Promise.all([
      loadPowerButtonGeometry(),
      loadPowerButtonGeometry(),
    ])
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(first).not.toBe(second)
    expect(first.getAttribute('position').array).not.toBe(
      second.getAttribute('position').array,
    )
    first.translate(100, 0, 0)
    const third = await loadPowerButtonGeometry()
    expect(third.getAttribute('position').array).toEqual(
      second.getAttribute('position').array,
    )
    expect(fetcher).toHaveBeenCalledTimes(2)
    const controller = new AbortController()
    controller.abort()
    await expect(loadPowerButtonGeometry(controller.signal)).rejects.toThrow()
    for (const geometry of [first, second, third]) geometry.dispose()
  })
})
