import { useEffect, useState } from 'react'
import type { BufferGeometry } from 'three'
import type { Design } from './design'
import { buildPanelGeometry } from './panels'

export interface PanelSource {
  geometry: BufferGeometry
  model: Design['model']
  style: Design['style']
}

/** Keep the last preview visible while a worker generates the latest design. */
export function usePanelGeometry(
  source: PanelSource | null,
  design: Design,
  retryKey: number,
) {
  const [result, setResult] = useState<(PanelSource & { key: string }) | null>(
    null,
  )
  const [failure, setFailure] = useState<{
    key: string
    message: string
  } | null>(null)
  const matches =
    source?.model === design.model && source?.style === design.style
  const key = `${matches ? source.geometry.uuid : 'loading'}:${design.model}:${design.style}:${design.relief}:${JSON.stringify(design.handle)}:${retryKey}`

  useEffect(() => {
    if (!matches || !source) return
    let active = true
    const generate = async () => {
      try {
        const geometry =
          design.handle.mode === 'original'
            ? buildPanelGeometry(
                source.geometry,
                source.model,
                source.style,
                design.relief,
              )
            : await (
                await import('./handles')
              ).buildHandledPanelGeometry(
                source.geometry,
                source.model,
                source.style,
                design.relief,
                design.handle,
              )
        if (!active) {
          geometry.dispose()
          return
        }
        setResult({ geometry, model: source.model, style: source.style, key })
        setFailure(null)
      } catch (error) {
        if (active)
          setFailure({
            key,
            message:
              error instanceof Error
                ? error.message
                : 'This handle could not be generated. Please try again.',
          })
      }
    }
    const timer = window.setTimeout(
      generate,
      design.handle.mode === 'custom' ? 160 : 0,
    )
    return () => {
      active = false
      window.clearTimeout(timer)
    }
    // The key includes the source identity and every geometry-affecting setting.
  }, [key])

  useEffect(() => () => result?.geometry.dispose(), [result])
  const geometry = result?.key === key ? result.geometry : null
  const previewGeometry =
    matches && result?.model === design.model && result?.style === design.style
      ? result.geometry
      : null
  const error = failure?.key === key ? failure.message : ''
  return {
    geometry,
    previewGeometry,
    error,
    generating: matches && !geometry && !error,
  }
}
