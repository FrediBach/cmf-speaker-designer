import { BufferGeometry, Float32BufferAttribute, Mesh, Vector3 } from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { STLExporter } from 'three/addons/exporters/STLExporter.js'
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js'
import originalAsset from '../../resources/stl-files/cmf-speaker-sm-3d-printing-knob-original-v1.stl?url'
import { shapedKnobGeometry } from './shaped-knob-geometry'
import {
  KNOB_MOUNT_HEIGHT,
  KNOB_BASE_HEIGHT,
  normalizeKnobSettings,
  type KnobSettings,
  type KnobStyle,
} from './knob-settings'

type SourceStyle = 'ring' | 'bar' | 'cross'

export interface KnobMetadata {
  settings: KnobSettings
  mountHeight: number
  sourceStyle: SourceStyle
  baseHeight: number
  units: 'mm'
}

const sourceStyle = (style: KnobStyle): SourceStyle =>
  style === 'bar' || style === 'cross' ? style : 'ring'

/**
 * Extract one complete, connected part from the supplied multi-part print plate.
 * The original plate holds bar/cross/ring at X=33.682/.682/-33.318 mm.
 * Coordinates stay in millimeters, with the stem bottom at Z=0 and grip +Z.
 */
export function parseKnobGeometry(
  data: ArrayBuffer,
  style: KnobStyle,
): BufferGeometry {
  const source = sourceStyle(style)
  const plate = new STLLoader().parse(data)
  const positions = plate.getAttribute('position')
  const selected: number[] = []
  for (let triangle = 0; triangle < positions.count; triangle += 3) {
    const x =
      (positions.getX(triangle) +
        positions.getX(triangle + 1) +
        positions.getX(triangle + 2)) /
      3
    const include =
      source === 'ring'
        ? x < -16
        : source === 'bar'
          ? x > 16
          : x > -16 && x < 16
    if (!include) continue
    for (let corner = 0; corner < 3; corner += 1) {
      const index = triangle + corner
      selected.push(
        positions.getX(index),
        positions.getY(index),
        positions.getZ(index),
      )
    }
  }
  plate.dispose()
  if (!selected.length)
    throw new Error('The selected volume knob is missing from its source file.')
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(selected, 3))
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const centerX = (box.min.x + box.max.x) / 2
  // All three originals share one shaft axis. Their tessellated silhouettes
  // differ by a fraction of a facet, so silhouette Y-center is not the axis.
  const centerY = -0.16899950802326202
  geometry.translate(-centerX, -centerY, -box.min.z)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.userData.sourceStyle = source
  return geometry
}

type Point = [number, number, number]

/**
 * Slice each source triangle at common horizontal planes before deformation.
 * Adjacent triangles reuse bit-identical intersection vertices, so the result
 * remains watertight. Original vertices below the base top are untouched.
 */
function subdivideGrip(
  original: BufferGeometry,
  detailed: boolean,
): BufferGeometry {
  const positions = original.getAttribute('position')
  const planes = [KNOB_BASE_HEIGHT]
  if (detailed) {
    // 32 upper bands resolve the spiral/chevron path even at 32 flutes.
    for (let step = 1; step < 32; step += 1)
      planes.push(KNOB_BASE_HEIGHT + ((16 - KNOB_BASE_HEIGHT) * step) / 32)
  }
  const result: number[] = []
  const intersections = new Map<string, Point>()
  const pointKey = (point: Point) => point.join(',')
  const intersection = (a: Point, b: Point, z: number): Point => {
    let first = a,
      second = b
    if (pointKey(first) > pointKey(second)) [first, second] = [second, first]
    const key = `${pointKey(first)}:${pointKey(second)}:${z}`
    let point = intersections.get(key)
    if (!point) {
      const amount = (z - first[2]) / (second[2] - first[2])
      point = [
        Math.fround(first[0] + (second[0] - first[0]) * amount),
        Math.fround(first[1] + (second[1] - first[1]) * amount),
        z,
      ]
      intersections.set(key, point)
    }
    return point
  }
  const emit = (polygon: Point[]) => {
    const unique: Point[] = []
    for (const point of polygon) {
      if (
        !unique.some(
          (other) =>
            point[0] === other[0] &&
            point[1] === other[1] &&
            point[2] === other[2],
        )
      )
        unique.push(point)
    }
    for (let corner = 1; corner < unique.length - 1; corner += 1)
      result.push(...unique[0], ...unique[corner], ...unique[corner + 1])
  }
  for (let triangle = 0; triangle < positions.count; triangle += 3) {
    let polygon: Point[] = [0, 1, 2].map((corner) => {
      const index = triangle + corner
      return [
        positions.getX(index),
        positions.getY(index),
        positions.getZ(index),
      ]
    })
    const minZ = Math.min(...polygon.map((point) => point[2]))
    const maxZ = Math.max(...polygon.map((point) => point[2]))
    for (const plane of planes) {
      if (plane <= minZ || plane >= maxZ) continue
      const lower: Point[] = [],
        upper: Point[] = []
      for (let edge = 0; edge < polygon.length; edge += 1) {
        const a = polygon[edge],
          b = polygon[(edge + 1) % polygon.length]
        if (a[2] <= plane) lower.push(a)
        if (a[2] >= plane) upper.push(a)
        if ((a[2] < plane && b[2] > plane) || (a[2] > plane && b[2] < plane)) {
          const crossing = intersection(a, b, plane)
          lower.push(crossing)
          upper.push(crossing)
        }
      }
      emit(lower)
      polygon = upper
    }
    emit(polygon)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(result, 3))
  return geometry
}

const refinedSources = new WeakMap<
  BufferGeometry,
  Map<boolean, BufferGeometry>
>()

function refinedSource(original: BufferGeometry, detailed: boolean) {
  let variants = refinedSources.get(original)
  if (!variants) {
    variants = new Map()
    refinedSources.set(original, variants)
  }
  let geometry = variants.get(detailed)
  if (!geometry) {
    geometry = subdivideGrip(original, detailed)
    variants.set(detailed, geometry)
  }
  return geometry
}

/**
 * The full original collar, shaft, and blind socket at Z<=8 mm stay fixed.
 * Only upper grip material changes. New shaped grips replace the top cap;
 * ring-derived grips retain their central recess. Every style stays within
 * the original envelope, without diameter scaling or rigid rotation.
 */
export function customizeKnobGeometry(
  original: BufferGeometry,
  input: Partial<KnobSettings>,
): BufferGeometry {
  const settings = normalizeKnobSettings(input)
  original.computeBoundingBox()
  const dimensions = original.boundingBox!.getSize(new Vector3())
  const radius = Math.max(dimensions.x, dimensions.y) / 2
  const shaped =
    settings.style === 'triangle' ||
    settings.style === 'arrow' ||
    settings.style === 'v'
  const patterned = settings.style === 'fluted' || settings.style === 'hex'
  const modified =
    patterned || settings.height !== dimensions.z || settings.taper !== 0
  const geometry = shaped
    ? shapedKnobGeometry(refinedSource(original, false), settings)
    : (modified
        ? refinedSource(original, patterned || settings.taper !== 0)
        : original
      ).clone()
  const positions = geometry.getAttribute('position')
  if (modified && !shaped)
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index),
        y = positions.getY(index),
        z = positions.getZ(index)
      if (z <= KNOB_BASE_HEIGHT) continue
      const fraction =
        (z - KNOB_BASE_HEIGHT) / (dimensions.z - KNOB_BASE_HEIGHT)
      const distance = Math.hypot(x, y)
      const angle = Math.atan2(y, x)
      // Protect the existing center recess and preserve at least 1.3 mm walls
      // at the permitted five-facet / 1 mm taper and deepest-groove limits.
      const edgeWeight = Math.min(
        1,
        Math.max(0, (distance - 5.5) / (radius - 5.5)),
      )
      const transition = Math.min(1, (z - KNOB_BASE_HEIGHT) / 1)
      let inset = settings.taper * fraction
      if (settings.style === 'fluted') {
        const path =
          settings.flutePath === 'spiral'
            ? fraction
            : settings.flutePath === 'chevron'
              ? 1 - Math.abs(fraction * 2 - 1)
              : 0
        // A path displaces grooves by 1.5 pitches along Z. It never rotates
        // the part or its mounting interface; only recesses move around it.
        const phase = path * 1.5 * Math.PI * 2
        inset +=
          (transition *
            settings.fluteDepth *
            (1 - Math.cos(angle * settings.fluteCount - phase))) /
          2
      } else if (settings.style === 'hex') {
        const sector = (Math.PI * 2) / settings.facets
        const local = (((angle % sector) + sector) % sector) - sector / 2
        const polygonRadius =
          (radius * Math.cos(Math.PI / settings.facets)) / Math.cos(local)
        inset += transition * (radius - polygonRadius)
      }
      const scale = distance > 0 ? 1 - (edgeWeight * inset) / distance : 1
      const height =
        KNOB_BASE_HEIGHT + fraction * (settings.height - KNOB_BASE_HEIGHT)
      positions.setXYZ(index, x * scale, y * scale, height)
    }
  positions.needsUpdate = true
  if (settings.style === 'fluted') {
    // Smooth the fine, diagonally tessellated grooves while preserving sharp
    // top/collar transitions. Only normals change; STL vertices are identical.
    toCreasedNormals(geometry, Math.PI / 4)
  } else geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.userData.knob = {
    settings,
    mountHeight: KNOB_MOUNT_HEIGHT,
    sourceStyle: sourceStyle(settings.style),
    baseHeight: KNOB_BASE_HEIGHT,
    units: 'mm',
  } satisfies KnobMetadata
  return geometry
}

const sources = new Map<SourceStyle, Promise<BufferGeometry>>()
const plates = new Map<string, Promise<ArrayBuffer>>()

async function loadSource(style: SourceStyle): Promise<BufferGeometry> {
  const asset = originalAsset
  let plate = plates.get(asset)
  if (!plate) {
    plate = fetch(asset)
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            `Unable to load the volume knob (${response.status}).`,
          )
        return response.arrayBuffer()
      })
      .catch((error: unknown) => {
        plates.delete(asset)
        throw error
      })
    plates.set(asset, plate)
  }
  return parseKnobGeometry(await plate, style)
}

/** Preview and export both receive this same owned, printable geometry. */
export async function buildKnobGeometry(
  input: Partial<KnobSettings> = {},
  signal?: AbortSignal,
): Promise<BufferGeometry> {
  signal?.throwIfAborted()
  const settings = normalizeKnobSettings(input)
  const style = sourceStyle(settings.style)
  let source = sources.get(style)
  if (!source) {
    source = loadSource(style).catch((error: unknown) => {
      sources.delete(style)
      throw error
    })
    sources.set(style, source)
  }
  // Cached loads are shared by both previews. Aborting one caller must not
  // cancel the other or poison the cache; it only discards that caller's work.
  const original = await source
  signal?.throwIfAborted()
  return customizeKnobGeometry(original, settings)
}

export function prepareKnobExportGeometry(
  geometry: BufferGeometry,
): BufferGeometry {
  const printable = geometry.clone()
  printable.computeBoundingBox()
  printable.translate(0, 0, -printable.boundingBox!.min.z)
  return printable
}

export function exportKnobStl(geometry: BufferGeometry): ArrayBuffer {
  const printable = prepareKnobExportGeometry(geometry)
  const mesh = new Mesh(printable)
  mesh.updateMatrixWorld(true)
  const binary = new STLExporter().parse(mesh, { binary: true })
  const result = new ArrayBuffer(binary.byteLength)
  new Uint8Array(result).set(
    new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength),
  )
  printable.dispose()
  return result
}

export function knobFilename(input: KnobSettings): string {
  const settings = normalizeKnobSettings(input)
  const pattern =
    settings.style === 'fluted'
      ? `-${settings.flutePath}-${settings.fluteCount}-flutes-${settings.fluteDepth.toFixed(1)}mm`
      : settings.style === 'hex'
        ? `-${settings.facets}-faces`
        : settings.style === 'triangle' ||
            settings.style === 'arrow' ||
            settings.style === 'v'
          ? `-width-${settings.gripWidth.toFixed(1)}mm-depth-${settings.gripDepth.toFixed(1)}mm${settings.style === 'triangle' ? '' : `-stroke-${settings.gripThickness.toFixed(1)}mm`}`
          : ''
  const taper =
    settings.taper > 0 ? `-taper-${settings.taper.toFixed(1)}mm` : ''
  const label = settings.style === 'hex' ? 'faceted' : settings.style
  return `cmf-speaker-knob-${label}-height-${settings.height.toFixed(1)}mm${pattern}${taper}.stl`
}
