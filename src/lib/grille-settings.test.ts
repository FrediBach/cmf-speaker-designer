import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GRILLE_SETTINGS,
  getGrilleLimits,
  getGrillePattern,
  GRILLE_PERFORATION_RADIUS,
  normalizeGrilleSettings,
} from './grille-settings'

describe('parametric grille settings and shared cutter layout', () => {
  it('normalizes invalid inputs and couples slot length to hole width', () => {
    const settings = normalizeGrilleSettings({
      mode: 'custom',
      size: 100,
      spacing: -20,
      slotLength: 1,
      rotation: 200,
      thickness: Infinity,
      recessDepth: -1,
    })
    expect(settings).toMatchObject({
      mode: 'custom',
      size: 10,
      spacing: 1.2,
      slotLength: 10,
      rotation: 90,
      thickness: 3.5,
      recessDepth: 0.2,
    })
    expect(getGrilleLimits(settings).slotLength.min).toBe(10)
    expect(normalizeGrilleSettings()).toEqual(DEFAULT_GRILLE_SETTINGS)
    expect(normalizeGrilleSettings({ size: NaN }).size).toBe(4)
  })

  it.each(['round', 'hex', 'slot'] as const)(
    '%s cutters remain inside the speaker apertures or safe recessed face region',
    (pattern) => {
      for (const model of ['s', 'm'] as const)
        for (const rotation of [0, 37, 90]) {
          const result = getGrillePattern(model, {
            mode: 'custom',
            pattern,
            rotation,
            extendPattern: true,
            size: 4,
            spacing: 2,
            slotLength: 16,
          })
          expect(result.holes.some((hole) => hole.kind === 'through')).toBe(
            true,
          )
          expect(result.holes.some((hole) => hole.kind === 'recess')).toBe(true)
          for (const hole of result.holes) {
            expect(
              hole.points.every(
                ([x, y]) =>
                  x >= result.bounds.minX - 1e-7 &&
                  x <= result.bounds.maxX + 1e-7 &&
                  y >= result.bounds.minY - 1e-7 &&
                  y <= result.bounds.maxY + 1e-7,
              ),
            ).toBe(true)
            if (hole.kind === 'through')
              expect(
                result.openings.some((opening) =>
                  hole.points.every(
                    ([x, y]) =>
                      Math.hypot(x - opening.x, y - opening.y) <=
                      GRILLE_PERFORATION_RADIUS,
                  ),
                ),
              ).toBe(true)
            else
              for (const opening of result.openings)
                expect(
                  Math.hypot(hole.x - opening.x, hole.y - opening.y),
                ).toBeGreaterThan(34.1)
          }
        }
    },
  )

  it('uses a stable lattice and adds only shallow impressions when extending the pattern', () => {
    const settings = {
      mode: 'custom' as const,
      pattern: 'round' as const,
      layout: 'grid' as const,
      size: 4,
      spacing: 2,
      rotation: 0,
    }
    const normal = getGrillePattern('s', settings)
    const extended = getGrillePattern('s', { ...settings, extendPattern: true })
    expect(normal.holes.every((hole) => hole.kind === 'through')).toBe(true)
    expect(extended.holes.filter((hole) => hole.kind === 'through')).toEqual(
      normal.holes,
    )
    expect(
      extended.holes.find((hole) => hole.x === 0 && hole.y === 0)?.kind,
    ).toBe('through')
    expect(
      extended.holes.find((hole) => hole.x === 36 && hole.y === 0)?.kind,
    ).toBe('recess')
  })

  it('keeps hole sets nonempty at largest sparse and smallest dense settings', () => {
    for (const pattern of ['round', 'hex', 'slot'] as const)
      for (const model of ['s', 'm'] as const) {
        for (const settings of [
          { size: 10, spacing: 6, slotLength: 24, rotation: 90 },
          { size: 2, spacing: 1.2, slotLength: 4, rotation: 45 },
        ]) {
          expect(
            getGrillePattern(model, { ...settings, pattern }).holes.length,
          ).toBeGreaterThan(0)
        }
      }
  })
})
