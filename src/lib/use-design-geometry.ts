import type { Design } from './design'
import { getPanelDimensions } from './panels'
import { usePanelGeometry } from './use-panel-geometry'
import { useKnobGeometry } from './use-knob-geometry'
import { usePowerButtonGeometry } from './use-power-button-geometry'
import { useMulticolorGeometry } from './use-multicolor-geometry'

export function useDesignGeometry(design: Design, retryKey: number) {
  const { geometry, previewGeometry, error, generating } = usePanelGeometry(
    design,
    retryKey,
  )
  const multicolor = useMulticolorGeometry(
    geometry,
    design.multicolor,
    retryKey,
  )
  const {
    geometry: knobGeometry,
    previewGeometry: previewKnobGeometry,
    error: knobError,
    generating: knobGenerating,
  } = useKnobGeometry(design.knob, retryKey)
  const {
    geometry: powerButtonGeometry,
    previewGeometry: previewPowerButtonGeometry,
    error: powerButtonError,
    generating: powerButtonGenerating,
  } = usePowerButtonGeometry(retryKey)
  const powerButtonBounds = previewPowerButtonGeometry?.boundingBox
  const powerButtonDimensions = powerButtonBounds
    ? [
        powerButtonBounds.max.x - powerButtonBounds.min.x,
        powerButtonBounds.max.y - powerButtonBounds.min.y,
        powerButtonBounds.max.z - powerButtonBounds.min.z,
      ]
        .map((value) => Number(value.toFixed(2)))
        .join(' × ')
    : null
  const knobBounds = previewKnobGeometry?.boundingBox
  const knobDimensions = knobBounds
    ? `Ø${Number(Math.max(knobBounds.max.x - knobBounds.min.x, knobBounds.max.y - knobBounds.min.y).toFixed(2))} × ${Number((knobBounds.max.z - knobBounds.min.z).toFixed(2))}`
    : null
  const dimensions = previewGeometry
    ? getPanelDimensions(previewGeometry)
    : null
  const panelWidth = dimensions ? Math.round(dimensions.width) : 85
  const panelHeight = dimensions
    ? Math.round(dimensions.height)
    : design.model === 's'
      ? 131
      : 225
  return {
    geometry,
    previewGeometry,
    knobGeometry,
    previewKnobGeometry,
    powerButtonGeometry,
    previewPowerButtonGeometry,
    error,
    knobError,
    powerButtonError,
    generating,
    knobGenerating,
    powerButtonGenerating,
    panelWidth,
    panelHeight,
    knobDimensions,
    powerButtonDimensions,
    materialParts: multicolor.parts,
    previewMaterialParts: multicolor.previewParts,
    multicolorGenerating: multicolor.generating,
    multicolorError: multicolor.error,
    multicolorDiagnostics: multicolor.diagnostics,
  }
}
