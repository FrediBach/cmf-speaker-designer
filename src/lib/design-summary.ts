import type { Design } from './design'
import { getPanelStyles } from './panels'
import { KNOB_STYLES } from './knob-settings'

export function getDesignSummary(design: Design) {
  const styles = getPanelStyles(design.model)
  const currentStyle = styles.find((item) => item.id === design.style)!
  const customHalo = design.halo.mode === 'custom'
  const customGrille = design.grille.mode === 'custom'
  const grilleLabel = `${{ round: 'Round', hex: 'Hexagonal', slot: 'Slotted' }[design.grille.pattern]} grille`
  const haloLabel = design.model === 'm' ? 'Custom Halos' : 'Custom Halo'
  const panelLabel = customHalo
    ? `${haloLabel}${customGrille ? ` · ${grilleLabel}` : ''}`
    : customGrille
      ? grilleLabel
      : currentStyle.label
  const knobLabel =
    KNOB_STYLES.find((item) => item.id === design.knob.style)?.label ??
    'Volume knob'
  return {
    styles,
    currentStyle,
    customHalo,
    customGrille,
    haloLabel,
    panelLabel,
    knobLabel,
  }
}
