import initializeManifold, {
  type Manifold,
  type ManifoldToplevel,
} from 'manifold-3d'
import {
  HALO_CIRCULAR_SEGMENTS,
  HALO_INNER_RADIUS,
  getHaloCutPivotRadius,
  getHaloWaveAmplitude,
  getHaloWaveFrequency,
  createHaloHeightModulator,
  normalizeHaloSettings,
  type HaloSettings,
} from './halo-settings'
import type { SpeakerModel } from './panels'

export interface HaloMetadata {
  settings: HaloSettings
  baseZ: number
  frontZ: number
  center: { x: number; y: number }
  centers: { x: number; y: number }[]
  innerRadius: number
  outerRadius: number
  topInnerRadius: number
  topOuterRadius: number
  baseRimHeight: number
}

export interface HaloResult {
  positions: Float32Array
  metadata: HaloMetadata
}

function sourceSolid(
  module: ManifoldToplevel,
  positions: Float32Array,
): Manifold {
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

function equalPositions(a: Float32Array, b: Float32Array) {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1)
    if (a[index] !== b[index]) return false
  return true
}

/** Check the exact coordinates exported to STL, where Float32 rounding matters. */
function hasClosedFloat32Topology(positions: Float32Array) {
  const unique = new Map<string, number>()
  const ids: number[] = []
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index],
      y = positions[index + 1],
      z = positions[index + 2]
    if (![x, y, z].every(Number.isFinite)) return false
    const key = `${x},${y},${z}`
    let id = unique.get(key)
    if (id === undefined) {
      id = unique.size
      unique.set(key, id)
    }
    ids.push(id)
  }
  const edges = new Map<number, number>()
  for (let index = 0; index < ids.length; index += 3) {
    const offset = index * 3
    const ab = [0, 1, 2].map(
      (axis) => positions[offset + 3 + axis] - positions[offset + axis],
    )
    const ac = [0, 1, 2].map(
      (axis) => positions[offset + 6 + axis] - positions[offset + axis],
    )
    if (
      ab[1] * ac[2] === ab[2] * ac[1] &&
      ab[2] * ac[0] === ab[0] * ac[2] &&
      ab[0] * ac[1] === ab[1] * ac[0]
    )
      return false
    for (let corner = 0; corner < 3; corner += 1) {
      const a = ids[index + corner],
        b = ids[index + ((corner + 1) % 3)]
      if (a === b) return false
      const key = Math.min(a, b) * unique.size + Math.max(a, b)
      edges.set(key, (edges.get(key) ?? 0) + (a < b ? 11 : 9))
    }
  }
  return [...edges.values()].every((count) => count === 20)
}

/**
 * Refine angular edges after the boolean cut, then deform that actual mesh.
 * Shared edge midpoints keep every facet joined, including sharp waveform
 * changes and the return seam when fractional cycles are deliberately allowed.
 * Refining only the angular direction avoids a dense grid down tall walls.
 */
function modulateRing(
  module: ManifoldToplevel,
  ring: Manifold,
  settings: HaloSettings,
  baseZ: number,
  samplesPerCycle: number,
) {
  const mesh = ring.getMesh()
  const vertices: number[][] = []
  const ids = new Map<string, number>()
  const remap: number[] = []
  for (
    let index = 0;
    index < mesh.vertProperties.length;
    index += mesh.numProp
  ) {
    const vertex = Array.from(mesh.vertProperties.slice(index, index + 3))
    const key = vertex.join(',')
    let id = ids.get(key)
    if (id === undefined) {
      id = vertices.length
      ids.set(key, id)
      vertices.push(vertex)
    }
    remap.push(id)
  }
  let triangles = Array.from(mesh.triVerts, (id) => remap[id])
  const maxAngle =
    (2 * Math.PI) /
    Math.max(
      HALO_CIRCULAR_SEGMENTS,
      getHaloWaveFrequency(settings) * samplesPerCycle,
    )
  const angle = (id: number) => Math.atan2(vertices[id][0], vertices[id][1])
  const edgeKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`)
  const splitEdges = (midpoints: Map<string, number>) => {
    const refined: number[] = []
    for (let index = 0; index < triangles.length; index += 3) {
      const corners = triangles.slice(index, index + 3)
      const mids = corners.map((id, corner) =>
        midpoints.get(edgeKey(id, corners[(corner + 1) % 3])),
      )
      const count = mids.filter((id) => id !== undefined).length
      if (count === 0) refined.push(...corners)
      else if (count === 3) {
        const [a, b, c] = corners,
          [ab, bc, ca] = mids as number[]
        refined.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca)
      } else {
        // Rotate the triangle to put its sole split edge (or its pair of
        // adjacent split edges) first; this retains the source winding.
        const start =
          count === 1
            ? mids.findIndex((id) => id !== undefined)
            : (mids.findIndex((id) => id === undefined) + 1) % 3
        const a = corners[start],
          b = corners[(start + 1) % 3],
          c = corners[(start + 2) % 3]
        const ab = mids[start]!
        if (count === 1) refined.push(a, ab, c, ab, b, c)
        else {
          const bc = mids[(start + 1) % 3]!
          refined.push(b, bc, ab, a, ab, c, ab, bc, c)
        }
      }
    }
    triangles = refined
  }
  // Split crossing edges inside the same mesh: a separate fixed/moving union
  // creates almost-coincident caps when a decimal rim is rounded to Float32.
  const anchor = Math.fround(baseZ + settings.rimHeight)
  for (const vertex of vertices)
    if (Math.abs(vertex[2] - anchor) < 0.000005) vertex[2] = anchor
  const crossings = new Map<string, number>()
  for (let index = 0; index < triangles.length; index += 3) {
    for (let corner = 0; corner < 3; corner += 1) {
      const a = triangles[index + corner],
        b = triangles[index + ((corner + 1) % 3)]
      const az = vertices[a][2] - anchor,
        bz = vertices[b][2] - anchor
      if (az * bz >= 0) continue
      const key = edgeKey(a, b)
      if (crossings.has(key)) continue
      const fraction = az / (az - bz)
      crossings.set(key, vertices.length)
      vertices.push([
        vertices[a][0] + fraction * (vertices[b][0] - vertices[a][0]),
        vertices[a][1] + fraction * (vertices[b][1] - vertices[a][1]),
        anchor,
      ])
    }
  }
  splitEdges(crossings)
  for (let pass = 0; pass < 14; pass += 1) {
    const midpoints = new Map<string, number>()
    for (let index = 0; index < triangles.length; index += 3) {
      for (let corner = 0; corner < 3; corner += 1) {
        const a = triangles[index + corner]
        const b = triangles[index + ((corner + 1) % 3)]
        if (vertices[a][2] <= anchor && vertices[b][2] <= anchor) continue
        const delta = Math.abs(angle(a) - angle(b))
        if (Math.min(delta, 2 * Math.PI - delta) <= maxAngle * 1.001) continue
        const key = edgeKey(a, b)
        if (midpoints.has(key)) continue
        midpoints.set(key, vertices.length)
        vertices.push(
          vertices[a].map((value, axis) => (value + vertices[b][axis]) / 2),
        )
      }
    }
    if (!midpoints.size) break
    splitEdges(midpoints)
  }
  const modulateHeight = createHaloHeightModulator(settings)
  for (const vertex of vertices) {
    if (vertex[2] <= anchor) continue
    const degrees =
      ((Math.atan2(vertex[0], vertex[1]) * 180) / Math.PI + 360) % 360
    vertex[2] = baseZ + modulateHeight(vertex[2] - baseZ, degrees)
  }
  return new module.Manifold(
    new module.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(vertices.flat()),
      triVerts: new Uint32Array(triangles),
    }),
  )
}

/**
 * Add the halo last, after the handle, face depth, and optional grille. A true
 * planar cut trims the flared wall. The selected rim can stay flush with the
 * face or rise around the opening; a buried collar keeps the hood connected.
 * The cut pivots over the outer tip: 0° rotation keeps the top (+Y), and
 * 90° keeps the right (+X). Waves deform this finished wall above its fixed rim;
 * their peaks can extend beyond the original depth.
 */
export async function createHaloEngine(wasmUrl?: string) {
  const module = await initializeManifold(
    wasmUrl ? { locateFile: () => wasmUrl } : undefined,
  )
  module.setup()
  let cached:
    | { model: SpeakerModel; positions: Float32Array; solid: Manifold }
    | undefined
  return {
    build(
      model: SpeakerModel,
      input: HaloSettings,
      positions: Float32Array,
      panelGap = 0,
      panelFaceZ?: number,
    ): HaloResult {
      const settings = normalizeHaloSettings(input)
      // Raised grille details can stand above the face the halo grows from.
      let baseZ = panelFaceZ ?? -Infinity
      if (panelFaceZ === undefined)
        for (let index = 2; index < positions.length; index += 3)
          baseZ = Math.max(baseZ, positions[index])
      const centers = (model === 's' ? [-23] : [15, -70]).map((y) => ({
        x: 0,
        y,
      }))
      const center = centers[0]
      const innerRadius = HALO_INNER_RADIUS
      const outerRadius = innerRadius + settings.thickness
      const flare = Math.tan((settings.outwardAngle * Math.PI) / 180)
      const frontZ = baseZ + settings.depth
      const metadata: HaloMetadata = {
        settings,
        baseZ,
        frontZ: settings.mode === 'custom' ? frontZ : baseZ,
        center,
        centers,
        innerRadius,
        outerRadius,
        topInnerRadius: innerRadius + flare * settings.depth,
        topOuterRadius: outerRadius + flare * settings.depth,
        baseRimHeight: settings.rimHeight,
      }
      if (settings.mode === 'original')
        return { positions: positions.slice(), metadata }
      if (
        !Number.isFinite(baseZ) ||
        baseZ - panelGap < 3.99 ||
        baseZ - panelGap > 6.01
      )
        throw new Error(
          'Custom halos require the original open front-panel shape.',
        )
      if (
        !cached ||
        cached.model !== model ||
        !equalPositions(cached.positions, positions)
      ) {
        const solid = sourceSolid(module, positions)
        if (solid.status() !== 'NoError') {
          solid.delete()
          throw new Error(
            'The original panel could not be prepared for a custom halo.',
          )
        }
        cached?.solid.delete()
        cached = { model, positions: positions.slice(), solid }
      }
      const hasWave = getHaloWaveAmplitude(settings) > 0
      // Sharp waves can make the two M walls nearly touch at their overlap.
      // Retry with finer angular facets if Float32 export collapses that seam.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const disposable: { delete(): void }[] = []
        const own = <T extends { delete(): void }>(value: T): T => {
          disposable.push(value)
          return value
        }
        try {
          const profile = own(
            new module.CrossSection([
              [
                [innerRadius, 0.75 + panelGap],
                [outerRadius, 0.75 + panelGap],
                [outerRadius, baseZ],
                [metadata.topOuterRadius, frontZ],
                [metadata.topInnerRadius, frontZ],
                [innerRadius, baseZ],
              ],
            ]),
          )
          // Finish the ring in local coordinates so every driver receives the
          // same wall, cut plane, orientation, and base rim.
          const fullRing = own(profile.revolve(HALO_CIRCULAR_SEGMENTS))
          let ring = fullRing
          // A full-height rim already contains the whole halo; avoid introducing
          // coincident boolean seams by cutting and restoring that same solid.
          if (settings.cutAngle > 0 && settings.rimHeight < settings.depth) {
            const radians = (settings.cutAngle * Math.PI) / 180
            const rotation = (settings.cutRotation * Math.PI) / 180
            const nx = Math.sin(radians) * Math.sin(rotation)
            const ny = Math.sin(radians) * Math.cos(rotation)
            const nz = -Math.cos(radians)
            // The plane goes through the tip, leaving no horizontal front shelf.
            // Polygon support preserves exact depth at non-cardinal rotations.
            const cutPivotRadius = getHaloCutPivotRadius(settings)
            // The normal is unit length; Manifold expects a physical offset.
            const offset =
              -Math.cos(radians) * frontZ + Math.sin(radians) * cutPivotRadius
            const trimmed = own(fullRing.trimByPlane([nx, ny, nz], offset))
            const rim = own(
              fullRing.trimByPlane([0, 0, -1], -(baseZ + settings.rimHeight)),
            )
            ring = own(trimmed.add(rim))
          }
          if (hasWave) {
            ring = own(
              modulateRing(module, ring, settings, baseZ, 64 * 2 ** attempt),
            )
            metadata.frontZ = ring.boundingBox().max[2]
          }
          // Union all copies: wide flares can meet between the M drivers and
          // must become one printable volume without overlapping mesh faces.
          let united = cached.solid
          for (const opening of centers) {
            const copy = own(ring.translate([opening.x, opening.y, 0]))
            united = own(united.add(copy))
          }
          if (united.status() !== 'NoError' || united.isEmpty())
            throw new Error('This halo could not be joined to the panel.')
          const consolidated = own(united.asOriginal())
          const stable = own(consolidated.simplify(0.00005))
          const components = stable.decompose()
          const count = components.length
          components.forEach((component) => component.delete())
          if (count !== 1) {
            if (hasWave && attempt < 2) continue
            throw new Error(
              'The halo must remain joined to the panel as one solid.',
            )
          }
          const mesh = stable.getMesh()
          const output = new Float32Array(mesh.triVerts.length * 3)
          for (let index = 0; index < mesh.triVerts.length; index += 1) {
            const vertex = mesh.triVerts[index] * mesh.numProp
            output[index * 3] = mesh.vertProperties[vertex]
            output[index * 3 + 1] = mesh.vertProperties[vertex + 1]
            output[index * 3 + 2] = mesh.vertProperties[vertex + 2]
          }
          if (hasWave && !hasClosedFloat32Topology(output)) continue
          return { positions: output, metadata }
        } finally {
          disposable.reverse().forEach((value) => value.delete())
        }
      }
      throw new Error(
        'This wave could not produce a closed halo. Adjust its amplitude, frequency, or phase.',
      )
    },
    dispose() {
      cached?.solid.delete()
      cached = undefined
    },
  }
}
