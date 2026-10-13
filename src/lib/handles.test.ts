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
import { describe, expect, it } from 'vitest'
import { buildHandledPanelGeometry } from './handles'
import {
  getDefaultHandleSettings,
  normalizeHandleSettings,
  type HandleSettings,
} from './handle-settings'
import {
  exportPanelStl,
  parsePanelGeometry,
  type PanelStyle,
  type SpeakerModel,
} from './panels'

const cases: [SpeakerModel, PanelStyle][] = [
  ['s', 'original'],
  ['m', 'original'],
]

function readPanel(model: SpeakerModel, style: PanelStyle) {
  const data = readFileSync(
    new URL(
      `../../resources/stl-files/cmf-speaker-${model}-3d-printing-panel-${style}-v1.stl`,
      import.meta.url,
    ),
  )
  const buffer = new ArrayBuffer(data.byteLength)
  new Uint8Array(buffer).set(data)
  return parsePanelGeometry(buffer, model)
}

function inspectTopology(geometry: BufferGeometry) {
  const positions = geometry.getAttribute('position')
  const unique = new Map<string, number>()
  const ids: number[] = []
  const parents: number[] = []
  const find = (id: number): number => {
    while (parents[id] !== id) {
      parents[id] = parents[parents[id]]
      id = parents[id]
    }
    return id
  }
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index),
      y = positions.getY(index),
      z = positions.getZ(index)
    if (![x, y, z].every(Number.isFinite)) throw new Error('Non-finite vertex')
    const key = `${x},${y},${z}`
    let id = unique.get(key)
    if (id === undefined) {
      id = unique.size
      unique.set(key, id)
      parents.push(id)
    }
    ids.push(id)
  }
  const edges = new Map<number, number>()
  for (let index = 0; index < ids.length; index += 3) {
    for (let side = 0; side < 3; side += 1) {
      const a = ids[index + side],
        b = ids[index + ((side + 1) % 3)]
      if (a === b)
        throw new Error(
          `Collapsed edge in triangle ${index / 3}: ${Array.from(
            positions.array,
          )
            .slice(index * 3, index * 3 + 9)
            .join(', ')}`,
        )
      const key = Math.min(a, b) * unique.size + Math.max(a, b)
      edges.set(key, (edges.get(key) ?? 0) + (a < b ? 11 : 9))
      parents[find(a)] = find(b)
    }
  }
  return {
    invalidEdges: [...edges.values()].filter((count) => count !== 20).length,
    components: new Set(parents.map((_, id) => find(id))).size,
  }
}

function intersections(geometry: BufferGeometry, x: number, y: number) {
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material)
  mesh.updateMatrixWorld(true)
  const ray = new Raycaster(new Vector3(x, y, 150), new Vector3(0, 0, -1))
  const hits = ray.intersectObject(mesh).map((hit) => hit.point.z)
  material.dispose()
  return [...new Set(hits.map((z) => Number(z.toFixed(4))))].sort(
    (a, b) => a - b,
  )
}

describe('generative handles', () => {
  it.each(cases)(
    'joins a genuinely perforated custom handle to %s/%s as one closed solid',
    async (model, style) => {
      const original = readPanel(model, style)
      const settings = normalizeHandleSettings(model, {
        ...getDefaultHandleSettings(model),
        mode: 'custom',
        height: 48,
        width: 96,
        cornerRadius: 8,
        cutout: 'circle',
        holeCount: 3,
        holeWidth: 12,
        holeGap: 8,
        offsetX: 6,
        offsetY: 3,
      })
      const geometry = await buildHandledPanelGeometry(
        original,
        model,
        style,
        0,
        settings,
      )
      const expectedSeam =
        original.boundingBox!.max.y - (model === 's' ? 24 : 27)
      expect(geometry.boundingBox!.min.y).toBe(original.boundingBox!.min.y)
      expect(geometry.boundingBox!.max.y).toBeCloseTo(expectedSeam + 48, 4)
      expect(
        geometry.boundingBox!.max.x - geometry.boundingBox!.min.x,
      ).toBeCloseTo(96, 4)
      expect(inspectTopology(geometry)).toEqual({
        invalidEdges: 0,
        components: 1,
      })
      const centers = geometry.userData.handle.holeCenters as {
        x: number
        y: number
      }[]
      expect(centers).toHaveLength(3)
      for (const hole of centers)
        expect(intersections(geometry, hole.x, hole.y)).toEqual([])
      expect(
        intersections(
          geometry,
          (centers[0].x + centers[1].x) / 2,
          centers[0].y,
        ),
      ).toHaveLength(2)
      expect(
        intersections(geometry, 0, expectedSeam + settings.height - 1),
      ).toHaveLength(2)

      // Actual lower surfaces, controls, and mounting features survive the boolean.
      for (const [x, y] of [
        [0.3, -50],
        [37.2, -35],
        [5.3, model === 's' ? 29.5 : 70],
      ]) {
        const before = intersections(original, x, y)
        const after = intersections(geometry, x, y)
        expect(after.length).toBe(before.length)
        after.forEach((z, index) => expect(z).toBeCloseTo(before[index], 3))
      }
      const roundtrip = new STLLoader().parse(exportPanelStl(geometry))
      expect(inspectTopology(roundtrip)).toEqual({
        invalidEdges: 0,
        components: 1,
      })
      roundtrip.computeBoundingBox()
      expect(roundtrip.boundingBox!.min.z).toBeCloseTo(0, 5)
      roundtrip.dispose()
      geometry.dispose()
      original.dispose()
    },
    30_000,
  )

  it.each(['none', 'circle', 'slot'] as const)(
    'keeps constrained minimum-size %s designs connected',
    async (cutout) => {
      const original = readPanel('s', 'original')
      const settings = normalizeHandleSettings('s', {
        mode: 'custom',
        height: 16,
        width: 60,
        cornerRadius: 16,
        cutout,
        holeCount: 3,
        holeWidth: 64,
        holeHeight: 30,
        holeGap: 20,
        offsetX: 30,
        offsetY: -24,
      })
      const geometry = await buildHandledPanelGeometry(
        original,
        's',
        'original',
        2,
        settings,
      )
      expect(inspectTopology(geometry)).toEqual({
        invalidEdges: 0,
        components: 1,
      })
      for (const center of geometry.userData.handle.holeCenters)
        expect(intersections(geometry, center.x, center.y)).toEqual([])
      if (cutout === 'none')
        expect(
          intersections(geometry, 0, geometry.userData.handle.seamY + 10),
        ).toHaveLength(2)
      geometry.dispose()
      original.dispose()
    },
    30_000,
  )

  it('keeps original mode byte-identical, and slot width changes the true opening', async () => {
    const original = readPanel('s', 'original')
    const untouched = await buildHandledPanelGeometry(
      original,
      's',
      'original',
      0,
      getDefaultHandleSettings('s'),
    )
    expect(untouched.getAttribute('position').array).toEqual(
      original.getAttribute('position').array,
    )
    const input: HandleSettings = {
      ...getDefaultHandleSettings('s'),
      mode: 'custom',
      height: 40,
      cutout: 'slot',
      holeWidth: 40,
      holeHeight: 12,
    }
    const wide = await buildHandledPanelGeometry(
      original,
      's',
      'original',
      0,
      input,
    )
    const narrow = await buildHandledPanelGeometry(
      original,
      's',
      'original',
      0,
      { ...input, holeWidth: 16 },
    )
    const y = wide.userData.handle.holeCenters[0].y
    expect(intersections(wide, 15, y)).toEqual([])
    expect(intersections(narrow, 15, y)).toHaveLength(2)
    untouched.dispose()
    wide.dispose()
    narrow.dispose()
    original.dispose()
  }, 30_000)
})
