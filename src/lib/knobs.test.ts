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
import {
  DEFAULT_KNOB_SETTINGS,
  KNOB_STYLES,
  normalizeKnobSettings,
  type KnobSettings,
} from './knob-settings'
import {
  customizeKnobGeometry,
  exportKnobStl,
  knobFilename,
  parseKnobGeometry,
} from './knobs'
import { prepareTextKnobContours, TEXT_KNOB_RADIUS } from './text-knob-contours'
import { getTextContours } from './multicolor-fonts'
import { PATTERN_FONTS } from './multicolor-font-catalog'

function asset() {
  const data = readFileSync(
    new URL(
      `../../resources/stl-files/cmf-speaker-sm-3d-printing-knob-original-v1.stl`,
      import.meta.url,
    ),
  )
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer
}

const originals = asset()

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
        throw new Error('Non-finite knob vertex')
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
      if (a === b) throw new Error('Collapsed knob triangle')
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

function baseVertices(geometry: BufferGeometry, ceiling = 8) {
  const positions = geometry.getAttribute('position')
  const result = new Set<string>()
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index),
      y = positions.getY(index),
      z = positions.getZ(index)
    if (z < ceiling) result.add([x, y, z].join(','))
  }
  return [...result].sort()
}

function hitsFromBottom(geometry: BufferGeometry, x: number, y: number) {
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material)
  mesh.updateMatrixWorld(true)
  const hits = new Raycaster(new Vector3(x, y, -1), new Vector3(0, 0, 1))
    .intersectObject(mesh)
    .map((hit) => hit.point.z)
  material.dispose()
  return [...new Set(hits.map((z) => Number(z.toFixed(4))))]
}

function gripRadius(geometry: BufferGeometry, angle: number, z = 12) {
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material)
  mesh.updateMatrixWorld(true)
  const x = Math.cos(angle),
    y = Math.sin(angle)
  const hit = new Raycaster(
    new Vector3(x * 30, y * 30, z),
    new Vector3(-x, -y, 0),
  ).intersectObject(mesh)[0]
  material.dispose()
  return Math.hypot(hit.point.x, hit.point.y)
}

describe('volume knobs', () => {
  it.each(KNOB_STYLES.map(({ id }) => id))(
    '%s preview and exported STL remain one closed printable solid',
    async (style) => {
      const original = parseKnobGeometry(originals, style)
      for (const values of [
        { height: 16, taper: 0, fluteCount: 16, fluteDepth: 0.8, facets: 6 },
        {
          height: 12,
          taper: 1,
          fluteCount: 32,
          fluteDepth: 1.4,
          flutePath: 'spiral' as const,
          facets: 5,
        },
        {
          height: 24,
          taper: 1,
          fluteCount: 8,
          fluteDepth: 1.4,
          flutePath: 'chevron' as const,
          facets: 12,
        },
      ]) {
        const settings = normalizeKnobSettings({ style, ...values })
        const text =
          style === 'text' ? await prepareTextKnobContours(settings) : undefined
        const geometry = customizeKnobGeometry(original, settings, text)
        const inspection = topology(geometry)
        expect(inspection.invalidEdges).toBe(0)
        expect(inspection.components).toBe(1)
        expect(inspection.volume).toBeGreaterThan(250)
        expect(geometry.boundingBox!.min.z).toBe(0)
        expect(geometry.boundingBox!.max.z).toBeCloseTo(values.height, 4)
        // Shaped grips retriangulate the horizontal base-top cap, whose
        // original Float32 vertices sit slightly below nominal 8 mm.
        // All lower collar and mounting vertices remain byte-exact.
        const ceiling = ['triangle', 'arrow', 'v', 'text'].includes(style)
          ? 7.99999
          : 8
        expect(baseVertices(geometry, ceiling)).toEqual(
          baseVertices(original, ceiling),
        )
        expect(geometry.boundingBox!.min.x).toBe(original.boundingBox!.min.x)
        expect(geometry.boundingBox!.max.x).toBe(original.boundingBox!.max.x)
        expect(geometry.boundingBox!.min.y).toBe(original.boundingBox!.min.y)
        expect(geometry.boundingBox!.max.y).toBe(original.boundingBox!.max.y)
        // Face intersections verify the full fixed lower surfaces even where
        // the upper grip required newly inserted tessellation vertices.
        for (const z of [1.1, 5.25, 6.7, 7.9])
          for (const angle of [0.13, 1.77, 3.1])
            expect(gripRadius(geometry, angle, z)).toBeCloseTo(
              gripRadius(original, angle, z),
              5,
            )
        const p = geometry.getAttribute('position')
        for (let i = 0; i < p.count; i += 1)
          if (Math.hypot(p.getX(i), p.getY(i)) > 9.00001)
            throw new Error('Grip protrudes beyond the original envelope')
        const roundtrip = new STLLoader().parse(exportKnobStl(geometry))
        expect(roundtrip.getAttribute('position').array).toEqual(
          geometry.getAttribute('position').array,
        )
        expect(topology(roundtrip)).toEqual(inspection)
        roundtrip.dispose()
        geometry.dispose()
      }
      original.dispose()
    },
    30_000,
  )

  it('retains the original ring, cross, and bar surfaces at their default dimensions', () => {
    for (const style of ['ring', 'cross', 'bar'] as const) {
      const original = parseKnobGeometry(originals, style)
      const geometry = customizeKnobGeometry(original, {
        ...DEFAULT_KNOB_SETTINGS,
        style,
      })
      expect(geometry.getAttribute('position').array).toEqual(
        original.getAttribute('position').array,
      )
      expect(hitsFromBottom(geometry, 0.17, 0.23)[0]).toBeCloseTo(4.7, 3)
      expect(hitsFromBottom(geometry, 3.1, 0.13)[0]).toBeCloseTo(0, 3)
      if (style === 'ring')
        expect(hitsFromBottom(geometry, 0.17, 0.23)).toEqual([4.7, 8])
      geometry.dispose()
      original.dispose()
    }
  })

  it.each(['triangle', 'arrow', 'v'] as const)(
    '%s keeps its intended silhouette and parameters in the printable mesh',
    (style) => {
      const original = parseKnobGeometry(originals, style)
      const build = (values: Partial<KnobSettings> = {}) =>
        customizeKnobGeometry(original, { style, ...values })
      const normal = build()
      const highest = (geometry: BufferGeometry, x: number, y: number) =>
        Math.max(...hitsFromBottom(geometry, x, y))
      // Probe head, shaft, and notch regions, rather than merely checking
      // vertex counts: each style must actually produce its named outline.
      if (style === 'triangle') {
        expect(highest(normal, 0.1, 4)).toBe(16)
        expect(highest(normal, 5, 4)).toBe(8)
        expect(highest(normal, 5, -4)).toBe(16)
      } else if (style === 'arrow') {
        expect(highest(normal, 0.1, -4)).toBe(16)
        expect(highest(normal, 4, -4)).toBe(8)
        expect(highest(normal, 4, 0.5)).toBe(16)
      } else {
        expect(highest(normal, 0.1, 4)).toBe(8)
        expect(highest(normal, 4, 4)).toBe(16)
        expect(highest(normal, 0.1, -4)).toBe(16)
      }
      const narrower = build({ gripWidth: 8 })
      const shallower = build({ gripDepth: 8 })
      const tapered = build({ taper: 1 })
      for (const smaller of [narrower, shallower, tapered])
        expect(topology(smaller).volume).toBeLessThan(topology(normal).volume)
      if (style !== 'triangle') {
        const thicker = build({ gripThickness: 4 })
        expect(topology(thicker).volume).toBeGreaterThan(
          topology(normal).volume,
        )
        thicker.dispose()
      }
      // The blind socket stays open from the stem bottom, with its original
      // roof height, whether material is raised above that XY position or not.
      expect(hitsFromBottom(normal, 0.17, 0.23)[0]).toBe(4.7)
      for (const geometry of [original, normal, narrower, shallower, tapered])
        geometry.dispose()
    },
  )

  it.each(['triangle', 'arrow', 'v'] as const)(
    '%s remains watertight at extreme proportions, thicknesses, and tapers',
    (style) => {
      const original = parseKnobGeometry(originals, style)
      for (const [gripWidth, gripDepth] of [
        [8, 8],
        [16, 8],
        [8, 16],
        [16, 16],
      ])
        for (const gripThickness of [2, 5]) {
          const geometry = customizeKnobGeometry(original, {
            style,
            gripWidth,
            gripDepth,
            gripThickness,
            height: 24,
            taper: 1,
          })
          const inspection = topology(geometry)
          expect(inspection.invalidEdges).toBe(0)
          expect(inspection.components).toBe(1)
          expect(inspection.volume).toBeGreaterThan(250)
          const positions = geometry.getAttribute('position')
          for (let index = 0; index < positions.count; index += 1)
            if (positions.getZ(index) > 8)
              expect(
                Math.hypot(positions.getX(index), positions.getY(index)),
              ).toBeLessThan(9)
          const exported = new STLLoader().parse(exportKnobStl(geometry))
          expect(topology(exported)).toEqual(inspection)
          geometry.dispose()
          exported.dispose()
        }
      original.dispose()
    },
  )

  it('includes the active shaped-grip dimensions in export filenames', () => {
    expect(
      knobFilename(normalizeKnobSettings({ style: 'triangle' })),
    ).toContain('triangle-height-16.0mm-width-13.0mm-depth-12.0mm')
    expect(
      knobFilename(normalizeKnobSettings({ style: 'arrow', gripThickness: 4 })),
    ).toContain('arrow-height-16.0mm-width-13.0mm-depth-12.0mm-stroke-4.0mm')
    expect(
      knobFilename(normalizeKnobSettings({ style: 'v', taper: 1 })),
    ).toContain(
      'v-height-16.0mm-width-13.0mm-depth-12.0mm-stroke-3.0mm-taper-1.0mm',
    )
  })

  it.each(['BO', 'ij', 'WW', 'I', '@', 'é'])(
    'joins text %s, including counters and detached pieces, into one watertight STL',
    async (text) => {
      const original = parseKnobGeometry(originals, 'text')
      for (const taper of [0, 1]) {
        const settings = normalizeKnobSettings({
          style: 'text',
          text,
          height: 24,
          taper,
        })
        const contours = await prepareTextKnobContours(settings)
        const geometry = customizeKnobGeometry(original, settings, contours)
        const inspection = topology(geometry)
        expect(inspection.invalidEdges).toBe(0)
        expect(inspection.components).toBe(1)
        expect(inspection.volume).toBeGreaterThan(250)
        expect(baseVertices(geometry, 7.99999)).toEqual(
          baseVertices(original, 7.99999),
        )
        expect(hitsFromBottom(geometry, 0.17, 0.23)[0]).toBe(4.7)
        expect(geometry.boundingBox!.max.z).toBe(24)
        const exported = new STLLoader().parse(exportKnobStl(geometry))
        expect(topology(exported)).toEqual(inspection)
        geometry.dispose()
        exported.dispose()
      }
      original.dispose()
    },
  )

  it('fits narrow and wide character pairs proportionally to the same collar', async () => {
    for (const text of ['I', 'WW', 'ij', 'BO']) {
      const settings = normalizeKnobSettings({ style: 'text', text })
      const original = getTextContours(
        text,
        settings.fontId,
        1,
        settings.fontWeight,
      )
      const prepared = await prepareTextKnobContours(settings)
      const extents = (points: { x: number; y: number }[]) => ({
        minX: Math.min(...points.map(({ x }) => x)),
        maxX: Math.max(...points.map(({ x }) => x)),
        minY: Math.min(...points.map(({ y }) => y)),
        maxY: Math.max(...points.map(({ y }) => y)),
      })
      const before = extents(original.flat().map(([x, y]) => ({ x, y })))
      const after = extents(prepared.contours.flat())
      expect((after.maxX - after.minX) / (after.maxY - after.minY)).toBeCloseTo(
        (before.maxX - before.minX) / (before.maxY - before.minY),
        5,
      )
      expect(after.minX + after.maxX).toBeCloseTo(0, 6)
      expect(after.minY + after.maxY).toBeCloseTo(0, 6)
      expect(
        Math.max(
          ...prepared.contours.flat().map(({ x, y }) => Math.hypot(x, y)),
        ),
      ).toBeCloseTo(TEXT_KNOB_RADIUS, 5)
    }
  })

  it('keeps letter counters open down to the collar and applies text taper independently of shaped-grip dimensions', async () => {
    const original = parseKnobGeometry(originals, 'text')
    const settings = normalizeKnobSettings({
      style: 'text',
      text: 'O',
      height: 20,
    })
    const contours = await prepareTextKnobContours(settings)
    const normal = customizeKnobGeometry(original, settings, contours)
    expect(hitsFromBottom(normal, 0.17, 0.23)).toEqual([4.7, 8])
    const tapered = customizeKnobGeometry(
      original,
      { ...settings, taper: 1 },
      contours,
    )
    const unrelated = customizeKnobGeometry(
      original,
      {
        ...settings,
        taper: 1,
        gripWidth: 8,
        gripDepth: 16,
      },
      contours,
    )
    expect(unrelated.getAttribute('position').array).toEqual(
      tapered.getAttribute('position').array,
    )
    expect(topology(tapered).volume).toBeLessThan(topology(normal).volume)
    const radiusAt = (geometry: BufferGeometry, z: number) => {
      const p = geometry.getAttribute('position')
      let radius = 0
      for (let i = 0; i < p.count; i += 1)
        if (p.getZ(i) === z)
          radius = Math.max(radius, Math.hypot(p.getX(i), p.getY(i)))
      return radius
    }
    expect(radiusAt(normal, 20)).toBeCloseTo(TEXT_KNOB_RADIUS, 5)
    expect(radiusAt(tapered, 20)).toBeCloseTo(TEXT_KNOB_RADIUS - 1, 5)
    for (const geometry of [original, normal, tapered, unrelated])
      geometry.dispose()
  })

  it.each(PATTERN_FONTS)(
    'builds printable contours in $name at every available weight',
    async ({ id, weights }) => {
      const original = parseKnobGeometry(originals, 'text')
      for (const fontWeight of weights) {
        const settings = normalizeKnobSettings({
          style: 'text',
          text: 'B@',
          fontId: id,
          fontWeight,
        })
        const contours = await prepareTextKnobContours(settings)
        const geometry = customizeKnobGeometry(original, settings, contours)
        expect(topology(geometry)).toMatchObject({
          invalidEdges: 0,
          components: 1,
        })
        geometry.dispose()
      }
      original.dispose()
    },
  )

  it('includes characters, font and weight in safe text-knob filenames', () => {
    expect(
      knobFilename(normalizeKnobSettings({ style: 'text', text: 'AB' })),
    ).toContain('text-height-16.0mm-AB-inter-700')
    expect(
      knobFilename(normalizeKnobSettings({ style: 'text', text: '/?' })),
    ).toContain('-u2fu3f-')
  })

  it('ignores legacy diameter and rigid rotation without changing the original source', () => {
    const original = parseKnobGeometry(originals, 'bar')
    const legacy = { ...DEFAULT_KNOB_SETTINGS, diameter: 24, rotation: 135 }
    const geometry = customizeKnobGeometry(original, legacy)
    expect(geometry.getAttribute('position').array).toEqual(
      original.getAttribute('position').array,
    )
    expect(normalizeKnobSettings(legacy)).toEqual(DEFAULT_KNOB_SETTINGS)
    expect(normalizeKnobSettings({ style: 'heart' as never }).style).toBe('bar')
    original.dispose()
    geometry.dispose()
  })

  it('makes spiral and chevron grooves change direction with height while preserving the cavity', () => {
    const original = parseKnobGeometry(originals, 'ring')
    const straight = customizeKnobGeometry(original, {
      style: 'fluted',
      flutePath: 'straight',
    })
    const spiral = customizeKnobGeometry(original, {
      style: 'fluted',
      flutePath: 'spiral',
    })
    const chevron = customizeKnobGeometry(original, {
      style: 'fluted',
      flutePath: 'chevron',
    })
    // Straight ribs stay on angle zero; spiral phase progresses, whereas
    // chevron phase is mirrored around the upper grip's middle height.
    expect(gripRadius(straight, 0, 10)).toBeCloseTo(
      gripRadius(original, 0, 10),
      4,
    )
    expect(gripRadius(spiral, 0, 10)).toBeLessThan(
      gripRadius(straight, 0, 10) - 0.5,
    )
    expect(gripRadius(chevron, 0, 10)).toBeLessThan(
      gripRadius(straight, 0, 10) - 0.3,
    )
    expect(gripRadius(spiral, 0, 12)).toBeGreaterThan(
      gripRadius(chevron, 0, 12) + 0.3,
    )
    expect(gripRadius(spiral, 0, 14)).toBeGreaterThan(
      gripRadius(chevron, 0, 14) + 0.2,
    )
    for (const geometry of [straight, spiral, chevron]) {
      expect(hitsFromBottom(geometry, 0.17, 0.23)).toEqual([4.7, 8])
      expect(topology(geometry).invalidEdges).toBe(0)
      geometry.dispose()
    }
    original.dispose()
  })

  it('insets the upper taper and varies facet count without changing the base', () => {
    const original = parseKnobGeometry(originals, 'ring')
    const five = customizeKnobGeometry(original, {
      style: 'hex',
      facets: 5,
      taper: 1,
    })
    const twelve = customizeKnobGeometry(original, { style: 'hex', facets: 12 })
    const tapered = customizeKnobGeometry(original, { style: 'ring', taper: 1 })
    expect(gripRadius(five, Math.PI / 5, 14)).toBeLessThan(
      gripRadius(twelve, Math.PI / 5, 14) - 1,
    )
    expect(gripRadius(tapered, 0, 14)).toBeLessThan(
      gripRadius(original, 0, 14) - 0.7,
    )
    expect(gripRadius(tapered, 0, 10)).toBeGreaterThan(
      gripRadius(original, 0, 10) - 0.3,
    )
    expect(gripRadius(tapered, 0, 7)).toBe(gripRadius(original, 0, 7))
    for (const geometry of [original, five, twelve, tapered]) geometry.dispose()
  })

  it('changes the actual grip surface for flute count, depth, and hexagonal faces', () => {
    const original = parseKnobGeometry(originals, 'ring')
    const eight = customizeKnobGeometry(original, {
      style: 'fluted',
      fluteCount: 8,
    })
    const sixteen = customizeKnobGeometry(original, {
      style: 'fluted',
      fluteCount: 16,
    })
    const deep = customizeKnobGeometry(original, {
      style: 'fluted',
      fluteCount: 8,
      fluteDepth: 1.4,
    })
    const hex = customizeKnobGeometry(original, { style: 'hex' })
    expect(gripRadius(eight, 0)).toBeCloseTo(gripRadius(original, 0), 4)
    expect(
      gripRadius(original, Math.PI / 8) - gripRadius(eight, Math.PI / 8),
    ).toBeCloseTo(0.8, 1)
    expect(gripRadius(sixteen, Math.PI / 8)).toBeCloseTo(
      gripRadius(original, Math.PI / 8),
      1,
    )
    expect(
      gripRadius(original, Math.PI / 8) - gripRadius(deep, Math.PI / 8),
    ).toBeCloseTo(1.4, 1)
    expect(gripRadius(hex, 0)).toBeCloseTo(gripRadius(original, 0), 4)
    expect(
      gripRadius(hex, Math.PI / 6) / gripRadius(original, Math.PI / 6),
    ).toBeCloseTo(Math.cos(Math.PI / 6), 2)
    for (const geometry of [original, eight, sixteen, deep, hex])
      geometry.dispose()
  })

  it('normalizes invalid and extreme saved values to printable bounds', () => {
    expect(
      normalizeKnobSettings({
        style: 'unknown' as never,
        height: -5,
        taper: Infinity,
        facets: 100,
        flutePath: 'invalid' as never,
        fluteCount: 900,
        fluteDepth: 99,
      }),
    ).toEqual({
      ...DEFAULT_KNOB_SETTINGS,
      height: 12,
      fluteCount: 32,
      fluteDepth: 1.4,
      facets: 12,
    })
    expect(normalizeKnobSettings({ fluteCount: 12.8 }).fluteCount).toBe(13)
  })
})
