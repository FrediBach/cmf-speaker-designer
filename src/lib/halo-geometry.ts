import initializeManifold, {
  type Manifold,
  type ManifoldToplevel,
} from 'manifold-3d'
import {
  HALO_CIRCULAR_SEGMENTS,
  HALO_INNER_RADIUS,
  getHaloCutPivotRadius,
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

/**
 * Add the halo last, after the handle, face depth, and optional grille. A true
 * planar cut trims the flared wall. The selected rim can stay flush with the
 * face or rise around the opening; a buried collar keeps the hood connected.
 * The cut pivots over the outer tip: 0° rotation keeps the top (+Y), and
 * 90° keeps the right (+X). Depth always remains the maximum forward reach.
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
        if (count !== 1)
          throw new Error(
            'The halo must remain joined to the panel as one solid.',
          )
        const mesh = stable.getMesh()
        const output = new Float32Array(mesh.triVerts.length * 3)
        for (let index = 0; index < mesh.triVerts.length; index += 1) {
          const vertex = mesh.triVerts[index] * mesh.numProp
          output[index * 3] = mesh.vertProperties[vertex]
          output[index * 3 + 1] = mesh.vertProperties[vertex + 1]
          output[index * 3 + 2] = mesh.vertProperties[vertex + 2]
        }
        return { positions: output, metadata }
      } finally {
        disposable.reverse().forEach((value) => value.delete())
      }
    },
    dispose() {
      cached?.solid.delete()
      cached = undefined
    },
  }
}
