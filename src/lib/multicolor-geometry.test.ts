import { readFileSync } from 'node:fs'
import initializeManifold, {
  type ManifoldToplevel,
  type Manifold,
} from 'manifold-3d'
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createMulticolorEngine,
  multicolorGeometryKey,
  type MaterialMesh,
  type MulticolorMesh,
} from './multicolor-geometry'
import { buildMulticolorGeometry } from './multicolor-client'
import {
  getDefaultMulticolorSettings,
  type PatternElement,
  type MulticolorSettings,
} from './multicolor-settings'
import { parsePanelGeometry, type SpeakerModel } from './panels'
import { buildHandledPanelGeometry } from './handles'
import { getDefaultHandleSettings } from './handle-settings'
import { normalizeGrilleSettings } from './grille-settings'
import { normalizeHaloSettings } from './halo-settings'
import { normalizeRaceStripeSettings } from './race-stripe-settings'
import { applyMulticolorPreset, MULTICOLOR_PRESETS } from './multicolor-presets'
import { validateDesign } from './design'

function readPanel(model: SpeakerModel) {
  const bytes = readFileSync(
    new URL(
      `../../resources/stl-files/cmf-speaker-${model}-3d-printing-panel-original-v1.stl`,
      import.meta.url,
    ),
  )
  const data = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(data).set(bytes)
  return parsePanelGeometry(data, model)
}

function inputOf(geometry: BufferGeometry): MulticolorMesh {
  return {
    positions: new Float32Array(geometry.getAttribute('position').array),
    ...(geometry.index
      ? { indices: Uint32Array.from(geometry.index.array) }
      : {}),
  }
}

function settings(elements: PatternElement[] = []): MulticolorSettings {
  return {
    ...getDefaultMulticolorSettings(),
    enabled: true,
    frame: { centerX: 0, centerY: 0, width: 200, height: 400 },
    materials: [
      { id: 'red', name: 'Red', color: '#ee0000' },
      { id: 'blue', name: 'Blue', color: '#0000ee' },
    ],
    elements,
  }
}

function stripe(
  id: string,
  materialId: string,
  x: number,
  width: number,
  rotation = 0,
): PatternElement {
  return {
    id,
    name: id,
    materialId,
    kind: 'stripe',
    visible: true,
    x,
    y: 0,
    width,
    height: 400,
    rotation,
  }
}

/** Independent index-based inspection preserves separate contacting shells. */
function inspect(part: MaterialMesh) {
  const edges = new Map<string, number[]>()
  const p = part.positions
  let volume = 0
  expect([...p].every(Number.isFinite)).toBe(true)
  for (let i = 0; i < part.indices.length; i += 3) {
    const [a, b, c] = part.indices.subarray(i, i + 3)
    const ax = p[a * 3],
      ay = p[a * 3 + 1],
      az = p[a * 3 + 2]
    const bx = p[b * 3],
      by = p[b * 3 + 1],
      bz = p[b * 3 + 2]
    const cx = p[c * 3],
      cy = p[c * 3 + 1],
      cz = p[c * 3 + 2]
    volume +=
      (ax * (by * cz - bz * cy) +
        ay * (bz * cx - bx * cz) +
        az * (bx * cy - by * cx)) /
      6
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      if (from === to) throw new Error('Collapsed mesh edge')
      const key = `${Math.min(from, to)}:${Math.max(from, to)}`
      const directions = edges.get(key) ?? []
      directions.push(from < to ? 1 : -1)
      edges.set(key, directions)
    }
  }
  expect(
    [...edges.values()].every(
      (directions) =>
        directions.length === 2 && directions[0] + directions[1] === 0,
    ),
  ).toBe(true)
  expect(volume).toBeGreaterThan(0)
  expect(Math.abs(volume - part.volume)).toBeLessThan(
    Math.max(0.001, part.volume * 0.00001),
  )
}

function testSolid(module: ManifoldToplevel, input: MulticolorMesh): Manifold {
  let vertices = input.positions
  let triangles = input.indices
  if (!triangles) {
    const indexed: number[] = [],
      positions: number[] = []
    const ids = new Map<string, number>()
    for (let i = 0; i < vertices.length; i += 3) {
      const key = `${vertices[i]},${vertices[i + 1]},${vertices[i + 2]}`
      let id = ids.get(key)
      if (id === undefined) {
        id = ids.size
        ids.set(key, id)
        positions.push(...vertices.subarray(i, i + 3))
      }
      indexed.push(id)
    }
    vertices = new Float32Array(positions)
    triangles = new Uint32Array(indexed)
  }
  return new module.Manifold(
    new module.Mesh({
      numProp: 3,
      vertProperties: vertices,
      triVerts: triangles,
    }),
  )
}

describe('multicolor material partitioning', () => {
  let engine: Awaited<ReturnType<typeof createMulticolorEngine>>
  let module: ManifoldToplevel
  beforeAll(async () => {
    engine = await createMulticolorEngine()
    module = await initializeManifold()
    module.setup()
  })
  afterAll(() => engine.dispose())

  function assertPartition(input: MulticolorMesh, parts: MaterialMesh[]) {
    const owned: Manifold[] = []
    const own = (solid: Manifold) => {
      owned.push(solid)
      return solid
    }
    try {
      const original = own(testSolid(module, input))
      const solids = parts.map((part) => {
        inspect(part)
        const solid = own(testSolid(module, part))
        expect(solid.status()).toBe('NoError')
        return solid
      })
      const united = own(module.Manifold.union(solids))
      expect(united.status()).toBe('NoError')
      const tolerance = Math.max(0.002, original.volume() * 0.000001)
      expect(Math.abs(united.volume() - original.volume())).toBeLessThan(
        tolerance,
      )
      expect(Math.abs(own(original.subtract(united)).volume())).toBeLessThan(
        tolerance,
      )
      expect(Math.abs(own(united.subtract(original)).volume())).toBeLessThan(
        tolerance,
      )
      for (let i = 0; i < solids.length; i++)
        for (let j = i + 1; j < solids.length; j++)
          expect(
            Math.abs(own(solids[i].intersect(solids[j])).volume()),
          ).toBeLessThan(tolerance)
      const components = united.decompose().map(own)
      expect(
        components.filter((part) => part.volume() > tolerance),
      ).toHaveLength(1)
    } finally {
      owned.reverse().forEach((solid) => solid.delete())
    }
  }

  it('partitions the reported overlapping stripes on a slotted handle and round grille', async () => {
    const design = validateDesign(
      JSON.parse(
        readFileSync(
          new URL(
            '../../tests/fixtures/multicolor-overlapping-stripes.json',
            import.meta.url,
          ),
          'utf8',
        ),
      ),
    )
    const source = readPanel(design.model)
    let panel: BufferGeometry | undefined
    try {
      panel = await buildHandledPanelGeometry(
        source,
        design.model,
        'original',
        design.relief,
        design.handle,
        design.grille,
        design.halo,
        design.panelExtension,
        design.panelGap,
        design.raceStripes,
      )
      const input = inputOf(panel)
      const before = structuredClone(design.multicolor)
      const result = engine.build(input, design.multicolor)
      expect(result.parts.map((part) => part.materialId)).toEqual([
        'base',
        ...design.multicolor.materials.slice(-3).map((material) => material.id),
      ])
      expect(design.multicolor).toEqual(before)
      expect(result.parts.flatMap((part) => part.elementIds).sort()).toEqual(
        design.multicolor.elements
          .slice(-3)
          .map((element) => element.id)
          .sort(),
      )
      assertPartition(input, result.parts)
    } finally {
      source.dispose()
      panel?.dispose()
    }
  }, 60_000)

  it.each([1, 2, 8])(
    'excludes covered rainbow layers beneath %i repeated three-stripe groups',
    (repeats) => {
      const design = validateDesign(
        JSON.parse(
          readFileSync(
            new URL(
              '../../tests/fixtures/multicolor-overlapping-stripes.json',
              import.meta.url,
            ),
            'utf8',
          ),
        ),
      )
      const artwork = structuredClone(design.multicolor)
      artwork.elements = [
        ...artwork.elements.slice(0, 6),
        ...Array.from({ length: repeats }, (_, index) =>
          artwork.elements
            .slice(-3)
            .map((element) => ({ ...element, id: `${element.id}-${index}` })),
        ).flat(),
      ]
      const box = new BoxGeometry(85, 131, 4).toNonIndexed()
      try {
        const input = inputOf(box)
        const result = engine.build(input, artwork)
        expect(result.parts.map((part) => part.materialId)).toEqual(
          artwork.materials.slice(-3).map((material) => material.id),
        )
        expect(result.parts.flatMap((part) => part.elementIds).sort()).toEqual(
          artwork.elements
            .slice(-3)
            .map((element) => element.id)
            .sort(),
        )
        assertPartition(input, result.parts)
      } finally {
        box.dispose()
      }
    },
  )

  it('retains a real narrow gap between adjacent masks instead of merging close boundaries', () => {
    const box = new BoxGeometry(80, 100, 4).toNonIndexed()
    try {
      const input = inputOf(box)
      const result = engine.build(
        input,
        settings([
          stripe('left', 'red', -20.005, 39.99),
          stripe('right', 'blue', 20.005, 39.99),
        ]),
      )
      expect(
        result.parts.find((part) => part.materialId === 'base')?.volume,
      ).toBeCloseTo(0.02 * 100 * 4, 5)
      assertPartition(input, result.parts)
    } finally {
      box.dispose()
    }
  })

  it('resolves rings, base-colored overlays and disconnected same-color islands without overlap', () => {
    const box = new BoxGeometry(80, 100, 4).toNonIndexed()
    const elements: PatternElement[] = [
      stripe('lower', 'red', -20, 40),
      {
        id: 'ring',
        name: 'Ring',
        kind: 'circle',
        materialId: 'blue',
        visible: true,
        x: 0,
        y: 0,
        rotation: 0,
        radius: 20,
        innerRadius: 10,
      },
      stripe('erase', 'base', 0, 10),
    ]
    const input = inputOf(box)
    const before = input.positions.slice()
    const result = engine.build(input, settings(elements))
    assertPartition(input, result.parts)
    expect(input.positions).toEqual(before)
    const materialsAt = (x: number, y: number) =>
      result.parts
        .filter((part) => {
          const geometry = new BufferGeometry()
          geometry.setAttribute(
            'position',
            new BufferAttribute(part.positions, 3),
          )
          geometry.setIndex(new BufferAttribute(part.indices, 1))
          const material = new MeshBasicMaterial({ side: DoubleSide })
          const mesh = new Mesh(geometry, material)
          const hits = new Raycaster(
            new Vector3(x, y, 20),
            new Vector3(0, 0, -1),
          ).intersectObject(mesh)
          geometry.dispose()
          material.dispose()
          return hits.length > 0
        })
        .map((part) => part.materialId)
    expect(materialsAt(0, 0)).toEqual(['base'])
    expect(materialsAt(-8, 0)).toEqual(['red'])
    expect(materialsAt(15, 0)).toEqual(['blue'])
    expect(materialsAt(-25, 0)).toEqual(['red'])
    box.dispose()
  })

  it('clips artwork, omits completely covered materials, and reports empty shapes', () => {
    const box = new BoxGeometry(80, 100, 4).toNonIndexed()
    const input = inputOf(box)
    const full = engine.build(
      input,
      settings([stripe('under', 'blue', 0, 80), stripe('top', 'red', 0, 80)]),
    )
    expect(full.parts.map((part) => part.materialId)).toEqual(['red'])
    expect(full.diagnostics).toHaveLength(1)
    assertPartition(input, full.parts)
    const clipped = settings([stripe('fill', 'blue', 0, 80)])
    clipped.frame.width = 10
    expect(
      engine
        .build(input, clipped)
        .parts.find((part) => part.materialId === 'blue')!.volume,
    ).toBeCloseTo(4000, 5)
    box.dispose()
  })

  it('supports cross and polygon intersections, contacting discs and exact coincident stripe walls', () => {
    const box = new BoxGeometry(80, 100, 4).toNonIndexed()
    const input = inputOf(box)
    const elements: PatternElement[] = [
      stripe('left', 'red', -20, 40),
      stripe('right', 'blue', 20, 40),
      {
        id: 'cross',
        name: 'Cross',
        kind: 'cross',
        materialId: 'base',
        visible: true,
        x: 0,
        y: 0,
        rotation: 32,
        left: 30,
        right: 20,
        top: 25,
        bottom: 35,
        horizontalThickness: 9,
        verticalThickness: 7,
      },
      {
        id: 'triangle',
        name: 'Triangle',
        kind: 'polygon',
        materialId: 'red',
        visible: true,
        x: 3,
        y: 2,
        rotation: 16,
        points: [
          [-25, -20],
          [25, -20],
          [0, 25],
        ],
      },
      {
        id: 'disc-one',
        name: 'Disc one',
        kind: 'circle',
        materialId: 'blue',
        visible: true,
        x: -10,
        y: 35,
        rotation: 0,
        radius: 10,
        innerRadius: 0,
      },
      {
        id: 'disc-two',
        name: 'Disc two',
        kind: 'circle',
        materialId: 'blue',
        visible: true,
        x: 10,
        y: 35,
        rotation: 0,
        radius: 10,
        innerRadius: 0,
      },
    ]
    try {
      assertPartition(input, engine.build(input, settings(elements)).parts)
    } finally {
      box.dispose()
    }
  })

  it('warns about resolved narrow islands without removing or expanding them', () => {
    const box = new BoxGeometry(80, 100, 4).toNonIndexed()
    const input = inputOf(box)
    const result = engine.build(
      input,
      settings([stripe('thin', 'red', 0, 0.3, 35)]),
    )
    try {
      expect(result.diagnostics.join(' ')).toContain('0.8 mm width reference')
      assertPartition(input, result.parts)
    } finally {
      box.dispose()
    }
  })

  it.each(['s', 'm'] as const)(
    'preserves the real %s panel and skips a circle entirely inside an opening',
    (model) => {
      const panel = readPanel(model)
      const input = inputOf(panel)
      const elements: PatternElement[] = [
        stripe('band', 'red', 0, 16),
        {
          id: 'empty',
          name: 'Opening disc',
          kind: 'circle',
          materialId: 'blue',
          visible: true,
          x: 0,
          y: model === 's' ? -23 : -70,
          rotation: 0,
          radius: 8,
          innerRadius: 0,
        },
      ]
      const result = engine.build(input, settings(elements))
      expect(result.parts.map((part) => part.materialId)).toEqual([
        'base',
        'red',
      ])
      expect(result.diagnostics.join(' ')).toContain('Opening disc')
      assertPartition(input, result.parts)
      panel.dispose()
    },
    20_000,
  )

  it.each(
    (['s', 'm'] as const).flatMap((model) =>
      MULTICOLOR_PRESETS.map(({ id }) => ({ model, id })),
    ),
  )(
    'serializes the $id preset on Speaker $model in both layouts',
    ({ model, id }) => {
      const panel = readPanel(model)
      try {
        for (const layout of ['panel', 'proportional'] as const) {
          const preset = applyMulticolorPreset(
            id,
            getDefaultMulticolorSettings(model),
            layout,
          )
          const result = engine.build(inputOf(panel), preset.settings)
          expect(result.parts.length).toBeGreaterThan(0)
          for (const part of result.parts) {
            const solid = testSolid(module, part)
            try {
              expect(solid.status()).toBe('NoError')
              expect(solid.volume()).toBeGreaterThan(0)
            } finally {
              solid.delete()
            }
          }
        }
      } finally {
        panel.dispose()
      }
    },
    30_000,
  )

  it.each(['s', 'm'] as const)(
    'partitions the completed %s grille, halo, grooves, custom handle, sides and mounting gap',
    async (model) => {
      const source = readPanel(model)
      const panel = await buildHandledPanelGeometry(
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
        normalizeRaceStripeSettings({
          enabled: true,
          count: 3,
          width: 10,
          gap: 12,
        }),
      )
      try {
        const input = inputOf(panel)
        const result = engine.build(
          input,
          settings([
            stripe('center', 'red', 0, 17),
            stripe('diagonal', 'blue', 9, 12, 24),
          ]),
        )
        expect(result.parts).toHaveLength(3)
        assertPartition(input, result.parts)
      } finally {
        panel.dispose()
        source.dispose()
      }
    },
    60_000,
  )

  it('keeps material meshes indexed through the public client and leaves appearance out of its key', async () => {
    const panel = readPanel('s')
    const original = settings([stripe('center', 'red', 0, 17)])
    const changed = structuredClone(original)
    changed.materials[0].name = 'New name'
    changed.materials[0].color = '#123456'
    changed.elements[0].name = 'New label'
    expect(multicolorGeometryKey(changed)).toBe(multicolorGeometryKey(original))
    changed.elements[0].materialId = 'blue'
    expect(multicolorGeometryKey(changed)).not.toBe(
      multicolorGeometryKey(original),
    )
    const result = await buildMulticolorGeometry(panel, original)
    try {
      expect(result.parts).toHaveLength(2)
      expect(
        result.parts.every(
          ({ geometry }) => geometry.index && geometry.boundingBox,
        ),
      ).toBe(true)
    } finally {
      result.parts.forEach(({ geometry, previewGeometry }) => {
        geometry.dispose()
        previewGeometry?.dispose()
      })
      panel.dispose()
    }
  })
})
