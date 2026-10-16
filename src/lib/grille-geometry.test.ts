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
import { createPanelGapEngine } from './panel-gap'
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

describe('real perforated grilles and signed surrounding pattern depth', () => {
  let engine: Awaited<ReturnType<typeof createGrilleEngine>>
  beforeAll(async () => {
    engine = await createGrilleEngine()
  })
  afterAll(() => engine.dispose())

  const cases = (['s', 'm'] as const).flatMap((model) =>
    (['round', 'hex', 'slot'] as const).map((pattern) => ({ model, pattern })),
  )
  it.each(
    cases.flatMap((entry) => [6, -3].map((depth) => ({ ...entry, depth }))),
  )(
    '$model / $pattern stays closed and connected at $depth mm surface depth',
    ({ model, pattern, depth }) => {
      const source = readPanel(model)
      const settings = normalizeGrilleSettings({
        mode: 'custom',
        pattern,
        extendPattern: true,
        recessDepth: depth,
        thickness: 2,
        rotation: 37,
      })
      const result = engine.build(model, settings, positionsOf(source))
      const geometry = geometryOf(result.positions)
      expect(topology(geometry)).toEqual({ invalid: 0, components: 1 })
      for (const hole of result.metadata.holes.filter(
        (hole) => hole.kind === 'through',
      ))
        expect(hits(geometry, hole.x, hole.y)).toEqual([])
      const surface = result.metadata.holes.filter(
        (hole) => hole.kind === 'recess',
      )
      if (depth > 0) {
        expect(
          surface.filter((hole) => hits(geometry, hole.x, hole.y).length === 0)
            .length,
        ).toBeGreaterThan(10)
      } else {
        for (const hole of surface) {
          const column = hits(geometry, hole.x, hole.y)
          // Keep every source rear surface, including roots and latch gaps.
          // Within the original aperture, the insert supplies the rear face.
          const sourceColumn = hits(source, hole.x, hole.y)
          const rear = sourceColumn.length
            ? sourceColumn.slice(0, -1)
            : [4 - settings.thickness]
          expect(column).toHaveLength(rear.length + 1)
          rear.forEach((z, index) => expect(column[index]).toBeCloseTo(z, 3))
          expect(column.at(-1)).toBeCloseTo(4 - depth, 3)
        }
      }
      const exported = new STLLoader().parse(exportPanelStl(geometry))
      expect(topology(exported)).toEqual({ invalid: 0, components: 1 })
      exported.dispose()
      geometry.dispose()
      source.dispose()
    },
    30_000,
  )

  it.each(
    (['s', 'm'] as const).flatMap((model) =>
      [0, 5].map((gap) => ({ model, gap })),
    ),
  )(
    'perforates the $model face while retaining attachment backing at $gap mm gap',
    async ({ model, gap }) => {
      const source = readPanel(model)
      const deeper = buildPanelGeometry(source, model, 'original', 2, 7.5)
      const gaps = await createPanelGapEngine()
      const spaced = geometryOf(
        gaps.build(model, positionsOf(deeper), gap, 2).positions,
      )
      const settings = normalizeGrilleSettings({
        mode: 'custom',
        layout: 'grid',
        extendPattern: true,
        recessDepth: 6,
        thickness: 4,
      })
      const geometry = geometryOf(
        engine.build(model, settings, positionsOf(spaced), gap).positions,
      )
      expect(topology(geometry)).toEqual({ invalid: 0, components: 1 })
      // Solid face and former insert rim both open all the way through.
      for (const [x, y] of model === 's'
        ? [
            [36, 0],
            [0, 6],
          ]
        : [
            [36, 0],
            [0, -18],
          ])
        expect(hits(geometry, x, y)).toEqual([])
      // A full-depth pattern at each latch still leaves its root and backing.
      for (const x of [-36, 36])
        for (const y of model === 's' ? [-54, 6] : [-102, -30, 30]) {
          const before = hits(spaced, x, y)
          const after = hits(geometry, x, y)
          expect(before.length).toBeGreaterThanOrEqual(2)
          expect(before[0]).toBeLessThan(0.5 + gap)
          expect(after.filter((z) => z < 0.5 + gap)).toEqual(
            before.filter((z) => z < 0.5 + gap),
          )
          expect(after.at(-1)).toBeCloseTo(1 + gap, 3)
        }
      // Material between neighboring cuts is unchanged.
      expect(hits(geometry, 33, 0)).toEqual(hits(spaced, 33, 0))
      geometry.dispose()
      spaced.dispose()
      deeper.dispose()
      source.dispose()
      gaps.dispose()
    },
    30_000,
  )

  it('raises the local face and aperture bevel while zero leaves a flat face', () => {
    const source = readPanel('s')
    const deeper = buildPanelGeometry(source, 's', 'original', 2)
    const settings = normalizeGrilleSettings({
      mode: 'custom',
      layout: 'grid',
      extendPattern: true,
      recessDepth: 0,
      thickness: 2,
    })
    const flat = engine.build('s', settings, positionsOf(deeper))
    const plain = engine.build(
      's',
      { ...settings, extendPattern: false },
      positionsOf(deeper),
    )
    expect(flat.positions).toEqual(plain.positions)
    const flatGeometry = geometryOf(flat.positions)
    const raised = geometryOf(
      engine.build('s', { ...settings, recessDepth: -3 }, positionsOf(deeper))
        .positions,
    )
    expect(topology(raised)).toEqual({ invalid: 0, components: 1 })
    for (const [x, y] of [
      [36, 0],
      [0, 6],
      [30, -12],
      [31.5, -12],
    ]) {
      const before = hits(flatGeometry, x, y)
      const after = hits(raised, x, y)
      expect(after).toHaveLength(2)
      expect(after[0]).toBe(before[0])
      expect(after[1]).toBeCloseTo(before[1] + 3, 3)
    }
    expect(hits(raised, 0, 0)).toEqual([])
    expect(hits(raised, 33, 0)).toEqual(hits(flatGeometry, 33, 0))
    raised.dispose()
    flatGeometry.dispose()
    deeper.dispose()
    source.dispose()
  })

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
