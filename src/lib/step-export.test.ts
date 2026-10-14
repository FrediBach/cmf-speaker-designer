import { readFileSync } from 'node:fs'
import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  CylinderGeometry,
  ExtrudeGeometry,
  Path,
  Shape,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { describe, expect, it } from 'vitest'
import { exportStep } from './step-export'
import { parsePanelGeometry, preparePanelExportGeometry } from './panels'
import { buildHandledPanelGeometry } from './handles'
import { getDefaultHandleSettings } from './handle-settings'
import { normalizeGrilleSettings } from './grille-settings'
import { normalizeHaloSettings } from './halo-settings'
import {
  customizeKnobGeometry,
  parseKnobGeometry,
  prepareKnobExportGeometry,
} from './knobs'
import { KNOB_STYLES } from './knob-settings'

type Point = [number, number, number]
const decoder = new TextDecoder()

/** Independently follow STEP references and rebuild its polygonal boundary. */
function inspectStep(data: ArrayBuffer) {
  const text = decoder.decode(data)
  expect(text.startsWith('ISO-10303-21;\nHEADER;')).toBe(true)
  expect(text.endsWith('ENDSEC;\nEND-ISO-10303-21;\n')).toBe(true)
  expect(text).toContain("FILE_SCHEMA(('AUTOMOTIVE_DESIGN'))")
  expect(text).toContain('SI_UNIT(.MILLI.,.METRE.)')
  const entities = new Map<number, string>()
  for (const match of text.matchAll(/^#(\d+)=(.*);$/gm)) {
    expect(entities.has(Number(match[1]))).toBe(false)
    entities.set(Number(match[1]), match[2])
  }
  for (const entity of entities.values()) {
    for (const reference of entity.matchAll(/#(\d+)/g))
      expect(entities.has(Number(reference[1]))).toBe(true)
  }
  function point(id: number): Point {
    const match = entities
      .get(id)!
      .match(/^CARTESIAN_POINT\('',\(([^)]+)\)\)$/)!
    expect(match).not.toBeNull()
    return match[1].split(',').map(Number) as Point
  }
  function references(entity: string) {
    return [...entity.matchAll(/#(\d+)/g)].map((match) => Number(match[1]))
  }
  function vertex(id: number): Point {
    const entity = entities.get(id)!
    expect(entity).toMatch(/^VERTEX_POINT\(/)
    return point(references(entity)[0])
  }
  const triangles: Point[][] = []
  const faceVolumes = new Map<number, number>()
  const edgeUses = new Map<number, number[]>()
  const tripleVolume = ([a, b, c]: Point[]) =>
    (a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0])) /
    6
  for (const [id, entity] of entities) {
    if (!entity.startsWith('ADVANCED_FACE(')) continue
    const bounds = references(entity).slice(0, -1)
    let faceVolume = 0
    bounds.forEach((boundId, boundIndex) => {
      const bound = entities.get(boundId)!
      expect(bound).toMatch(
        boundIndex === 0 ? /^FACE_OUTER_BOUND\(/ : /^FACE_BOUND\(/,
      )
      expect(bound).toMatch(/,.T.\)$/)
      const loop = entities.get(references(bound)[0])!
      expect(loop).toMatch(/^EDGE_LOOP\(/)
      const orientedEdges = references(loop).map((edgeId) => {
        const oriented = entities.get(edgeId)!
        expect(oriented).toMatch(/^ORIENTED_EDGE\('',\*,\*,#\d+,\.[TF]\.\)$/)
        const edgeRef = references(oriented)[0]
        const edge = entities.get(edgeRef)!
        expect(edge).toMatch(/^EDGE_CURVE\(/)
        const [a, b] = references(edge)
        const forward = oriented.endsWith(',.T.)')
        const uses = edgeUses.get(edgeRef) ?? []
        uses.push(forward ? 1 : -1)
        edgeUses.set(edgeRef, uses)
        return forward ? [a, b] : [b, a]
      })
      orientedEdges.forEach((edge, index) =>
        expect(edge[1]).toBe(
          orientedEdges[(index + 1) % orientedEdges.length][0],
        ),
      )
      const polygon = orientedEdges.map(([start]) => vertex(start))
      // Signed fan integration also covers concave boundaries and hole loops.
      for (let index = 1; index + 1 < polygon.length; index += 1) {
        const triangle = [polygon[0], polygon[index], polygon[index + 1]]
        triangles.push(triangle)
        faceVolume += tripleVolume(triangle)
      }
    })
    faceVolumes.set(id, faceVolume)
  }
  for (const uses of edgeUses.values()) expect(uses.sort()).toEqual([-1, 1])
  const shellVolumes = new Map<number, number>()
  for (const [id, entity] of entities) {
    if (!entity.startsWith('CLOSED_SHELL(')) continue
    shellVolumes.set(
      id,
      references(entity).reduce((sum, face) => sum + faceVolumes.get(face)!, 0),
    )
  }
  let solidVolume = 0
  for (const entity of entities.values()) {
    if (!/^(MANIFOLD_SOLID_BREP|BREP_WITH_VOIDS)\(/.test(entity)) continue
    const [outside, ...voids] = references(entity)
    solidVolume += shellVolumes.get(outside)!
    for (const cavity of voids) {
      const oriented = entities.get(cavity)!
      expect(oriented).toMatch(/^ORIENTED_CLOSED_SHELL\(/)
      solidVolume +=
        shellVolumes.get(references(oriented)[0])! *
        (oriented.endsWith(',.T.)') ? 1 : -1)
    }
  }
  const volume = triangles.reduce(
    (sum, triangle) => sum + tripleVolume(triangle),
    0,
  )
  return { text, entities, triangles, volume, solidVolume }
}

describe('STEP solid export', () => {
  it('retains indexed geometry, millimeter dimensions and positive volume without modifying the mesh', () => {
    const geometry = new BoxGeometry(7.25, 11.5, 19.75).translate(-25, 14, 100)
    const before = geometry.getAttribute('position').array.slice()
    const step = inspectStep(exportStep(geometry, 'panel.stp'))
    expect(step.triangles).toHaveLength(12)
    expect(step.volume).toBeCloseTo(7.25 * 11.5 * 19.75, 7)
    expect(step.text.match(/=CLOSED_SHELL\(/g)).toHaveLength(1)
    expect(step.text.match(/=MANIFOLD_SOLID_BREP\(/g)).toHaveLength(1)
    expect(step.text.match(/=ADVANCED_FACE\(/g)).toHaveLength(6)
    expect(step.text.match(/=PLANE\(/g)).toHaveLength(6)
    expect(step.text.match(/=EDGE_CURVE\(/g)).toHaveLength(12)
    expect(step.text).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION(')
    expect(step.text).not.toContain('FACETED_BREP')
    const positions = step.triangles.flat()
    expect(
      [0, 1, 2].map((axis) =>
        Math.min(...positions.map((point) => point[axis])),
      ),
    ).toEqual([-28.625, 8.25, 90.125])
    expect(
      [0, 1, 2].map((axis) =>
        Math.max(...positions.map((point) => point[axis])),
      ),
    ).toEqual([-21.375, 19.75, 109.875])
    expect(geometry.getAttribute('position').array).toEqual(before)
    geometry.dispose()
  })

  it('joins floating point seams while preserving curved polygonal profiles', () => {
    const geometry = new CylinderGeometry(5, 7, 12, 16).toNonIndexed()
    const step = inspectStep(exportStep(geometry, 'knob.stp'))
    expect(step.triangles).toHaveLength(60)
    const expectedVolume =
      (12 / 3) * (25 + 35 + 49) * ((16 * Math.sin((2 * Math.PI) / 16)) / 2)
    expect(step.volume).toBeCloseTo(expectedVolume, 3)
    expect(step.text.match(/=CLOSED_SHELL\(/g)).toHaveLength(1)
    geometry.dispose()
  })

  it('keeps disconnected solid components in separate closed shells', () => {
    const first = new BoxGeometry(1, 2, 3)
    const second = new BoxGeometry(2, 3, 4).translate(10, 0, 0)
    const geometry = mergeGeometries([first, second])
    const step = inspectStep(exportStep(geometry, 'two-solids.stp'))
    expect(step.text.match(/=CLOSED_SHELL\(/g)).toHaveLength(2)
    expect(step.text.match(/=MANIFOLD_SOLID_BREP\(/g)).toHaveLength(2)
    expect(step.volume).toBeCloseTo(30, 7)
    first.dispose()
    second.dispose()
    geometry.dispose()
  })

  it('exports enclosed cavities as reversed void shells, preserving empty space', () => {
    const outside = new BoxGeometry(10, 10, 10).toNonIndexed()
    const inside = new BoxGeometry(4, 4, 4).toNonIndexed()
    const attribute = inside.getAttribute('position')
    for (let i = 0; i < attribute.count; i += 3) {
      const point = [
        attribute.getX(i + 1),
        attribute.getY(i + 1),
        attribute.getZ(i + 1),
      ]
      attribute.setXYZ(
        i + 1,
        attribute.getX(i + 2),
        attribute.getY(i + 2),
        attribute.getZ(i + 2),
      )
      attribute.setXYZ(i + 2, ...(point as Point))
    }
    const geometry = mergeGeometries([outside, inside])
    const step = inspectStep(exportStep(geometry, 'hollow.stp'))
    expect(step.text.match(/=CLOSED_SHELL\(/g)).toHaveLength(2)
    expect(step.text).toMatch(/ORIENTED_CLOSED_SHELL\('',\*,#\d+,.F.\)/)
    expect(step.text).toMatch(/=BREP_WITH_VOIDS\('hollow.stp',#\d+,\(#\d+\)\)/)
    expect(step.text).toContain('=ADVANCED_BREP_SHAPE_REPRESENTATION(')
    expect(step.text).not.toContain('FACETED_BREP_SHAPE_REPRESENTATION(')
    // Both base shells enclose positive volume; STEP reverses only the cavity.
    expect(step.volume).toBeCloseTo(1064, 7)
    expect(step.solidVolume).toBeCloseTo(936, 7)
    outside.dispose()
    inside.dispose()
    geometry.dispose()
  })

  it('preserves through holes when planar triangle regions become bounded faces', () => {
    const outline = new Shape()
    outline.moveTo(0, 0)
    outline.lineTo(10, 0)
    outline.lineTo(10, 8)
    outline.lineTo(0, 8)
    outline.closePath()
    const hole = new Path()
    hole.moveTo(3, 2)
    hole.lineTo(3, 6)
    hole.lineTo(7, 6)
    hole.lineTo(7, 2)
    hole.closePath()
    outline.holes.push(hole)
    const geometry = new ExtrudeGeometry(outline, {
      depth: 2,
      bevelEnabled: false,
      steps: 1,
    })
    const step = inspectStep(exportStep(geometry, 'through-hole.stp'))
    expect(step.text.match(/=FACE_BOUND\(/g)).toHaveLength(2)
    expect(step.text.match(/=ADVANCED_FACE\(/g)).toHaveLength(10)
    expect(step.solidVolume).toBeCloseTo((80 - 16) * 2, 7)
    geometry.dispose()
  })

  it('ignores zero-area facets but rejects open surfaces and invalid coordinates', () => {
    const box = new BoxGeometry(1, 1, 1).toNonIndexed()
    const geometry = new BufferGeometry().setAttribute(
      'position',
      new Float32BufferAttribute(
        [...box.getAttribute('position').array, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        3,
      ),
    )
    expect(inspectStep(exportStep(geometry, 'box.stp')).triangles).toHaveLength(
      12,
    )
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    )
    expect(() => exportStep(geometry, 'open.stp')).toThrow('without open edges')
    geometry.getAttribute('position').setX(0, NaN)
    expect(() => exportStep(geometry, 'invalid.stp')).toThrow(
      'invalid coordinates',
    )
    expect(() => exportStep(new BufferGeometry(), 'empty.stp')).toThrow(
      'non-empty triangle mesh',
    )
    box.dispose()
    geometry.dispose()
  })

  it('escapes names without allowing STEP records to be injected', () => {
    const geometry = new BoxGeometry()
    const text = decoder.decode(
      exportStep(geometry, "Speaker's \\ Öffnung\n.stp"),
    )
    expect(text).toContain(
      "Speaker''s \\\\ \\X2\\00D6\\X0\\ffnung\\X2\\000A\\X0\\.stp",
    )
    expect(text.match(/^FILE_NAME\(/gm)).toHaveLength(1)
    geometry.dispose()
  })

  it.each(['s', 'm'] as const)(
    'exports the original speaker %s mesh with consolidated planar faces',
    (model) => {
      const bytes = readFileSync(
        new URL(
          `../../resources/stl-files/cmf-speaker-${model}-3d-printing-panel-original-v1.stl`,
          import.meta.url,
        ),
      )
      const data = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer
      const source = parsePanelGeometry(data, model)
      const geometry = preparePanelExportGeometry(source)
      const text = decoder.decode(exportStep(geometry, `panel-${model}.stp`))
      expect(text.match(/=ADVANCED_FACE\(/g)!.length).toBeLessThan(
        geometry.getAttribute('position').count / 3,
      )
      expect(text).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION(')
      source.dispose()
      geometry.dispose()
    },
  )

  it.each(KNOB_STYLES)(
    'exports customized $label knobs with their mounting geometry',
    ({ id }) => {
      const bytes = readFileSync(
        new URL(
          '../../resources/stl-files/cmf-speaker-sm-3d-printing-knob-original-v1.stl',
          import.meta.url,
        ),
      )
      const data = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer
      const source = parseKnobGeometry(data, id)
      const customized = customizeKnobGeometry(source, {
        style: id,
        height: 20,
        taper: 0.6,
        flutePath: 'spiral',
      })
      const geometry = prepareKnobExportGeometry(customized)
      const text = decoder.decode(exportStep(geometry, `knob-${id}.stp`))
      expect(text.match(/=ADVANCED_FACE\(/g)!.length).toBeGreaterThan(0)
      expect(text.match(/=ADVANCED_FACE\(/g)!.length).toBeLessThanOrEqual(
        geometry.getAttribute('position').count / 3,
      )
      source.dispose()
      customized.dispose()
      geometry.dispose()
    },
  )

  it.each(['s', 'm'] as const)(
    'exports a generated %s panel combining handle studs, depth, grille and halo',
    async (model) => {
      const bytes = readFileSync(
        new URL(
          `../../resources/stl-files/cmf-speaker-${model}-3d-printing-panel-original-v1.stl`,
          import.meta.url,
        ),
      )
      const data = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer
      const source = parsePanelGeometry(data, model)
      const customized = await buildHandledPanelGeometry(
        source,
        model,
        'original',
        2,
        {
          ...getDefaultHandleSettings(model),
          mode: 'custom',
          legoStuds: true,
          height: 48,
          cutout: 'circle',
          holeCount: 3,
          holeWidth: 10,
        },
        normalizeGrilleSettings({
          mode: 'custom',
          extendPattern: true,
          recessDepth: 3,
        }),
        normalizeHaloSettings({
          mode: 'custom',
          cutAngle: 30,
          depth: 28,
          rimHeight: 5,
        }),
      )
      const geometry = preparePanelExportGeometry(customized)
      const text = decoder.decode(exportStep(geometry, `custom-${model}.stp`))
      expect(text.match(/=ADVANCED_FACE\(/g)!.length).toBeGreaterThan(0)
      expect(text.match(/=ADVANCED_FACE\(/g)!.length).toBeLessThanOrEqual(
        geometry.getAttribute('position').count / 3,
      )
      expect(text.match(/=MANIFOLD_SOLID_BREP\(/g)).toHaveLength(1)
      source.dispose()
      customized.dispose()
      geometry.dispose()
    },
    30_000,
  )
})
