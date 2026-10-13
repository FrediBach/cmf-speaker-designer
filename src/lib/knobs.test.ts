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
} from './knob-settings'
import {
  customizeKnobGeometry,
  exportKnobStl,
  parseKnobGeometry,
} from './knobs'

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

function baseVertices(geometry: BufferGeometry) {
  const positions = geometry.getAttribute('position')
  const result = new Set<string>()
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index),
      y = positions.getY(index),
      z = positions.getZ(index)
    if (z < 8) result.add([x, y, z].join(','))
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
    (style) => {
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
        const geometry = customizeKnobGeometry(original, { style, ...values })
        const inspection = topology(geometry)
        expect(inspection.invalidEdges).toBe(0)
        expect(inspection.components).toBe(1)
        expect(inspection.volume).toBeGreaterThan(250)
        expect(geometry.boundingBox!.min.z).toBe(0)
        expect(geometry.boundingBox!.max.z).toBeCloseTo(values.height, 4)
        // Freeze the complete original base, including its full outer collar,
        // not only the central socket. Its XYZ point set stays byte-exact.
        expect(baseVertices(geometry)).toEqual(baseVertices(original))
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
