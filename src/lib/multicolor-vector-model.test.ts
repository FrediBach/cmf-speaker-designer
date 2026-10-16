import { BoxGeometry } from 'three'
import { strFromU8, unzipSync } from 'three/addons/libs/fflate.module.js'
import { describe, expect, it } from 'vitest'
import { parseDesignJson, validateDesign } from './design'
import { createDesignHistory, designHistoryReducer } from './design-history'
import { buildDesignExport } from './design-export'
import { buildMulticolorGeometry } from './multicolor-client'
import {
  createPatternElement,
  fitMulticolorArtwork,
  getElementContours,
} from './multicolor-patterns'
import {
  getDefaultMulticolorSettings,
  MULTICOLOR_LIMITS,
  normalizeMulticolorSettings,
  PATTERN_FONTS,
  polygonSignedArea,
  type PatternElement,
} from './multicolor-settings'

function artwork() {
  const settings = getDefaultMulticolorSettings()
  settings.enabled = true
  settings.frame = { centerX: 0, centerY: 0, width: 100, height: 80 }
  settings.materials = [
    { id: 'svg-color', name: 'Logo', color: '#ff0000' },
    { id: 'text-color', name: 'Lettering', color: '#0000ff' },
  ]
  settings.elements = [
    {
      ...createPatternElement('svg', settings.frame, 'svg-color'),
      kind: 'svg',
      x: -25,
      width: 20,
      height: 20,
      sourceName: 'Ring.svg',
      contours: [
        [
          [-0.5, -0.5],
          [0.5, -0.5],
          [0.5, 0.5],
          [-0.5, 0.5],
        ],
        [
          [-0.25, -0.25],
          [-0.25, 0.25],
          [0.25, 0.25],
          [0.25, -0.25],
        ],
      ],
    },
    {
      ...createPatternElement('text', settings.frame, 'text-color'),
      kind: 'text',
      text: 'BO',
      fontId: 'helvetiker',
      fontSize: 15,
      x: 20,
    },
  ]
  return normalizeMulticolorSettings(settings)
}

describe('SVG and text multicolor documents', () => {
  it('preserves editable shapes through JSON and isolates contours in undo snapshots', () => {
    const design = validateDesign({ multicolor: artwork() })
    expect(parseDesignJson(JSON.stringify(design))).toEqual(design)
    const history = createDesignHistory(design)
    const edited = designHistoryReducer(history, {
      type: 'set',
      update: (current) => {
        const svg = current.multicolor.elements[0]
        const text = current.multicolor.elements[1]
        if (svg.kind !== 'svg' || text.kind !== 'text')
          throw new Error('Wrong kinds')
        svg.contours[0][0][0] += 0.1
        text.fontId = 'optimer'
        text.text = 'CMF'
        return current
      },
    })
    expect(history.present).toEqual(design)
    expect(designHistoryReducer(edited, { type: 'undo' }).present).toEqual(
      design,
    )
    expect(parseDesignJson(JSON.stringify(edited.present))).toEqual(
      edited.present,
    )
  })

  it('uniformly fits both shapes and preserves normalized SVG outlines', () => {
    const original = artwork()
    const fitted = fitMulticolorArtwork(original, {
      centerX: 5,
      centerY: 10,
      width: 200,
      height: 160,
    })
    expect(fitted.elements[0]).toMatchObject({
      kind: 'svg',
      width: 40,
      height: 40,
      x: -45,
      y: 10,
      contours: (
        original.elements[0] as Extract<PatternElement, { kind: 'svg' }>
      ).contours,
    })
    expect(fitted.elements[1]).toMatchObject({
      kind: 'text',
      fontSize: 30,
      x: 45,
      y: 10,
    })
    for (let i = 0; i < original.elements.length; i++) {
      const before = getElementContours(original.elements[i]).flat()
      const after = getElementContours(fitted.elements[i]).flat()
      expect(after).toHaveLength(before.length)
      after.forEach(([x, y], index) => {
        expect(x).toBeCloseTo(before[index][0] * 2 + 5)
        expect(y).toBeCloseTo(before[index][1] * 2 + 10)
      })
    }
  })

  it.each(PATTERN_FONTS)(
    'keeps holes and finite centered geometry with $name',
    ({ id }) => {
      const element = { ...artwork().elements[1], fontId: id } as PatternElement
      const contours = getElementContours(element)
      expect(
        contours.filter((points) => polygonSignedArea(points) < 0),
      ).toHaveLength(3)
      expect(
        contours.filter((points) => polygonSignedArea(points) > 0),
      ).toHaveLength(2)
      const points = contours.flat()
      expect(points.flat().every(Number.isFinite)).toBe(true)
      const xs = points.map(([x]) => x)
      const ys = points.map(([, y]) => y)
      expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(element.x)
      expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(element.y)
    },
  )

  it('rejects invalid vector geometry, font choices, and unsupported text atomically', () => {
    const original = artwork()
    const svg = original.elements[0]
    const text = original.elements[1]
    for (const invalid of [
      { ...svg, contours: [] },
      {
        ...svg,
        contours: [
          [
            [0, 0],
            [0.5, 0],
            [NaN, 0.5],
          ],
        ],
      },
      {
        ...svg,
        contours: [
          [
            [0, 0],
            [0.5, 0],
            [0, 2],
          ],
        ],
      },
      { ...svg, width: 0 },
      { ...text, fontId: 'missing-font' },
      { ...text, text: '🙂' },
      { ...text, text: 'A'.repeat(MULTICOLOR_LIMITS.textLength + 1) },
      { ...text, text: '   ' },
      { ...text, fontSize: -1 },
    ]) {
      expect(() =>
        normalizeMulticolorSettings({ ...original, elements: [invalid] }),
      ).toThrow()
    }
    expect(original.elements[0]).toEqual(svg)
  })

  it('partitions SVG holes and letter counters into closed printable material parts with portable 3MF metadata', async () => {
    const design = validateDesign({ multicolor: artwork() })
    const panel = new BoxGeometry(100, 80, 4).toNonIndexed()
    const knob = new BoxGeometry(5, 5, 5).toNonIndexed()
    const powerButton = new BoxGeometry(2, 2, 2).toNonIndexed()
    const result = await buildMulticolorGeometry(panel, design.multicolor)
    try {
      expect(result.parts.map((part) => part.materialId)).toEqual([
        'base',
        'svg-color',
        'text-color',
      ])
      expect(
        result.parts.find((part) => part.materialId === 'svg-color')!.volume,
      ).toBeCloseTo(1200, 3)
      const textArea = getElementContours(design.multicolor.elements[1]).reduce(
        (total, contour) => total + polygonSignedArea(contour),
        0,
      )
      expect(
        result.parts.find((part) => part.materialId === 'text-color')!.volume,
      ).toBeCloseTo(textArea * 4, 3)
      expect(
        result.parts.reduce((total, part) => total + part.volume, 0),
      ).toBeCloseTo(100 * 80 * 4, 3)
      const file = await buildDesignExport({
        design,
        panel,
        knob,
        powerButton,
        materialParts: result.parts,
        target: 'panel',
        format: '3mf',
      })
      const entries = unzipSync(new Uint8Array(file.data))
      expect(
        parseDesignJson(strFromU8(entries['Metadata/design.json'])),
      ).toEqual(design)
      const mesh = strFromU8(entries['3D/3dmodel.model'])
      expect(mesh.match(/<mesh>/g)).toHaveLength(3)
    } finally {
      panel.dispose()
      knob.dispose()
      powerButton.dispose()
      result.parts.forEach(({ geometry, previewGeometry }) => {
        geometry.dispose()
        previewGeometry?.dispose()
      })
    }
  })
})
