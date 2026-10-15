import { describe, expect, it } from 'vitest'
import { DEFAULT_DESIGN, PALETTE, validateDesign, type Design } from './design'
import { getGrillePattern, GRILLE_MIN_BACKING } from './grille-settings'
import { HALO_INNER_RADIUS } from './halo-settings'
import { KNOB_STYLES } from './knob-settings'
import { randomizeDesign } from './random-design'

function seededRandom(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
}

function sampleDesigns(model: Design['model'], count = 200) {
  const random = seededRandom(73891)
  return Array.from({ length: count }, () => randomizeDesign(model, random))
}

describe('random designs', () => {
  it.each(['s', 'm'] as const)(
    'preserves speaker %s and produces complete, normalized settings',
    (model) => {
      const designs = [
        ...sampleDesigns(model),
        randomizeDesign(model, () => 0),
        randomizeDesign(model, () => 1 - Number.EPSILON),
      ]
      for (const design of designs) {
        expect(design.model).toBe(model)
        expect(design.handle.svgCutout).toBeNull()
        expect(['black', 'gray']).toContain(design.bodyColor)
        expect(
          design.bodyColor === 'gray'
            ? ['black']
            : ['black', 'orange', 'turquoise'],
        ).toContain(design.bodyGrilleColor)
        expect(validateDesign(design)).toEqual(design)
        expect(design.style).toBe('custom')
        expect(
          [design.handle, design.grille, design.halo].some(
            ({ mode }) => mode === 'custom',
          ),
        ).toBe(true)
        expect(
          design.grille.thickness - design.grille.recessDepth,
        ).toBeGreaterThanOrEqual(GRILLE_MIN_BACKING)
        expect(PALETTE.some(({ value }) => value === design.panelColor)).toBe(
          true,
        )
        expect(
          PALETTE.some(({ value }) => value === design.powerButtonColor),
        ).toBe(true)
        expect(PALETTE.some(({ value }) => value === design.knobColor)).toBe(
          true,
        )
      }
    },
  )

  it('can reproduce a design without retaining or sharing earlier settings', () => {
    const first = randomizeDesign('m', seededRandom(39217))
    const second = randomizeDesign('m', seededRandom(39217))
    expect(second).toEqual(first)
    for (const component of ['handle', 'grille', 'halo', 'knob'] as const) {
      expect(first[component]).not.toBe(second[component])
      expect(first[component]).not.toBe(DEFAULT_DESIGN[component])
    }
    first.handle.height = 70
    expect(second.handle.height).not.toBe(70)
    expect(randomizeDesign('m', seededRandom(39218))).not.toEqual(second)
  })

  it('varies generated settings, including inactive settings and each component mode', () => {
    const designs = sampleDesigns('s')
    for (const key of [
      'bodyColor',
      'bodyGrilleColor',
      'panelColor',
      'powerButtonColor',
      'knobColor',
      'relief',
    ] as const)
      expect(
        new Set(designs.map((design) => design[key])).size,
      ).toBeGreaterThan(1)
    expect(
      designs.some(
        ({ panelColor, powerButtonColor, knobColor }) =>
          powerButtonColor !== panelColor && powerButtonColor !== knobColor,
      ),
    ).toBe(true)
    for (const component of ['handle', 'grille', 'halo', 'knob'] as const) {
      for (const key of Object.keys(designs[0][component])) {
        // Uploaded artwork is provided by the user, never generated at random.
        if (component === 'handle' && key === 'svgCutout') continue
        const values = designs.map(
          (design) =>
            (design[component] as unknown as Record<string, unknown>)[key],
        )
        expect(new Set(values).size, `${component}.${key}`).toBeGreaterThan(1)
      }
    }
    expect(new Set(designs.map(({ knob }) => knob.style))).toEqual(
      new Set(KNOB_STYLES.map(({ id }) => id)),
    )
    for (const model of ['s', 'm'] as const) {
      expect(
        new Set(sampleDesigns(model).map(({ bodyColor }) => bodyColor)),
      ).toEqual(new Set(['black', 'gray']))
      expect(
        new Set(
          sampleDesigns(model)
            .filter(({ bodyColor }) => bodyColor === 'black')
            .map(({ bodyGrilleColor }) => bodyGrilleColor),
        ),
      ).toEqual(new Set(['black', 'orange', 'turquoise']))
    }
    expect(new Set(designs.map(({ handle }) => handle.cutout))).toEqual(
      new Set(['none', 'circle', 'slot']),
    )
    expect(new Set(designs.map(({ grille }) => grille.pattern))).toEqual(
      new Set(['round', 'hex', 'slot']),
    )
    expect(new Set(designs.map(({ knob }) => knob.flutePath))).toEqual(
      new Set(['straight', 'spiral', 'chevron']),
    )
    for (const component of ['handle', 'grille', 'halo'] as const)
      expect(new Set(designs.map((design) => design[component].mode))).toEqual(
        new Set(['original', 'custom']),
      )
  })

  it('keeps the two M halos clear of one another even at maximum flare', () => {
    const designs = [
      ...sampleDesigns('m'),
      randomizeDesign('m', () => 1 - Number.EPSILON),
    ]
    for (const { halo } of designs) {
      const outerRadius =
        HALO_INNER_RADIUS +
        halo.thickness +
        Math.tan((halo.outwardAngle * Math.PI) / 180) * halo.depth
      expect(outerRadius * 2).toBeLessThan(85)
    }
  })

  it.each(['s', 'm'] as const)(
    'keeps generated %s grille patterns useful and reasonably sized',
    (model) => {
      for (const { grille } of sampleDesigns(model, 30)) {
        const { holes } = getGrillePattern(model, grille)
        expect(holes.some(({ kind }) => kind === 'through')).toBe(true)
        expect(holes.length).toBeLessThan(400)
      }
    },
  )
})
