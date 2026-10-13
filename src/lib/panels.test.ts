import { readFileSync } from 'node:fs'
import { BufferGeometry } from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { describe, expect, it } from 'vitest'
import {
  buildPanelGeometry,
  exportPanelStl,
  getPanelDimensions,
  getPanelStyles,
  PANEL_ASSETS,
  panelFilename,
  parsePanelGeometry,
  type PanelStyle,
  type SpeakerModel,
} from './panels'

const fixtures: [SpeakerModel, PanelStyle, number, number][] = [
  ['s', 'original', 168472, 24],
  ['m', 'original', 200022, 29],
]

function readPanel(model: SpeakerModel, style: PanelStyle) {
  const bytes = readFileSync(
    new URL(
      `../../resources/stl-files/cmf-speaker-${model}-3d-printing-panel-${style}-v1.stl`,
      import.meta.url,
    ),
  )
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return parsePanelGeometry(buffer, model)
}

/** A closed, consistently wound mesh uses every directed edge once each way. */
function inspectMesh(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position')
  const vertices = new Map<string, number>()
  const indices: number[] = []
  let volume = 0
  for (let i = 0; i < position.count; i += 1) {
    const point = [position.getX(i), position.getY(i), position.getZ(i)]
    if (!point.every(Number.isFinite))
      throw new Error('Non-finite mesh coordinates')
    const key = point.join(',')
    let index = vertices.get(key)
    if (index === undefined) {
      index = vertices.size
      vertices.set(key, index)
    }
    indices.push(index)
    if (i % 3 === 0) {
      const ax = position.getX(i),
        ay = position.getY(i),
        az = position.getZ(i)
      const bx = position.getX(i + 1),
        by = position.getY(i + 1),
        bz = position.getZ(i + 1)
      const cx = position.getX(i + 2),
        cy = position.getY(i + 2),
        cz = position.getZ(i + 2)
      volume +=
        (ax * (by * cz - bz * cy) -
          ay * (bx * cz - bz * cx) +
          az * (bx * cy - by * cx)) /
        6
    }
  }
  const edges = new Map<number, number>()
  for (let i = 0; i < indices.length; i += 3) {
    for (let corner = 0; corner < 3; corner += 1) {
      const a = indices[i + corner]
      const b = indices[i + ((corner + 1) % 3)]
      if (a === b) throw new Error('Collapsed mesh edge')
      const key = Math.min(a, b) * vertices.size + Math.max(a, b)
      edges.set(key, (edges.get(key) ?? 0) + (a < b ? 11 : 9))
    }
  }
  const invalidEdges = [...edges.values()].filter(
    (value) => value !== 20,
  ).length
  return { invalidEdges, volume }
}

describe('official panel geometry and millimeter STL export', () => {
  it.each(fixtures)(
    '%s / %s retains source fit and a closed mesh at maximum face depth',
    (model, style, triangleCount, depth) => {
      const source = readPanel(model, style)
      const dimensions = getPanelDimensions(source)
      expect(source.getAttribute('position').count / 3).toBe(triangleCount)
      expect(dimensions.width).toBeCloseTo(84.9715, 3)
      expect(dimensions.height).toBeCloseTo(
        model === 's' ? 130.9691 : 224.9691,
        3,
      )
      expect(dimensions.depth).toBeCloseTo(depth, 3)
      expect(source.boundingBox!.min.z).toBeCloseTo(
        model === 's' ? -20 : -25,
        3,
      )

      const originalStats = inspectMesh(source)
      expect(originalStats.invalidEdges).toBe(0)
      expect(originalStats.volume).toBeGreaterThan(0)

      const customized = buildPanelGeometry(source, model, style, 2)
      const positions = source.getAttribute('position')
      const modified = customized.getAttribute('position')
      let protectedVertices = 0
      let changedVertices = 0
      let invalidCoordinates = 0
      for (let i = 0; i < positions.count; i += 1) {
        const z = positions.getZ(i)
        const nextZ = modified.getZ(i)
        const protectedVertex =
          z <= 0.5 || positions.getY(i) >= (model === 's' ? 19 : 57)
        if (
          positions.getX(i) !== modified.getX(i) ||
          positions.getY(i) !== modified.getY(i)
        )
          invalidCoordinates += 1
        if (protectedVertex) {
          protectedVertices += 1
          if (nextZ !== z) invalidCoordinates += 1
        }
        if (nextZ !== z) changedVertices += 1
        if (nextZ < z || nextZ - z > 2.00001) invalidCoordinates += 1
      }
      expect(invalidCoordinates).toBe(0)
      expect(protectedVertices).toBeGreaterThan(1000)
      expect(changedVertices).toBeGreaterThan(1000)
      const customStats = inspectMesh(customized)
      expect(customStats.invalidEdges).toBe(0)
      expect(customStats.volume).toBeGreaterThan(originalStats.volume)

      const binary = exportPanelStl(customized)
      expect(binary.byteLength).toBe(84 + triangleCount * 50)
      const printed = new STLLoader().parse(binary)
      const printedDimensions = getPanelDimensions(printed)
      expect(printed.boundingBox!.min.z).toBeCloseTo(0, 5)
      expect(printedDimensions.width).toBeCloseTo(dimensions.width, 3)
      expect(printedDimensions.height).toBeCloseTo(dimensions.height, 3)
      expect(printedDimensions.depth).toBeCloseTo(
        getPanelDimensions(customized).depth,
        3,
      )
      expect(inspectMesh(printed).invalidEdges).toBe(0)
      printed.dispose()
      customized.dispose()
      source.dispose()
    },
    30_000,
  )

  it('leaves the original mesh unchanged when no material is added', () => {
    const source = readPanel('s', 'original')
    const copy = buildPanelGeometry(source, 's', 'original', 0)
    expect(copy).not.toBe(source)
    expect(copy.getAttribute('position').array).toEqual(
      source.getAttribute('position').array,
    )
    expect(() => buildPanelGeometry(source, 's', 'original', -1)).toThrow(
      RangeError,
    )
    expect(() => buildPanelGeometry(source, 's', 'original', 2.1)).toThrow(
      RangeError,
    )
    expect(() =>
      buildPanelGeometry(source, 's', 'original', Number.NaN),
    ).toThrow(RangeError)
    copy.dispose()
    source.dispose()
  })

  it.each(['s', 'm'] as const)(
    'offers only original and custom modes using the original %s source',
    (model) => {
      expect(
        getPanelStyles(model).map(({ id, label }) => ({ id, label })),
      ).toEqual([
        { id: 'original', label: 'Original' },
        { id: 'custom', label: 'Custom' },
      ])
      expect(Object.keys(PANEL_ASSETS[model])).toEqual(['original', 'custom'])
      expect(PANEL_ASSETS[model].custom).toBe(PANEL_ASSETS[model].original)
      expect(panelFilename(model, 'original')).toBe(
        `cmf-speaker-${model}-original.stl`,
      )
      expect(panelFilename(model, 'custom', 1.2)).toBe(
        `cmf-speaker-${model}-original-depth-1.2mm.stl`,
      )
    },
  )
})
