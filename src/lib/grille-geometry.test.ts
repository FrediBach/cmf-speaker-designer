import { readFileSync } from 'node:fs'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGrilleEngine } from './grille-geometry'
import {
  DEFAULT_GRILLE_SETTINGS,
  getGrilleOpenings,
  normalizeGrilleSettings,
} from './grille-settings'
import { createHandleEngine } from './handle-geometry'
import { getDefaultHandleSettings } from './handle-settings'
import {
  buildPanelGeometry,
  exportPanelStl,
  parsePanelGeometry,
  type SpeakerModel,
} from './panels'

function readPanel(model: SpeakerModel) {
  const bytes = readFileSync(
    new URL(
      `../../resources/stl-files/cmf-speaker-${model}-3d-printing-panel-original-v1.stl`,
      import.meta.url,
    ),
  )
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return parsePanelGeometry(buffer, model)
}
function geometryOf(positions: Float32Array) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeBoundingBox()
  return geometry
}
function positionsOf(geometry: BufferGeometry) {
  return new Float32Array(geometry.getAttribute('position').array)
}

function topology(geometry: BufferGeometry) {
  const positions = geometry.getAttribute('position')
  const unique = new Map<string, number>(),
    ids: number[] = [],
    parents: number[] = []
  const find = (index: number) => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]]
      index = parents[index]
    }
    return index
  }
  for (let i = 0; i < positions.count; i += 1) {
    const point = [positions.getX(i), positions.getY(i), positions.getZ(i)]
    if (!point.every(Number.isFinite)) throw new Error('Non-finite mesh')
    const key = point.join(',')
    let id = unique.get(key)
    if (id === undefined) {
      id = unique.size
      unique.set(key, id)
      parents.push(id)
    }
    ids.push(id)
  }
  const edges = new Map<number, number>()
  for (let i = 0; i < ids.length; i += 3)
    for (let j = 0; j < 3; j += 1) {
      const a = ids[i + j],
        b = ids[i + ((j + 1) % 3)]
      if (a === b) throw new Error('Collapsed edge')
      const key = Math.min(a, b) * unique.size + Math.max(a, b)
      edges.set(key, (edges.get(key) ?? 0) + (a < b ? 11 : 9))
      parents[find(a)] = find(b)
    }
  return {
    invalid: [...edges.values()].filter((value) => value !== 20).length,
    components: new Set(parents.map((_, i) => find(i))).size,
  }
}
function hits(geometry: BufferGeometry, x: number, y: number) {
  const material = new MeshBasicMaterial({ side: DoubleSide }),
    mesh = new Mesh(geometry, material)
  mesh.updateMatrixWorld(true)
  const ray = new Raycaster(new Vector3(x, y, 100), new Vector3(0, 0, -1))
  const result = [
    ...new Set(
      ray.intersectObject(mesh).map((hit) => Number(hit.point.z.toFixed(4))),
    ),
  ].sort((a, b) => a - b)
  material.dispose()
  return result
}

describe('real perforated grilles and blind surrounding pattern', () => {
  let engine: Awaited<ReturnType<typeof createGrilleEngine>>
  beforeAll(async () => {
    engine = await createGrilleEngine()
  })
  afterAll(() => engine.dispose())

  const cases = (['s', 'm'] as const).flatMap((model) =>
    (['round', 'hex', 'slot'] as const).map((pattern) => ({ model, pattern })),
  )
  it.each(cases)(
    '$model / $pattern is connected, closed, and perforated with 3 mm deep recesses',
    ({ model, pattern }) => {
      const source = readPanel(model)
      const settings = normalizeGrilleSettings({
        mode: 'custom',
        pattern,
        extendPattern: true,
        recessDepth: 3,
        rotation: pattern === 'slot' ? 30 : 0,
      })
      const result = engine.build(model, settings, positionsOf(source)),
        geometry = geometryOf(result.positions)
      expect(topology(geometry)).toEqual({ invalid: 0, components: 1 })
      expect(result.metadata.throughHoleCount).toBeGreaterThan(5)
      const holes = result.metadata.holes.filter(
        (hole) => hole.kind === 'through',
      )
      for (const hole of [
        holes[0],
        holes[Math.floor(holes.length / 2)],
        holes[holes.length - 1],
      ])
        expect(hits(geometry, hole.x, hole.y)).toEqual([])
      const recess = result.metadata.holes.find(
        (hole) => hole.kind === 'recess',
      )!
      expect(recess).toBeDefined()
      const recessHits = hits(geometry, recess.x, recess.y)
      expect(recessHits.at(-1)).toBeCloseTo(4 - settings.recessDepth, 3)
      expect(recessHits.at(-1)! - recessHits[0]).toBeGreaterThanOrEqual(0.5)
      const openings = getGrilleOpenings(model)
      for (const opening of openings) {
        const boundaryRecess = result.metadata.holes.find(
          (hole) =>
            hole.kind === 'recess' &&
            Math.hypot(hole.x - opening.x, hole.y - opening.y) <
              opening.radius - 0.5,
        )!
        expect(boundaryRecess).toBeDefined()
        expect(hits(source, boundaryRecess.x, boundaryRecess.y)).toEqual([])
        expect(hits(geometry, boundaryRecess.x, boundaryRecess.y)).toEqual([
          4 - settings.thickness,
          4 - settings.recessDepth,
        ])
      }
      for (const [x, y] of [
        [0.3, model === 's' ? 29.5 : 70],
        [35.75, model === 's' ? -53.81 : -97.53],
      ]) {
        expect(hits(geometry, x, y).filter((z) => z <= 0.5)).toEqual(
          hits(source, x, y).filter((z) => z <= 0.5),
        )
      }
      const exported = new STLLoader().parse(exportPanelStl(geometry))
      expect(topology(exported)).toEqual({ invalid: 0, components: 1 })
      exported.dispose()
      geometry.dispose()
      source.dispose()
    },
    30_000,
  )

  it.each([1.5, 2])(
    'keeps exact thickness and blind depth with a generated handle and %s mm added face depth',
    async (relief) => {
      const source = readPanel('s'),
        handles = await createHandleEngine()
      const handle = handles.build(
        's',
        'original',
        {
          ...getDefaultHandleSettings('s'),
          mode: 'custom',
          height: 48,
          cutout: 'circle',
          holeCount: 3,
          holeWidth: 10,
        },
        positionsOf(source),
      )
      const handled = geometryOf(handle.positions),
        deeper = buildPanelGeometry(handled, 's', 'original', relief)
      const settings = normalizeGrilleSettings({
        mode: 'custom',
        pattern: 'round',
        layout: 'grid',
        size: 4,
        spacing: 2,
        thickness: 2,
        extendPattern: true,
        recessDepth: 1.5,
      })
      const result = engine.build('s', settings, positionsOf(deeper)),
        geometry = geometryOf(result.positions)
      expect(topology(geometry)).toEqual({ invalid: 0, components: 1 })
      expect(result.metadata.frontZ).toBeCloseTo(4 + relief, 4)
      expect(hits(geometry, 0, 0)).toEqual([])
      expect(hits(geometry, 3, 0)).toEqual([2 + relief, 4 + relief])
      // These recesses fill the former blank ring, including one whose
      // outline crosses from the grille insert onto the original panel.
      for (const [x, y] of [
        [0, 6],
        [30, -24],
        [0, -54],
        [30, -12],
      ]) {
        expect(result.metadata.holes).toContainEqual({ x, y, kind: 'recess' })
        expect(hits(deeper, x, y)).toEqual([])
        const boundaryHits = hits(geometry, x, y)
        expect(boundaryHits).toHaveLength(2)
        expect(boundaryHits[0]).toBeCloseTo(4 + relief - settings.thickness, 4)
        expect(boundaryHits[1]).toBeCloseTo(
          4 + relief - settings.recessDepth,
          4,
        )
        expect(boundaryHits[1] - boundaryHits[0]).toBeCloseTo(0.5, 4)
      }
      // Sample the same recess on the original face outside the insert:
      // its floor follows the local face and preserves the existing rear.
      const seamHits = hits(geometry, 31.5, -12)
      const originalSeamHits = hits(deeper, 31.5, -12)
      expect(originalSeamHits).toHaveLength(2)
      expect(seamHits).toHaveLength(2)
      expect(seamHits[0]).toBe(originalSeamHits[0])
      expect(seamHits[1]).toBeCloseTo(
        originalSeamHits[1] - settings.recessDepth,
        3,
      )
      expect(hits(geometry, 36, 0)[0]).toBe(0.5)
      expect(hits(geometry, 36, 0).at(-1)).toBeCloseTo(
        hits(deeper, 36, 0).at(-1)! - settings.recessDepth,
        3,
      )
      expect(
        hits(geometry, 36, 0).at(-1)! - hits(geometry, 36, 0)[0],
      ).toBeGreaterThanOrEqual(1.5)
      expect(hits(geometry, 33, 0)).toEqual(hits(deeper, 33, 0))
      for (const hole of handle.metadata.holeCenters)
        expect(hits(geometry, hole.x, hole.y)).toEqual([])
      geometry.dispose()
      deeper.dispose()
      handled.dispose()
      source.dispose()
      handles.dispose()
    },
    30_000,
  )

  it.each([
    { size: 2, spacing: 1.2, thickness: 4, recessDepth: 3, rotation: 45 },
    { size: 10, spacing: 6, thickness: 2, recessDepth: 0.2, rotation: 90 },
  ])(
    'keeps extreme density and wall settings manifold: %j',
    (settings) => {
      const source = readPanel('s')
      const result = engine.build(
        's',
        normalizeGrilleSettings({
          ...settings,
          mode: 'custom',
          extendPattern: true,
        }),
        positionsOf(source),
      )
      const geometry = geometryOf(result.positions)
      expect(topology(geometry)).toEqual({ invalid: 0, components: 1 })
      geometry.dispose()
      source.dispose()
    },
    30_000,
  )

  it('preserves original mode exactly', () => {
    const source = readPanel('s'),
      positions = positionsOf(source)
    expect(
      engine.build('s', DEFAULT_GRILLE_SETTINGS, positions).positions,
    ).toEqual(positions)
    source.dispose()
  })
})
