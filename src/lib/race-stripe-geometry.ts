import initializeManifold, { type ManifoldToplevel } from 'manifold-3d'
import { getFaceFold } from './face-depth'
import {
  getRaceStripeIntervals,
  normalizeRaceStripeSettings,
  RACE_STRIPE_DEPTH,
  type RaceStripeSettings,
} from './race-stripe-settings'
import type { SpeakerModel } from './panels'

export interface RaceStripeMetadata {
  settings: RaceStripeSettings
  depthMm: number
  intervals: { minX: number; maxX: number }[]
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

/** The groove floor follows both folded surfaces at a constant normal depth. */
function grooveProfile(
  model: SpeakerModel,
  relief: number,
  gap: number,
  minY: number,
  maxY: number,
  topZ: number,
): [number, number][] {
  const { frontY, deckIntercept } = getFaceFold(model)
  const depth = RACE_STRIPE_DEPTH
  const foldY = frontY - relief
  const foldZ = 3 + relief
  // The mounting gap expands the front bend; recessing contracts it again.
  const foldRadius = 1 + gap - depth
  const offset = gap * Math.SQRT1_2
  const handleFront = model === 's' ? -16 : -21
  const handleY = deckIntercept - handleFront + Math.SQRT2 - 1 + offset
  const handleZ = handleFront + 1 + offset
  // This concave bend is translated by the mounting gap, so its inner offset
  // grows the original radius instead of contracting it.
  const handleRadius = 1 + depth
  const profile: [number, number][] = [[minY, 4 + relief + gap - depth]]
  for (let step = 0; step <= 24; step += 1) {
    const angle = (step * Math.PI) / 96
    profile.push([
      foldY + foldRadius * Math.sin(angle),
      foldZ + foldRadius * Math.cos(angle),
    ])
  }
  for (let step = 24; step >= 0; step -= 1) {
    const angle = (step * Math.PI) / 96
    profile.push([
      handleY - handleRadius * Math.sin(angle),
      handleZ - handleRadius * Math.cos(angle),
    ])
  }
  profile.push([maxY, handleFront + offset - depth], [maxY, topZ], [minY, topZ])
  return profile
}

/** Cut after the grille and before the halo, whose buried roots remain intact. */
export async function createRaceStripeEngine(wasmUrl?: string) {
  const module = await initializeManifold(
    wasmUrl ? { locateFile: () => wasmUrl } : undefined,
  )
  module.setup()
  return {
    build(
      model: SpeakerModel,
      input: RaceStripeSettings,
      positions: Float32Array,
      relief = 0,
      panelGap = 0,
    ): { positions: Float32Array; metadata: RaceStripeMetadata } {
      const settings = normalizeRaceStripeSettings(input)
      const intervals = getRaceStripeIntervals(settings)
      const metadata = { settings, depthMm: RACE_STRIPE_DEPTH, intervals }
      if (!settings.enabled) return { positions, metadata }
      const disposable: { delete(): void }[] = []
      const own = <T extends { delete(): void }>(value: T): T => {
        disposable.push(value)
        return value
      }
      try {
        const original = own(sourceSolid(module, positions))
        if (original.status() !== 'NoError' || original.isEmpty())
          throw new Error('The panel could not be prepared for race stripes.')
        let minY = Infinity,
          maxY = -Infinity,
          maxZ = -Infinity
        for (let index = 0; index < positions.length; index += 3) {
          minY = Math.min(minY, positions[index + 1])
          maxY = Math.max(maxY, positions[index + 1])
          maxZ = Math.max(maxZ, positions[index + 2])
        }
        const profile = own(
          new module.CrossSection([
            grooveProfile(
              model,
              relief,
              panelGap,
              minY - 1,
              maxY + 1,
              maxZ + 1,
            ),
          ]),
        )
        const cutters = intervals.map(({ minX, maxX }) => {
          // A grille hole can be exactly tangent to a groove wall. Open that
          // contact by a tenth of a micron so exported Float32 faces cannot
          // meet four-to-an-edge along a zero-width sliver of the raised face.
          const overlap = 0.0001
          const extrusion = own(profile.extrude(maxX - minX + 2 * overlap))
          // Local profile X/Y become panel Y/Z, with extrusion along panel X.
          return own(
            own(extrusion.rotate([90, 0, 90])).translate([
              minX - overlap,
              0,
              0,
            ]),
          )
        })
        let cutter = own(module.Manifold.union(cutters))
        const controlY = model === 's' ? 29.5 : 70
        const controlZ = model === 's' ? -6 : -8.5
        for (const x of [-28.5, 28.5]) {
          // Protect the complete seating collar and raised control well, with
          // 0.25 mm clearance. Its axis is the controls' unchanged shaft axis.
          const cylinder = own(module.Manifold.cylinder(80, 13.55, 13.55, 128))
          const inclined = own(cylinder.rotate([-45, 0, 0]))
          const protectedControl = own(
            inclined.translate([
              x,
              controlY - 30 * Math.SQRT1_2,
              controlZ - 30 * Math.SQRT1_2,
            ]),
          )
          cutter = own(cutter.subtract(protectedControl))
        }
        const carved = own(original.subtract(cutter))
        if (carved.status() !== 'NoError' || carved.isEmpty())
          throw new Error(
            'The race stripes could not be recessed into the panel.',
          )
        const consolidated = own(carved.asOriginal())
        const stable = own(consolidated.simplify(0.00005))
        const components = stable.decompose().map(own)
        if (components.length !== 1)
          throw new Error('The recessed panel must remain one connected solid.')
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
    dispose() {},
  }
}
