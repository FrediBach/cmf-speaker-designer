import { readFileSync } from 'node:fs'
import initializeManifold, {
  type Manifold,
  type ManifoldToplevel,
} from 'manifold-3d'
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
import { getFaceFold } from './face-depth'
import { normalizeGrilleSettings } from './grille-settings'
import { normalizeHaloSettings } from './halo-settings'
import { getDefaultHandleSettings } from './handle-settings'
import { buildHandledPanelGeometry } from './handles'
import { createPanelSplitEngine } from './panel-split'
import { parsePanelGeometry, type SpeakerModel } from './panels'
import { normalizeRaceStripeSettings } from './race-stripe-settings'

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
  return geometry
}

function solidOf(module: ManifoldToplevel, positions: Float32Array) {
  const ids = new Map<string, number>()
  const vertices: number[] = []
  const triangles: number[] = []
  const edges = new Map<string, number>()
  expect(positions.every(Number.isFinite)).toBe(true)
  for (let index = 0; index < positions.length; index += 3) {
    const point = Array.from(positions.subarray(index, index + 3))
    const key = point.join(',')
    let id = ids.get(key)
    if (id === undefined) {
      id = ids.size
      ids.set(key, id)
      vertices.push(...point)
    }
    triangles.push(id)
  }
  for (let index = 0; index < triangles.length; index += 3)
    for (let edge = 0; edge < 3; edge += 1) {
      const a = triangles[index + edge]
      const b = triangles[index + ((edge + 1) % 3)]
      if (a === b) throw new Error('A printable part has a collapsed edge.')
      const key = a < b ? `${a},${b}` : `${b},${a}`
      edges.set(key, (edges.get(key) ?? 0) + (a < b ? 11 : 9))
    }
  expect([...edges.values()].every((value) => value === 20)).toBe(true)
  return new module.Manifold(
    new module.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(vertices),
      triVerts: new Uint32Array(triangles),
    }),
  )
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

function jointRegion(
  module: ManifoldToplevel,
  solid: Manifold,
  seamY: number,
  gap = 0,
) {
  const box = module.Manifold.cube([30, 7, 8])
  const positioned = box.translate([-15, seamY - 6, gap - 1])
  const region = solid.intersect(positioned)
  positioned.delete()
  box.delete()
  return region
}

describe('printable front and angled panel split', () => {
  let engine: Awaited<ReturnType<typeof createPanelSplitEngine>>
  let module: ManifoldToplevel
  beforeAll(async () => {
    engine = await createPanelSplitEngine()
    module = await initializeManifold()
    module.setup()
  })
  afterAll(() => engine.dispose())

  it.each(['s', 'm'] as const)(
    'creates two watertight %s parts with a supported groove and unobstructed insertion',
    (model) => {
      const source = readPanel(model)
      const input = new Float32Array(source.getAttribute('position').array)
      const before = input.slice()
      const result = engine.build(model, input)
      const { frontPositions, upperPositions, seamY } = result.metadata
      expect(input).toEqual(before)
      expect(seamY).toBeCloseTo(getFaceFold(model).frontY, 6)
      expect(result.metadata.insertionAxis).toEqual([0, -1, 0])
      const front = solidOf(module, frontPositions)
      const upper = solidOf(module, upperPositions)
      const original = solidOf(module, input)
      const originalJoint = jointRegion(module, original, seamY)
      const frontGeometry = geometryOf(frontPositions)
      const upperGeometry = geometryOf(upperPositions)
      try {
        for (const part of [front, upper]) {
          expect(part.status()).toBe('NoError')
          const pieces = part.decompose()
          expect(pieces.length).toBe(1)
          pieces.forEach((piece) => piece.delete())
          // The joint adds nothing behind the existing flat rear face.
          const joint = jointRegion(module, part, seamY)
          const outside = joint.subtract(originalJoint)
          const rearAddition = outside.trimByPlane([0, 0, -1], -0.5)
          expect(Math.abs(rearAddition.volume())).toBeLessThan(0.001)
          if (part === front)
            expect(Math.abs(outside.volume())).toBeLessThan(0.001)
          rearAddition.delete()
          outside.delete()
          joint.delete()
        }
        expect(heights(frontGeometry, 0, seamY - 2)).toEqual([0.5, 1.3, 2.5, 4])
        expect(heights(upperGeometry, 0, seamY - 2)).toEqual([1.5, 2.3])
        expect(heights(frontGeometry, 0, seamY - 5.5)).toEqual([0.5, 4])
        expect(heights(frontGeometry, 15, seamY - 2)).toEqual([0.5, 4])
        // A 0.2 mm gap surrounds the tongue and the seam. The insertion path
        // stays clear from first engagement all the way to the mounted pose.
        for (const distance of [0, 0.1, 0.5, 1, 2, 3, 4, 5, 6]) {
          const translated = upper.translate([0, distance, 0])
          const collision = front.intersect(translated)
          expect(Math.abs(collision.volume())).toBeLessThan(0.00001)
          collision.delete()
          translated.delete()
        }
        const lockY = model === 's' ? 3 : 33
        for (const x of [-35.5, 35.5])
          expect(heights(frontGeometry, x, lockY)).toEqual(
            heights(source, x, lockY),
          )
        const normal = new Vector3(0, Math.SQRT1_2, Math.SQRT1_2)
        for (const x of [-28.5, 28.5]) {
          const hook = new Vector3(
            x,
            model === 's' ? 30.5 : 74,
            model === 's' ? -16.5 : -21,
          )
          const origin = hook.clone().addScaledVector(normal, -20)
          const before = hits(source, origin, normal)
          const after = hits(upperGeometry, origin, normal)
          expect(before.length).toBeGreaterThan(0)
          expect(after[0].distanceTo(before[0])).toBeLessThan(0.0002)
          const center = new Vector3(
            x,
            model === 's' ? 29.5 : 70,
            model === 's' ? -6 : -8.5,
          )
          expect(
            hits(
              upperGeometry,
              center.clone().addScaledVector(normal, 30),
              normal.clone().negate(),
            ),
          ).toEqual([])
        }
      } finally {
        front.delete()
        upper.delete()
        original.delete()
        originalJoint.delete()
        frontGeometry.dispose()
        upperGeometry.dispose()
        source.dispose()
      }
    },
    60_000,
  )

  it.each(['s', 'm'] as const)(
    'keeps a tall flared halo on the %s front with depth, gap, extended sides and a custom handle',
    async (model) => {
      const source = readPanel(model)
      const customized = await buildHandledPanelGeometry(
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
        normalizeHaloSettings({ mode: 'custom', depth: 40, outwardAngle: 45 }),
        10,
        5,
      )
      const result = engine.build(
        model,
        new Float32Array(customized.getAttribute('position').array),
        2,
        5,
      )
      const front = solidOf(module, result.metadata.frontPositions)
      const upper = solidOf(module, result.metadata.upperPositions)
      const original = solidOf(
        module,
        new Float32Array(customized.getAttribute('position').array),
      )
      const originalJoint = jointRegion(
        module,
        original,
        result.metadata.seamY,
        5,
      )
      const frontGeometry = geometryOf(result.metadata.frontPositions)
      try {
        for (const part of [front, upper]) {
          const pieces = part.decompose()
          expect(pieces.length).toBe(1)
          pieces.forEach((piece) => piece.delete())
          const joint = jointRegion(module, part, result.metadata.seamY, 5)
          const outside = joint.subtract(originalJoint)
          const rearAddition = outside.trimByPlane([0, 0, -1], -5.5)
          expect(Math.abs(rearAddition.volume())).toBeLessThan(0.001)
          rearAddition.delete()
          outside.delete()
          joint.delete()
        }
        expect(
          heights(frontGeometry, 0, result.metadata.seamY - 2).slice(0, 3),
        ).toEqual([5.5, 6.3, 7.9])
        // At maximum relief, the socket overlaps the top of the extended
        // grille. Its reinforcement must close those perforations locally
        // while retaining both skins around the entire insertion channel.
        for (const x of [-12, -6, 0, 6, 12])
          for (const belowSeam of [1, 3, 4.8]) {
            const surfaces = heights(
              frontGeometry,
              x,
              result.metadata.seamY - belowSeam,
            )
            expect(surfaces.slice(0, 3)).toEqual([5.5, 6.3, 7.9])
            expect(surfaces[3]).toBeGreaterThanOrEqual(8.6)
          }
        for (const distance of [0, 0.1, 0.5, 1, 2, 3, 4, 5, 6]) {
          const moved = upper.translate([0, distance, 0])
          const overlap = front.intersect(moved)
          expect(Math.abs(overlap.volume())).toBeLessThan(0.00001)
          overlap.delete()
          moved.delete()
        }
        // The halo rises past the fold in Y; all of its outer crown remains
        // attached to the front instead of producing a third printable part.
        const crown = front.trimByPlane([0, 1, 0], result.metadata.seamY + 5)
        expect(crown.volume()).toBeGreaterThan(10)
        crown.delete()
        const upperCrown = upper.trimByPlane([0, 0, 1], 11.011)
        expect(upperCrown.isEmpty()).toBe(true)
        upperCrown.delete()
      } finally {
        front.delete()
        upper.delete()
        original.delete()
        originalJoint.delete()
        frontGeometry.dispose()
        customized.dispose()
        source.dispose()
      }
    },
    60_000,
  )

  it.each(
    (['s', 'm'] as const).flatMap((model) =>
      [0, 0.2, 0.4, 2].flatMap((depth) =>
        (model === 's' && depth === 0 ? [0, 3, 5] : [0, 5]).map((gap) => ({
          model,
          depth,
          gap,
        })),
      ),
    ),
  )(
    'recesses the $model joint within the striped face at depth $depth and gap $gap',
    async ({ model, depth, gap }) => {
      const source = readPanel(model)
      const striped = await buildHandledPanelGeometry(
        source,
        model,
        'original',
        depth,
        getDefaultHandleSettings(model),
        undefined,
        undefined,
        0,
        gap,
        normalizeRaceStripeSettings({
          enabled: true,
          count: 1,
          width: 20,
        }),
      )
      const input = new Float32Array(striped.getAttribute('position').array)
      const result = engine.build(model, input, depth, gap)
      const front = geometryOf(result.metadata.frontPositions)
      const frontSolid = solidOf(module, result.metadata.frontPositions)
      const upper = solidOf(module, result.metadata.upperPositions)
      const upperGeometry = geometryOf(result.metadata.upperPositions)
      const original = solidOf(module, input)
      const originalJoint = jointRegion(
        module,
        original,
        result.metadata.seamY,
        gap,
      )
      try {
        const surfaces = heights(front, 0, result.metadata.seamY - 2)
        expect(surfaces).toHaveLength(4)
        expect(surfaces[0]).toBeCloseTo(gap + 0.5, 4)
        expect(surfaces[1] - surfaces[0]).toBeCloseTo(0.8, 4)
        expect(surfaces[3] - surfaces[2]).toBeGreaterThanOrEqual(0.7 - 0.0001)
        expect(surfaces[3]).toBeCloseTo(gap + depth + 3.2, 4)
        expect(result.metadata.tongueThicknessMm).toBeGreaterThanOrEqual(0.8)
        expect(result.metadata.tongueThicknessMm).toBeLessThanOrEqual(1.2)
        expect(surfaces[2] - surfaces[1]).toBeCloseTo(
          result.metadata.tongueThicknessMm + 0.4,
          4,
        )
        for (const part of [frontSolid, upper]) {
          expect(part.status()).toBe('NoError')
          const pieces = part.decompose()
          expect(pieces.length).toBe(1)
          pieces.forEach((piece) => piece.delete())
          const joint = jointRegion(module, part, result.metadata.seamY, gap)
          const outside = joint.subtract(originalJoint)
          const rearAddition = outside.trimByPlane([0, 0, -1], -(gap + 0.5))
          expect(Math.abs(rearAddition.volume())).toBeLessThan(0.001)
          if (part === frontSolid)
            expect(Math.abs(outside.volume())).toBeLessThan(0.001)
          else {
            // The tongue root remains buried in the original upper section,
            // even beneath the stripe as it follows the curved fold.
            const exposedRoot = outside.trimByPlane(
              [0, 1, 0],
              result.metadata.seamY + 0.1001,
            )
            expect(Math.abs(exposedRoot.volume())).toBeLessThan(0.001)
            exposedRoot.delete()
          }
          rearAddition.delete()
          outside.delete()
          joint.delete()
        }
        for (const distance of [0, 0.1, 1, 3, 6]) {
          const moved = upper.translate([0, distance, 0])
          const collision = frontSolid.intersect(moved)
          expect(Math.abs(collision.volume())).toBeLessThan(0.00001)
          collision.delete()
          moved.delete()
        }
        if (gap > 0) {
          const normal = new Vector3(0, Math.SQRT1_2, Math.SQRT1_2)
          for (const x of [-28.5, 28.5]) {
            const center = new Vector3(
              x,
              model === 's' ? 29.5 : 70,
              model === 's' ? -6 : -8.5,
            )
            expect(
              hits(
                upperGeometry,
                center.clone().addScaledVector(normal, 20),
                normal.clone().negate(),
              ),
            ).toEqual([])
            // The lower edges of the fixed control wells can cross the split
            // height at large gaps. Both ends must stay with the upper part.
            for (const angle of [Math.PI / 2 - 0.1, Math.PI / 2 + 0.1]) {
              const origin = center
                .clone()
                .add(
                  new Vector3(
                    12.5 * Math.cos(angle),
                    -12.5 * Math.sin(angle) * Math.SQRT1_2,
                    12.5 * Math.sin(angle) * Math.SQRT1_2,
                  ),
                )
                .addScaledVector(normal, 20)
              const direction = normal.clone().negate()
              const before = hits(striped, origin, direction)
              const after = hits(upperGeometry, origin, direction)
              expect(before.length).toBeGreaterThanOrEqual(2)
              expect(after.length).toBeGreaterThanOrEqual(2)
              expect(after[0].distanceTo(before[0])).toBeLessThan(0.0002)
              expect(after.at(-1)!.distanceTo(before.at(-1)!)).toBeLessThan(
                0.0002,
              )
            }
          }
        }
      } finally {
        front.dispose()
        frontSolid.delete()
        upper.delete()
        upperGeometry.dispose()
        original.delete()
        originalJoint.delete()
        striped.dispose()
        source.dispose()
      }
    },
    60_000,
  )
})
