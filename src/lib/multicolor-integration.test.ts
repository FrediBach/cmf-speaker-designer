import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Box3, Vector3, type BufferGeometry } from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { describe, expect, it } from 'vitest'
import { DEFAULT_DESIGN, validateDesign } from './design'
import { buildDesignExport } from './design-export'
import { getDefaultHandleSettings } from './handle-settings'
import { buildHandledPanelGeometry } from './handles'
import { customizeKnobGeometry, parseKnobGeometry } from './knobs'
import { buildMulticolorGeometry } from './multicolor-client'
import type { MaterialGeometry } from './multicolor-geometry'
import { applyMulticolorPreset } from './multicolor-presets'
import { getDefaultMulticolorSettings } from './multicolor-settings'
import { parsePanelGeometry } from './panels'
import { parsePowerButtonGeometry } from './power-button'

const decoder = new TextDecoder()

function sourceBytes(name: string) {
  const bytes = readFileSync(
    new URL(`../../resources/stl-files/${name}`, import.meta.url),
  )
  const buffer = new ArrayBuffer(bytes.length)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

/** Independent ZIP reader: validates each stored payload against its CRC. */
function archiveEntries(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  const entries = new Map<string, Uint8Array>()
  let offset = 0
  while (view.getUint32(offset, true) === 0x04034b50) {
    expect(view.getUint16(offset + 8, true)).toBe(0)
    const length = view.getUint32(offset + 18, true)
    expect(view.getUint32(offset + 22, true)).toBe(length)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const name = decoder.decode(new Uint8Array(buffer, offset + 30, nameLength))
    const start = offset + 30 + nameLength + extraLength
    const bytes = new Uint8Array(buffer.slice(start, start + length))
    let checksum = -1
    for (const byte of bytes) {
      checksum ^= byte
      for (let bit = 0; bit < 8; bit++)
        checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0)
    }
    expect((checksum ^ -1) >>> 0).toBe(view.getUint32(offset + 14, true))
    expect(entries.has(name)).toBe(false)
    entries.set(name, bytes)
    offset = start + length
  }
  expect(view.getUint32(offset, true)).toBe(0x02014b50)
  const end = buffer.byteLength - 22
  expect(view.getUint32(end, true)).toBe(0x06054b50)
  expect(view.getUint16(end + 10, true)).toBe(entries.size)
  expect(view.getUint32(end + 16, true)).toBe(offset)
  return entries
}

const attributes = (text: string) =>
  Object.fromEntries(
    [...text.matchAll(/([\w:]+)="([^"]*)"/g)].map((match) => [
      match[1],
      match[2],
    ]),
  )

function parsedObjects(model: string) {
  return new Map(
    [...model.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)].map(
      (match) => {
        const attrs = attributes(match[1])
        const body = match[2]
        const points = [...body.matchAll(/<vertex\b([^>]*)\/>/g)].map(
          (vertex) => {
            const values = attributes(vertex[1])
            return new Vector3(
              Number(values.x),
              Number(values.y),
              Number(values.z),
            )
          },
        )
        const triangles = [...body.matchAll(/<triangle\b([^>]*)\/>/g)].flatMap(
          (triangle) => {
            const values = attributes(triangle[1])
            return [Number(values.v1), Number(values.v2), Number(values.v3)]
          },
        )
        const components = [...body.matchAll(/<component\b([^>]*)\/>/g)].map(
          (component) => Number(attributes(component[1]).objectid),
        )
        return [
          Number(attrs.id),
          {
            attrs,
            points,
            triangles,
            components,
            bounds: new Box3().setFromPoints(points),
          },
        ] as const
      },
    ),
  )
}

function expectBounds(actual: Box3, expected: Box3) {
  for (const axis of ['x', 'y', 'z'] as const) {
    expect(actual.min[axis]).toBeCloseTo(expected.min[axis], 4)
    expect(actual.max[axis]).toBeCloseTo(expected.max[axis], 4)
  }
}

/** Reproduce the physical rotation mathematically, without export helpers. */
function placedBounds(geometry: BufferGeometry, frontZ: number) {
  const p = geometry.getAttribute('position')
  const bounds = new Box3()
  for (let index = 0; index < p.count; index++)
    bounds.expandByPoint(
      new Vector3(-p.getX(index), p.getY(index), frontZ - p.getZ(index)),
    )
  return bounds
}

const fixtures = [
  { model: 's', preset: 'france', target: 'all', grille: false },
  { model: 'm', preset: 'norway', target: 'panel', grille: false },
  { model: 's', preset: 'united-kingdom', target: 'panel', grille: false },
  { model: 'm', preset: 'rainbow', target: 'panel', grille: false },
  { model: 's', preset: 'japan', target: 'panel', grille: true },
] as const

describe('real-panel multicolor export integration', () => {
  it.each(fixtures)(
    'round-trips Speaker $model $preset through actual 3MF and aligned STL parts',
    async ({ model, preset, target, grille }) => {
      const recipe = applyMulticolorPreset(
        preset,
        getDefaultMulticolorSettings(model),
      )
      const design = validateDesign({
        ...DEFAULT_DESIGN,
        model,
        handle: getDefaultHandleSettings(model),
        multicolor: recipe.settings,
        panelColor: recipe.panelColor,
        powerButtonColor: '#d9277c',
        grille: {
          ...DEFAULT_DESIGN.grille,
          mode: grille ? 'custom' : 'original',
        },
      })
      const source = parsePanelGeometry(
        sourceBytes(`cmf-speaker-${model}-3d-printing-panel-original-v1.stl`),
        model,
      )
      const knobSource = parseKnobGeometry(
        sourceBytes('cmf-speaker-sm-3d-printing-knob-original-v1.stl'),
        design.knob.style,
      )
      const knob = customizeKnobGeometry(knobSource, design.knob)
      const powerButton = parsePowerButtonGeometry(
        sourceBytes('cmf-speaker-sm-3d-printing-power-button-original-v1.stl'),
      )
      let panel: BufferGeometry | undefined
      let parts: MaterialGeometry[] = []
      try {
        panel = await buildHandledPanelGeometry(
          source,
          model,
          'original',
          design.relief,
          design.handle,
          design.grille,
          design.halo,
          design.panelExtension,
          design.panelGap,
          design.raceStripes,
        )
        parts = (await buildMulticolorGeometry(panel, design.multicolor)).parts
        if (preset === 'japan')
          expect(parts.some(({ materialId }) => materialId !== 'base')).toBe(
            true,
          )
        const before = parts.map(
          ({ geometry }) =>
            new Float32Array(geometry.getAttribute('position').array),
        )
        const input = {
          panel,
          knob,
          powerButton,
          design,
          target,
          materialParts: parts,
        }
        const threeMf = await buildDesignExport({ ...input, format: '3mf' })
        const stlZip = await buildDesignExport({
          ...input,
          format: 'stl-parts',
        })
        expect(threeMf.mimeType).toBe('model/3mf')
        expect(stlZip.mimeType).toBe('application/zip')
        const threeEntries = archiveEntries(threeMf.data)
        const stlEntries = archiveEntries(stlZip.data)
        const xml = decoder.decode(threeEntries.get('3D/3dmodel.model'))
        expect(xml).toContain('unit="millimeter"')
        expect(xml).toContain(
          'http://schemas.microsoft.com/3dmanufacturing/core/2015/02',
        )
        expect(decoder.decode(threeEntries.get('_rels/.rels'))).toContain(
          'Target="/3D/3dmodel.model"',
        )
        expect(
          decoder.decode(threeEntries.get('[Content_Types].xml')),
        ).toContain('application/vnd.ms-package.3dmanufacturing-3dmodel+xml')
        const threeDesign = JSON.parse(
          decoder.decode(threeEntries.get('Metadata/design.json')),
        )
        const zipDesign = JSON.parse(
          decoder.decode(stlEntries.get('design.json')),
        )
        expect(validateDesign(threeDesign)).toEqual(design)
        expect(validateDesign(zipDesign)).toEqual(design)
        expect(threeDesign.export).toMatchObject({
          units: 'mm',
          mapping: 'front-projection',
          depthMode: 'full-depth',
        })
        const materialMetadata = JSON.parse(
          decoder.decode(threeEntries.get('Metadata/materials.json')),
        ) as {
          units: string
          objects: {
            materialId: string
            objectId: number
            name: string
            color: string
            assembly: string
          }[]
        }
        const stlMetadata = JSON.parse(
          decoder.decode(stlEntries.get('materials.json')),
        ) as {
          units: string
          parts: {
            materialId: string
            file: string
            name: string
            color: string
            assembly: string
          }[]
        }
        const expectedPartCount = parts.length + (target === 'all' ? 2 : 0)
        expect(materialMetadata.units).toBe('mm')
        expect(stlMetadata.units).toBe('mm')
        expect(materialMetadata.objects).toHaveLength(expectedPartCount)
        expect(stlMetadata.parts).toHaveLength(expectedPartCount)
        expect(
          [...stlEntries.keys()].filter((name) => name.endsWith('.stl')),
        ).toHaveLength(expectedPartCount)
        expect(zipDesign.export.files).toEqual(stlMetadata.parts)
        const objects = parsedObjects(xml)
        const buildIds = [...xml.matchAll(/<item\b([^>]*)\/>/g)].map((item) =>
          Number(attributes(item[1]).objectid),
        )
        expect(buildIds).toHaveLength(target === 'all' ? 3 : 1)
        expect(objects.get(buildIds[0])!.components).toHaveLength(parts.length)
        expect(objects.size).toBe(expectedPartCount + buildIds.length)
        const bases = [...xml.matchAll(/<base\b([^>]*)\/>/g)].map((base) =>
          attributes(base[1]),
        )
        expect(bases).toHaveLength(expectedPartCount)
        panel.computeBoundingBox()
        const frontZ = panel.boundingBox!.max.z
        const assembledBounds = new Box3()
        let raisedMaterial = false
        for (const [index, part] of parts.entries()) {
          const material = materialMetadata.objects.find(
            (entry) => entry.materialId === part.materialId,
          )!
          const fallback = stlMetadata.parts.find(
            (entry) => entry.materialId === part.materialId,
          )!
          expect(material).toBeDefined()
          expect(fallback).toBeDefined()
          expect(fallback).toMatchObject({
            color: material.color,
            name: material.name,
            assembly: material.assembly,
          })
          const object = objects.get(material.objectId)!
          expect(objects.get(buildIds[0])!.components).toContain(
            material.objectId,
          )
          expect(object.attrs.pid).toBe('1')
          expect(bases[Number(object.attrs.pindex)].displaycolor).toBe(
            `${material.color.toUpperCase()}FF`,
          )
          expect(object.triangles).toEqual(
            Array.from(part.geometry.index!.array),
          )
          expect(object.points).toHaveLength(
            part.geometry.getAttribute('position').count,
          )
          const expected = placedBounds(part.geometry, frontZ)
          expectBounds(object.bounds, expected)
          assembledBounds.union(object.bounds)
          raisedMaterial ||= expected.min.z > 0.1
          const stlBytes = stlEntries.get(fallback.file)!
          const stl = new STLLoader().parse(stlBytes.buffer as ArrayBuffer)
          try {
            stl.computeBoundingBox()
            expectBounds(stl.boundingBox!, object.bounds)
            expect(stl.getAttribute('position').count).toBe(
              part.geometry.index!.count,
            )
          } finally {
            stl.dispose()
          }
          expect(part.geometry.getAttribute('position').array).toEqual(
            before[index],
          )
        }
        expectBounds(assembledBounds, placedBounds(panel, frontZ))
        expect(assembledBounds.min.z).toBeCloseTo(0, 4)
        if (preset === 'rainbow') expect(raisedMaterial).toBe(true)
        if (target === 'all') {
          const knobObject = objects.get(
            materialMetadata.objects.find(
              ({ materialId }) => materialId === 'knob',
            )!.objectId,
          )!
          expect(knobObject.bounds.min.x).toBeGreaterThan(assembledBounds.max.x)
          expect(knobObject.bounds.min.z).toBeCloseTo(0, 4)
          expect(objects.get(buildIds[1])!.components).toHaveLength(1)
          const powerButtonMaterial = materialMetadata.objects.find(
            ({ assembly }) => assembly === 'Power button',
          )!
          const powerButtonObject = objects.get(powerButtonMaterial.objectId)!
          expect(powerButtonMaterial).toMatchObject({
            materialId: 'power-button',
            name: 'Power button',
            color: '#d9277c',
          })
          expect(
            powerButtonObject.bounds.min.x - knobObject.bounds.max.x,
          ).toBeCloseTo(10, 4)
          expect(powerButtonObject.bounds.min.z).toBeCloseTo(0, 4)
          expect(objects.get(buildIds[2])!.components).toEqual([
            powerButtonMaterial.objectId,
          ])
          expect(
            bases[Number(powerButtonObject.attrs.pindex)].displaycolor,
          ).toBe('#D9277CFF')
          const fallback = stlMetadata.parts.find(
            ({ assembly }) => assembly === 'Power button',
          )!
          expect(fallback).toMatchObject({
            color: '#d9277c',
            file: 'power-button.stl',
          })
          const buttonStl = new STLLoader().parse(
            stlEntries.get(fallback.file)!.buffer as ArrayBuffer,
          )
          try {
            buttonStl.computeBoundingBox()
            expectBounds(buttonStl.boundingBox!, powerButtonObject.bounds)
            expect(buttonStl.getAttribute('position').count).toBe(
              powerButton.getAttribute('position').count,
            )
          } finally {
            buttonStl.dispose()
          }
        }
        if (process.env.MULTICOLOR_FIXTURES === '1') {
          const directory = resolve('test-results/multicolor-fixtures')
          mkdirSync(directory, { recursive: true })
          const name = `speaker-${model}-${preset}${grille ? '-grille' : ''}-${target}`
          writeFileSync(
            resolve(directory, `${name}.3mf`),
            new Uint8Array(threeMf.data),
          )
          writeFileSync(
            resolve(directory, `${name}-stl-parts.zip`),
            new Uint8Array(stlZip.data),
          )
        }
      } finally {
        for (const { geometry, previewGeometry } of parts) {
          geometry.dispose()
          previewGeometry?.dispose()
        }
        panel?.dispose()
        source.dispose()
        knob.dispose()
        powerButton.dispose()
        knobSource.dispose()
      }
    },
    60_000,
  )
})
