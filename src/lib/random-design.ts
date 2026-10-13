import { PALETTE, validateDesign, type Design } from './design'
import { KNOB_STYLES } from './knob-settings'

/** Generate a fresh design; only the selected speaker version carries over. */
export function randomizeDesign(
  model: Design['model'],
  random: () => number = Math.random,
): Design {
  const pick = <T>(values: readonly T[]): T =>
    values[Math.floor(random() * values.length)]
  const range = (min: number, max: number, step = 1) =>
    Number(
      (
        min +
        Math.floor(random() * (Math.round((max - min) / step) + 1)) * step
      ).toFixed(2),
    )
  const mode = () => pick(['original', 'custom', 'custom'] as const)
  const handleMode = mode()
  const grilleMode = mode()
  const haloMode = mode()

  return validateDesign({
    model,
    style: 'custom',
    panelColor: pick(PALETTE).value,
    knobColor: pick(PALETTE).value,
    relief: range(0, 2, 0.1),
    handle: {
      // Always include a visible custom component, even when both face
      // components happened to land on their original versions.
      mode:
        grilleMode === 'original' && haloMode === 'original'
          ? 'custom'
          : handleMode,
      height: range(24, 56, 4) + (model === 'm' ? 3 : 0),
      width: range(70, 110, 5),
      cornerRadius: range(0, 12, 2),
      cutout: pick(['none', 'circle', 'slot'] as const),
      holeCount: range(1, 3),
      holeWidth: range(8, 48, 4),
      holeHeight: range(8, 24, 2),
      holeGap: range(4, 12, 2),
      offsetX: range(-8, 8, 2),
      offsetY: range(-4, 4, 2),
    },
    grille: {
      mode: grilleMode,
      pattern: pick(['round', 'hex', 'slot'] as const),
      layout: pick(['grid', 'staggered'] as const),
      // A generous minimum pitch keeps random full-face patterns responsive.
      size: range(4, 8),
      spacing: range(2, 5, 0.5),
      slotLength: range(8, 20, 2),
      rotation: range(0, 90, 15),
      thickness: range(2.5, 4, 0.5),
      extendPattern: pick([false, true]),
      recessDepth: range(0.4, 1.6, 0.2),
    },
    halo: {
      mode: haloMode,
      // M has two openings 85 mm apart. These ranges leave clearance between
      // the complete outer rims, including their maximum flare and thickness.
      outwardAngle: range(0, model === 'm' ? 12.5 : 25, 2.5),
      depth: range(8, model === 'm' ? 24 : 30, 2),
      thickness: range(2, 4, 0.5),
      rimHeight: range(0, 3, 0.5),
      cutAngle: range(0, 25, 5),
      cutRotation: range(0, 315, 45),
    },
    knob: {
      style: pick(KNOB_STYLES).id,
      height: range(12, 24, 2),
      taper: range(0, 1, 0.1),
      fluteCount: range(8, 28, 4),
      fluteDepth: range(0.4, 1.2, 0.2),
      flutePath: pick(['straight', 'spiral', 'chevron'] as const),
      facets: range(5, 12),
    },
  })
}
