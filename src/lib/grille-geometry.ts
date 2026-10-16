import initializeManifold, {
  type Manifold,
  type ManifoldToplevel,
} from 'manifold-3d'
import {
  getGrillePattern,
  GRILLE_INSERT_RADIUS,
  GRILLE_MIN_BACKING,
  normalizeGrilleSettings,
  type GrilleSettings,
} from './grille-settings'
import type { SpeakerModel } from './panels'
import type { RaceStripeSettings } from './race-stripe-settings'

export interface GrilleMetadata {
  settings: GrilleSettings
  frontZ: number
  backZ: number
  throughHoleCount: number
  recessCount: number
  holes: { x: number; y: number; kind: 'through' | 'recess' }[]
}
export interface GrilleResult {
  positions: Float32Array
  metadata: GrilleMetadata
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
 * Run after custom-handle generation and face-depth adjustment. Only the open
 * original front-panel shape is supported. Discs overlap the CAD aperture rims
 * positively. The extended pattern can recess, perforate, or rise from the
 * face; case attachment roots retain a solid backing even at full cut depth.
 */
export async function createGrilleEngine(wasmUrl?: string) {
  const module = await initializeManifold(
    wasmUrl ? { locateFile: () => wasmUrl } : undefined,
  )
  module.setup()
  let cached:
    | {
        model: SpeakerModel
        positions: Float32Array
        solid: Manifold
        frontZ: number
      }
    | undefined
  return {
    build(
      model: SpeakerModel,
      input: GrilleSettings,
      positions: Float32Array,
      panelGap = 0,
      raceStripes?: RaceStripeSettings,
    ): GrilleResult {
      const settings = normalizeGrilleSettings(input)
      let frontZ = -Infinity
      for (let index = 2; index < positions.length; index += 3)
        frontZ = Math.max(frontZ, positions[index])
      if (settings.mode === 'original')
        return {
          positions: positions.slice(),
          metadata: {
            settings,
            frontZ,
            backZ: 0.5 + panelGap,
            throughHoleCount: 0,
            recessCount: 0,
            holes: [],
          },
        }
      if (frontZ - panelGap < 3.99 || frontZ - panelGap > 6.01)
        throw new Error(
          'Custom grilles require the original open front-panel shape.',
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
            'The original panel could not be prepared for a custom grille.',
          )
        }
        cached?.solid.delete()
        cached = { model, positions: positions.slice(), solid, frontZ }
      }
      const disposable: { delete(): void }[] = []
      const own = <T extends { delete(): void }>(value: T): T => {
        disposable.push(value)
        return value
      }
      try {
        const pattern = getGrillePattern(model, settings, raceStripes)
        const through = pattern.holes.filter((hole) => hole.kind === 'through')
        const recesses = pattern.holes.filter((hole) => hole.kind === 'recess')
        if (!through.length)
          throw new Error(
            'This grille pattern has no speaker openings. Reduce hole size or spacing.',
          )
        const discContours = pattern.openings.map((opening) =>
          Array.from({ length: 160 }, (_, index): [number, number] => [
            opening.x + GRILLE_INSERT_RADIUS * Math.cos((index * Math.PI) / 80),
            opening.y + GRILLE_INSERT_RADIUS * Math.sin((index * Math.PI) / 80),
          ]),
        )
        const discs = own(new module.CrossSection(discContours))
        const cuts = own(
          new module.CrossSection(through.map((hole) => hole.points)),
        )
        const perforated = own(discs.subtract(cuts))
        const extrusion = own(perforated.extrude(settings.thickness))
        const grille = own(
          extrusion.translate([0, 0, frontZ - settings.thickness]),
        )
        let result = own(cached.solid.add(grille))
        if (recesses.length && settings.recessDepth !== 0) {
          const recessProfiles = own(
            new module.CrossSection(recesses.map((hole) => hole.points)),
          )
          const rearZ = 0.5 + panelGap
          const bottomZ = Math.min(rearZ, frontZ - settings.thickness) - 0.25
          const recessExtrusion = own(
            recessProfiles.extrude(frontZ - bottomZ + 0.25),
          )
          const prism = own(recessExtrusion.translate([0, 0, bottomZ]))
          if (settings.recessDepth > 0) {
            // Follow the local front surface, including the aperture bevel.
            const depthStop = own(
              result.translate([0, 0, -settings.recessDepth]),
            )
            let cutter = own(prism.subtract(depthStop))
            // Only the source attachments extend behind the flat rear face.
            // Project their complete roots (including gap supports), with a
            // small shoulder, and retain 0.5 mm of panel above those roots.
            const attachments = own(
              cached.solid.trimByPlane([0, 0, -1], -(rearZ - 0.01)),
            )
            const footprint = own(attachments.project())
            const shoulder = own(footprint.offset(GRILLE_MIN_BACKING))
            const backing = own(
              shoulder.extrude(rearZ + GRILLE_MIN_BACKING - bottomZ),
            )
            const protectedRoots = own(backing.translate([0, 0, bottomZ]))
            cutter = own(cutter.subtract(protectedRoots))
            result = own(result.subtract(cutter))
          } else {
            // Sweep the existing face columns upward so raised patterns follow
            // the local face and remain joined even on the thinnest insert.
            const columns = own(result.intersect(prism))
            const height = -settings.recessDepth
            const steps = Math.ceil(height)
            const raised = Array.from({ length: steps }, (_, index) =>
              own(columns.translate([0, 0, (height * (index + 1)) / steps])),
            )
            result = own(module.Manifold.union([result, ...raised]))
          }
        }
        if (result.status() !== 'NoError' || result.isEmpty())
          throw new Error('This grille could not be joined to the panel.')
        // Consolidate coplanar boolean faces and prevent Float32 seam slivers.
        const consolidated = own(result.asOriginal())
        const stable = own(consolidated.simplify(0.00005))
        const components = stable.decompose()
        const count = components.length
        components.forEach((component) => component.delete())
        if (count !== 1)
          throw new Error(
            'The grille must remain joined to the panel as one solid.',
          )
        const mesh = stable.getMesh()
        const output = new Float32Array(mesh.triVerts.length * 3)
        for (let index = 0; index < mesh.triVerts.length; index += 1) {
          const vertex = mesh.triVerts[index] * mesh.numProp
          output[index * 3] = mesh.vertProperties[vertex]
          output[index * 3 + 1] = mesh.vertProperties[vertex + 1]
          output[index * 3 + 2] = mesh.vertProperties[vertex + 2]
        }
        return {
          positions: output,
          metadata: {
            settings,
            frontZ,
            backZ: frontZ - settings.thickness,
            throughHoleCount: through.length,
            recessCount: recesses.length,
            holes: pattern.holes.map(({ x, y, kind }) => ({ x, y, kind })),
          },
        }
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
