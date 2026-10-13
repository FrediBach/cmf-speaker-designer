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

  it('allows recesses up to 3 mm while leaving at least 0.5 mm of grille backing', () => {
    expect(getGrilleLimits().recessDepth).toEqual({ min: 0.2, max: 3 })
    for (const [thickness, maxDepth] of [
      [2, 1.5],
      [2.3, 1.8],
      [2.5, 2],
      [3, 2.5],
      [3.5, 3],
      [4, 3],
    ]) {
      expect(getGrilleLimits({ thickness }).recessDepth).toEqual({
        min: 0.2,
        max: maxDepth,
      })
      expect(
        normalizeGrilleSettings({ thickness, recessDepth: 10 }).recessDepth,
      ).toBe(maxDepth)
      expect(
        normalizeGrilleSettings({ thickness, recessDepth: maxDepth })
          .recessDepth,
      ).toBe(maxDepth)
    }
  })

  it('clamps an existing deep recess when the grille thickness is reduced', () => {
    const deep = normalizeGrilleSettings({ thickness: 3.5, recessDepth: 3 })
    const thin = normalizeGrilleSettings({ ...deep, thickness: 2 })
    expect(deep.recessDepth).toBe(3)
    expect(thin.recessDepth).toBe(1.5)
    expect(
      normalizeGrilleSettings({ ...thin, thickness: 3.5 }).recessDepth,
    ).toBe(1.5)
  })

  it.each(['round', 'hex', 'slot'] as const)(
    '%s cutters fill a continuous lattice across the speaker apertures and face',
    (pattern) => {
      for (const model of ['s', 'm'] as const)
        for (const layout of ['grid', 'staggered'] as const)
          for (const rotation of [0, 37, 90]) {
            const result = getGrillePattern(model, {
              mode: 'custom',
              pattern,
              layout,
              rotation,
              extendPattern: true,
              size: 4,
              spacing: 2,
              slotLength: 16,
            })
            expect(result.holes.some((hole) => hole.kind === 'through')).toBe(
              true,
            )
            expect(result.holes.some((hole) => hole.kind === 'recess')).toBe(
              true,
            )
            const key = (x: number, y: number) =>
              `${x.toFixed(6)},${y.toFixed(6)}`.replaceAll(
                '-0.000000',
                '0.000000',
              )
            const centers = new Set(result.holes.map(({ x, y }) => key(x, y)))
            const pitchX = pattern === 'slot' ? 18 : 6
            const pitchY =
              layout === 'staggered' && pattern !== 'slot'
                ? 3 * Math.sqrt(3)
                : 6
            const angle = (rotation * Math.PI) / 180
            const neighbors = [
              [pitchX, 0],
              [layout === 'staggered' ? pitchX / 2 : 0, pitchY],
            ].flatMap(([x, y]) => {
              const dx = x * Math.cos(angle) - y * Math.sin(angle)
              const dy = x * Math.sin(angle) + y * Math.cos(angle)
              return [
                [dx, dy],
                [-dx, -dy],
              ]
            })
            const withinFace = (x: number, y: number) =>
              x >= result.bounds.minX - 1e-7 &&
              x <= result.bounds.maxX + 1e-7 &&
              y >= result.bounds.minY - 1e-7 &&
              y <= result.bounds.maxY + 1e-7
            for (const hole of result.holes) {
              expect(hole.points.every(([x, y]) => withinFace(x, y))).toBe(true)
              expect(hole.kind === 'through').toBe(
                result.openings.some((opening) =>
                  hole.points.every(
                    ([x, y]) =>
                      Math.hypot(x - opening.x, y - opening.y) <=
                      GRILLE_PERFORATION_RADIUS,
                  ),
                ),
              )
              // Every neighboring outline that fits on the face must exist,
              // including at the change from perforations to shallow recesses.
              for (const [dx, dy] of neighbors)
                if (hole.points.every(([x, y]) => withinFace(x + dx, y + dy)))
                  expect(centers.has(key(hole.x + dx, hole.y + dy))).toBe(true)
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
    for (const [x, y] of [
      [0, 6],
      [30, -24],
      [0, -54],
      [36, 0],
    ])
      expect(
        extended.holes.find((hole) => hole.x === x && hole.y === y)?.kind,
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
