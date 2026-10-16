import { readFileSync } from 'node:fs'
import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Vector3,
} from 'three'
import { strFromU8, unzipSync } from 'three/addons/libs/fflate.module.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { describe, expect, it } from 'vitest'
import { validateDesign } from './design'
import { buildDesignExport } from './design-export'
import { buildMulticolorGeometry } from './multicolor-client'
import { createPatternElement } from './multicolor-patterns'
import { buildHandledPanelGeometry } from './handles'
import { parsePanelGeometry } from './panels'
import { STEP_TOLERANCE_MM } from './step-settings'

function fixture(multicolor = false) {
  const front = new BoxGeometry(40, 20, 4).toNonIndexed().translate(0, -10, 0)
  // This upper solid reaches below the seam behind the front. It must remain
  // part of the upper print even where its Y coordinates are negative.
  const upper = new BoxGeometry(20, 20, 4)
    .toNonIndexed()
    .rotateX(-Math.PI / 4)
    .translate(0, 4, -12)
  const frontPositions = new Float32Array(front.getAttribute('position').array)
  const upperPositions = new Float32Array(upper.getAttribute('position').array)
  const positions = new Float32Array(
    frontPositions.length + upperPositions.length,
  )
  positions.set(frontPositions)
  positions.set(upperPositions, frontPositions.length)
  const panel = new BufferGeometry()
  panel.setAttribute('position', new BufferAttribute(positions, 3))
  panel.userData.split = {
    seamY: 0,
    clearanceMm: 0.25,
    frontPositions,
    upperPositions,
  }
  const knob = new BoxGeometry(10, 10, 12)
  const powerButton = new BoxGeometry(6, 6, 3)
  const design = validateDesign({
    panelSplit: true,
    multicolor: {
      enabled: multicolor,
      frame: { centerX: 0, centerY: 0, width: 80, height: 80 },
      materials: [{ id: 'blue', name: 'Blue', color: '#0044ff' }],
    },
  })
  design.multicolor.elements = [
    {
      ...createPatternElement('stripe', design.multicolor.frame, 'blue'),
      kind: 'stripe',
      id: 'blue-band',
      width: 40,
      height: 80,
      x: 20,
    },
  ]
  return {
    panel,
    knob,
    powerButton,
    design,
    frontPositions,
    upperPositions,
    dispose() {
      ;[front, upper, panel, knob, powerButton].forEach((geometry) =>
        geometry.dispose(),
      )
    },
  }
}

function stlGeometry(bytes: Uint8Array) {
  return new STLLoader().parse(bytes.slice().buffer as ArrayBuffer)
}

function volume(geometry: BufferGeometry) {
  const positions = geometry.getAttribute('position')
  const index = geometry.getIndex()
  let result = 0
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3()
  for (
    let offset = 0;
    offset < (index?.count ?? positions.count);
    offset += 3
  ) {
    a.fromBufferAttribute(positions, index ? index.getX(offset) : offset)
    b.fromBufferAttribute(
      positions,
      index ? index.getX(offset + 1) : offset + 1,
    )
    c.fromBufferAttribute(
      positions,
      index ? index.getX(offset + 2) : offset + 2,
    )
    result += a.dot(b.cross(c)) / 6
  }
  return result
}

function assertOrientedParts(front: Box3, upper: Box3) {
  expect(front.min.z).toBeCloseTo(0, 5)
  expect(upper.min.z).toBeCloseTo(0, 5)
  expect(front.getSize(new Vector3()).toArray()).toEqual([40, 20, 4])
  const size = upper.getSize(new Vector3())
  expect(size.x).toBeCloseTo(20, 5)
  expect(size.y).toBeCloseTo(20, 5)
  expect(size.z).toBeCloseTo(4, 5)
}

function stepBounds(bytes: Uint8Array) {
  const source = strFromU8(bytes)
  expect(source).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION')
  const points = new Map<string, Vector3>()
  for (const match of source.matchAll(
    /#(\d+)\s*=\s*CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(([^)]+)\)\s*\)/g,
  ))
    points.set(
      match[1],
      new Vector3(
        ...(match[2].split(',').map(Number) as [number, number, number]),
      ),
    )
  const box = new Box3()
  for (const match of source.matchAll(/VERTEX_POINT\('',#(\d+)\)/g))
    box.expandByPoint(points.get(match[1])!)
  return box
}

describe('split panel exports', () => {
  it.each(['stl', 'stp'] as const)(
    'exports independently oriented front and upper %s files with reusable design settings',
    async (format) => {
      const input = fixture()
      const beforeFront = input.frontPositions.slice()
      const beforeUpper = input.upperPositions.slice()
      try {
        const file = await buildDesignExport({
          ...input,
          target: 'panel',
          format,
        })
        expect(file.mimeType).toBe('application/zip')
        const entries = unzipSync(new Uint8Array(file.data))
        const frontName = `cmf-speaker-s-original-split-front.${format}`
        const upperName = `cmf-speaker-s-original-split-upper.${format}`
        expect(Object.keys(entries).sort()).toEqual(
          [frontName, upperName, 'design.json'].sort(),
        )
        if (format === 'stl') {
          const front = stlGeometry(entries[frontName])
          const upper = stlGeometry(entries[upperName])
          try {
            front.computeBoundingBox()
            upper.computeBoundingBox()
            assertOrientedParts(front.boundingBox!, upper.boundingBox!)
            expect(volume(front)).toBeCloseTo(3200, 3)
            expect(volume(upper)).toBeCloseTo(1600, 3)
          } finally {
            front.dispose()
            upper.dispose()
          }
          const repeated = await buildDesignExport({
            ...input,
            target: 'panel',
            format,
          })
          expect(new Uint8Array(repeated.data)).toEqual(
            new Uint8Array(file.data),
          )
        } else
          assertOrientedParts(
            stepBounds(entries[frontName]),
            stepBounds(entries[upperName]),
          )
        const settings = JSON.parse(strFromU8(entries['design.json']))
        expect(validateDesign(settings)).toEqual(input.design)
        expect(settings.export.files.panel).toEqual({
          front: frontName,
          upper: upperName,
        })
        expect(input.frontPositions).toEqual(beforeFront)
        expect(input.upperPositions).toEqual(beforeUpper)
        const all = await buildDesignExport({ ...input, target: 'all', format })
        expect(
          Object.keys(unzipSync(new Uint8Array(all.data))).filter((name) =>
            name.endsWith(`.${format}`),
          ),
        ).toHaveLength(4)
      } finally {
        input.dispose()
      }
    },
  )

  it.each([false, true])(
    'creates two independently placed panel 3MF assemblies (multicolor: %s)',
    async (multicolor) => {
      const input = fixture(multicolor)
      const generated = multicolor
        ? await buildMulticolorGeometry(input.panel, input.design.multicolor)
        : null
      try {
        const file = await buildDesignExport({
          ...input,
          target: 'all',
          format: '3mf',
          materialParts: generated?.parts,
        })
        const entries = unzipSync(new Uint8Array(file.data))
        const source = strFromU8(entries['3D/3dmodel.model'])
        expect(source.match(/<item /g)).toHaveLength(4)
        expect(source).toContain('name="Speaker S front panel"')
        expect(source).toContain('name="Speaker S upper panel"')
        const materialMetadata = JSON.parse(
          strFromU8(entries['Metadata/materials.json']),
        )
        expect(
          materialMetadata.objects.filter(
            (part: { assembly: string }) =>
              part.assembly === 'Speaker S front panel',
          ),
        ).toHaveLength(multicolor ? 2 : 1)
        expect(
          materialMetadata.objects.filter(
            (part: { assembly: string }) =>
              part.assembly === 'Speaker S upper panel',
          ),
        ).toHaveLength(multicolor ? 2 : 1)
        const settings = JSON.parse(strFromU8(entries['Metadata/design.json']))
        expect(validateDesign(settings)).toEqual(input.design)
      } finally {
        input.dispose()
        generated?.parts.forEach(({ geometry, previewGeometry }) => {
          geometry.dispose()
          previewGeometry?.dispose()
        })
      }
    },
  )

  it('preserves joint membership, color registration and complete volumes in split material STL groups', async () => {
    const input = fixture(true)
    const generated = await buildMulticolorGeometry(
      input.panel,
      input.design.multicolor,
    )
    try {
      const file = await buildDesignExport({
        ...input,
        target: 'panel',
        format: 'stl-parts',
        materialParts: generated.parts,
      })
      const entries = unzipSync(new Uint8Array(file.data))
      const manifest = JSON.parse(strFromU8(entries['materials.json'])) as {
        parts: { file: string; assembly: string; materialId: string }[]
      }
      expect(manifest.parts).toHaveLength(4)
      expect(new Set(manifest.parts.map(({ file }) => file)).size).toBe(4)
      const boxes: Box3[] = []
      for (const [piece, expectedVolume] of [
        ['front', 3200],
        ['upper', 1600],
      ] as const) {
        const parts = manifest.parts.filter(
          ({ assembly }) => assembly === `Speaker S ${piece} panel`,
        )
        expect(parts.map(({ materialId }) => materialId).sort()).toEqual([
          'base',
          'blue',
        ])
        const box = new Box3()
        let totalVolume = 0
        for (const part of parts) {
          expect(part.file).toMatch(new RegExp(`^panel-${piece}-material-`))
          const geometry = stlGeometry(entries[part.file])
          try {
            geometry.computeBoundingBox()
            box.union(geometry.boundingBox!)
            totalVolume += volume(geometry)
            // Each x half keeps its position inside the physical object.
            expect(geometry.boundingBox!.getSize(new Vector3()).x).toBeCloseTo(
              piece === 'front' ? 20 : 10,
              4,
            )
          } finally {
            geometry.dispose()
          }
        }
        expect(totalVolume).toBeCloseTo(expectedVolume, 2)
        boxes.push(box)
      }
      assertOrientedParts(boxes[0], boxes[1])
      expect(boxes[1].min.x - boxes[0].max.x).toBeCloseTo(10, 5)
      expect(strFromU8(entries['README.txt'])).toContain(
        'PARTS OF A SECOND OBJECT',
      )
    } finally {
      input.dispose()
      generated.parts.forEach(({ geometry, previewGeometry }) => {
        geometry.dispose()
        previewGeometry?.dispose()
      })
    }
  })

  it('rejects a split export until the current split geometry is available', async () => {
    const input = fixture()
    delete input.panel.userData.split
    try {
      await expect(
        buildDesignExport({ ...input, target: 'panel' }),
      ).rejects.toThrow('Wait for the split panel')
      await expect(
        buildDesignExport({ ...input, target: 'panel', format: '3mf' }),
      ).rejects.toThrow('Wait for the split panel')
    } finally {
      input.dispose()
    }
  })

  it('exports the real split speaker, including its joint, hooks and deck, through STEP and multicolor paths', async () => {
    const input = fixture(true)
    const bytes = readFileSync(
      new URL(
        '../../resources/stl-files/cmf-speaker-s-3d-printing-panel-original-v1.stl',
        import.meta.url,
      ),
    )
    const source = parsePanelGeometry(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      's',
    )
    const panel = await buildHandledPanelGeometry(
      source,
      's',
      'original',
      0,
      input.design.handle,
      input.design.grille,
      input.design.halo,
      0,
      0,
      input.design.raceStripes,
      undefined,
      true,
    )
    const generated = await buildMulticolorGeometry(
      panel,
      input.design.multicolor,
    )
    try {
      const stp = await buildDesignExport({
        ...input,
        panel,
        target: 'panel',
        format: 'stp',
      })
      const stepEntries = unzipSync(new Uint8Array(stp.data))
      for (const piece of ['front', 'upper']) {
        const box = stepBounds(
          stepEntries[`cmf-speaker-s-original-split-${piece}.stp`],
        )
        expect(Math.abs(box.min.z)).toBeLessThanOrEqual(STEP_TOLERANCE_MM)
        expect(box.isEmpty()).toBe(false)
      }
      const materialExport = await buildDesignExport({
        ...input,
        panel,
        target: 'panel',
        format: 'stl-parts',
        materialParts: generated.parts,
      })
      const entries = unzipSync(new Uint8Array(materialExport.data))
      for (const piece of ['front', 'upper']) {
        const expectedGeometry = new BufferGeometry().setAttribute(
          'position',
          new BufferAttribute(panel.userData.split[`${piece}Positions`], 3),
        )
        const expectedVolume = volume(expectedGeometry)
        expectedGeometry.dispose()
        let exportedVolume = 0
        for (const [name, data] of Object.entries(entries).filter(([name]) =>
          name.startsWith(`panel-${piece}-material-`),
        )) {
          expect(name.endsWith('.stl')).toBe(true)
          const geometry = stlGeometry(data)
          exportedVolume += volume(geometry)
          geometry.dispose()
        }
        expect(exportedVolume).toBeCloseTo(expectedVolume, 1)
      }
      const settings = JSON.parse(strFromU8(entries['design.json']))
      expect(settings.export.panelSplit).toMatchObject({
        engagementMm: 5,
        clearanceMm: 0.2,
        insertionAxis: [0, -1, 0],
      })
      expect(settings.export.panelSplit.frontPositions).toBeUndefined()
    } finally {
      generated.parts.forEach(({ geometry, previewGeometry }) => {
        geometry.dispose()
        previewGeometry?.dispose()
      })
      panel.dispose()
      source.dispose()
      input.dispose()
    }
  }, 60_000)
})
