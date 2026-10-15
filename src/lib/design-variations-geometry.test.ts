import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Vector3, type BufferGeometry } from 'three'
import { validateDesign } from './design'
import { createDesignVariations, panelSafeVariation } from './design-variations'
import { buildHandledPanelGeometry } from './handles'
import { createMulticolorEngine } from './multicolor-geometry'
import { applyMulticolorPreset } from './multicolor-presets'
import { getDefaultMulticolorSettings } from './multicolor-settings'
import { parsePanelGeometry } from './panels'

function seededRandom(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
}

describe('variation geometry fallback', () => {
  let source: BufferGeometry
  let engine: Awaited<ReturnType<typeof createMulticolorEngine>>
  beforeAll(async () => {
    const bytes = readFileSync(
      new URL(
        '../../resources/stl-files/cmf-speaker-s-3d-printing-panel-original-v1.stl',
        import.meta.url,
      ),
    )
    source = parsePanelGeometry(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      's',
    )
    engine = await createMulticolorEngine()
  })
  afterAll(() => {
    source.dispose()
    engine.dispose()
  })

  it.each([
    { seed: 42, id: 'variation-2-3' },
    { seed: 42, id: 'variation-3-3' },
    { seed: 42, id: 'variation-3-6' },
    { seed: 4281, id: 'variation-3-1' },
    { seed: 4281, id: 'variation-3-3' },
  ])(
    'provides a printable replacement for France $id (seed $seed)',
    async ({ seed, id }) => {
      const preset = applyMulticolorPreset(
        'france',
        getDefaultMulticolorSettings(),
      )
      const base = validateDesign({
        multicolor: preset.settings,
        panelColor: preset.panelColor,
      })
      const candidate = createDesignVariations(base, seededRandom(seed)).find(
        (variation) => variation.id === id,
      )!
      const design = panelSafeVariation(base, candidate.design)
      const panel = await buildHandledPanelGeometry(
        source,
        design.model,
        'original',
        design.relief,
        design.handle,
        design.grille,
        design.halo,
        design.panelExtension,
        design.panelGap,
        design.raceStripes,
      )
      try {
        const result = engine.build(
          { positions: new Float32Array(panel.getAttribute('position').array) },
          design.multicolor,
        )
        expect(result.parts.map(({ materialId }) => materialId)).toEqual(
          design.multicolor.materials.map(({ id }) => id),
        )
        // Check the actual indexed Float32 triangles independently of the engine's
        // internal safeguard that rejected these customized panel suggestions.
        const a = new Vector3(),
          b = new Vector3(),
          c = new Vector3()
        for (const part of result.parts) {
          expect(part.volume).toBeGreaterThan(0)
          for (let index = 0; index < part.indices.length; index += 3) {
            a.fromArray(part.positions, part.indices[index] * 3)
            b.fromArray(part.positions, part.indices[index + 1] * 3)
            c.fromArray(part.positions, part.indices[index + 2] * 3)
            expect(b.sub(a).cross(c.sub(a)).lengthSq()).toBeGreaterThan(0)
          }
        }
        expect(design.panelColor).toBe(candidate.design.panelColor)
        expect(design.knob).toEqual(candidate.design.knob)
        expect(design.multicolor.materials).toEqual(
          candidate.design.multicolor.materials,
        )
      } finally {
        panel.dispose()
      }
    },
    30_000,
  )
})
