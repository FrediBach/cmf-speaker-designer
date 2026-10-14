import { Box3, BoxGeometry, CylinderGeometry, Vector3 } from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { describe, expect, it } from 'vitest'
import { DEFAULT_DESIGN, validateDesign, type Design } from './design'
import { buildDesignExport } from './design-export'
import { exportKnobStl, knobFilename } from './knobs'
import { exportPanelStl } from './panels'
import { STEP_TOLERANCE_MM } from './step-settings'

const decoder = new TextDecoder()

/** Independent bitwise CRC verifies the ZIP's stored payloads and headers. */
function checksum(bytes: Uint8Array) {
  let value = -1
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit += 1)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ -1) >>> 0
}

function readArchive(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  const end = buffer.byteLength - 22
  expect(view.getUint32(end, true)).toBe(0x06054b50)
  expect(view.getUint16(end + 4, true)).toBe(0)
  expect(view.getUint16(end + 6, true)).toBe(0)
  const fileCount = view.getUint16(end + 10, true)
  expect(view.getUint16(end + 8, true)).toBe(fileCount)
  expect(view.getUint16(end + 20, true)).toBe(0)
  const directoryOffset = view.getUint32(end + 16, true)
  expect(directoryOffset + view.getUint32(end + 12, true)).toBe(end)
  let central = directoryOffset
  let nextLocal = 0
  const entries = new Map<string, Uint8Array>()
  for (let index = 0; index < fileCount; index += 1) {
    expect(view.getUint32(central, true)).toBe(0x02014b50)
    expect(view.getUint16(central + 10, true)).toBe(0)
    const local = view.getUint32(central + 42, true)
    expect(local).toBe(nextLocal)
    expect(view.getUint32(local, true)).toBe(0x04034b50)
    expect(view.getUint16(local + 8, true)).toBe(0)
    expect(view.getUint16(local + 6, true)).toBe(0x0800)
    const length = view.getUint32(central + 24, true)
    expect(view.getUint32(central + 20, true)).toBe(length)
    expect(view.getUint32(local + 18, true)).toBe(length)
    expect(view.getUint32(local + 22, true)).toBe(length)
    const nameLength = view.getUint16(central + 28, true)
    const name = decoder.decode(
      new Uint8Array(buffer, central + 46, nameLength),
    )
    expect(view.getUint16(local + 26, true)).toBe(nameLength)
    expect(decoder.decode(new Uint8Array(buffer, local + 30, nameLength))).toBe(
      name,
    )
    const payloadOffset =
      local + 30 + nameLength + view.getUint16(local + 28, true)
    const bytes = new Uint8Array(
      buffer.slice(payloadOffset, payloadOffset + length),
    )
    expect(view.getUint32(central + 16, true)).toBe(checksum(bytes))
    expect(view.getUint32(local + 14, true)).toBe(checksum(bytes))
    expect(entries.has(name)).toBe(false)
    entries.set(name, bytes)
    nextLocal = payloadOffset + length
    central +=
      46 +
      nameLength +
      view.getUint16(central + 30, true) +
      view.getUint16(central + 32, true)
  }
  expect(nextLocal).toBe(directoryOffset)
  expect(central).toBe(end)
  return entries
}

/** Read only facet vertices, excluding the STEP representation's placement. */
function readStepBounds(buffer: ArrayBuffer) {
  const source = decoder.decode(buffer)
  expect(source.trimStart()).toMatch(/^ISO-10303-21;/)
  expect(source.trimEnd()).toMatch(/END-ISO-10303-21;$/)
  expect(source).toMatch(/SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/)
  expect(source).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION')
  expect(source).toContain('ADVANCED_FACE')
  expect(source).toContain('CLOSED_SHELL')

  const points = new Map<string, Vector3>()
  for (const match of source.matchAll(
    /#(\d+)\s*=\s*CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(([^)]+)\)\s*\)/g,
  )) {
    const coordinates = match[2].split(',').map(Number)
    expect(coordinates).toHaveLength(3)
    expect(coordinates.every(Number.isFinite)).toBe(true)
    points.set(
      match[1],
      new Vector3(...(coordinates as [number, number, number])),
    )
  }
  const bounds = new Box3()
  let vertexCount = 0
  for (const vertex of source.matchAll(/VERTEX_POINT\('',#(\d+)\)/g)) {
    const point = points.get(vertex[1])
    expect(point).toBeDefined()
    bounds.expandByPoint(point!)
    vertexCount += 1
  }
  expect(vertexCount).toBeGreaterThan(0)
  return bounds
}

function expectStepMatchesStl(step: ArrayBuffer, stl: ArrayBuffer) {
  const actual = readStepBounds(step)
  const geometry = new STLLoader().parse(stl)
  geometry.computeBoundingBox()
  const expected = geometry.boundingBox!
  for (const axis of ['x', 'y', 'z'] as const) {
    expect(actual.min[axis]).toBeCloseTo(expected.min[axis], 5)
    expect(actual.max[axis]).toBeCloseTo(expected.max[axis], 5)
  }
  expect(actual.min.z).toBeCloseTo(0, 5)
  geometry.dispose()
}

describe('design export', async () => {
  it('packages separate printable parts and complete, reusable color settings', async () => {
    const panel = new BoxGeometry(85, 131, 24)
    const knob = new CylinderGeometry(10, 10, 12, 16)
    const design: Design = {
      ...DEFAULT_DESIGN,
      bodyColor: 'gray',
      panelColor: '#123456',
      knobColor: '#abcdef',
      knob: {
        ...DEFAULT_DESIGN.knob,
        style: 'fluted',
        height: 16,
        taper: 0.6,
        fluteCount: 18,
        fluteDepth: 0.8,
        flutePath: 'spiral',
        facets: 8,
      },
      relief: 1.2,
      panelExtension: 7.5,
      handle: {
        ...DEFAULT_DESIGN.handle,
        mode: 'custom',
        height: 32,
        legoStuds: true,
      },
      grille: {
        ...DEFAULT_DESIGN.grille,
        mode: 'custom',
        pattern: 'hex',
        extendPattern: true,
      },
      // A custom grille always starts with the original panel source.
      style: 'custom',
    }
    const panelBefore = panel.getAttribute('position').array.slice()
    const knobBefore = knob.getAttribute('position').array.slice()
    const file = await buildDesignExport({
      panel,
      knob,
      design,
      target: 'both',
    })
    expect(file.filename).toBe('cmf-speaker-s-design.zip')
    expect(file.mimeType).toBe('application/zip')
    const entries = readArchive(file.data)
    const panelName =
      'cmf-speaker-s-original-depth-1.2mm-sides-7.5mm-handle-32.0mm-lego-studs-grille-hex-extended.stl'
    const knobName = knobFilename(design.knob)
    expect([...entries.keys()]).toEqual([panelName, knobName, 'design.json'])
    expect(entries.get(panelName)).toEqual(
      new Uint8Array(exportPanelStl(panel)),
    )
    expect(entries.get(knobName)).toEqual(new Uint8Array(exportKnobStl(knob)))
    const settings = JSON.parse(decoder.decode(entries.get('design.json')))
    expect(settings).toMatchObject(design)
    expect(settings.bodyColor).toBe('gray')
    expect(settings.handle.legoStuds).toBe(true)
    expect(settings.knob).not.toHaveProperty('diameter')
    expect(settings.knob).not.toHaveProperty('rotation')
    expect(settings.export.units).toBe('mm')
    expect(settings.export.files).toEqual({ panel: panelName, knob: knobName })
    expect(settings.export.colorNote).toContain('geometry only')
    expect(validateDesign(settings)).toEqual(validateDesign(design))

    // Each part has its own print-bed origin and the preview meshes stay intact.
    for (const filename of [panelName, knobName]) {
      const data = entries.get(filename)!
      const geometry = new STLLoader().parse(data.buffer as ArrayBuffer)
      geometry.computeBoundingBox()
      expect(geometry.boundingBox!.min.z).toBeCloseTo(0, 5)
      geometry.dispose()
    }
    expect(panel.getAttribute('position').array).toEqual(panelBefore)
    expect(knob.getAttribute('position').array).toEqual(knobBefore)
    panel.dispose()
    knob.dispose()
  })

  it('supports individual STL exports without a ZIP wrapper', async () => {
    const panel = new BoxGeometry(85, 225, 29)
    const knob = new CylinderGeometry(10, 10, 12, 16)
    const design: Design = { ...DEFAULT_DESIGN, model: 'm', style: 'custom' }
    const panelFile = await buildDesignExport({
      panel,
      knob,
      design,
      target: 'panel',
    })
    expect(panelFile.filename).toBe('cmf-speaker-m-original.stl')
    expect(panelFile.mimeType).toBe('model/stl')
    expect(new Uint8Array(panelFile.data)).toEqual(
      new Uint8Array(exportPanelStl(panel)),
    )

    const knobFile = await buildDesignExport({
      panel,
      knob,
      design,
      target: 'knob',
    })
    expect(knobFile.filename).toBe(knobFilename(design.knob))
    expect(knobFile.mimeType).toBe('model/stl')
    expect(new Uint8Array(knobFile.data)).toEqual(
      new Uint8Array(exportKnobStl(knob)),
    )
    panel.dispose()
    knob.dispose()
  })

  it('exports each selected part as STEP in millimeters with the same orientation as STL', async () => {
    const panel = new BoxGeometry(85, 225, 29).translate(14, 6, 31)
    const knob = new CylinderGeometry(10, 7, 12, 16).translate(7, -4, 23)
    const design: Design = { ...DEFAULT_DESIGN, model: 'm', style: 'custom' }
    const panelBefore = panel.getAttribute('position').array.slice()
    const knobBefore = knob.getAttribute('position').array.slice()
    const panelIndexBefore = panel.getIndex()!.array.slice()
    const knobIndexBefore = knob.getIndex()!.array.slice()

    const panelFile = await buildDesignExport({
      panel,
      knob,
      design,
      target: 'panel',
      format: 'stp',
    })
    expect(panelFile.filename).toBe('cmf-speaker-m-original.stp')
    expect(panelFile.mimeType).toBe('model/step')
    expectStepMatchesStl(panelFile.data, exportPanelStl(panel))

    const knobFile = await buildDesignExport({
      panel,
      knob,
      design,
      target: 'knob',
      format: 'stp',
    })
    expect(knobFile.filename).toBe(
      knobFilename(design.knob).replace(/\.stl$/, '.stp'),
    )
    expect(knobFile.mimeType).toBe('model/step')
    expectStepMatchesStl(knobFile.data, exportKnobStl(knob))
    expect(panel.getAttribute('position').array).toEqual(panelBefore)
    expect(knob.getAttribute('position').array).toEqual(knobBefore)
    expect(panel.getIndex()!.array).toEqual(panelIndexBefore)
    expect(knob.getIndex()!.array).toEqual(knobIndexBefore)
    panel.dispose()
    knob.dispose()
  })

  it('packages STEP parts with their format, geometry type, and reusable settings', async () => {
    const panel = new BoxGeometry(85, 131, 48)
    const knob = new CylinderGeometry(10, 7, 12, 16)
    const design = validateDesign({
      ...DEFAULT_DESIGN,
      bodyColor: 'gray',
      panelColor: '#123456',
      knobColor: '#abcdef',
      style: 'custom',
      relief: 1.2,
      knob: { ...DEFAULT_DESIGN.knob, style: 'hex', facets: 8, height: 16 },
      handle: {
        ...DEFAULT_DESIGN.handle,
        mode: 'custom',
        height: 32,
        legoStuds: true,
      },
      grille: {
        ...DEFAULT_DESIGN.grille,
        mode: 'custom',
        pattern: 'hex',
        extendPattern: true,
      },
      halo: {
        mode: 'custom',
        outwardAngle: 20,
        depth: 30,
        thickness: 3.2,
        cutAngle: 45,
        cutRotation: 180,
        rimHeight: 3,
      },
    })
    const file = await buildDesignExport({
      panel,
      knob,
      design,
      target: 'both',
      format: 'stp',
    })
    expect(file.filename).toBe('cmf-speaker-s-design-stp.zip')
    expect(file.mimeType).toBe('application/zip')
    const entries = readArchive(file.data)
    const panelName =
      'cmf-speaker-s-original-depth-1.2mm-handle-32.0mm-lego-studs-grille-hex-extended-halo-30.0mm-cut-45.0deg.stp'
    const knobName = knobFilename(design.knob).replace(/\.stl$/, '.stp')
    expect([...entries.keys()]).toEqual([panelName, knobName, 'design.json'])
    expectStepMatchesStl(
      entries.get(panelName)!.buffer as ArrayBuffer,
      exportPanelStl(panel),
    )
    expectStepMatchesStl(
      entries.get(knobName)!.buffer as ArrayBuffer,
      exportKnobStl(knob),
    )
    const settings = JSON.parse(decoder.decode(entries.get('design.json')))
    expect(settings).toMatchObject(design)
    expect(settings.handle.legoStuds).toBe(true)
    expect(settings.export).toMatchObject({
      format: 'stp',
      geometryType: 'advanced-brep',
      toleranceMm: STEP_TOLERANCE_MM,
      units: 'mm',
      files: { panel: panelName, knob: knobName },
    })
    expect(validateDesign(settings)).toEqual(design)
    panel.dispose()
    knob.dispose()
  })

  it.each(['stl', 'stp'] as const)(
    'names studs only on custom handles in %s exports and preserves disabled settings in ZIPs',
    async (format) => {
      const panel = new BoxGeometry(85, 131, 24)
      const knob = new CylinderGeometry(10, 10, 12, 16)
      for (const [mode, legoStuds, suffix] of [
        ['custom', true, '-handle-32.0mm-lego-studs'],
        ['custom', false, '-handle-32.0mm'],
        ['original', true, ''],
      ] as const) {
        const design = validateDesign({
          ...DEFAULT_DESIGN,
          handle: { ...DEFAULT_DESIGN.handle, mode, height: 32, legoStuds },
        })
        const filename = `cmf-speaker-s-original${suffix}.${format}`
        const file = await buildDesignExport({
          panel,
          knob,
          design,
          target: 'panel',
          format,
        })
        expect(file.filename).toBe(filename)
        const archive = await buildDesignExport({
          panel,
          knob,
          design,
          target: 'both',
          format,
        })
        const entries = readArchive(archive.data)
        expect(entries.has(filename)).toBe(true)
        const settings = JSON.parse(decoder.decode(entries.get('design.json')))
        expect(settings.handle).toEqual(design.handle)
        expect(settings.export.files.panel).toBe(filename)
        expect(validateDesign(settings)).toEqual(design)
      }
      panel.dispose()
      knob.dispose()
    },
  )

  it('names generated halos and retains every halo parameter in the archive', async () => {
    const panel = new BoxGeometry(85, 131, 48)
    const knob = new CylinderGeometry(10, 10, 12, 16)
    const design = validateDesign({
      ...DEFAULT_DESIGN,
      style: 'custom',
      halo: {
        mode: 'custom',
        outwardAngle: 20,
        depth: 30,
        thickness: 3.2,
        cutAngle: 45,
        cutRotation: 180,
        rimHeight: 3,
      },
    })
    const filename = 'cmf-speaker-s-original-halo-30.0mm-cut-45.0deg.stl'
    expect(
      (await buildDesignExport({ panel, knob, design, target: 'panel' }))
        .filename,
    ).toBe(filename)
    const entries = readArchive(
      (await buildDesignExport({ panel, knob, design, target: 'both' })).data,
    )
    expect(entries.get(filename)).toEqual(new Uint8Array(exportPanelStl(panel)))
    const restored = validateDesign(
      JSON.parse(decoder.decode(entries.get('design.json'))),
    )
    expect(restored).toEqual(design)
    panel.dispose()
    knob.dispose()
  })
})
