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
import { createRaceStripeEngine } from './race-stripe-geometry'
import { getFaceFold } from './face-depth'
import {
  DEFAULT_RACE_STRIPE_SETTINGS,
  getRaceStripeIntervals,
  normalizeRaceStripeSettings,
  RACE_STRIPE_DEPTH,
} from './race-stripe-settings'
import { normalizeGrilleSettings } from './grille-settings'
import { normalizeHaloSettings } from './halo-settings'
import {
  getDefaultHandleSettings,
  HANDLE_STUD_DIAMETER,
} from './handle-settings'
import { buildHandledPanelGeometry } from './handles'
import { exportPanelStl, parsePanelGeometry, type SpeakerModel } from './panels'

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

function positionsOf(geometry: BufferGeometry) {
  return new Float32Array(geometry.getAttribute('position').array)
}

function geometryOf(positions: Float32Array) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  return geometry
}

/** Check the exact Float32 triangles that will be sent to the slicer. */
function topology(geometry: BufferGeometry) {
  const positions = positionsOf(geometry)
  const ids = new Map<string, number>()
  const vertices: number[] = [],
    parents: number[] = []
  const find = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]]
      index = parents[index]
    }
    return index
  }
  for (let index = 0; index < positions.length; index += 3) {
    const point = Array.from(positions.subarray(index, index + 3))
    if (!point.every(Number.isFinite)) throw new Error('Non-finite vertex')
    const key = point.join(',')
    let id = ids.get(key)
    if (id === undefined) {
      id = ids.size
      ids.set(key, id)
      parents.push(id)
    }
    vertices.push(id)
  }
  const edges = new Map<number, number>()
  for (let triangle = 0; triangle < vertices.length; triangle += 3)
    for (let edge = 0; edge < 3; edge += 1) {
      const a = vertices[triangle + edge],
        b = vertices[triangle + ((edge + 1) % 3)]
      if (a === b) throw new Error('Collapsed edge')
      const key = Math.min(a, b) * ids.size + Math.max(a, b)
      edges.set(key, (edges.get(key) ?? 0) + (a < b ? 11 : 9))
      parents[find(a)] = find(b)
    }
  return {
    invalidEdges: [...edges.values()].filter((count) => count !== 20).length,
    components: new Set(parents.map((_, index) => find(index))).size,
  }
}

function hits(
  geometry: BufferGeometry,
  origin: Vector3,
  direction = new Vector3(0, 0, -1),
) {
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material)
  mesh.updateMatrixWorld(true)
  const points = new Raycaster(origin, direction)
    .intersectObject(mesh)
    .map((hit) => hit.point)
  material.dispose()
  return points
}

function heights(geometry: BufferGeometry, x: number, y: number) {
  return [
    ...new Set(
      hits(geometry, new Vector3(x, y, 100)).map((point) =>
        Number(point.z.toFixed(4)),
      ),
    ),
  ].sort((a, b) => a - b)
}

describe('recessed race stripes', () => {
  let engine: Awaited<ReturnType<typeof createRaceStripeEngine>>
  beforeAll(async () => {
    engine = await createRaceStripeEngine()
  })
  afterAll(() => engine.dispose())

  it('leaves disabled stripes unchanged', () => {
    const positions = new Float32Array(9)
    const result = engine.build('s', DEFAULT_RACE_STRIPE_SETTINGS, positions)
    expect(result.positions).toBe(positions)
    expect(result.metadata.intervals).toEqual([])
  })

  it.each(
    (['s', 'm'] as const).flatMap((model) =>
      [1, 2, 3].map((count) => ({ model, count })),
    ),
  )(
    'carves $count stripes continuously across the $model face, deck and handle',
    ({ model, count }) => {
      const source = readPanel(model)
      const settings = normalizeRaceStripeSettings({
        enabled: true,
        count,
        width: 8,
        gap: 4,
      })
      const positions = positionsOf(source)
      const before = positions.slice()
      const result = engine.build(model, settings, positions)
      const geometry = geometryOf(result.positions)
      try {
        expect(positions).toEqual(before)
        expect(topology(geometry)).toEqual({ invalidEdges: 0, components: 1 })
        expect(result.metadata.depthMm).toBe(RACE_STRIPE_DEPTH)
        for (const interval of result.metadata.intervals) {
          const x = (interval.minX + interval.maxX) / 2
          const frontY = model === 's' ? -61 : -108
          const handleY = model === 's' ? 50 : 110
          expect(heights(geometry, x, frontY).at(-1)).toBeCloseTo(3.2, 4)
          expect(heights(geometry, x, frontY)[0]).toBeCloseTo(
            heights(source, x, frontY)[0],
            4,
          )
          expect(heights(geometry, x, handleY).at(-1)).toBeCloseTo(
            (model === 's' ? -16 : -21) - RACE_STRIPE_DEPTH,
            4,
          )
          expect(heights(geometry, x, handleY)[0]).toBeCloseTo(
            heights(source, x, handleY)[0],
            4,
          )
          const deckNormal = new Vector3(0, Math.SQRT1_2, Math.SQRT1_2)
          const point = new Vector3(
            x,
            model === 's' ? 29.5 : 70,
            model === 's' ? -6 : -8.5,
          )
          const rayOrigin = point.clone().addScaledVector(deckNormal, 20)
          const originalDeck = hits(
            source,
            rayOrigin,
            deckNormal.clone().negate(),
          )[0]
          const recessedDeck = hits(
            geometry,
            rayOrigin,
            deckNormal.clone().negate(),
          )[0]
          expect(originalDeck.distanceTo(recessedDeck)).toBeCloseTo(0.8, 4)

          // Both bends retain a continuous groove floor at the same normal
          // depth. The source STL itself approximates these radii with facets.
          const fold = getFaceFold(model)
          const handleFront = model === 's' ? -16 : -21
          for (const angle of [Math.PI / 16, Math.PI / 8, (3 * Math.PI) / 16]) {
            const normal = new Vector3(0, Math.sin(angle), Math.cos(angle))
            const bendPoints = [
              new Vector3(
                x,
                fold.frontY + Math.sin(angle),
                3 + Math.cos(angle),
              ),
              new Vector3(
                x,
                fold.deckIntercept -
                  handleFront +
                  Math.SQRT2 -
                  1 -
                  Math.sin(angle),
                handleFront + 1 - Math.cos(angle),
              ),
            ]
            for (const bend of bendPoints) {
              const crossing = hits(
                geometry,
                bend.clone().addScaledVector(normal, 5),
                normal.clone().negate(),
              )[0]
              expect(
                crossing.distanceTo(bend.clone().addScaledVector(normal, -0.8)),
              ).toBeLessThan(0.012)
            }
          }
        }
        for (const x of [-35.5, 35.5]) {
          const y = model === 's' ? 3 : 29
          expect(heights(geometry, x, y)).toEqual(heights(source, x, y))
        }
        const exported = new STLLoader().parse(exportPanelStl(geometry))
        expect(topology(exported)).toEqual({ invalidEdges: 0, components: 1 })
        exported.dispose()
      } finally {
        geometry.dispose()
        source.dispose()
      }
    },
    30_000,
  )

  it.each(['s', 'm'] as const)(
    'preserves %s controls and joins with maximum gap, relief, sides, grille, halo and studs',
    async (model) => {
      const source = readPanel(model)
      const stripes = normalizeRaceStripeSettings({
        enabled: true,
        count: 3,
        width: 10,
        gap: 12,
      })
      const geometry = await buildHandledPanelGeometry(
        source,
        model,
        'original',
        2,
        {
          ...getDefaultHandleSettings(model),
          mode: 'custom',
          cutout: 'none',
          height: 48,
          width: 60,
          legoStuds: true,
        },
        normalizeGrilleSettings({
          mode: 'custom',
          thickness: 2,
          extendPattern: true,
          recessDepth: 3,
        }),
        normalizeHaloSettings({ mode: 'custom', depth: 10, cutAngle: 30 }),
        10,
        5,
        stripes,
      )
      try {
        expect(topology(geometry)).toEqual({ invalidEdges: 0, components: 1 })
        expect(
          heights(geometry, 0, model === 's' ? -61 : -108).at(-1),
        ).toBeCloseTo(10.2, 4)
        const normal = new Vector3(0, Math.SQRT1_2, Math.SQRT1_2)
        const deckPoint = new Vector3(
          0,
          model === 's' ? 29.5 : 70,
          model === 's' ? -6 : -8.5,
        )
        const deck = hits(
          geometry,
          deckPoint.clone().addScaledVector(normal, 20),
          normal.clone().negate(),
        )[0]
        expect(
          deck.distanceTo(deckPoint.addScaledVector(normal, 5 - 0.8)),
        ).toBeLessThan(0.0001)
        const intervals = getRaceStripeIntervals(stripes)
        expect(geometry.userData.handle.studCenters.length).toBeGreaterThan(0)
        for (const stud of geometry.userData.handle.studCenters) {
          for (const stripe of intervals)
            expect(
              stud.x + HANDLE_STUD_DIAMETER / 2 + 0.249 < stripe.minX ||
                stud.x - HANDLE_STUD_DIAMETER / 2 - 0.249 > stripe.maxX,
            ).toBe(true)
          expect(heights(geometry, stud.x, stud.y).at(-1)).toBeCloseTo(
            geometry.userData.handle.backZ + 4 + 1.8,
            4,
          )
        }
        for (const well of geometry.userData.gap.controlWells) {
          const normal = new Vector3(...well.axis)
          const point = new Vector3(...well.center).add(
            new Vector3(-10.8, 0, 0),
          )
          const origin = point.clone().addScaledVector(normal, 20)
          const original = hits(source, origin, normal.clone().negate())
          const current = hits(geometry, origin, normal.clone().negate())
          expect(current[0].distanceTo(original[0])).toBeLessThan(0.0002)
        }
        for (const hole of geometry.userData.grille.holes) {
          if (hole.kind === 'through')
            expect(heights(geometry, hole.x, hole.y)).toEqual([])
        }
        const exported = new STLLoader().parse(exportPanelStl(geometry))
        expect(topology(exported)).toEqual({ invalidEdges: 0, components: 1 })
        exported.dispose()
      } finally {
        geometry.dispose()
        source.dispose()
      }
    },
    60_000,
  )
})
