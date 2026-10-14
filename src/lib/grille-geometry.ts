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
 * positively; all new through-holes stay inside the original speaker openings.
 * Optional face impressions retain solid backing across the grille and panel.
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
        const pattern = getGrillePattern(model, settings)
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
        if (recesses.length) {
          const recessProfiles = own(
            new module.CrossSection(recesses.map((hole) => hole.points)),
          )
          // Follow the joined panel and grille face, including its tessellated
          // face-depth transition. Using the joined solid also keeps recesses
          // blind where the continuous pattern crosses the aperture rims.
          // The rear face starts at Z=0.5 plus the panel gap. Extend the cutter
          // down to its remaining backing so deeper selected recesses cut fully.
          const minimumFloorZ = 0.5 + panelGap + GRILLE_MIN_BACKING
          const recessExtrusion = own(
            recessProfiles.extrude(frontZ - minimumFloorZ + 0.25),
          )
          const prism = own(recessExtrusion.translate([0, 0, minimumFloorZ]))
          const depthStop = own(result.translate([0, 0, -settings.recessDepth]))
          const cutter = own(prism.subtract(depthStop))
          result = own(result.subtract(cutter))
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
