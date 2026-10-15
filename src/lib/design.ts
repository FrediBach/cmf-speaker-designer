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
import {
  DEFAULT_RACE_STRIPE_SETTINGS,
  normalizeRaceStripeSettings,
  type RaceStripeSettings,
} from './race-stripe-settings'
import {
  getDefaultMulticolorSettings,
  normalizeMulticolorSettings,
  type MulticolorSettings,
} from './multicolor-settings'

export const PALETTE = [
  { name: 'CMF orange', value: '#f45427' },
  { name: 'Graphite', value: '#303538' },
  { name: 'Chalk', value: '#eeeae1' },
  { name: 'Lagoon', value: '#13b7b1' },
  { name: 'Soft pink', value: '#e4b8b4' },
  { name: 'Cobalt', value: '#5573ce' },
] as const

export const BODY_COLORS = {
  black: { label: 'Black', shell: '#272b2e', radiator: '#2b2f31' },
  gray: { label: 'Gray', shell: '#929697', radiator: '#85898a' },
} as const

export type BodyColor = keyof typeof BODY_COLORS

export const BODY_GRILLE_COLORS = {
  black: { label: 'Black', value: '#2c2e2f' },
  orange: { label: 'Orange', value: '#f45427' },
  turquoise: { label: 'Turquoise', value: '#13b7b1' },
} as const

export type BodyGrilleColor = keyof typeof BODY_GRILLE_COLORS

export function normalizeBodyGrilleColor(
  bodyColor: BodyColor,
  value: unknown,
): BodyGrilleColor {
  return bodyColor === 'black' && (value === 'orange' || value === 'turquoise')
    ? value
    : 'black'
}

export type Design = {
  model: 's' | 'm'
  bodyColor: BodyColor
  bodyGrilleColor: BodyGrilleColor
  style: PanelStyle
  panelColor: string
  knobColor: string
  relief: number
  panelExtension: number
  panelGap: number
  handle: HandleSettings
  grille: GrilleSettings
  halo: HaloSettings
  raceStripes: RaceStripeSettings
  multicolor: MulticolorSettings
  knob: KnobSettings
}
export const DEFAULT_DESIGN: Design = {
  model: 's',
  bodyColor: 'black',
  bodyGrilleColor: 'black',
  style: 'original',
  panelColor: '#f45427',
  knobColor: '#303538',
  relief: 0,
  panelExtension: 0,
  panelGap: 0,
  handle: getDefaultHandleSettings('s'),
  grille: { ...DEFAULT_GRILLE_SETTINGS },
  halo: { ...DEFAULT_HALO_SETTINGS },
  raceStripes: { ...DEFAULT_RACE_STRIPE_SETTINGS },
  multicolor: getDefaultMulticolorSettings('s'),
  knob: { ...DEFAULT_KNOB_SETTINGS },
}
export const STORAGE_KEY = 'cmf-speaker-design-v1'
const isColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

export function validateDesign(value: unknown): Design {
  const data =
    value && typeof value === 'object' ? (value as Partial<Design>) : {}
  const model = data.model === 'm' ? 'm' : 's'
  const bodyColor = data.bodyColor === 'gray' ? 'gray' : 'black'
  const grille = normalizeGrilleSettings(data.grille ?? {})
  const halo = normalizeHaloSettings(data.halo ?? {})
  const raceStripes = normalizeRaceStripeSettings(data.raceStripes ?? {})
  return {
    model,
    bodyColor,
    bodyGrilleColor: normalizeBodyGrilleColor(bodyColor, data.bodyGrilleColor),
    knob: normalizeKnobSettings(data.knob ?? {}),
    grille,
    halo,
    raceStripes,
    multicolor: normalizeMulticolorSettings(data.multicolor, model),
    handle: normalizeHandleSettings(
      model,
      data.handle ?? getDefaultHandleSettings(model),
    ),
    style:
      data.style === 'custom' ||
      grille.mode === 'custom' ||
      halo.mode === 'custom' ||
      raceStripes.enabled
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
    panelExtension:
      typeof data.panelExtension === 'number' &&
      Number.isFinite(data.panelExtension)
        ? Math.round(Math.min(10, Math.max(0, data.panelExtension)) * 10) / 10
        : 0,
    panelGap:
      typeof data.panelGap === 'number' && Number.isFinite(data.panelGap)
        ? Math.round(Math.min(5, Math.max(0, data.panelGap)) * 10) / 10
        : 0,
  }
}

/** Keep uploaded geometry out of the URL sent to the web server. */
export function designShareUrl(design: Design, href: string): URL {
  const url = new URL(href)
  url.search = ''
  url.hash = ''
  const parameters = new URLSearchParams({ design: JSON.stringify(design) })
  if (
    design.handle.svgCutout ||
    design.multicolor.enabled ||
    design.multicolor.elements.length
  )
    url.hash = parameters.toString()
  else url.search = parameters.toString()
  return url
}

let loadFailure = ''
let rejectedSavedDesign = false

export function getDesignLoadFailure() {
  return loadFailure
}

/** A rejected saved document stays intact until the user explicitly starts editing. */
export function hasRejectedSavedDesign() {
  return rejectedSavedDesign
}

export function allowDesignSave() {
  rejectedSavedDesign = false
}

export const MAX_DESIGN_JSON_BYTES = 2_000_000
export const MAX_SHARE_URL_LENGTH = 64_000

export function parseDesignJson(text: string): Design {
  if (new TextEncoder().encode(text).length > MAX_DESIGN_JSON_BYTES)
    throw new Error('This design is too large. The maximum JSON size is 2 MB.')
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Choose a design JSON object exported by this designer.')
  if (
    ![
      'model',
      'panelColor',
      'knobColor',
      'handle',
      'grille',
      'halo',
      'multicolor',
    ].some((key) => key in value)
  )
    throw new Error('This JSON does not contain a speaker design.')
  return validateDesign(value)
}

export function readDesign(): Design {
  loadFailure = ''
  rejectedSavedDesign = false
  try {
    const shared =
      new URLSearchParams(window.location.hash?.slice(1)).get('design') ??
      new URLSearchParams(window.location.search).get('design')
    if (shared) return parseDesignJson(shared)
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return parseDesignJson(saved)
  } catch (error) {
    rejectedSavedDesign = true
    loadFailure = `The saved design could not be opened. ${error instanceof Error ? error.message : 'Please load a valid design JSON.'} Your saved data has been retained.`
  }
  return validateDesign({})
}

export function colorName(color: string) {
  return (
    PALETTE.find((item) => item.value.toLowerCase() === color.toLowerCase())
      ?.name ?? color.toUpperCase()
  )
}
