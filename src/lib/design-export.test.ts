import { readFileSync } from 'node:fs'
import { Box3, BoxGeometry, CylinderGeometry, Vector3 } from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { describe, expect, it } from 'vitest'
import { DEFAULT_DESIGN, validateDesign, type Design } from './design'
import { buildDesignExport } from './design-export'
import { exportKnobStl, knobFilename } from './knobs'
import { exportPanelStl } from './panels'
import {
  exportPowerButtonStl,
  parsePowerButtonGeometry,
  powerButtonFilename,
} from './power-button'
import { STEP_TOLERANCE_MM } from './step-settings'

const decoder = new TextDecoder()

function powerButtonFixture() {
  const source = readFileSync(
    new URL(
      '../../resources/stl-files/cmf-speaker-sm-3d-printing-power-button-original-v1.stl',
      import.meta.url,
    ),
  )
  return parsePowerButtonGeometry(
    source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength,
    ),
  )
}

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

function expectStepMatchesStl(
  step: ArrayBuffer,
  stl: ArrayBuffer,
  tolerance = 0.00001,
) {
  const actual = readStepBounds(step)
  const geometry = new STLLoader().parse(stl)
  geometry.computeBoundingBox()
  const expected = geometry.boundingBox!
  for (const axis of ['x', 'y', 'z'] as const) {
    expect(Math.abs(actual.min[axis] - expected.min[axis])).toBeLessThanOrEqual(
      tolerance,
    )
    expect(Math.abs(actual.max[axis] - expected.max[axis])).toBeLessThanOrEqual(
      tolerance,
    )
  }
  expect(Math.abs(actual.min.z)).toBeLessThanOrEqual(tolerance)
  geometry.dispose()
}

describe('design export', async () => {
  it.each(['stl', 'stp'] as const)(
    'names enabled race stripes in %s exports and retains all stripe settings in ZIPs',
    async (format) => {
      const panel = new BoxGeometry(85, 131, 24)
      const knob = new CylinderGeometry(10, 10, 12, 16)
      const powerButton = powerButtonFixture()
      try {
        for (const [enabled, count, suffix] of [
          [true, 1, '-race-stripes-1x8.0mm'],
          [true, 3, '-race-stripes-3x8.0mm-gap-5.0mm'],
          [false, 3, ''],
        ] as const) {
          const design = validateDesign({
            ...DEFAULT_DESIGN,
            raceStripes: { enabled, count, width: 8, gap: 5 },
          })
          const filename = `cmf-speaker-s-original${suffix}.${format}`
          const file = await buildDesignExport({
            panel,
            knob,
            powerButton,
            design,
            target: 'panel',
            format,
          })
          expect(file.filename).toBe(filename)
          const archive = await buildDesignExport({
            panel,
            knob,
            powerButton,
            design,
            target: 'all',
            format,
          })
          const entries = readArchive(archive.data)
          expect(entries.has(filename)).toBe(true)
          const settings = JSON.parse(
            decoder.decode(entries.get('design.json')),
          )
          expect(settings.raceStripes).toEqual(design.raceStripes)
          expect(settings.export.files.panel).toBe(filename)
          expect(validateDesign(settings)).toEqual(design)
        }
      } finally {
        panel.dispose()
        knob.dispose()
        powerButton.dispose()
      }
    },
  )

  it('packages separate printable parts and complete, reusable color settings', async () => {
    const panel = new BoxGeometry(85, 131, 24)
    const knob = new CylinderGeometry(10, 10, 12, 16)
    const powerButton = powerButtonFixture()
    const design: Design = {
      ...DEFAULT_DESIGN,
      bodyColor: 'gray',
      panelColor: '#123456',
      knobColor: '#abcdef',
      powerButtonColor: '#c41f82',
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
      panelGap: 3.5,
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
    const powerButtonBefore = powerButton.getAttribute('position').array.slice()
    const file = await buildDesignExport({
      panel,
      knob,
      powerButton,
      design,
      target: 'all',
    })
    expect(file.filename).toBe('cmf-speaker-s-design.zip')
    expect(file.mimeType).toBe('application/zip')
    const entries = readArchive(file.data)
    const panelName =
      'cmf-speaker-s-original-depth-1.2mm-sides-7.5mm-gap-3.5mm-handle-32.0mm-lego-studs-grille-hex-extended.stl'
    const knobName = knobFilename(design.knob)
    const powerButtonName = powerButtonFilename()
    expect([...entries.keys()]).toEqual([
      panelName,
      knobName,
      powerButtonName,
      'design.json',
    ])
    expect(entries.get(panelName)).toEqual(
      new Uint8Array(exportPanelStl(panel)),
    )
    expect(entries.get(knobName)).toEqual(new Uint8Array(exportKnobStl(knob)))
    expect(entries.get(powerButtonName)).toEqual(
      new Uint8Array(exportPowerButtonStl(powerButton)),
    )
    const settings = JSON.parse(decoder.decode(entries.get('design.json')))
    expect(settings).toMatchObject(design)
    expect(settings.bodyColor).toBe('gray')
    expect(settings.handle.legoStuds).toBe(true)
    expect(settings.knob).not.toHaveProperty('diameter')
    expect(settings.knob).not.toHaveProperty('rotation')
    expect(settings.export.units).toBe('mm')
    expect(settings.export.files).toEqual({
      panel: panelName,
      knob: knobName,
      powerButton: powerButtonName,
    })
    expect(settings.export.colorNote).toContain('geometry only')
    expect(settings.export.colorNote).toContain('powerButtonColor')
    expect(validateDesign(settings)).toEqual(validateDesign(design))

    // Each part has its own print-bed origin and the preview meshes stay intact.
    for (const filename of [panelName, knobName, powerButtonName]) {
      const data = entries.get(filename)!
      const geometry = new STLLoader().parse(data.buffer as ArrayBuffer)
      geometry.computeBoundingBox()
      expect(geometry.boundingBox!.min.z).toBeCloseTo(0, 5)
      geometry.dispose()
    }
    expect(panel.getAttribute('position').array).toEqual(panelBefore)
    expect(knob.getAttribute('position').array).toEqual(knobBefore)
    expect(powerButton.getAttribute('position').array).toEqual(
      powerButtonBefore,
    )
    panel.dispose()
    knob.dispose()
    powerButton.dispose()
  })

  it('supports individual STL exports without a ZIP wrapper', async () => {
    const panel = new BoxGeometry(85, 225, 29)
    const knob = new CylinderGeometry(10, 10, 12, 16)
    const powerButton = powerButtonFixture()
    const design: Design = { ...DEFAULT_DESIGN, model: 'm', style: 'custom' }
    const panelFile = await buildDesignExport({
      panel,
      knob,
      powerButton,
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
      powerButton,
      design,
      target: 'knob',
    })
    expect(knobFile.filename).toBe(knobFilename(design.knob))
    expect(knobFile.mimeType).toBe('model/stl')
    expect(new Uint8Array(knobFile.data)).toEqual(
      new Uint8Array(exportKnobStl(knob)),
    )
    const powerButtonFile = await buildDesignExport({
      panel,
      knob,
      powerButton,
      design,
      target: 'power-button',
    })
    expect(powerButtonFile.filename).toBe(powerButtonFilename())
    expect(powerButtonFile.mimeType).toBe('model/stl')
    expect(new Uint8Array(powerButtonFile.data)).toEqual(
      new Uint8Array(exportPowerButtonStl(powerButton)),
    )
    panel.dispose()
    knob.dispose()
    powerButton.dispose()
  })

  it('exports each selected part as STEP in millimeters with the same orientation as STL', async () => {
    const panel = new BoxGeometry(85, 225, 29).translate(14, 6, 31)
    const knob = new CylinderGeometry(10, 7, 12, 16).translate(7, -4, 23)
    const powerButton = powerButtonFixture()
    const design: Design = { ...DEFAULT_DESIGN, model: 'm', style: 'custom' }
    const panelBefore = panel.getAttribute('position').array.slice()
    const knobBefore = knob.getAttribute('position').array.slice()
    const powerButtonBefore = powerButton.getAttribute('position').array.slice()
    const panelIndexBefore = panel.getIndex()!.array.slice()
    const knobIndexBefore = knob.getIndex()!.array.slice()

    const panelFile = await buildDesignExport({
      panel,
      knob,
      powerButton,
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
      powerButton,
      design,
      target: 'knob',
      format: 'stp',
    })
    expect(knobFile.filename).toBe(
      knobFilename(design.knob).replace(/\.stl$/, '.stp'),
    )
    expect(knobFile.mimeType).toBe('model/step')
    expectStepMatchesStl(knobFile.data, exportKnobStl(knob))
    const powerButtonFile = await buildDesignExport({
      panel,
      knob,
      powerButton,
      design,
      target: 'power-button',
      format: 'stp',
    })
    expect(powerButtonFile.filename).toBe(
      powerButtonFilename().replace(/\.stl$/, '.stp'),
    )
    expect(powerButtonFile.mimeType).toBe('model/step')
    expectStepMatchesStl(
      powerButtonFile.data,
      exportPowerButtonStl(powerButton),
      STEP_TOLERANCE_MM,
    )
    expect(panel.getAttribute('position').array).toEqual(panelBefore)
    expect(knob.getAttribute('position').array).toEqual(knobBefore)
    expect(powerButton.getAttribute('position').array).toEqual(
      powerButtonBefore,
    )
    expect(panel.getIndex()!.array).toEqual(panelIndexBefore)
    expect(knob.getIndex()!.array).toEqual(knobIndexBefore)
    panel.dispose()
    knob.dispose()
    powerButton.dispose()
  })

  it('packages STEP parts with their format, geometry type, and reusable settings', async () => {
    const panel = new BoxGeometry(85, 131, 48)
    const knob = new CylinderGeometry(10, 7, 12, 16)
    const powerButton = powerButtonFixture()
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
      powerButton,
      design,
      target: 'all',
      format: 'stp',
    })
    expect(file.filename).toBe('cmf-speaker-s-design-stp.zip')
    expect(file.mimeType).toBe('application/zip')
    const entries = readArchive(file.data)
    const panelName =
      'cmf-speaker-s-original-depth-1.2mm-handle-32.0mm-lego-studs-grille-hex-extended-halo-30.0mm-cut-45.0deg.stp'
    const knobName = knobFilename(design.knob).replace(/\.stl$/, '.stp')
    const powerButtonName = powerButtonFilename().replace(/\.stl$/, '.stp')
    expect([...entries.keys()]).toEqual([
      panelName,
      knobName,
      powerButtonName,
      'design.json',
    ])
    expectStepMatchesStl(
      entries.get(panelName)!.buffer as ArrayBuffer,
      exportPanelStl(panel),
    )
    expectStepMatchesStl(
      entries.get(knobName)!.buffer as ArrayBuffer,
      exportKnobStl(knob),
    )
    expectStepMatchesStl(
      entries.get(powerButtonName)!.buffer as ArrayBuffer,
      exportPowerButtonStl(powerButton),
      STEP_TOLERANCE_MM,
    )
    const settings = JSON.parse(decoder.decode(entries.get('design.json')))
    expect(settings).toMatchObject(design)
    expect(settings.handle.legoStuds).toBe(true)
    expect(settings.export).toMatchObject({
      format: 'stp',
      geometryType: 'advanced-brep',
      toleranceMm: STEP_TOLERANCE_MM,
      units: 'mm',
      files: { panel: panelName, knob: knobName, powerButton: powerButtonName },
    })
    expect(validateDesign(settings)).toEqual(design)
    panel.dispose()
    knob.dispose()
    powerButton.dispose()
  })

  it.each(['stl', 'stp'] as const)(
    'names active handle profiles and studs in %s exports and preserves their settings in ZIPs',
    async (format) => {
      const panel = new BoxGeometry(85, 131, 24)
      const knob = new CylinderGeometry(10, 10, 12, 16)
      const powerButton = powerButtonFixture()
      for (const [mode, legoStuds, topShape, topAngle, topCurve, suffix] of [
        ['custom', true, 'straight', 0, 10, '-handle-32.0mm-lego-studs'],
        ['custom', false, 'straight', 0, 10, '-handle-32.0mm'],
        ['original', true, 'outward', 5, 5, ''],
        ['custom', false, 'straight', 5, 10, '-handle-32.0mm-top-5.0deg'],
        [
          'custom',
          false,
          'outward',
          5,
          5,
          '-handle-32.0mm-top-5.0deg-outward-5.0mm',
        ],
        [
          'custom',
          false,
          'inward',
          -5,
          5,
          '-handle-32.0mm-top--5.0deg-inward-5.0mm',
        ],
      ] as const) {
        const design = validateDesign({
          ...DEFAULT_DESIGN,
          handle: {
            ...DEFAULT_DESIGN.handle,
            mode,
            height: 32,
            legoStuds,
            topShape,
            topAngle,
            topCurve,
          },
        })
        const filename = `cmf-speaker-s-original${suffix}.${format}`
        const file = await buildDesignExport({
          panel,
          knob,
          powerButton,
          design,
          target: 'panel',
          format,
        })
        expect(file.filename).toBe(filename)
        const archive = await buildDesignExport({
          panel,
          knob,
          powerButton,
          design,
          target: 'all',
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
      powerButton.dispose()
    },
  )

  it('names generated halos and retains every halo parameter in the archive', async () => {
    const panel = new BoxGeometry(85, 131, 48)
    const knob = new CylinderGeometry(10, 10, 12, 16)
    const powerButton = powerButtonFixture()
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
        waveShape: 'sine',
        waveAmplitude: 4,
        waveFrequency: 3.25,
        wavePhase: 90,
        waveSeamless: true,
      },
    })
    const filename =
      'cmf-speaker-s-original-halo-30.0mm-cut-45.0deg-wave-sine-4.0mm-3cycles-90.0deg.stl'
    expect(
      (
        await buildDesignExport({
          panel,
          knob,
          powerButton,
          design,
          target: 'panel',
        })
      ).filename,
    ).toBe(filename)
    const entries = readArchive(
      (
        await buildDesignExport({
          panel,
          knob,
          powerButton,
          design,
          target: 'all',
        })
      ).data,
    )
    expect(entries.get(filename)).toEqual(new Uint8Array(exportPanelStl(panel)))
    const restored = validateDesign(
      JSON.parse(decoder.decode(entries.get('design.json'))),
    )
    expect(restored).toEqual(design)
    panel.dispose()
    knob.dispose()
    powerButton.dispose()
  })
})
