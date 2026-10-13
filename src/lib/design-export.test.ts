import { BoxGeometry, CylinderGeometry } from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { describe, expect, it } from 'vitest'
import { DEFAULT_DESIGN, validateDesign, type Design } from './design'
import { buildDesignExport } from './design-export'
import { exportKnobStl, knobFilename } from './knobs'
import { exportPanelStl } from './panels'

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

describe('design export', () => {
  it('packages separate printable parts and complete, reusable color settings', () => {
    const panel = new BoxGeometry(85, 131, 24)
    const knob = new CylinderGeometry(10, 10, 12, 16)
    const design: Design = {
      ...DEFAULT_DESIGN,
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
      handle: { ...DEFAULT_DESIGN.handle, mode: 'custom', height: 32 },
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
    const file = buildDesignExport({ panel, knob, design, target: 'both' })
    expect(file.filename).toBe('cmf-speaker-s-design.zip')
    expect(file.mimeType).toBe('application/zip')
    const entries = readArchive(file.data)
    const panelName =
      'cmf-speaker-s-original-depth-1.2mm-handle-32.0mm-grille-hex-extended.stl'
    const knobName = knobFilename(design.knob)
    expect([...entries.keys()]).toEqual([panelName, knobName, 'design.json'])
    expect(entries.get(panelName)).toEqual(
      new Uint8Array(exportPanelStl(panel)),
    )
    expect(entries.get(knobName)).toEqual(new Uint8Array(exportKnobStl(knob)))
    const settings = JSON.parse(decoder.decode(entries.get('design.json')))
    expect(settings).toMatchObject(design)
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

  it('supports individual STL exports without a ZIP wrapper', () => {
    const panel = new BoxGeometry(85, 225, 29)
    const knob = new CylinderGeometry(10, 10, 12, 16)
    const design: Design = { ...DEFAULT_DESIGN, model: 'm', style: 'custom' }
    const panelFile = buildDesignExport({
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

    const knobFile = buildDesignExport({ panel, knob, design, target: 'knob' })
    expect(knobFile.filename).toBe(knobFilename(design.knob))
    expect(knobFile.mimeType).toBe('model/stl')
    expect(new Uint8Array(knobFile.data)).toEqual(
      new Uint8Array(exportKnobStl(knob)),
    )
    panel.dispose()
    knob.dispose()
  })

  it('names generated halos and retains every halo parameter in the archive', () => {
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
      buildDesignExport({ panel, knob, design, target: 'panel' }).filename,
    ).toBe(filename)
    const entries = readArchive(
      buildDesignExport({ panel, knob, design, target: 'both' }).data,
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
