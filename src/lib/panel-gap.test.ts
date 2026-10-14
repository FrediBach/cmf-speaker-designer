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
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPanelGapEngine } from './panel-gap'
import { normalizeGrilleSettings } from './grille-settings'
import { normalizeHaloSettings } from './halo-settings'
import { getDefaultHandleSettings } from './handle-settings'
import { buildHandledPanelGeometry } from './handles'
import { parsePanelGeometry, type SpeakerModel } from './panels'

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

function topology(positions: Float32Array) {
  const ids = new Map<string, number>()
  const vertices: number[] = []
  const parent: number[] = []
  const find = (id: number): number => {
    while (parent[id] !== id) {
      parent[id] = parent[parent[id]]
      id = parent[id]
    }
    return id
  }
  for (let index = 0; index < positions.length; index += 3) {
    const point = Array.from(positions.subarray(index, index + 3))
    if (!point.every(Number.isFinite)) throw new Error('Non-finite vertex')
    const key = point.join(',')
    let id = ids.get(key)
    if (id === undefined) {
      id = ids.size
      ids.set(key, id)
      parent.push(id)
    }
    vertices.push(id)
  }
  const edges = new Map<number, number>()
  for (let triangle = 0; triangle < vertices.length; triangle += 3)
    for (let edge = 0; edge < 3; edge += 1) {
      const a = vertices[triangle + edge],
        b = vertices[triangle + ((edge + 1) % 3)]
      if (a === b)
        throw new Error(
          `Collapsed edge ${Array.from(positions.slice(triangle * 3, triangle * 3 + 9)).join(',')}`,
        )
      const key = Math.min(a, b) * ids.size + Math.max(a, b)
      edges.set(key, (edges.get(key) ?? 0) + (a < b ? 11 : 9))
      parent[find(a)] = find(b)
    }
  return {
    invalidEdges: [...edges.values()].filter((count) => count !== 20).length,
    components: new Set(parent.map((_, id) => find(id))).size,
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
  const result = new Raycaster(origin, direction)
    .intersectObject(mesh)
    .map((hit) => hit.point)
  material.dispose()
  return result
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

describe('panel mounting gap', () => {
  let engine: Awaited<ReturnType<typeof createPanelGapEngine>>
  beforeAll(async () => {
    engine = await createPanelGapEngine()
  })
  afterAll(() => engine.dispose())

  it('keeps the zero gap unchanged and validates the physical range', () => {
    const positions = new Float32Array(9)
    expect(engine.build('s', positions, 0).positions).toBe(positions)
    for (const gap of [-0.1, 5.1, NaN, Infinity])
      expect(() => engine.build('s', positions, gap)).toThrow(RangeError)
  })

  it.each(
    (['s', 'm'] as const).flatMap((model) =>
      [0.1, 3.5, 5].map((gap) => ({ model, gap })),
    ),
  )(
    'builds a connected $model panel at $gap mm with fixed locks, recessed controls and contacting supports',
    ({ model, gap }) => {
      const source = readPanel(model)
      try {
        const sourcePositions = new Float32Array(
          source.getAttribute('position').array,
        )
        const result = engine.build(model, sourcePositions, gap)
        const geometry = geometryOf(result.positions)
        try {
          expect(topology(result.positions)).toEqual({
            invalidEdges: 0,
            components: 1,
          })
          expect(geometry.boundingBox!.max.z).toBeCloseTo(4 + gap, 4)
          expect(
            heights(geometry, 40, model === 's' ? -20 : -70).at(-1),
          ).toBeCloseTo(4 + gap, 4)
          const lock = model === 's' ? [35.75, 3] : [35.5, 29]
          expect(heights(geometry, lock[0], lock[1])[0]).toBeCloseTo(
            heights(source, lock[0], lock[1])[0],
            4,
          )
          const deckNormal = new Vector3(0, Math.SQRT1_2, Math.SQRT1_2)
          const hookPoint = new Vector3(
            28.5,
            model === 's' ? 30.5 : 74,
            model === 's' ? -16.5 : -21,
          )
          const hookOrigin = hookPoint.clone().addScaledVector(deckNormal, -20)
          const originalHook = hits(source, hookOrigin, deckNormal)
          const extendedHook = hits(geometry, hookOrigin, deckNormal)
          expect(originalHook.length).toBeGreaterThan(0)
          expect(extendedHook[0].distanceTo(originalHook[0])).toBeLessThan(
            0.0002,
          )
          // Preserve the whole body-side bearing and insertion profile, not
          // only the hook tips. The grown roots start outside these datums.
          const lockYs = model === 's' ? [3, 4.5, 6, 8] : [29, 33, 35, 37]
          for (const x of [-lock[0], lock[0]])
            for (const y of lockYs) {
              const before = heights(source, x, y).filter((z) => z < -0.0001)
              const after = heights(geometry, x, y).filter((z) => z < -0.0001)
              expect(after.length).toBe(before.length)
              before.forEach((z, index) =>
                expect(after[index]).toBeCloseTo(z, 3),
              )
            }
          const deckContact = (model === 's' ? 23.5 : 61.5) - 4 * Math.SQRT2
          const tangents = model === 's' ? [31, 33, 35, 37] : [65, 67, 69, 71]
          const insideDeck = (points: Vector3[]) =>
            [
              ...new Set(
                points
                  .filter((point) => point.y + point.z < deckContact - 0.0001)
                  .map((point) =>
                    Number(((point.y + point.z) * Math.SQRT1_2).toFixed(4)),
                  ),
              ),
            ].sort((a, b) => a - b)
          let sampledDeckFaces = 0
          for (const x of [-28.5, 28.5])
            for (const tangent of tangents) {
              const origin = new Vector3(
                x,
                tangent * Math.SQRT1_2,
                -tangent * Math.SQRT1_2,
              ).addScaledVector(deckNormal, -50)
              const before = insideDeck(hits(source, origin, deckNormal))
              const after = insideDeck(hits(geometry, origin, deckNormal))
              sampledDeckFaces += before.length
              expect(after.length).toBe(before.length)
              before.forEach((value, index) =>
                expect(after[index]).toBeCloseTo(value, 3),
              )
            }
          expect(sampledDeckFaces).toBeGreaterThan(4)
          for (const x of [-42, 42]) {
            const rimY = model === 's' ? 25 : 66
            const origin = new Vector3(
              x,
              rimY,
              deckContact - rimY,
            ).addScaledVector(deckNormal, -10)
            const before = hits(source, origin, deckNormal)
            const after = hits(geometry, origin, deckNormal)
            expect(before.length).toBeGreaterThan(1)
            expect(
              after[0].distanceTo(
                before[0].clone().addScaledVector(deckNormal, gap),
              ),
            ).toBeLessThan(0.0002)
          }
          for (const support of result.metadata.supports) {
            const foot = new Vector3(...support.contact)
            const normal = new Vector3(...support.axis)
            const contacts = hits(
              geometry,
              foot.clone().addScaledVector(normal, -1),
              normal,
            )
            expect(contacts.length).toBeGreaterThanOrEqual(2)
            expect(contacts[0].distanceTo(foot)).toBeLessThan(0.0002)
          }
          for (const well of result.metadata.controlWells) {
            const center = new Vector3(...well.center)
            const normal = new Vector3(...well.axis)
            // Both existing control apertures remain open along the shaft axis.
            expect(
              hits(
                geometry,
                center.clone().addScaledVector(normal, 20),
                normal.clone().negate(),
              ),
            ).toEqual([])
            // A retained seating collar at radius 10.8 stays at original depth.
            const offset = center.clone().add(new Vector3(10.8, 0, 0))
            const old = hits(
              source,
              offset.clone().addScaledVector(normal, 20),
              normal.clone().negate(),
            )
            const current = hits(
              geometry,
              offset.clone().addScaledVector(normal, 20),
              normal.clone().negate(),
            )
            expect(old.length).toBeGreaterThan(0)
            expect(current[0].distanceTo(old[0])).toBeLessThan(0.0002)
          }
        } finally {
          geometry.dispose()
        }
      } finally {
        source.dispose()
      }
    },
    60_000,
  )

  it.each(['s', 'm'] as const)(
    'combines the %s gap with side extension, handle, face depth, grille and halo',
    async (model) => {
      const source = readPanel(model)
      const geometry = await buildHandledPanelGeometry(
        source,
        model,
        'original',
        2,
        {
          ...getDefaultHandleSettings(model),
          mode: 'custom',
          width: 70,
          height: 35,
          legoStuds: true,
        },
        normalizeGrilleSettings({ mode: 'custom', extendPattern: true }),
        normalizeHaloSettings({ mode: 'custom', depth: 12, cutAngle: 30 }),
        10,
        5,
      )
      try {
        expect(
          topology(new Float32Array(geometry.getAttribute('position').array)),
        ).toEqual({ invalidEdges: 0, components: 1 })
        expect(geometry.userData.gap.gapMm).toBe(5)
        const driverY = model === 's' ? -23 : 15
        expect(heights(geometry, 48, driverY).at(-1)).toBeCloseTo(11, 4)
        // Halo roots and grille backing belong to the raised face and must
        // leave the intended air gap underneath the speaker opening collar.
        for (const x of [32, 33, 34]) {
          const surfaces = heights(geometry, x, driverY)
          expect(surfaces.length).toBeGreaterThan(0)
          expect(surfaces[0]).toBeGreaterThanOrEqual(5.49)
        }
        for (const hole of geometry.userData.handle.holeCenters)
          expect(heights(geometry, hole.x, hole.y)).toEqual([])
        for (const stud of geometry.userData.handle.studCenters)
          expect(heights(geometry, stud.x, stud.y).at(-1)).toBeCloseTo(
            geometry.userData.handle.backZ + 4 + 1.8,
            4,
          )
      } finally {
        geometry.dispose()
        source.dispose()
      }
    },
    60_000,
  )
})
