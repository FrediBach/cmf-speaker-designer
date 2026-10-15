import { useEffect, useState } from 'react'
import type { BufferGeometry } from 'three'
import {
  multicolorGeometryKey,
  type MaterialGeometry,
} from './multicolor-geometry'
import type { MulticolorSettings } from './multicolor-settings'

interface Result {
  key: string
  source: string
  parts: MaterialGeometry[]
  diagnostics: string[]
}

function disposeParts(parts: MaterialGeometry[]) {
  parts.forEach(({ geometry, previewGeometry }) => {
    geometry.dispose()
    if (previewGeometry !== geometry) previewGeometry?.dispose()
  })
}

/** Geometry identities exclude palette appearance; export receives only current parts. */
export function useMulticolorGeometry(
  geometry: BufferGeometry | null,
  settings: MulticolorSettings,
  retryKey: number,
) {
  const active = settings.enabled && geometry !== null
  const key = `${geometry?.uuid ?? 'pending'}:${multicolorGeometryKey(settings)}:${retryKey}`
  const [result, setResult] = useState<Result | null>(null)
  const [failure, setFailure] = useState<{
    key: string
    message: string
  } | null>(null)

  useEffect(() => {
    if (!active || !geometry) {
      setResult(null)
      setFailure(null)
      return
    }
    const controller = new AbortController()
    const source = geometry.uuid
    const timer = window.setTimeout(async () => {
      try {
        const { buildMulticolorGeometry } = await import('./multicolor-client')
        const generated = await buildMulticolorGeometry(
          geometry,
          settings,
          controller.signal,
        )
        if (controller.signal.aborted) {
          disposeParts(generated.parts)
          return
        }
        setResult({ key, source, ...generated })
        setFailure(null)
      } catch (error) {
        if (!controller.signal.aborted)
          setFailure({
            key,
            message:
              error instanceof Error
                ? error.message
                : 'The multicolor panel could not be generated.',
          })
      }
    }, 160)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
    // This key includes all geometry and assignment settings, but no palette RGB/name.
  }, [key, active])

  useEffect(
    () => () => {
      if (result) disposeParts(result.parts)
    },
    [result],
  )

  const parts = active && result?.key === key ? result.parts : null
  const previewParts =
    active && result?.source === geometry?.uuid ? result.parts : null
  const error = active && failure?.key === key ? failure.message : ''
  return {
    parts,
    previewParts,
    generating: active && !parts && !error,
    error,
    diagnostics: active && result?.key === key ? result.diagnostics : [],
  }
}
