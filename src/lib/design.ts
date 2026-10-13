import {
  DEFAULT_KNOB_SETTINGS,
  normalizeKnobSettings,
  type KnobSettings,
} from './knob-settings'
import {
  getDefaultHandleSettings,
  normalizeHandleSettings,
  type HandleSettings,
} from './handle-settings'
import {
  DEFAULT_GRILLE_SETTINGS,
  normalizeGrilleSettings,
  type GrilleSettings,
} from './grille-settings'
import {
  DEFAULT_HALO_SETTINGS,
  normalizeHaloSettings,
  type HaloSettings,
} from './halo-settings'
import type { PanelStyle } from './panels'

export const PALETTE = [
  { name: 'CMF orange', value: '#f45427' },
  { name: 'Graphite', value: '#303538' },
  { name: 'Chalk', value: '#eeeae1' },
  { name: 'Lagoon', value: '#13b7b1' },
  { name: 'Soft pink', value: '#e4b8b4' },
  { name: 'Cobalt', value: '#5573ce' },
] as const

export type Design = {
  model: 's' | 'm'
  style: PanelStyle
  panelColor: string
  knobColor: string
  relief: number
  handle: HandleSettings
  grille: GrilleSettings
  halo: HaloSettings
  knob: KnobSettings
}
export const DEFAULT_DESIGN: Design = {
  model: 's',
  style: 'original',
  panelColor: '#f45427',
  knobColor: '#303538',
  relief: 0,
  handle: getDefaultHandleSettings('s'),
  grille: { ...DEFAULT_GRILLE_SETTINGS },
  halo: { ...DEFAULT_HALO_SETTINGS },
  knob: { ...DEFAULT_KNOB_SETTINGS },
}
export const STORAGE_KEY = 'cmf-speaker-design-v1'
const isColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

export function validateDesign(value: unknown): Design {
  const data =
    value && typeof value === 'object' ? (value as Partial<Design>) : {}
  const model = data.model === 'm' ? 'm' : 's'
  const grille = normalizeGrilleSettings(data.grille ?? {})
  const halo = normalizeHaloSettings(data.halo ?? {})
  return {
    model,
    knob: normalizeKnobSettings(data.knob ?? {}),
    grille,
    halo,
    handle: normalizeHandleSettings(
      model,
      data.handle ?? getDefaultHandleSettings(model),
    ),
    style:
      data.style === 'custom' ||
      grille.mode === 'custom' ||
      halo.mode === 'custom'
        ? 'custom'
        : 'original',
    panelColor: isColor(data.panelColor)
      ? data.panelColor
      : DEFAULT_DESIGN.panelColor,
    knobColor: isColor(data.knobColor)
      ? data.knobColor
      : DEFAULT_DESIGN.knobColor,
    relief:
      typeof data.relief === 'number' && Number.isFinite(data.relief)
        ? Math.round(Math.min(2, Math.max(0, data.relief)) * 10) / 10
        : 0,
  }
}

export function readDesign(): Design {
  try {
    const shared = new URLSearchParams(window.location.search).get('design')
    if (shared) return validateDesign(JSON.parse(shared))
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return validateDesign(JSON.parse(saved))
  } catch {
    /* A malformed link or unavailable storage falls back to the default. */
  }
  return { ...DEFAULT_DESIGN }
}

export function colorName(color: string) {
  return (
    PALETTE.find((item) => item.value.toLowerCase() === color.toLowerCase())
      ?.name ?? color.toUpperCase()
  )
}
