import initializeManifold, {
  type Manifold,
  type ManifoldToplevel,
} from 'manifold-3d'
import { getFaceFold } from './face-depth'
import type { SpeakerModel } from './panels'

export const MAX_PANEL_GAP = 5

type Point = [number, number, number]
type Plane = { axis: 1 | 2 | 'deck'; value: number }

export interface PanelGapSupport {
  surface: 'front' | 'deck'
  contact: Point
  axis: Point
  radius: number
  length: number
}

export interface PanelGapMetadata {
  gapMm: number
  frontOffset: number
  deckOffset: Point
  supports: PanelGapSupport[]
  controlWells: {
    center: Point
    axis: Point
    innerRadius: number
    outerRadius: number
  }[]
}

export interface PanelGapResult {
  positions: Float32Array
  metadata: PanelGapMetadata
}

const DECK_NORMAL: Point = [0, Math.SQRT1_2, Math.SQRT1_2]
const WELL_INNER_RADIUS = 11.3
const WELL_OUTER_RADIUS = 13.3
const OVERLAP = 0.25

const coordinate = (point: Point, axis: Plane['axis']) =>
  axis === 'deck' ? point[1] + point[2] : point[axis]
const distance = (point: Point, plane: Plane) => {
  const value = coordinate(point, plane.axis) - plane.value
  return plane.axis === 'deck' && Math.abs(value) < 0.00002 ? 0 : value
}

/**
 * Keep every part of the hooks inside the original contact planes fixed; only
 * their exposed roots grow. Front and deck move along their outward normals.
 * The existing convex bend grows concentrically instead of introducing a step.
 */
function offsetPanel(
  positions: Float32Array,
  model: SpeakerModel,
  gap: number,
  addedFaceDepth: number,
) {
  const fold = getFaceFold(model)
  const frontY = fold.frontY - addedFaceDepth
  const deckY = fold.deckY - addedFaceDepth
  const deckContact = Math.fround(fold.deckIntercept - 4 * Math.SQRT2)
  const deckBack = Math.fround(fold.deckIntercept - 3.5 * Math.SQRT2)
  const frontWindows =
    model === 's'
      ? [
          [-59, -50],
          [1, 10],
        ]
      : [
          [-107, -94],
          [-40, -27],
          [26, 40],
        ]
  const planes: Plane[] = [
    { axis: 2, value: 0 },
    { axis: 2, value: 0.5 },
    { axis: 'deck', value: deckContact },
    { axis: 'deck', value: deckBack },
  ]
  for (let band = 0; band <= 12; band += 1)
    planes.push({
      axis: 1,
      value: Math.fround(frontY + ((deckY - frontY) * band) / 12),
    })

  const output: number[] = []
  const crossings = new Map<string, Point>()
  const pointKey = (point: Point) => point.join(',')
  const intersection = (a: Point, b: Point, plane: Plane): Point => {
    let first = a,
      second = b
    if (pointKey(first) > pointKey(second)) [first, second] = [second, first]
    const key = `${pointKey(first)}:${pointKey(second)}:${plane.axis}:${plane.value}`
    let point = crossings.get(key)
    if (!point) {
      const fraction =
        (plane.value - coordinate(first, plane.axis)) /
        (coordinate(second, plane.axis) - coordinate(first, plane.axis))
      point = first.map((value, axis) =>
        axis === plane.axis
          ? plane.value
          : Math.fround(value + (second[axis] - value) * fraction),
      ) as Point
      if (plane.axis === 'deck') {
        if (first[2] === second[2])
          point[1] = Math.fround(plane.value - point[2])
        else point[2] = Math.fround(plane.value - point[1])
      }
      crossings.set(key, point)
    }
    return point
  }
  const append = (point: Point) => {
    const [x, y, z] = point
    const frontAttachment =
      Math.abs(x) >= 33 &&
      Math.abs(x) <= 38 &&
      frontWindows.some(([low, high]) => y >= low && y <= high)
    const tangent = (y - z) * Math.SQRT1_2
    const deckAttachment =
      Math.abs(x) >= 20 &&
      Math.abs(x) <= 37 &&
      tangent >= (model === 's' ? 29 : 62) &&
      tangent <= (model === 's' ? 40 : 76)
    // These conservative bounds enclose the complete source root fillets.
    // Between them, every source surface is at/above the inner rear plane;
    // the masks therefore introduce no discontinuity in the panel or rim.
    const neckWeight = frontAttachment
      ? Math.min(1, Math.max(0, z / 0.5))
      : deckAttachment
        ? Math.min(
            1,
            Math.max(
              0,
              distance(point, { axis: 'deck', value: deckContact }) /
                (deckBack - deckContact),
            ),
          )
        : 1
    const ny = Math.min(Math.SQRT1_2, Math.max(0, y - frontY))
    const nz = Math.sqrt(1 - ny * ny)
    output.push(x, y + gap * neckWeight * ny, z + gap * neckWeight * nz)
  }
  const emit = (polygon: Point[]) => {
    const unique = polygon.filter(
      (point, index) =>
        !polygon
          .slice(0, index)
          .some((other) => point.every((value, axis) => value === other[axis])),
    )
    for (let corner = 1; corner < unique.length - 1; corner += 1) {
      append(unique[0])
      append(unique[corner])
      append(unique[corner + 1])
    }
  }
  for (let triangle = 0; triangle < positions.length; triangle += 9) {
    const vertices: Point[] = [0, 3, 6].map((corner) => [
      positions[triangle + corner],
      positions[triangle + corner + 1],
      positions[triangle + corner + 2],
    ])
    const cuts = planes.filter((plane) => {
      const distances = vertices.map((point) => distance(point, plane))
      return Math.min(...distances) < 0 && Math.max(...distances) > 0
    })
    if (!cuts.length) {
      vertices.forEach(append)
      continue
    }
    let polygons = [vertices]
    for (const plane of cuts) {
      const next: Point[][] = []
      for (const polygon of polygons) {
        const distances = polygon.map((point) => distance(point, plane))
        if (Math.min(...distances) >= 0 || Math.max(...distances) <= 0) {
          next.push(polygon)
          continue
        }
        const lower: Point[] = [],
          upper: Point[] = []
        for (let edge = 0; edge < polygon.length; edge += 1) {
          const a = polygon[edge],
            b = polygon[(edge + 1) % polygon.length]
          const aDistance = distance(a, plane),
            bDistance = distance(b, plane)
          if (aDistance <= 0) lower.push(a)
          if (aDistance >= 0) upper.push(a)
          if (aDistance * bDistance < 0) {
            const point = intersection(a, b, plane)
            lower.push(point)
            upper.push(point)
          }
        }
        next.push(lower, upper)
      }
      polygons = next
    }
    polygons.forEach(emit)
  }
  return new Float32Array(output)
}

function sourceSolid(module: ManifoldToplevel, positions: Float32Array) {
  const ids = new Map<string, number>()
  const vertices: number[] = []
  const triangles = new Uint32Array(positions.length / 3)
  for (let index = 0; index < positions.length; index += 3) {
    const key = `${positions[index]},${positions[index + 1]},${positions[index + 2]}`
    let id = ids.get(key)
    if (id === undefined) {
      id = ids.size
      ids.set(key, id)
      vertices.push(
        positions[index],
        positions[index + 1],
        positions[index + 2],
      )
    }
    triangles[index / 3] = id
  }
  return new module.Manifold(
    new module.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(vertices),
      triVerts: triangles,
    }),
  )
}

export function getPanelGapMetadata(
  model: SpeakerModel,
  gapMm: number,
): PanelGapMetadata {
  const deckBack = (model === 's' ? 23.5 : 61.5) - 3.5 * Math.SQRT2
  const frontYs = model === 's' ? [-50, 0] : [-100, -33, 33]
  const supports: PanelGapSupport[] = frontYs.flatMap((y) =>
    [-39.5, 39.5].map((x) => ({
      surface: 'front' as const,
      contact: [x, y, 0] as Point,
      axis: [0, 0, 1] as Point,
      radius: 1.5,
      length: gapMm + 0.5,
    })),
  )
  const deckSupportY = model === 's' ? 28.5 : 69
  for (const x of [-10, 10])
    supports.push({
      surface: 'deck',
      contact: [
        x,
        deckSupportY - 0.5 * Math.SQRT1_2,
        deckBack - deckSupportY - 0.5 * Math.SQRT1_2,
      ],
      axis: [...DECK_NORMAL],
      radius: 1.25,
      length: gapMm + 0.5,
    })
  const controlY = model === 's' ? 29.5 : 70
  const controlZ = model === 's' ? -6 : -8.5
  return {
    gapMm,
    frontOffset: gapMm,
    deckOffset: [0, gapMm * Math.SQRT1_2, gapMm * Math.SQRT1_2],
    supports: gapMm > 0 ? supports : [],
    controlWells:
      gapMm > 0
        ? [-28.5, 28.5].map((x) => ({
            center: [x, controlY, controlZ] as Point,
            axis: [...DECK_NORMAL] as Point,
            innerRadius: WELL_INNER_RADIUS,
            outerRadius: WELL_OUTER_RADIUS,
          }))
        : [],
  }
}

/** Add a body-relative mounting gap before building the grille and halo. */
export async function createPanelGapEngine(wasmUrl?: string) {
  const module = await initializeManifold(
    wasmUrl ? { locateFile: () => wasmUrl } : undefined,
  )
  module.setup()
  return {
    build(
      model: SpeakerModel,
      positions: Float32Array,
      gapMm: number,
      addedFaceDepth = 0,
    ): PanelGapResult {
      if (!Number.isFinite(gapMm) || gapMm < 0 || gapMm > MAX_PANEL_GAP)
        throw new RangeError(
          `Panel gap must be between 0 and ${MAX_PANEL_GAP} mm.`,
        )
      const details = getPanelGapMetadata(model, gapMm)
      if (gapMm === 0) return { positions, metadata: details }
      const disposable: { delete(): void }[] = []
      const own = <T extends { delete(): void }>(value: T): T => {
        disposable.push(value)
        return value
      }
      const cylinder = (
        radius: number,
        length: number,
        base: Point,
        deck: boolean,
      ) => {
        let shape = own(module.Manifold.cylinder(length, radius, radius, 96))
        if (deck) shape = own(shape.rotate([-45, 0, 0]))
        return own(shape.translate(base))
      }
      try {
        const original = own(sourceSolid(module, positions))
        let solid: Manifold = own(
          sourceSolid(
            module,
            offsetPanel(positions, model, gapMm, addedFaceDepth),
          ),
        )
        const additions: Manifold[] = []
        for (const well of details.controlWells) {
          const bottom = well.center.map(
            (value, axis) => value - DECK_NORMAL[axis] * 3.55,
          ) as Point
          const cutter = cylinder(
            well.outerRadius - 0.5,
            OVERLAP + gapMm + 1,
            well.center.map(
              (value, axis) => value - DECK_NORMAL[axis] * OVERLAP,
            ) as Point,
            true,
          )
          solid = own(solid.subtract(cutter))
          // Preserve the seating plate without duplicating the hooks behind
          // it: their exact tips already survive the neck extension above.
          const seatBounds = cylinder(well.outerRadius, 3.6, bottom, true)
          additions.push(own(original.intersect(seatBounds)))
          const wallBase = well.center.map(
            (value, axis) => value - DECK_NORMAL[axis] * OVERLAP,
          ) as Point
          const outer = cylinder(
            well.outerRadius,
            gapMm + OVERLAP,
            wallBase,
            true,
          )
          const inner = cylinder(
            well.innerRadius,
            gapMm + OVERLAP + 2,
            well.center.map(
              (value, axis) => value - DECK_NORMAL[axis] * (OVERLAP + 1),
            ) as Point,
            true,
          )
          additions.push(own(outer.subtract(inner)))
        }
        for (const support of details.supports)
          additions.push(
            cylinder(
              support.radius,
              support.length + OVERLAP,
              support.contact,
              support.surface === 'deck',
            ),
          )
        solid = own(module.Manifold.union([solid, ...additions]))
        if (solid.status() !== 'NoError' || solid.isEmpty())
          throw new Error(
            'The panel gap could not be joined to the attachment supports.',
          )
        const consolidated = own(solid.asOriginal())
        const stable = own(consolidated.setTolerance(0.00005))
        const components = stable.decompose().map(own)
        // Coincident source seating planes can leave zero-volume numerical
        // sheets. Keep the physical solid; never discard a detached real part.
        const solids = components.filter(
          (component) => Math.abs(component.volume()) > 1e-8,
        )
        if (solids.length !== 1)
          throw new Error(
            'The spaced panel and its supports must remain one connected solid.',
          )
        const mesh = solids[0].getMesh()
        const output = new Float32Array(mesh.triVerts.length * 3)
        for (let index = 0; index < mesh.triVerts.length; index += 1) {
          const vertex = mesh.triVerts[index] * mesh.numProp
          output[index * 3] = mesh.vertProperties[vertex]
          output[index * 3 + 1] = mesh.vertProperties[vertex + 1]
          output[index * 3 + 2] = mesh.vertProperties[vertex + 2]
        }
        return { positions: output, metadata: details }
      } finally {
        disposable.reverse().forEach((value) => value.delete())
      }
    },
    dispose() {},
  }
}
