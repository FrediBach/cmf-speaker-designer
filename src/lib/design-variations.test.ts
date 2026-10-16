import { describe, expect, it } from 'vitest'
import { DEFAULT_DESIGN, validateDesign, type Design } from './design'
import { createDesignVariations, panelSafeVariation } from './design-variations'

function seededRandom(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
}

function colorDistance(from: string, to: string) {
  return Math.hypot(
    ...[1, 3, 5].map(
      (offset) =>
        parseInt(from.slice(offset, offset + 2), 16) -
        parseInt(to.slice(offset, offset + 2), 16),
    ),
  )
}

function artworkDesign(): Design {
  return validateDesign({
    ...DEFAULT_DESIGN,
    handle: {
      ...DEFAULT_DESIGN.handle,
      mode: 'custom',
      cutout: 'svg',
      svgCutout: {
        name: 'triangle.svg',
        aspectRatio: 1,
        paths: [
          {
            fillRule: 'nonzero',
            contours: [
              [
                [-0.5, -0.5],
                [0.5, -0.5],
                [0, 0.5],
              ],
            ],
          },
        ],
      },
    },
    multicolor: {
      ...DEFAULT_DESIGN.multicolor,
      enabled: true,
      materials: [{ id: 'blue', name: 'Blue', color: '#123456' }],
      elements: [
        {
          id: 'artwork',
          name: 'Artwork',
          kind: 'polygon',
          visible: true,
          materialId: 'blue',
          x: 0,
          y: 0,
          rotation: 0,
          points: [
            [-40, -50],
            [40, -50],
            [0, 50],
          ],
        },
      ],
    },
  })
}

describe('progressive design variations', () => {
  it.each([false, true])(
    'retains the explicitly chosen split assembly setting (%s) in every variation',
    (panelSplit) => {
      const base = validateDesign({ ...DEFAULT_DESIGN, panelSplit })
      for (const { design } of createDesignVariations(base, seededRandom(17)))
        expect(design.panelSplit).toBe(panelSplit)
      const candidate = validateDesign({ ...base, panelSplit: !panelSplit })
      expect(panelSafeVariation(base, candidate).panelSplit).toBe(panelSplit)
    },
  )

  it('retains the selected character face in subtle knob variations', () => {
    const base = validateDesign({
      ...DEFAULT_DESIGN,
      knob: { style: 'text', text: 'FB', fontId: 'inter', fontWeight: 300 },
    })
    const variations = createDesignVariations(base, seededRandom(4281))
    for (const variation of variations.filter(({ ring }) => ring === 1))
      expect(variation.design.knob).toMatchObject({
        style: 'text',
        text: 'FB',
        fontId: 'inter',
        fontWeight: 300,
      })
  })

  it('retries a rejected panel with proven source geometry while retaining candidate appearance and knob', () => {
    const base = artworkDesign()
    const candidate = createDesignVariations(base, seededRandom(4281)).at(
      -1,
    )!.design
    const beforeBase = structuredClone(base)
    const beforeCandidate = structuredClone(candidate)
    const fallback = panelSafeVariation(base, candidate)
    for (const key of [
      'model',
      'style',
      'relief',
      'panelExtension',
      'panelGap',
      'panelSplit',
      'handle',
      'grille',
      'halo',
      'raceStripes',
    ] as const)
      expect(fallback[key]).toEqual(base[key])
    for (const key of [
      'bodyColor',
      'bodyGrilleColor',
      'panelColor',
      'powerButtonColor',
      'knobColor',
      'knob',
    ] as const)
      expect(fallback[key]).toEqual(candidate[key])
    expect(fallback.multicolor.elements).toEqual(base.multicolor.elements)
    expect(fallback.multicolor.materials).toEqual(
      candidate.multicolor.materials,
    )
    expect(validateDesign(fallback)).toEqual(fallback)
    fallback.handle.svgCutout!.paths[0].contours[0][0][0] = 0
    fallback.multicolor.materials[0].color = '#abcdef'
    fallback.knob.height = 20
    expect(base).toEqual(beforeBase)
    expect(candidate).toEqual(beforeCandidate)
  })

  it.each(['s', 'm'] as const)(
    'stands an original and 24 %s choices in a compact ground-level formation',
    (model) => {
      const base = validateDesign({ ...DEFAULT_DESIGN, model })
      const variations = createDesignVariations(base, seededRandom(17))
      expect(variations).toHaveLength(25)
      expect(new Set(variations.map(({ id }) => id)).size).toBe(25)
      expect(variations[0]).toMatchObject({
        id: 'original',
        label: 'Original',
        ring: 0,
        strength: 0,
        position: [0, 0, 0],
        design: base,
      })
      expect(
        new Set(variations.map(({ position }) => position.join(','))).size,
      ).toBe(25)
      expect(new Set(variations.map(({ position: [x] }) => x)).size).toBe(5)
      expect(new Set(variations.map(({ position: [, , z] }) => z)).size).toBe(5)
      for (let index = 0; index < variations.length; index += 1) {
        const [x, y, z] = variations[index].position
        expect(y).toBe(0)
        for (const other of variations.slice(index + 1))
          expect(
            Math.hypot(x - other.position[0], z - other.position[2]),
          ).toBeGreaterThanOrEqual(160)
      }
      let previousRadius = 0
      let previousStrength = 0
      for (let ring = 1; ring <= 3; ring += 1) {
        const choices = variations.filter(
          (variation) => variation.ring === ring,
        )
        expect(choices).toHaveLength(8)
        const radii = choices.map(({ position }) => Math.hypot(...position))
        expect(Math.min(...radii)).toBeGreaterThan(previousRadius)
        expect(choices[0].strength).toBeGreaterThan(previousStrength)
        for (const choice of choices) {
          expect(choice.design.model).toBe(model)
        }
        previousRadius = Math.max(...radii)
        previousStrength = choices[0].strength
      }
    },
  )

  it('leaves the input intact and owns independent copies of nested artwork', () => {
    const base = artworkDesign()
    const before = structuredClone(base)
    const variations = createDesignVariations(base, seededRandom(91))
    expect(base).toEqual(before)
    expect(variations[0].design).toEqual(base)
    for (const { design } of variations) {
      expect(design).not.toBe(base)
      expect(design.handle).not.toBe(base.handle)
      expect(design.multicolor.elements).not.toBe(base.multicolor.elements)
    }
    variations[0].design.handle.svgCutout!.paths[0].contours[0][0][0] = 0
    variations[1].design.multicolor.materials[0].color = '#ffffff'
    expect(base).toEqual(before)
    expect(variations[1].design.handle.svgCutout).toEqual(base.handle.svgCutout)
    expect(variations[2].design.multicolor.materials[0].color).not.toBe(
      '#ffffff',
    )
  })

  it('produces distinct, reproducible, normalized choices including at RNG extremes', () => {
    for (const model of ['s', 'm'] as const) {
      const base = validateDesign({ ...DEFAULT_DESIGN, model })
      for (const random of [
        seededRandom(852),
        () => 0,
        () => 1 - Number.EPSILON,
      ]) {
        const variations = createDesignVariations(base, random)
        expect(
          new Set(variations.map(({ design }) => JSON.stringify(design))).size,
        ).toBe(25)
        for (const { design } of variations)
          expect(validateDesign(design)).toEqual(design)
      }
      expect(createDesignVariations(base, seededRandom(721))).toEqual(
        createDesignVariations(base, seededRandom(721)),
      )
      expect(createDesignVariations(base, seededRandom(722))).not.toEqual(
        createDesignVariations(base, seededRandom(721)),
      )
    }
  })

  it('keeps nearby modes and dimensions close while allowing distant structural changes', () => {
    const base = validateDesign({})
    const variations = createDesignVariations(base, seededRandom(125))
    for (const { design } of variations.filter(({ ring }) => ring === 1)) {
      expect(design.style).toBe(base.style)
      expect(design.bodyColor).toBe(base.bodyColor)
      expect(design.bodyGrilleColor).toBe(base.bodyGrilleColor)
      expect(design.handle.mode).toBe(base.handle.mode)
      expect(design.handle.cutout).toBe(base.handle.cutout)
      expect(design.grille.mode).toBe(base.grille.mode)
      expect(design.grille.pattern).toBe(base.grille.pattern)
      expect(design.halo.mode).toBe(base.halo.mode)
      expect(design.halo.waveShape).toBe(base.halo.waveShape)
      expect(design.halo.waveSeamless).toBe(base.halo.waveSeamless)
      expect(design.knob.style).toBe(base.knob.style)
      expect(design.raceStripes.enabled).toBe(base.raceStripes.enabled)
      expect(
        Math.abs(design.handle.height - base.handle.height),
      ).toBeLessThanOrEqual(9)
      expect(
        Math.abs(design.knob.height - base.knob.height),
      ).toBeLessThanOrEqual(2)
      for (const key of [
        'panelColor',
        'knobColor',
        'powerButtonColor',
      ] as const)
        for (const offset of [1, 3, 5])
          expect(
            Math.abs(
              parseInt(design[key].slice(offset, offset + 2), 16) -
                parseInt(base[key].slice(offset, offset + 2), 16),
            ),
          ).toBeLessThanOrEqual(41)
    }
    const outer = variations.filter(({ ring }) => ring === 3)
    expect(outer.every(({ design }) => design.style === 'custom')).toBe(true)
    expect(
      outer.some(({ design }) => design.handle.mode !== base.handle.mode),
    ).toBe(true)
    expect(
      outer.some(({ design }) => design.grille.mode !== base.grille.mode),
    ).toBe(true)
    expect(
      outer.some(({ design }) => design.knob.style !== base.knob.style),
    ).toBe(true)
  })

  it('moves each color and knob height progressively away toward the same target', () => {
    const base = validateDesign({})
    const variations = createDesignVariations(base, seededRandom(923))
    for (let direction = 0; direction < 8; direction += 1) {
      const progression = [1, 2, 3].map(
        (ring) => variations[1 + (ring - 1) * 8 + direction],
      )
      for (const color of [
        'panelColor',
        'knobColor',
        'powerButtonColor',
      ] as const) {
        const distances = progression.map(({ design }) =>
          colorDistance(base[color], design[color]),
        )
        expect(distances[1]).toBeGreaterThanOrEqual(distances[0])
        expect(distances[2]).toBeGreaterThanOrEqual(distances[1])
      }
      const heights = progression.map(({ design }) =>
        Math.abs(design.knob.height - base.knob.height),
      )
      expect(heights[1]).toBeGreaterThanOrEqual(heights[0])
      expect(heights[2]).toBeGreaterThanOrEqual(heights[1])
    }
  })

  it('preserves uploaded near handles and existing mask layouts without adding new masks', () => {
    const base = artworkDesign()
    const variations = createDesignVariations(base, seededRandom(39))
    for (const { ring, design } of variations) {
      if (ring <= 1) expect(design.handle).toEqual(base.handle)
      expect(design.multicolor.enabled).toBe(base.multicolor.enabled)
      expect(design.multicolor.elements).toEqual(base.multicolor.elements)
      expect(design.multicolor.groups).toEqual(base.multicolor.groups)
      expect(design.multicolor.frame).toEqual(base.multicolor.frame)
      expect(design.multicolor.materials.map(({ id }) => id)).toEqual(['blue'])
    }
    for (const { design } of createDesignVariations(
      validateDesign({}),
      seededRandom(39),
    )) {
      expect(design.multicolor.enabled).toBe(false)
      expect(design.multicolor.elements).toEqual([])
    }
  })
})
