import { readFileSync } from 'node:fs'
import { BoxGeometry, BufferGeometry, Float32BufferAttribute } from 'three'
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { describe, expect, it } from 'vitest'
import { validateDesign } from './design'
import { buildDesignExport } from './design-export'
import { buildMulticolorGeometry } from './multicolor-client'
import { createPatternElement } from './multicolor-patterns'
import { exportThreeMf } from './three-mf-export'
import { parsePowerButtonGeometry } from './power-button'

async function fixture(materialId = 'blue') {
  // Angled panel: each color has a different frontmost Z. Independent
  // per-material grounding would put the blue region in the wrong place.
  const panel = new BoxGeometry(40, 30, 4).toNonIndexed()
  panel.rotateY(0.2)
  const knob = new BoxGeometry(10, 10, 12).toNonIndexed()
  const powerButtonBytes = readFileSync(
    new URL(
      '../../resources/stl-files/cmf-speaker-sm-3d-printing-power-button-original-v1.stl',
      import.meta.url,
    ),
  )
  const powerButton = parsePowerButtonGeometry(
    powerButtonBytes.buffer.slice(
      powerButtonBytes.byteOffset,
      powerButtonBytes.byteOffset + powerButtonBytes.byteLength,
    ),
  )
  const design = validateDesign({
    powerButtonColor: '#cc22bb',
    panelColor: '#ffffff',
    multicolor: {
      enabled: true,
      frame: { centerX: 0, centerY: 0, width: 80, height: 80 },
      materials: [
        { id: materialId, name: 'Blue & "Sky" <1>', color: '#0044ff' },
      ],
    },
  })
  design.multicolor.elements = [
    {
      ...createPatternElement('stripe', design.multicolor.frame, materialId),
      kind: 'stripe',
      id: 'blue-band',
      width: 40,
      height: 80,
      x: 20,
    },
  ]
  const generated = await buildMulticolorGeometry(panel, design.multicolor)
  return {
    panel,
    knob,
    powerButton,
    design,
    materialParts: generated.parts,
    dispose() {
      panel.dispose()
      knob.dispose()
      powerButton.dispose()
      generated.parts.forEach(({ geometry, previewGeometry }) => {
        geometry.dispose()
        previewGeometry?.dispose()
      })
    },
  }
}

function vertices(source: string) {
  return [
    ...source.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g),
  ].map((match) => match.slice(1).map(Number))
}

function bounds(points: number[][]) {
  return {
    min: [0, 1, 2].map((axis) =>
      Math.min(...points.map((point) => point[axis])),
    ),
    max: [0, 1, 2].map((axis) =>
      Math.max(...points.map((point) => point[axis])),
    ),
  }
}

describe('multicolor printable exports', () => {
  it('preserves assembly registration, material identity, units and valid references in 3MF', async () => {
    const input = await fixture()
    try {
      const file = await buildDesignExport({
        ...input,
        target: 'all',
        format: '3mf',
      })
      expect(file.filename).toMatch(/\.3mf$/)
      expect(file.mimeType).toBe('model/3mf')
      const entries = unzipSync(new Uint8Array(file.data))
      const source = strFromU8(entries['3D/3dmodel.model'])
      expect(source).toContain('unit="millimeter"')
      expect(source).toContain('Blue &amp; &quot;Sky&quot; &lt;1&gt;')
      expect(source).toContain('displaycolor="#0044FFFF"')
      expect(source).toContain('name="Power button" displaycolor="#CC22BBFF"')
      expect(strFromU8(entries['_rels/.rels'])).toContain('/3D/3dmodel.model')
      const objects = [
        ...source.matchAll(/<object id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g),
      ]
      const ids = objects.map((match) => Number(match[1]))
      const refs = [...source.matchAll(/objectid="(\d+)"/g)].map((match) =>
        Number(match[1]),
      )
      expect(refs.every((id) => ids.includes(id))).toBe(true)
      expect(new Set(ids).size).toBe(ids.length)
      const meshes = objects.filter((match) => match[2].includes('<mesh>'))
      expect(meshes).toHaveLength(4)
      expect(source.match(/<item /g)).toHaveLength(3)
      for (const object of meshes) {
        const points = vertices(object[2])
        expect(points.length).toBeGreaterThan(3)
        const edges = new Map<string, number>()
        for (const match of object[2].matchAll(
          /<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g,
        )) {
          const triangle = match.slice(1).map(Number)
          expect(triangle.every((index) => index < points.length)).toBe(true)
          for (let corner = 0; corner < 3; corner++) {
            const a = triangle[corner],
              b = triangle[(corner + 1) % 3]
            const key = `${Math.min(a, b)}:${Math.max(a, b)}`
            edges.set(key, (edges.get(key) ?? 0) + (a < b ? 11 : 9))
          }
        }
        expect([...edges.values()].every((value) => value === 20)).toBe(true)
      }
      const regionBounds = meshes
        .slice(0, 2)
        .map((match) => bounds(vertices(match[2])))
      expect(Math.min(...regionBounds.map((box) => box.min[2]))).toBeCloseTo(
        0,
        6,
      )
      expect(
        Math.max(...regionBounds.map((box) => box.min[2])),
      ).toBeGreaterThan(1)
      const panelBounds = bounds(
        meshes.slice(0, 2).flatMap((match) => vertices(match[2])),
      )
      const knobBounds = bounds(vertices(meshes[2][2]))
      const powerButtonBounds = bounds(vertices(meshes[3][2]))
      expect(knobBounds.min[0] - panelBounds.max[0]).toBeCloseTo(10, 5)
      expect(powerButtonBounds.min[0] - knobBounds.max[0]).toBeCloseTo(10, 5)
      expect(powerButtonBounds.min[1]).toBeCloseTo(panelBounds.min[1], 5)
      expect(powerButtonBounds.min[2]).toBeCloseTo(0, 5)
      input.powerButton.computeBoundingBox()
      const sourceBounds = input.powerButton.boundingBox!
      expect(powerButtonBounds.max[0] - powerButtonBounds.min[0]).toBeCloseTo(
        sourceBounds.max.x - sourceBounds.min.x,
        5,
      )
      expect(powerButtonBounds.max[2]).toBeCloseTo(sourceBounds.max.z, 5)
      const metadata = JSON.parse(strFromU8(entries['Metadata/design.json']))
      expect(metadata.multicolor).toEqual(input.design.multicolor)
      expect(metadata.powerButtonColor).toBe('#cc22bb')
      const materials = JSON.parse(
        strFromU8(entries['Metadata/materials.json']),
      )
      expect(
        materials.objects.map(
          (item: { materialId: string }) => item.materialId,
        ),
      ).toEqual([
        ...input.materialParts.map((part) => part.materialId),
        'knob',
        'power-button',
      ])
      expect(materials.objects.at(-1)).toMatchObject({
        materialId: 'power-button',
        name: 'Power button',
        assembly: 'Power button',
        color: '#cc22bb',
      })
    } finally {
      input.dispose()
    }
  })

  it('exports aligned STL regions with reusable JSON and includes no hidden full panel', async () => {
    const input = await fixture()
    try {
      const file = await buildDesignExport({
        ...input,
        target: 'panel',
        format: 'stl-parts',
      })
      const entries = unzipSync(new Uint8Array(file.data))
      const manifest = JSON.parse(strFromU8(entries['materials.json']))
      expect(manifest.parts).toHaveLength(2)
      expect(
        Object.keys(entries).filter((name) => name.endsWith('.stl')),
      ).toHaveLength(2)
      const parsed = manifest.parts.map((part: { file: string }) =>
        new STLLoader().parse(entries[part.file].slice().buffer as ArrayBuffer),
      ) as BufferGeometry[]
      try {
        parsed.forEach((geometry) => geometry.computeBoundingBox())
        expect(
          Math.min(...parsed.map((geometry) => geometry.boundingBox!.min.z)),
        ).toBeCloseTo(0, 5)
        expect(
          Math.max(...parsed.map((geometry) => geometry.boundingBox!.min.z)),
        ).toBeGreaterThan(1)
      } finally {
        parsed.forEach((geometry) => geometry.dispose())
      }
      const metadata = JSON.parse(strFromU8(entries['design.json']))
      expect(validateDesign(metadata)).toEqual(input.design)
      expect(strFromU8(entries['README.txt'])).toContain('PARTS OF ONE OBJECT')
    } finally {
      input.dispose()
    }
  })

  it('rejects missing/stale regions but permits palette-only edits and canonical geometry exports', async () => {
    const input = await fixture()
    try {
      await expect(
        buildDesignExport({
          ...input,
          materialParts: null,
          target: 'panel',
          format: '3mf',
        }),
      ).rejects.toThrow(/Wait/)
      input.design.multicolor.materials[0].color = '#aa00bb'
      const recolored = await buildDesignExport({
        ...input,
        target: 'panel',
        format: '3mf',
      })
      expect(
        strFromU8(
          unzipSync(new Uint8Array(recolored.data))['3D/3dmodel.model'],
        ),
      ).toContain('#AA00BBFF')
      input.design.multicolor.elements[0].x += 2
      await expect(
        buildDesignExport({ ...input, target: 'panel', format: '3mf' }),
      ).rejects.toThrow(/out of date/)
      const combined = await buildDesignExport({
        ...input,
        target: 'panel',
        format: 'stl',
      })
      expect(combined.mimeType).toBe('model/stl')
      const knobOnly = await buildDesignExport({
        ...input,
        materialParts: null,
        target: 'knob',
        format: '3mf',
      })
      expect(knobOnly.mimeType).toBe('model/3mf')
    } finally {
      input.dispose()
    }
  })

  it('retains separate indexed vertices at shell contacts rather than globally welding coordinates', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, -1, 0],
        3,
      ),
    )
    geometry.setIndex([0, 1, 2, 3, 4, 5])
    const bytes = exportThreeMf(
      [
        {
          name: 'Contact',
          parts: [{ id: 'a', name: 'A', color: '#ffffff', geometry }],
        },
      ],
      {},
    )
    expect(
      vertices(strFromU8(unzipSync(new Uint8Array(bytes))['3D/3dmodel.model'])),
    ).toHaveLength(6)
    geometry.dispose()
  })

  it.each(['3mf', 'stl-parts'] as const)(
    'exports only the original power button in %s without requiring panel material regions',
    async (format) => {
      const input = await fixture()
      const before = input.powerButton.getAttribute('position').array.slice()
      try {
        const file = await buildDesignExport({
          ...input,
          materialParts: null,
          target: 'power-button',
          format,
        })
        const entries = unzipSync(new Uint8Array(file.data))
        if (format === '3mf') {
          expect(file.filename).toBe('cmf-speaker-s-power-button.3mf')
          const source = strFromU8(entries['3D/3dmodel.model'])
          expect(source.match(/<item /g)).toHaveLength(1)
          expect(source.match(/<mesh>/g)).toHaveLength(1)
          expect(source).toContain(
            'name="Power button" displaycolor="#CC22BBFF"',
          )
          const points = vertices(source)
          const exported = bounds(points)
          input.powerButton.computeBoundingBox()
          const original = input.powerButton.boundingBox!
          expect(exported.min).toEqual([original.min.x, original.min.y, 0])
          expect(exported.max).toEqual([
            original.max.x,
            original.max.y,
            original.max.z,
          ])
          const materials = JSON.parse(
            strFromU8(entries['Metadata/materials.json']),
          )
          expect(materials.objects).toHaveLength(1)
          expect(materials.objects[0]).toMatchObject({
            materialId: 'power-button',
            color: '#cc22bb',
            assembly: 'Power button',
          })
        } else {
          expect(
            Object.keys(entries).filter((name) => name.endsWith('.stl')),
          ).toEqual(['power-button.stl'])
          const materials = JSON.parse(strFromU8(entries['materials.json']))
          expect(materials.parts).toEqual([
            {
              materialId: 'power-button',
              name: 'Power button',
              color: '#cc22bb',
              file: 'power-button.stl',
              assembly: 'Power button',
            },
          ])
          const geometry = new STLLoader().parse(
            entries['power-button.stl'].slice().buffer as ArrayBuffer,
          )
          try {
            expect(geometry.getAttribute('position').array).toEqual(before)
          } finally {
            geometry.dispose()
          }
        }
        expect(input.powerButton.getAttribute('position').array).toEqual(before)
      } finally {
        input.dispose()
      }
    },
  )

  it.each(['knob', 'power-button'])(
    'keeps a panel material named %s distinct from the separate control STLs',
    async (materialId) => {
      const input = await fixture(materialId)
      try {
        const file = await buildDesignExport({
          ...input,
          target: 'all',
          format: 'stl-parts',
        })
        const entries = unzipSync(new Uint8Array(file.data))
        const manifest = JSON.parse(strFromU8(entries['materials.json']))
        const filenames = manifest.parts.map(
          (part: { file: string }) => part.file,
        )
        expect(new Set(filenames).size).toBe(4)
        expect(
          filenames.filter((name: string) => name === 'volume-knob.stl'),
        ).toHaveLength(1)
        expect(
          filenames.filter((name: string) => name === 'power-button.stl'),
        ).toHaveLength(1)
        expect(
          Object.keys(entries).filter((name) => name.endsWith('.stl')),
        ).toHaveLength(4)
      } finally {
        input.dispose()
      }
    },
  )

  it('rejects invalid XML names while accepting Unicode material names', () => {
    const geometry = new BoxGeometry(1, 1, 1).toNonIndexed()
    const part = { id: 'a', name: 'Blue\u0000', color: '#ffffff', geometry }
    try {
      expect(() =>
        exportThreeMf([{ name: 'Panel', parts: [part] }], {}),
      ).toThrow(/Rename the material/)
      part.name = 'Blå 🔵'
      const bytes = exportThreeMf([{ name: 'Panel', parts: [part] }], {})
      expect(
        strFromU8(unzipSync(new Uint8Array(bytes))['3D/3dmodel.model']),
      ).toContain('Blå 🔵')
    } finally {
      geometry.dispose()
    }
  })
})
