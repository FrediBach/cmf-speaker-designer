import type { SpeakerModel } from './panels'

export interface GrilleSettings {
  mode: 'original' | 'custom'
  pattern: 'round' | 'hex' | 'slot'
  layout: 'grid' | 'staggered'
  size: number
  spacing: number
  slotLength: number
  rotation: number
  thickness: number
  extendPattern: boolean
  recessDepth: number
}

export const DEFAULT_GRILLE_SETTINGS: GrilleSettings = {
  mode: 'original',
  pattern: 'round',
  layout: 'staggered',
  size: 4,
  spacing: 2,
  slotLength: 12,
  rotation: 0,
  thickness: 3.5,
  extendPattern: false,
  recessDepth: 0.6,
}

export const GRILLE_LIMITS = {
  size: { min: 2, max: 10 },
  spacing: { min: 1.2, max: 6 },
  slotLength: { min: 4, max: 24 },
  rotation: { min: 0, max: 90 },
  thickness: { min: 2, max: 4 },
  recessDepth: { min: 0.2, max: 1.2 },
} as const

const bounded = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback

export function normalizeGrilleSettings(
  input: Partial<GrilleSettings> = {},
): GrilleSettings {
  const values = Object.fromEntries(
    Object.entries(GRILLE_LIMITS).map(([key, range]) => [
      key,
      bounded(
        input[key as keyof GrilleSettings],
        DEFAULT_GRILLE_SETTINGS[key as keyof GrilleSettings] as number,
        range.min,
        range.max,
      ),
    ]),
  ) as Pick<GrilleSettings, keyof typeof GRILLE_LIMITS>
  values.slotLength = Math.max(values.slotLength, values.size)
  return {
    ...values,
    mode: input.mode === 'custom' ? 'custom' : 'original',
    pattern:
      input.pattern === 'hex' || input.pattern === 'slot'
        ? input.pattern
        : 'round',
    layout: input.layout === 'grid' ? 'grid' : 'staggered',
    extendPattern: input.extendPattern === true,
  }
}

export function getGrilleLimits(input: Partial<GrilleSettings> = {}) {
  const settings = normalizeGrilleSettings(input)
  return {
    ...GRILLE_LIMITS,
    slotLength: { min: Math.max(4, settings.size), max: 24 },
  }
}

export interface GrilleOpening {
  x: number
  y: number
  radius: number
}
export interface GrilleHole {
  x: number
  y: number
  points: [number, number][]
  kind: 'through' | 'recess'
}
export interface GrillePattern {
  holes: GrilleHole[]
  openings: GrilleOpening[]
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
}

export const GRILLE_INSERT_RADIUS = 33.1
export const GRILLE_PERFORATION_RADIUS = 30.5
export const GRILLE_RECESS_EXCLUSION_RADIUS = 34.1

export function getGrilleOpenings(model: SpeakerModel): GrilleOpening[] {
  return (model === 's' ? [-23] : [15, -70]).map((y) => ({
    x: 0,
    y,
    radius: 32.696541,
  }))
}

function holeOutline(settings: GrilleSettings): [number, number][] {
  const radius = settings.size / 2
  if (settings.pattern === 'hex')
    return Array.from({ length: 6 }, (_, index) => [
      radius * Math.cos((index * Math.PI) / 3),
      radius * Math.sin((index * Math.PI) / 3),
    ])
  if (settings.pattern === 'round')
    return Array.from({ length: 32 }, (_, index) => [
      radius * Math.cos((index * Math.PI) / 16),
      radius * Math.sin((index * Math.PI) / 16),
    ])
  const points: [number, number][] = []
  for (const [center, start] of [
    [(settings.slotLength - settings.size) / 2, -90],
    [-(settings.slotLength - settings.size) / 2, 90],
  ]) {
    for (let step = 0; step <= 16; step += 1) {
      const angle = ((start + (step * 180) / 16) * Math.PI) / 180
      points.push([center + Math.cos(angle) * radius, Math.sin(angle) * radius])
    }
  }
  return points
}

function distanceToSegment(
  x: number,
  y: number,
  a: [number, number],
  b: [number, number],
) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1]
  const length = dx * dx + dy * dy
  const t =
    length > 0
      ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / length))
      : 0
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)
}

/** Shared by the CAD kernel and the UI: all points are canonical millimeters. */
export function getGrillePattern(
  model: SpeakerModel,
  input: Partial<GrilleSettings>,
): GrillePattern {
  const settings = normalizeGrilleSettings(input)
  const openings = getGrilleOpenings(model)
  const bounds = {
    minX: -38,
    maxX: 38,
    minY: model === 's' ? -61 : -108,
    maxY: model === 's' ? 15 : 53,
  }
  const outline = holeOutline(settings)
  const pitchX =
    (settings.pattern === 'slot' ? settings.slotLength : settings.size) +
    settings.spacing
  const pitchY =
    (settings.size + settings.spacing) *
    (settings.layout === 'staggered' && settings.pattern !== 'slot'
      ? Math.sqrt(3) / 2
      : 1)
  const angle = (settings.rotation * Math.PI) / 180
  const cos = Math.cos(angle),
    sin = Math.sin(angle)
  const extent =
    Math.hypot(42, Math.max(Math.abs(bounds.minY), Math.abs(bounds.maxY))) + 25
  const holes: GrilleHole[] = []
  for (
    let row = -Math.ceil(extent / pitchY);
    row <= Math.ceil(extent / pitchY);
    row += 1
  ) {
    const offset =
      settings.layout === 'staggered' && Math.abs(row % 2) === 1
        ? pitchX / 2
        : 0
    for (
      let column = -Math.ceil(extent / pitchX);
      column <= Math.ceil(extent / pitchX);
      column += 1
    ) {
      const u = column * pitchX + offset,
        v = row * pitchY
      const x = u * cos - v * sin,
        y = u * sin + v * cos
      const points: [number, number][] = outline.map(([a, b]) => [
        x + a * cos - b * sin,
        y + a * sin + b * cos,
      ])
      if (
        !points.every(
          ([px, py]) =>
            px >= bounds.minX - 1e-8 &&
            px <= bounds.maxX + 1e-8 &&
            py >= bounds.minY - 1e-8 &&
            py <= bounds.maxY + 1e-8,
        )
      )
        continue
      if (
        openings.some((opening) =>
          points.every(
            ([px, py]) =>
              Math.hypot(px - opening.x, py - opening.y) <=
              GRILLE_PERFORATION_RADIUS,
          ),
        )
      ) {
        holes.push({ x, y, points, kind: 'through' })
      } else if (
        settings.extendPattern &&
        openings.every(
          (opening) =>
            Math.hypot(x - opening.x, y - opening.y) >
              GRILLE_RECESS_EXCLUSION_RADIUS &&
            points.every(
              (point, index) =>
                distanceToSegment(
                  opening.x,
                  opening.y,
                  point,
                  points[(index + 1) % points.length],
                ) >= GRILLE_RECESS_EXCLUSION_RADIUS,
            ),
        )
      ) {
        holes.push({ x, y, points, kind: 'recess' })
      }
    }
  }
  return { holes, openings, bounds }
}
