import initializeManifold, {
  type ManifoldToplevel,
  type Vec2,
} from 'manifold-3d'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { Vector2 } from 'three'
import type { KnobSettings } from './knob-settings'
import { validateKnobText } from './knob-text'
import { getTextContours } from './multicolor-fonts'

/** Leave 0.2 mm of the original 9 mm radius collar around the glyphs. */
export const TEXT_KNOB_RADIUS = 8.8

export interface TextKnobContours {
  contours: Vector2[][]
  triangulate: (contours: Vector2[][]) => [number, number, number][]
}

const preparedContours = new Map<string, TextKnobContours>()
let kernel: Promise<ManifoldToplevel> | undefined
function getKernel() {
  if (!kernel) {
    kernel = initializeManifold(
      // The worker, like the browser main thread, needs Vite's emitted URL.
      typeof window === 'undefined' && typeof self === 'undefined'
        ? undefined
        : { locateFile: () => wasmUrl },
    )
      .then((module) => {
        module.setup()
        return module
      })
      .catch((error: unknown) => {
        kernel = undefined
        throw error
      })
  }
  return kernel
}

/** Resolve overlaps before extrusion, preserving counters and detached dots. */
export async function prepareTextKnobContours(
  settings: KnobSettings,
): Promise<TextKnobContours> {
  validateKnobText(settings.text, settings.fontId, settings.fontWeight)
  const key = JSON.stringify([
    settings.text,
    settings.fontId,
    settings.fontWeight,
  ])
  const cached = preparedContours.get(key)
  if (cached) return cached
  const raw = getTextContours(
    settings.text,
    settings.fontId,
    1,
    settings.fontWeight,
  )
  const module = await getKernel()
  // Use millimeter-sized coordinates during clipping to retain tiny serifs.
  const section = new module.CrossSection(
    raw.map((contour) => contour.map(([x, y]): Vec2 => [x * 100, y * 100])),
    'NonZero',
  )
  try {
    const polygons = section.toPolygons()
    if (!polygons.length)
      throw new Error('Enter one or two visible characters.')
    const points = polygons.flat()
    const centerX =
      (Math.min(...points.map(([x]) => x)) +
        Math.max(...points.map(([x]) => x))) /
      2
    const centerY =
      (Math.min(...points.map(([, y]) => y)) +
        Math.max(...points.map(([, y]) => y))) /
      2
    const radius = Math.max(
      ...points.map(([x, y]) => Math.hypot(x - centerX, y - centerY)),
    )
    const scale = TEXT_KNOB_RADIUS / radius
    const prepared: TextKnobContours = {
      contours: polygons.map((polygon) =>
        polygon.map(
          ([x, y]) =>
            new Vector2(
              Math.fround((x - centerX) * scale),
              Math.fround((y - centerY) * scale),
            ),
        ),
      ),
      triangulate: (contours) =>
        module.triangulate(
          contours.map((contour) => contour.map(({ x, y }): Vec2 => [x, y])),
          0,
          false,
        ),
    }
    // Height and taper sliders reuse these immutable outlines. Bound the cache
    // so editing character pairs cannot accumulate an unlimited font history.
    if (preparedContours.size >= 32)
      preparedContours.delete(preparedContours.keys().next().value!)
    preparedContours.set(key, prepared)
    return prepared
  } finally {
    section.delete()
  }
}
