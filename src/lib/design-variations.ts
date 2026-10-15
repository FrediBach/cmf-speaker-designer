import { PALETTE, validateDesign, type Design } from './design'
import { randomizeDesign } from './random-design'

export interface DesignVariation {
  id: string
  label: string
  ring: number
  strength: number
  position: [number, number, number]
  design: Design
  panelFallback?: boolean
}

const STRENGTHS = [0.16, 0.5, 1] as const
const RING_LABELS = ['Subtle', 'Explore', 'Bold'] as const

function formationPositions(model: Design['model']) {
  const columnSpacing = 160
  const rowSpacing = model === 'm' ? 230 : 200
  const positions: [number, number, number][] = []
  for (let row = -2; row <= 2; row += 1) {
    for (let column = -2; column <= 2; column += 1) {
      if (row !== 0 || column !== 0)
        positions.push([column * columnSpacing, 0, row * rowSpacing])
    }
  }
  const angle = ([x, , z]: [number, number, number]) =>
    (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2)
  // Keep every speaker on the same floor, with bolder choices occupying
  // successively more distant cells of the formation.
  positions.sort(
    (a, b) => Math.hypot(...a) - Math.hypot(...b) || angle(a) - angle(b),
  )
  return STRENGTHS.map((_, band) =>
    positions
      .slice(band * 8, (band + 1) * 8)
      .sort((a, b) => angle(a) - angle(b)),
  )
}

/**
 * Keep a rejected panel suggestion useful without weakening geometry checks.
 * Reuse the original's proven panel and artwork, retaining the candidate's
 * body, colors, and independently generated knob. The caller must preview this
 * returned config before offering it as a selectable replacement.
 */
export function panelSafeVariation(base: Design, candidate: Design): Design {
  const original = structuredClone(base)
  const fallback = structuredClone(candidate)
  return validateDesign({
    ...fallback,
    model: original.model,
    style: original.style,
    relief: original.relief,
    panelExtension: original.panelExtension,
    panelGap: original.panelGap,
    handle: original.handle,
    grille: original.grille,
    halo: original.halo,
    raceStripes: original.raceStripes,
    multicolor: {
      ...original.multicolor,
      materials: original.multicolor.materials.map((material) => ({
        ...material,
        color:
          fallback.multicolor.materials.find(({ id }) => id === material.id)
            ?.color ?? material.color,
      })),
    },
  })
}

function mixColor(from: string, to: string, strength: number) {
  return `#${[1, 3, 5]
    .map((offset) => {
      const start = parseInt(from.slice(offset, offset + 2), 16)
      const end = parseInt(to.slice(offset, offset + 2), 16)
      return Math.round(start + (end - start) * strength)
        .toString(16)
        .padStart(2, '0')
    })
    .join('')}`
}

/** Interpolate dimensions while keeping categorical changes explicit. */
function mixSettings<T extends object>(
  from: T,
  to: T,
  strength: number,
  changeModes: boolean,
): T {
  return Object.fromEntries(
    Object.entries(from).map(([key, start]) => {
      const end = to[key as keyof T]
      return [
        key,
        typeof start === 'number' && typeof end === 'number'
          ? Number((start + (end - start) * strength).toFixed(3))
          : changeModes
            ? end
            : start,
      ]
    }),
  ) as T
}

function mixDesign(
  base: Design,
  target: Design,
  ring: number,
  direction: number,
): Design {
  const strength = STRENGTHS[ring - 1]
  // The middle ring explores one component family per direction. The outer
  // ring can change every family, while nearby copies retain their identity.
  const changes = (family: number) =>
    ring === 3 || (ring === 2 && direction % 5 === family)
  const mix = (from: number, to: number) => from + (to - from) * strength
  const design: Design = {
    ...structuredClone(base),
    bodyColor: ring === 3 ? target.bodyColor : base.bodyColor,
    bodyGrilleColor: ring === 3 ? target.bodyGrilleColor : base.bodyGrilleColor,
    style: ring === 3 ? target.style : base.style,
    panelColor: mixColor(base.panelColor, target.panelColor, strength),
    powerButtonColor: mixColor(
      base.powerButtonColor,
      target.powerButtonColor,
      strength,
    ),
    knobColor: mixColor(base.knobColor, target.knobColor, strength),
    relief: mix(base.relief, target.relief),
    panelExtension: mix(base.panelExtension, target.panelExtension),
    panelGap: mix(base.panelGap, target.panelGap),
    handle: mixSettings(base.handle, target.handle, strength, changes(0)),
    grille: mixSettings(base.grille, target.grille, strength, changes(1)),
    halo: mixSettings(base.halo, target.halo, strength, changes(2)),
    knob: mixSettings(base.knob, target.knob, strength, changes(3)),
    raceStripes: mixSettings(
      base.raceStripes,
      target.raceStripes,
      strength,
      changes(4),
    ),
  }

  // Uploaded artwork is never regenerated or edited by a nearby suggestion.
  if (base.handle.cutout === 'svg' && !changes(0))
    design.handle = structuredClone(base.handle)

  // Keep masks and their IDs intact; changing material colors does not invent
  // new boolean geometry for every member of the exploration field.
  design.multicolor.materials = base.multicolor.materials.map(
    (material, index) => ({
      ...material,
      color: mixColor(
        material.color,
        PALETTE[(direction + index) % PALETTE.length].value,
        strength,
      ),
    }),
  )
  return validateDesign(design)
}

/**
 * Create an isolated exploration session. Each direction follows one random
 * target, so colors and dimensions diverge progressively with distance. Nothing
 * is applied to the caller's design until the caller chooses a result.
 */
export function createDesignVariations(
  base: Design,
  random: () => number = Math.random,
): DesignVariation[] {
  const positions = formationPositions(base.model)
  const targets = Array.from({ length: 8 }, (_, direction) => {
    const target = randomizeDesign(base.model, random)
    // Rotate each direction's palette to retain variety even for a constant RNG.
    const panelIndex = PALETTE.findIndex(
      ({ value }) => value === target.panelColor,
    )
    const knobIndex = PALETTE.findIndex(
      ({ value }) => value === target.knobColor,
    )
    target.panelColor = PALETTE[(panelIndex + direction) % PALETTE.length].value
    target.knobColor =
      PALETTE[
        (knobIndex + Math.floor(direction / PALETTE.length)) % PALETTE.length
      ].value
    // The full randomizer can create stripes. This explorer keeps the user's
    // existing artwork instead; new mask layouts belong to explicit editing.
    target.multicolor = structuredClone(base.multicolor)
    return target
  })
  const variations: DesignVariation[] = [
    {
      id: 'original',
      label: 'Original',
      ring: 0,
      strength: 0,
      position: [0, 0, 0],
      design: structuredClone(base),
    },
  ]
  const seen = new Set([JSON.stringify(base)])
  for (let ring = 1; ring <= STRENGTHS.length; ring += 1) {
    for (let direction = 0; direction < targets.length; direction += 1) {
      const design = mixDesign(base, targets[direction], ring, direction)
      // A target can coincide with an unusual starting design. Keep all
      // choices distinct with a tiny color adjustment in that rare case.
      while (seen.has(JSON.stringify(design))) {
        const color = (parseInt(design.panelColor.slice(1), 16) + 1) % 0x1000000
        design.panelColor = `#${color.toString(16).padStart(6, '0')}`
      }
      seen.add(JSON.stringify(design))
      variations.push({
        id: `variation-${ring}-${direction + 1}`,
        label: `${RING_LABELS[ring - 1]} ${direction + 1}`,
        ring,
        strength: STRENGTHS[ring - 1],
        position: positions[ring - 1][direction],
        design,
      })
    }
  }
  return variations
}
