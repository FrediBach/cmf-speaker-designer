import { useEffect, useState } from 'react'
import type { BufferGeometry } from 'three'
import type { Design } from './design'

export interface PanelSource {
  geometry: BufferGeometry
  model: Design['model']
  style: Design['style']
}

/** Keep the last preview visible while a worker generates the latest design. */
export function usePanelGeometry(design: Design, retryKey: number) {
  const [result, setResult] = useState<(PanelSource & { key: string }) | null>(
    null,
  )
  const [failure, setFailure] = useState<{
    key: string
    message: string
  } | null>(null)
  const key = `${design.model}:${design.style}:${design.relief}:${design.panelExtension}:${design.panelGap}:${JSON.stringify(design.handle)}:${JSON.stringify(design.grille)}:${JSON.stringify(design.halo)}:${JSON.stringify(design.raceStripes)}:${retryKey}`

  useEffect(() => {
    const controller = new AbortController()
    const generate = async () => {
      try {
        const { buildDesignPanelGeometry } = await import('./handles')
        const geometry = await buildDesignPanelGeometry(
          design,
          controller.signal,
        )
        if (controller.signal.aborted) {
          geometry.dispose()
          return
        }
        setResult({ geometry, model: design.model, style: 'original', key })
        setFailure(null)
      } catch (error) {
        if (!controller.signal.aborted)
          setFailure({
            key,
            message:
              error instanceof Error
                ? error.message
                : 'This panel could not be generated. Please try again.',
          })
      }
    }
    const timer = window.setTimeout(
      generate,
      design.handle.mode === 'custom' ||
        design.grille.mode === 'custom' ||
        design.halo.mode === 'custom' ||
        design.panelGap > 0 ||
        design.raceStripes.enabled
        ? 180
        : 0,
    )
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
    // The key includes every geometry-affecting setting and explicit retry.
  }, [key])

  useEffect(() => () => result?.geometry.dispose(), [result])
  const geometry = result?.key === key ? result.geometry : null
  const previewGeometry =
    result?.model === design.model ? result.geometry : null
  const error = failure?.key === key ? failure.message : ''
  return {
    geometry,
    previewGeometry,
    error,
    generating: !geometry && !error,
  }
}
