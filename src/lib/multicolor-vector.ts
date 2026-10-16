import initializeManifold, {
  type ManifoldToplevel,
  type CrossSection,
} from 'manifold-3d'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { parseSvgCutout } from './svg-cutout-parser'
import {
  MULTICOLOR_LIMITS,
  MulticolorValidationError,
  type PatternFrame,
  type PatternPoint,
} from './multicolor-settings'

export { getTextContours, validatePatternText } from './multicolor-fonts'

let kernel: Promise<ManifoldToplevel> | undefined
function getKernel() {
  if (!kernel) {
    kernel = initializeManifold(
      typeof window === 'undefined' ? undefined : { locateFile: () => wasmUrl },
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

export type ImportedSvgShape = {
  sourceName: string
  width: number
  height: number
  contours: PatternPoint[][]
}

/** Import geometry only. Each path retains its fill rule before the paths are united. */
export async function importSvgShape(
  source: string,
  sourceName: string,
  frame: PatternFrame,
): Promise<ImportedSvgShape> {
  if (
    ![frame.width, frame.height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    throw new MulticolorValidationError(
      'The artwork frame must have positive dimensions.',
    )
  }
  const parsed = parseSvgCutout(source, sourceName)
  const module = await getKernel()
  const resources: CrossSection[] = []
  const own = (section: CrossSection) => {
    resources.push(section)
    return section
  }
  try {
    // Work in a larger numeric range than the stored [-0.5,0.5] contours so
    // the clipping kernel retains small details, then return normalized points.
    const precisionScale = 1000
    const paths = parsed.paths.map((path) =>
      own(
        new module.CrossSection(
          path.contours.map((points) =>
            points.map(([x, y]): PatternPoint => [
              x * precisionScale,
              -y * precisionScale,
            ]),
          ),
          path.fillRule === 'evenodd' ? 'EvenOdd' : 'NonZero',
        ),
      ),
    )
    const union = own(module.CrossSection.union(paths))
    if (union.isEmpty())
      throw new MulticolorValidationError(
        'This SVG has no visible filled area.',
      )
    const contours = union
      .toPolygons()
      .map((points) =>
        points.map(([x, y]): PatternPoint => [
          x / precisionScale,
          y / precisionScale,
        ]),
      )
    const vertices = contours.reduce(
      (count, points) => count + points.length,
      0,
    )
    if (
      contours.length > MULTICOLOR_LIMITS.vectorContours ||
      vertices > MULTICOLOR_LIMITS.vectorVertices
    ) {
      throw new MulticolorValidationError(
        'This SVG is too complex after combining its paths. Simplify the artwork and import it again.',
      )
    }
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const points of contours) {
      for (const [x, y] of points) {
        if (!Number.isFinite(x) || !Number.isFinite(y))
          throw new MulticolorValidationError(
            'The SVG contains invalid geometry.',
          )
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
    const spanX = maxX - minX,
      spanY = maxY - minY
    if (spanX <= 0 || spanY <= 0)
      throw new MulticolorValidationError(
        'This SVG has no visible filled area.',
      )
    const aspectRatio = (parsed.aspectRatio * spanX) / spanY
    const height = Math.min(
      frame.height * 0.6,
      (frame.width * 0.6) / aspectRatio,
    )
    return {
      sourceName: parsed.name,
      width: height * aspectRatio,
      height,
      contours: contours.map((points) =>
        points.map(([x, y]): PatternPoint => [
          Math.round(((x - minX) / spanX - 0.5) * 1e8) / 1e8,
          Math.round(((y - minY) / spanY - 0.5) * 1e8) / 1e8,
        ]),
      ),
    }
  } finally {
    for (const resource of resources.reverse()) resource.delete()
  }
}
