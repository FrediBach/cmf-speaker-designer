import { useEffect, useState } from 'react'
import type { BufferGeometry } from 'three'
import type { KnobSettings } from './knob-settings'

/** Only the current geometry can export; pending edits keep the last preview. */
export function useKnobGeometry(settings: KnobSettings, retryKey: number) {
  const key = `${JSON.stringify(settings)}:${retryKey}`
  const [result, setResult] = useState<{
    key: string
    geometry: BufferGeometry
  } | null>(null)
  const [failure, setFailure] = useState<{
    key: string
    message: string
  } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const { buildKnobGeometryInWorker } = await import('./knob-client')
        const geometry = await buildKnobGeometryInWorker(
          settings,
          controller.signal,
        )
        if (controller.signal.aborted) {
          geometry.dispose()
          return
        }
        setResult({ key, geometry })
        setFailure(null)
      } catch (error) {
        if (!controller.signal.aborted)
          setFailure({
            key,
            message:
              error instanceof Error
                ? error.message
                : 'The knob could not load. Please try again.',
          })
      }
    }, 120)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
    // The key contains every geometry setting and the explicit retry request.
  }, [key])

  useEffect(() => () => result?.geometry.dispose(), [result])
  const geometry = result?.key === key ? result.geometry : null
  const error = failure?.key === key ? failure.message : ''
  return {
    geometry,
    previewGeometry: result?.geometry ?? null,
    error,
    generating: !geometry && !error,
  }
}
