import { useEffect, useState } from 'react'
import type { BufferGeometry } from 'three'

/** The unchanged source is shared by both speaker sizes and all colors. */
export function usePowerButtonGeometry(retryKey: number) {
  const [result, setResult] = useState<{
    key: number
    geometry: BufferGeometry
  } | null>(null)
  const [failure, setFailure] = useState<{
    key: number
    message: string
  } | null>(null)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    import('./power-button')
      .then(({ loadPowerButtonGeometry }) =>
        loadPowerButtonGeometry(controller.signal),
      )
      .then((geometry) => {
        if (!active) {
          geometry.dispose()
          return
        }
        setResult({ key: retryKey, geometry })
        setFailure(null)
      })
      .catch((error: unknown) => {
        if (active)
          setFailure({
            key: retryKey,
            message:
              error instanceof Error
                ? error.message
                : 'The power button could not load. Please try again.',
          })
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [retryKey])

  useEffect(() => () => result?.geometry.dispose(), [result])
  const geometry = result?.key === retryKey ? result.geometry : null
  const error = failure?.key === retryKey ? failure.message : ''
  return {
    geometry,
    previewGeometry: result?.geometry ?? null,
    error,
    generating: !geometry && !error,
  }
}
