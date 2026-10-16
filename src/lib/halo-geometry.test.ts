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
import { createHaloEngine } from './halo-geometry'
import {
  DEFAULT_HALO_SETTINGS,
  HALO_INNER_RADIUS,
  getHaloCutPivotRadius,
  normalizeHaloSettings,
  getHaloModulatedHeight,
} from './halo-settings'
import { normalizeGrilleSettings } from './grille-settings'
import { getDefaultHandleSettings } from './handle-settings'
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

function geometryOf(positions: Float32Array) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeBoundingBox()
  return geometry
}

function positionsOf(geometry: BufferGeometry) {
  return new Float32Array(geometry.getAttribute('position').array)
}

/** Check the exact Float32 vertices a slicer receives, without tolerance welding. */
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
    invalid: [...edges.values()].filter((count) => count !== 20).length,
    components: new Set(parents.map((_, index) => find(index))).size,
  }
}

function rayHits(
  geometry: BufferGeometry,
  origin: Vector3,
  direction: Vector3,
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
      rayHits(geometry, new Vector3(x, y, 100), new Vector3(0, 0, -1)).map(
        (point) => Number(point.z.toFixed(4)),
      ),
    ),
  ].sort((a, b) => a - b)
}

function horizontalFaceArea(geometry: BufferGeometry, z: number) {
  const positions = geometry.getAttribute('position')
  let area = 0
  for (let index = 0; index < positions.count; index += 3) {
    if (
      [0, 1, 2].some(
        (offset) => Math.abs(positions.getZ(index + offset) - z) > 0.00001,
      )
    )
      continue
    const a = new Vector3().fromBufferAttribute(positions, index)
    const b = new Vector3().fromBufferAttribute(positions, index + 1)
    const c = new Vector3().fromBufferAttribute(positions, index + 2)
    area += b.sub(a).cross(c.sub(a)).length() / 2
  }
  return area
}

describe('generative halo and planar rain hood', () => {
  let engine: Awaited<ReturnType<typeof createHaloEngine>>
  beforeAll(async () => {
    engine = await createHaloEngine()
  })
  afterAll(() => engine.dispose())

  it.each(['s', 'm'] as const)(
    'retains the %s aperture and precise flare, depth and radial thickness',
    (model) => {
      const source = readPanel(model)
      const settings = normalizeHaloSettings({
        mode: 'custom',
        outwardAngle: 30,
        depth: 24,
        thickness: 3,
      })
      const result = engine.build(model, settings, positionsOf(source))
      const geometry = geometryOf(result.positions)
      expect(topology(geometry)).toEqual({ invalid: 0, components: 1 })
      expect(geometry.boundingBox!.max.z).toBe(28)
      expect(result.metadata.baseZ).toBe(4)
      expect(result.metadata.frontZ).toBe(28)
      expect(result.metadata.centers).toEqual(
        model === 's'
          ? [{ x: 0, y: -23 }]
          : [
              { x: 0, y: 15 },
              { x: 0, y: -70 },
            ],
      )
      expect(horizontalFaceArea(geometry, 28)).toBeGreaterThan(100)
      for (const center of result.metadata.centers) {
        expect(heights(geometry, 0, center.y)).toEqual([])
        expect(heights(geometry, 32, center.y)).toEqual([])
        expect(heights(geometry, 32.6, center.y)).toEqual(
          heights(source, 32.6, center.y),
        )
        for (const depth of [3, 12, 23]) {
          const crossings = [
            ...new Set(
              rayHits(
                geometry,
                new Vector3(100, center.y, 4 + depth),
                new Vector3(-1, 0, 0),
              ).map((point) => Number(point.x.toFixed(4))),
            ),
          ].sort((a, b) => a - b)
          expect(crossings).toHaveLength(4)
          const radius = HALO_INNER_RADIUS + Math.tan(Math.PI / 6) * depth
          expect(crossings[2]).toBeCloseTo(radius, 3)
          expect(crossings[3] - crossings[2]).toBeCloseTo(3, 3)
        }
      }
      for (const [x, y] of [
        [35, model === 's' ? -40 : -2],
        [0.3, model === 's' ? 29.5 : 70],
      ])
        expect(heights(geometry, x, y).filter((z) => z <= 0.5)).toEqual(
          heights(source, x, y).filter((z) => z <= 0.5),
        )
      geometry.dispose()
      source.dispose()
    },
  )

  it.each([
    {
      outwardAngle: 12.5,
      depth: 24,
      thickness: 4.5,
      cutAngle: 0,
      rimHeight: 0,
      cutRotation: 0,
    },
    {
      outwardAngle: 18,
      depth: 26,
      thickness: 3,
      cutAngle: 35,
      rimHeight: 0,
      cutRotation: 0,
    },
    {
      outwardAngle: 18,
      depth: 26,
      thickness: 3,
      cutAngle: 35,
      rimHeight: 5,
      cutRotation: 0,
    },
    {
      outwardAngle: 18,
      depth: 26,
      thickness: 3,
      cutAngle: 35,
      rimHeight: 2,
      cutRotation: 137,
    },
  ])(
    'generates matching M halos with fused intersections: %j',
    (input) => {
      const source = readPanel('m')
      const result = engine.build(
        'm',
        normalizeHaloSettings({ mode: 'custom', ...input }),
        positionsOf(source),
      )
      const geometry = geometryOf(result.positions)
      const samples = Array.from({ length: 8 }, (_, index) => [
        35 * Math.sin((index * Math.PI) / 4),
        35 * Math.cos((index * Math.PI) / 4),
      ])
      samples.push([40, 0], [-40, 0])
      for (const [x, y] of samples) {
        const upper = heights(geometry, x, 15 + y).filter((z) => z > 4.0001)
        const lower = heights(geometry, x, -70 + y).filter((z) => z > 4.0001)
        expect(lower).toHaveLength(upper.length)
        for (let index = 0; index < upper.length; index += 1)
          expect(lower[index]).toBeCloseTo(upper[index], 3)
      }
      for (const center of result.metadata.centers)
        expect(heights(geometry, center.x, center.y)).toEqual([])
      if (input.cutAngle === 0) {
        // Default lips overlap slightly at their shared midpoint; a ray through
        // the fused volume sees only an entry and an exit, with no internal wall.
        const overlap = heights(geometry, 0.1, -27.5).filter((z) => z > 4.0001)
        expect(overlap).toHaveLength(2)
        expect(overlap.at(-1)).toBeCloseTo(28, 4)
      }
      expect(topology(geometry)).toEqual({ invalid: 0, components: 1 })
      const exported = new STLLoader().parse(exportPanelStl(geometry))
      expect(topology(exported)).toEqual({ invalid: 0, components: 1 })
      exported.dispose()
      geometry.dispose()
      source.dispose()
    },
    30_000,
  )

  it.each([
    { outwardAngle: 18, cutAngle: 35, cutRotation: 0 },
    { outwardAngle: 18, cutAngle: 35, cutRotation: 137 },
    { outwardAngle: 18, cutAngle: 35, cutRotation: 270 },
    { outwardAngle: 45, cutAngle: 44, cutRotation: 37 },
  ])(
    'cuts the whole flared lip with one plane, without a horizontal shelf: %j',
    (angles) => {
      const source = readPanel('s')
      const settings = normalizeHaloSettings({
        mode: 'custom',
        depth: 26,
        thickness: 3,
        ...angles,
      })
      const result = engine.build('s', settings, positionsOf(source))
      const geometry = geometryOf(result.positions)
      const { baseZ, frontZ, center } = result.metadata
      const rotation = (settings.cutRotation * Math.PI) / 180
      const slope = Math.tan((settings.cutAngle * Math.PI) / 180)
      const pivot = getHaloCutPivotRadius(settings)
      const planeHeight = (x: number, y: number) =>
        frontZ +
        slope *
          (x * Math.sin(rotation) + (y - center.y) * Math.cos(rotation) - pivot)
      const positions = geometry.getAttribute('position')
      let lipTriangles = 0
      for (let index = 0; index < positions.count; index += 3) {
        const points = [0, 1, 2].map((offset) =>
          new Vector3().fromBufferAttribute(positions, index + offset),
        )
        for (const point of points) {
          if (point.z > baseZ + settings.rimHeight + 0.0001)
            expect(point.z - planeHeight(point.x, point.y)).toBeLessThan(
              0.00005,
            )
        }
        const normal = points[1]
          .clone()
          .sub(points[0])
          .cross(points[2].clone().sub(points[0]))
          .normalize()
        const averageZ = points.reduce((sum, point) => sum + point.z, 0) / 3
        // The inner cone also faces forward, but its Z-normal is sin(flare).
        // Every more-forward surface above the base rim must be the same cut.
        if (
          averageZ <= baseZ + settings.rimHeight + 0.0001 ||
          normal.z <= Math.sin((settings.outwardAngle * Math.PI) / 180) + 0.005
        )
          continue
        lipTriangles += 1
        for (const point of points)
          expect(point.z).toBeCloseTo(planeHeight(point.x, point.y), 4)
      }
      expect(lipTriangles).toBeGreaterThan(10)
      expect(horizontalFaceArea(geometry, frontZ)).toBe(0)
      expect(geometry.boundingBox!.max.z).toBeCloseTo(frontZ, 4)
      expect(topology(geometry)).toEqual({ invalid: 0, components: 1 })
      geometry.dispose()
      source.dispose()
    },
  )

  it.each([0, 90, 180, 270])(
    'cuts an actual tilted plane and rotates the retained hood through %s°',
    (rotation) => {
      const source = readPanel('s')
      const settings = normalizeHaloSettings({
        mode: 'custom',
        outwardAngle: 0,
        depth: 24,
        cutAngle: 30,
        cutRotation: rotation,
      })
      const result = engine.build('s', settings, positionsOf(source))
      const geometry = geometryOf(result.positions)
      const angle = (rotation * Math.PI) / 180
      const x = 35 * Math.sin(angle),
        y = 35 * Math.cos(angle)
      const upper = heights(geometry, x, -23 + y).at(-1)!
      const lower = heights(geometry, -x, -23 - y).at(-1)!
      expect(upper).toBeCloseTo(
        28 + Math.tan(Math.PI / 6) * (35 - result.metadata.outerRadius),
        3,
      )
      expect(lower).toBeCloseTo(4, 3)
      expect(geometry.boundingBox!.max.z).toBe(28)
      expect(topology(geometry)).toEqual({ invalid: 0, components: 1 })
      expect(heights(geometry, 0, -23)).toEqual([])
      geometry.dispose()
      source.dispose()
    },
  )

  it.each(
    [0, 2, 5].flatMap((rimHeight) =>
      [0, 137].map((cutRotation) => ({ rimHeight, cutRotation })),
    ),
  )(
    'makes the cut-away arc flush or precisely raised on both models: %j',
    ({ rimHeight, cutRotation }) => {
      for (const model of ['s', 'm'] as const) {
        const source = readPanel(model)
        const settings = normalizeHaloSettings({
          mode: 'custom',
          outwardAngle: 18,
          depth: 26,
          thickness: 3,
          cutAngle: 35,
          cutRotation,
          rimHeight,
        })
        const result = engine.build(model, settings, positionsOf(source))
        const geometry = geometryOf(result.positions)
        expect(result.metadata.baseRimHeight).toBe(rimHeight)
        for (const offset of [150, 180, 210]) {
          const angle = ((cutRotation + offset) * Math.PI) / 180
          const x = 35 * Math.sin(angle)
          for (const center of result.metadata.centers) {
            const y = center.y + 35 * Math.cos(angle)
            const sourceHeights = heights(source, x, y)
            const actual = heights(geometry, x, y)
            expect(sourceHeights.at(-1)).toBeCloseTo(4, 4)
            expect(actual.at(-1)).toBeCloseTo(4 + rimHeight, 4)
            expect(actual.filter((z) => z <= 0.5)).toEqual(
              sourceHeights.filter((z) => z <= 0.5),
            )
          }
        }
        for (const center of result.metadata.centers)
          expect(heights(geometry, 0, center.y)).toEqual([])
        expect(geometry.boundingBox!.max.z).toBeCloseTo(30, 4)
        expect(topology(geometry)).toEqual({ invalid: 0, components: 1 })
        const exported = new STLLoader().parse(exportPanelStl(geometry))
        expect(topology(exported)).toEqual({ invalid: 0, components: 1 })
        exported.dispose()
        geometry.dispose()
        source.dispose()
      }
    },
    30_000,
  )

  it.each(['s', 'm'] as const)(
    'limits the %s raised rim to a shallow halo depth',
    (model) => {
      const source = readPanel(model)
      const settings = normalizeHaloSettings({
        mode: 'custom',
        outwardAngle: 45,
        depth: 1,
        thickness: 6,
        cutAngle: 75,
        cutRotation: 137,
        rimHeight: 5,
      })
      const result = engine.build(model, settings, positionsOf(source))
      const geometry = geometryOf(result.positions)
      expect(result.metadata.settings.rimHeight).toBe(1)
      expect(result.metadata.baseRimHeight).toBe(1)
      expect(geometry.boundingBox!.max.z).toBeCloseTo(5, 4)
      expect(
        heights(geometry, 0, result.metadata.center.y - 35).at(-1),
      ).toBeCloseTo(5, 4)
      expect(topology(geometry)).toEqual({ invalid: 0, components: 1 })
      const exported = new STLLoader().parse(exportPanelStl(geometry))
      expect(topology(exported)).toEqual({ invalid: 0, components: 1 })
      exported.dispose()
      geometry.dispose()
      source.dispose()
    },
  )

  it('leaves the uncut full ring unchanged when rim height changes', () => {
    const source = readPanel('s'),
      positions = positionsOf(source)
    const flat = engine.build(
      's',
      normalizeHaloSettings({ mode: 'custom', rimHeight: 0 }),
      positions,
    )
    const raised = engine.build(
      's',
      normalizeHaloSettings({ mode: 'custom', rimHeight: 5 }),
      positions,
    )
    expect(raised.positions.length).toBe(flat.positions.length)
    expect(
      raised.positions.every((value, index) => value === flat.positions[index]),
    ).toBe(true)
    source.dispose()
  })

  const extremes = [0, 45].flatMap((outwardAngle) =>
    [1, 40].flatMap((depth) =>
      [1, 6].flatMap((thickness) =>
        [0, 75].map((cutAngle) => ({
          outwardAngle,
          depth,
          thickness,
          cutAngle,
        })),
      ),
    ),
  )
  it.each(extremes)(
    'exports one closed Float32 solid at normalized limits %j',
    (limits) => {
      for (const model of ['s', 'm'] as const) {
        const source = readPanel(model)
        const settings = normalizeHaloSettings({
          mode: 'custom',
          ...limits,
          cutRotation: limits.depth === 1 ? 137 : 360,
        })
        const result = engine.build(model, settings, positionsOf(source))
        const geometry = geometryOf(result.positions)
        expect(topology(geometry)).toEqual({ invalid: 0, components: 1 })
        expect(geometry.boundingBox!.max.z).toBeCloseTo(4 + settings.depth, 4)
        for (const center of result.metadata.centers)
          expect(heights(geometry, 0, center.y)).toEqual([])
        const exported = new STLLoader().parse(exportPanelStl(geometry))
        expect(topology(exported)).toEqual({ invalid: 0, components: 1 })
        exported.dispose()
        geometry.dispose()
        source.dispose()
      }
    },
    30_000,
  )

  it.each(['s', 'm'] as const)(
    'composes the %s halo with generated handle, face depth and recessed grille through the shared pipeline',
    async (model) => {
      const source = readPanel(model)
      const handle = {
        ...getDefaultHandleSettings(model),
        mode: 'custom' as const,
        height: 48,
        cutout: 'circle' as const,
        holeCount: 3,
        holeWidth: 10,
      }
      const grille = normalizeGrilleSettings({
        mode: 'custom',
        extendPattern: true,
        recessDepth: 3,
      })
      const halo = normalizeHaloSettings({
        mode: 'custom',
        cutAngle: 30,
        depth: 28,
        rimHeight: model === 's' ? 0 : 5,
      })
      const geometry = await buildHandledPanelGeometry(
        source,
        model,
        'original',
        2,
        handle,
        grille,
        halo,
      )
      expect(topology(geometry)).toEqual({ invalid: 0, components: 1 })
      expect(geometry.userData.halo.settings).toEqual(halo)
      expect(geometry.userData.halo.baseZ).toBeCloseTo(6, 4)
      expect(geometry.userData.halo.baseRimHeight).toBe(halo.rimHeight)
      for (const center of geometry.userData.halo.centers)
        expect(heights(geometry, 0, center.y - 35).at(-1)).toBeCloseTo(
          6 + halo.rimHeight,
          4,
        )
      expect(geometry.boundingBox!.max.z).toBeCloseTo(34, 4)
      for (const hole of geometry.userData.handle.holeCenters)
        expect(heights(geometry, hole.x, hole.y)).toEqual([])
      for (const hole of geometry.userData.grille.holes.filter(
        (hole: { kind: string }) => hole.kind === 'through',
      ))
        expect(heights(geometry, hole.x, hole.y)).toEqual([])
      const exported = new STLLoader().parse(exportPanelStl(geometry))
      expect(topology(exported)).toEqual({ invalid: 0, components: 1 })
      exported.dispose()
      geometry.dispose()
      source.dispose()
    },
    30_000,
  )

  it.each([
    { model: 's' as const, relief: 0, panelGap: 0, sampleY: 12 },
    { model: 'm' as const, relief: 2, panelGap: 5, sampleY: 48 },
  ])(
    'anchors the $model halo to the panel face beneath raised grille details',
    async ({ model, relief, panelGap, sampleY }) => {
      const source = readPanel(model)
      const halo = normalizeHaloSettings({
        mode: 'custom',
        depth: 12,
        outwardAngle: 0,
      })
      const geometry = await buildHandledPanelGeometry(
        source,
        model,
        'original',
        relief,
        getDefaultHandleSettings(model),
        normalizeGrilleSettings({
          mode: 'custom',
          layout: 'grid',
          thickness: 2,
          extendPattern: true,
          recessDepth: -3,
        }),
        halo,
        0,
        panelGap,
      )
      try {
        const faceZ = 4 + relief + panelGap
        expect(topology(geometry)).toEqual({ invalid: 0, components: 1 })
        expect(geometry.userData.grille.frontZ).toBeCloseTo(faceZ, 4)
        expect(geometry.userData.halo.baseZ).toBeCloseTo(faceZ, 4)
        expect(geometry.userData.halo.frontZ).toBeCloseTo(faceZ + halo.depth, 4)
        expect(geometry.boundingBox!.max.z).toBeCloseTo(faceZ + halo.depth, 4)
        // This raised detail sits outside the halo and keeps its full height.
        expect(heights(geometry, 36, sampleY).at(-1)).toBeCloseTo(faceZ + 3, 4)
        const opening = geometry.userData.grille.holes.find(
          (hole: { kind: string }) => hole.kind === 'through',
        )
        expect(heights(geometry, opening.x, opening.y)).toEqual([])
        const exported = new STLLoader().parse(exportPanelStl(geometry))
        try {
          expect(topology(exported)).toEqual({ invalid: 0, components: 1 })
        } finally {
          exported.dispose()
        }
      } finally {
        geometry.dispose()
        source.dispose()
      }
    },
    30_000,
  )

  it('preserves the source exactly in original mode', () => {
    const source = readPanel('s'),
      positions = positionsOf(source)
    const result = engine.build('s', DEFAULT_HALO_SETTINGS, positions)
    expect(result.positions).toEqual(positions)
    expect(result.positions).not.toBe(positions)
    source.dispose()
  })

  it.each(['s', 'm'] as const)(
    'oscillates the existing %s wall height with independent amplitude and phase',
    (model) => {
      const source = readPanel(model)
      for (const wavePhase of [0, 90]) {
        const settings = normalizeHaloSettings({
          mode: 'custom',
          outwardAngle: 0,
          depth: 20,
          rimHeight: 5,
          waveShape: 'sine',
          waveAmplitude: 4,
          waveFrequency: 1,
          wavePhase,
        })
        const result = engine.build(model, settings, positionsOf(source))
        const geometry = geometryOf(result.positions)
        for (const center of result.metadata.centers) {
          for (const degrees of [0, 90, 180, 270]) {
            const angle = (degrees * Math.PI) / 180
            const x = 35 * Math.sin(angle),
              y = center.y + 35 * Math.cos(angle)
            expect(heights(geometry, x, y).at(-1)).toBeCloseTo(
              4 + getHaloModulatedHeight(settings, settings.depth, degrees),
              3,
            )
            expect(heights(geometry, x, y).filter((z) => z < 4)).toEqual(
              heights(source, x, y).filter((z) => z < 4),
            )
          }
          expect(heights(geometry, center.x, center.y)).toEqual([])
        }
        expect(geometry.boundingBox!.max.z).toBeCloseTo(28, 4)
        expect(result.metadata.frontZ).toBeCloseTo(28, 4)
        expect(topology(geometry)).toEqual({ invalid: 0, components: 1 })
        geometry.dispose()
      }
      source.dispose()
    },
  )

  it('deforms the finished angled cut while preserving its raised rim and buried collar', () => {
    const source = readPanel('s')
    const settings = normalizeHaloSettings({
      mode: 'custom',
      outwardAngle: 0,
      depth: 26,
      thickness: 3,
      cutAngle: 12,
      cutRotation: 45,
      rimHeight: 5,
      waveShape: 'sine',
      waveAmplitude: 3,
      waveFrequency: 3,
      wavePhase: 90,
    })
    const baseline = geometryOf(
      engine.build('s', { ...settings, waveShape: 'none' }, positionsOf(source))
        .positions,
    )
    const result = engine.build('s', settings, positionsOf(source))
    const geometry = geometryOf(result.positions)
    for (const degrees of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const angle = (degrees * Math.PI) / 180
      const x = 34 * Math.sin(angle),
        y = -23 + 34 * Math.cos(angle)
      const original = heights(baseline, x, y)
      const actual = heights(geometry, x, y)
      expect(actual.at(-1)).toBeCloseTo(
        4 + getHaloModulatedHeight(settings, original.at(-1)! - 4, degrees),
        2,
      )
      expect(actual.filter((z) => z <= 4)).toEqual(
        original.filter((z) => z <= 4),
      )
    }
    expect(result.metadata.frontZ).toBeCloseTo(geometry.boundingBox!.max.z, 4)
    expect(topology(geometry)).toEqual({ invalid: 0, components: 1 })
    baseline.dispose()
    geometry.dispose()
    source.dispose()
  })

  it.each([
    { waveShape: 'sine' as const, waveFrequency: 3, waveSeamless: true },
    { waveShape: 'triangle' as const, waveFrequency: 2.6, waveSeamless: true },
    { waveShape: 'square' as const, waveFrequency: 3, waveSeamless: true },
    { waveShape: 'sawtooth' as const, waveFrequency: 3, waveSeamless: true },
    { waveShape: 'sine' as const, waveFrequency: 2.6, waveSeamless: false },
    { waveShape: 'sawtooth' as const, waveFrequency: 2.6, waveSeamless: false },
    { waveShape: 'square' as const, waveFrequency: 24, waveSeamless: true },
  ])(
    'exports both modulated and cut halo models as one closed solid: %j',
    (wave) => {
      for (const model of ['s', 'm'] as const) {
        const source = readPanel(model)
        const settings = normalizeHaloSettings({
          mode: 'custom',
          outwardAngle: 18,
          depth: 26,
          thickness: 3,
          cutAngle: 35,
          cutRotation: 137,
          rimHeight: 2,
          waveAmplitude: 4,
          wavePhase: 37,
          ...wave,
        })
        const result = engine.build(model, settings, positionsOf(source))
        const geometry = geometryOf(result.positions)
        expect(topology(geometry)).toEqual({ invalid: 0, components: 1 })
        expect(result.metadata.frontZ).toBeCloseTo(
          geometry.boundingBox!.max.z,
          4,
        )
        for (const center of result.metadata.centers)
          expect(heights(geometry, center.x, center.y)).toEqual([])
        const exported = new STLLoader().parse(exportPanelStl(geometry))
        expect(topology(exported)).toEqual({ invalid: 0, components: 1 })
        exported.dispose()
        geometry.dispose()
        source.dispose()
      }
    },
    30_000,
  )

  it.each([
    { depth: 1, rimHeight: 0, outwardAngle: 45, cutAngle: 44 },
    { depth: 40, rimHeight: 5, outwardAngle: 45, cutAngle: 0 },
    { depth: 6, rimHeight: 5, outwardAngle: 0, cutAngle: 75 },
  ])(
    'keeps extreme modulations attached without altering the aperture: %j',
    (dimensions) => {
      const source = readPanel('m')
      const result = engine.build(
        'm',
        normalizeHaloSettings({
          mode: 'custom',
          ...dimensions,
          thickness: 1,
          waveShape: 'square',
          waveAmplitude: 20,
          waveFrequency: 7.25,
          waveSeamless: false,
          wavePhase: 90,
        }),
        positionsOf(source),
      )
      const geometry = geometryOf(result.positions)
      expect(topology(geometry)).toEqual({ invalid: 0, components: 1 })
      for (const center of result.metadata.centers)
        expect(heights(geometry, center.x, center.y)).toEqual([])
      const exported = new STLLoader().parse(exportPanelStl(geometry))
      expect(topology(exported)).toEqual({ invalid: 0, components: 1 })
      exported.dispose()
      geometry.dispose()
      source.dispose()
    },
    30_000,
  )

  it.each([
    {
      depth: 1.07,
      rimHeight: 1.06,
      cutAngle: 73.7,
      outwardAngle: 4.1,
      waveShape: 'square' as const,
      waveFrequency: 23.65,
      wavePhase: 179.99,
    },
    {
      depth: 5.17,
      rimHeight: 4.93,
      cutAngle: 65.3,
      outwardAngle: 20.7,
      waveShape: 'sawtooth' as const,
      waveFrequency: 0.35,
      wavePhase: 359.99,
    },
    {
      depth: 16.43,
      rimHeight: 1.13,
      cutAngle: 29.9,
      outwardAngle: 15.2,
      waveShape: 'triangle' as const,
      waveFrequency: 7.35,
      wavePhase: 89.99,
    },
    {
      depth: 36.37,
      rimHeight: 3.77,
      cutAngle: 43.7,
      outwardAngle: 44.9,
      waveShape: 'sine' as const,
      waveFrequency: 23.65,
      wavePhase: 0.01,
    },
    {
      depth: 23.29,
      rimHeight: 0.0001,
      cutAngle: 0,
      outwardAngle: 0.1,
      waveShape: 'square' as const,
      waveFrequency: 0.25,
      wavePhase: 180,
    },
    {
      depth: 12.57,
      rimHeight: 2.67,
      cutAngle: 48.3,
      outwardAngle: 35.2,
      waveShape: 'sawtooth' as const,
      waveFrequency: 16.35,
      wavePhase: 45.01,
    },
  ])(
    'keeps decimal rims and shallow moving walls connected after Float32 export: %j',
    (input) => {
      for (const model of ['s', 'm'] as const) {
        const source = readPanel(model)
        const result = engine.build(
          model,
          normalizeHaloSettings({
            mode: 'custom',
            thickness: 1.13,
            cutRotation: 137.3,
            waveAmplitude: 20,
            waveSeamless: false,
            ...input,
          }),
          positionsOf(source),
        )
        const geometry = geometryOf(result.positions)
        expect(topology(geometry)).toEqual({ invalid: 0, components: 1 })
        const exported = new STLLoader().parse(exportPanelStl(geometry))
        expect(topology(exported)).toEqual({ invalid: 0, components: 1 })
        exported.dispose()
        geometry.dispose()
        source.dispose()
      }
    },
    30_000,
  )

  it('preserves exact old geometry for disabled, zero-amplitude and full-rim waves', () => {
    const source = readPanel('s'),
      positions = positionsOf(source)
    for (const dimensions of [
      { depth: 24, rimHeight: 2 },
      { depth: 5, rimHeight: 5 },
    ]) {
      const settings = normalizeHaloSettings({
        mode: 'custom',
        cutAngle: 30,
        ...dimensions,
      })
      const baseline = engine.build('s', settings, positions)
      const zero = engine.build(
        's',
        { ...settings, waveShape: 'square', waveAmplitude: 0 },
        positions,
      )
      expect(zero.positions).toEqual(baseline.positions)
      if (settings.depth === settings.rimHeight)
        expect(
          engine.build(
            's',
            { ...settings, waveShape: 'sine', waveAmplitude: 20 },
            positions,
          ).positions,
        ).toEqual(baseline.positions)
    }
    source.dispose()
  })
})
