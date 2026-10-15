import { useEffect, useState } from 'react'
import type { BufferGeometry } from 'three'
import type { Design } from './design'
import { loadPanelGeometry, getPanelDimensions } from './panels'
import { usePanelGeometry } from './use-panel-geometry'
import { useKnobGeometry } from './use-knob-geometry'
import { useMulticolorGeometry } from './use-multicolor-geometry'

export function useDesignGeometry(design: Design, retryKey: number) {
  const sourceStyle = 'original'
  const [source, setSource] = useState<{
    geometry: BufferGeometry
    model: Design['model']
    style: Design['style']
  } | null>(null)
  const [loadError, setLoadError] = useState('')
  const {
    geometry,
    previewGeometry,
    error: generationError,
    generating,
  } = usePanelGeometry(source, design, retryKey)
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
  const error = loadError || generationError
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoadError('')
    loadPanelGeometry(design.model, sourceStyle, controller.signal)
      .then((loaded) => {
        if (!active) {
          loaded.dispose()
          return
        }
        setSource({
          geometry: loaded,
          model: design.model,
          style: sourceStyle,
        })
      })
      .catch(() => {
        if (active) setLoadError('The panel could not load. Please try again.')
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [design.model, sourceStyle, retryKey])

  useEffect(
    () => () => {
      source?.geometry.dispose()
    },
    [source],
  )
  return {
    geometry,
    previewGeometry,
    knobGeometry,
    previewKnobGeometry,
    error,
    knobError,
    generating,
    knobGenerating,
    panelWidth,
    panelHeight,
    knobDimensions,
    materialParts: multicolor.parts,
    previewMaterialParts: multicolor.previewParts,
    multicolorGenerating: multicolor.generating,
    multicolorError: multicolor.error,
    multicolorDiagnostics: multicolor.diagnostics,
  }
}
