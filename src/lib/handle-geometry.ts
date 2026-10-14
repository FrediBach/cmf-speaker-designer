import initializeManifold, {
  type Manifold,
  type ManifoldToplevel,
} from 'manifold-3d'
import {
  getHandleHoleCenters,
  getHandleOutline,
  getHandleStudCenters,
  getHandleSvgPaths,
  HANDLE_STUD_DIAMETER,
  HANDLE_STUD_HEIGHT,
  HANDLE_THICKNESS,
  normalizeHandleSettings,
  type HandleSettings,
} from './handle-settings'
import type { PanelStyle, SpeakerModel } from './panels'
import type { RaceStripeSettings } from './race-stripe-settings'

type Point = [number, number]
export interface HandleMetadata {
  settings: HandleSettings
  seamY: number
  backZ: number
  thickness: number
  holeCenters: { x: number; y: number; width: number; height: number }[]
  studCenters: { x: number; y: number }[]
}
export interface HandleResult {
  positions: Float32Array
  metadata: HandleMetadata
}
interface CachedBase {
  solid: Manifold
  seamY: number
  backZ: number
  width: number
  panelExtension: number
}

function capsule(width: number, height: number, x: number, y: number): Point[] {
  const radius = height / 2
  const points: Point[] = []
  for (const [cx, start] of [
    [x + (width - height) / 2, -90],
    [x - (width - height) / 2, 90],
  ]) {
    for (let step = 0; step <= 32; step += 1) {
      const angle = ((start + (step * 180) / 32) * Math.PI) / 180
      points.push([cx + Math.cos(angle) * radius, y + Math.sin(angle) * radius])
    }
  }
  return points
}

function sourceSolid(
  module: ManifoldToplevel,
  positions: Float32Array,
): Manifold {
  const unique = new Map<string, number>()
  const vertices: number[] = []
  const triangles = new Uint32Array(positions.length / 3)
  for (let index = 0; index < positions.length; index += 3) {
    const key = `${positions[index]},${positions[index + 1]},${positions[index + 2]}`
    let vertex = unique.get(key)
    if (vertex === undefined) {
      vertex = unique.size
      unique.set(key, vertex)
      vertices.push(
        positions[index],
        positions[index + 1],
        positions[index + 2],
      )
    }
    triangles[index / 3] = vertex
  }
  return new module.Manifold(
    new module.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(vertices),
      triVerts: triangles,
    }),
  )
}

/** A dedicated kernel instance, used in a Worker in the browser and directly by tests. */
export async function createHandleEngine(wasmUrl?: string) {
  const module = await initializeManifold(
    wasmUrl ? { locateFile: () => wasmUrl } : undefined,
  )
  module.setup()
  const bases = new Map<string, CachedBase>()

  return {
    build(
      model: SpeakerModel,
      style: PanelStyle,
      input: HandleSettings,
      source?: Float32Array,
      panelExtension = 0,
      raceStripes?: RaceStripeSettings,
    ): HandleResult {
      const settings = normalizeHandleSettings(model, input)
      const key = `${model}:${style}`
      let base = bases.get(key)
      if (!base || base.panelExtension !== panelExtension) {
        if (!source)
          throw new Error(
            'The original panel is missing. Please retry the design.',
          )
        let minX = Infinity,
          maxX = -Infinity,
          maxY = -Infinity,
          minZ = Infinity
        for (let index = 0; index < source.length; index += 3) {
          minX = Math.min(minX, source[index])
          maxX = Math.max(maxX, source[index])
          maxY = Math.max(maxY, source[index + 1])
          minZ = Math.min(minZ, source[index + 2])
        }
        const seamY = maxY - (model === 's' ? 24 : 27)
        const original = sourceSolid(module, source)
        try {
          const lower = original.trimByPlane([0, -1, 0], -seamY)
          if (lower.status() !== 'NoError') {
            lower.delete()
            throw new Error(
              'The original panel could not be prepared for a custom handle.',
            )
          }
          // Keep one base per model/style when the panel width changes, rather
          // than retaining a solid for every position of the extension slider.
          base?.solid.delete()
          base = {
            solid: lower,
            seamY,
            backZ: minZ,
            width: maxX - minX,
            panelExtension,
          }
          bases.set(key, base)
        } finally {
          original.delete()
        }
      }

      const disposable: { delete(): void }[] = []
      const own = <T extends { delete(): void }>(value: T): T => {
        disposable.push(value)
        return value
      }
      try {
        let section = own(
          new module.CrossSection([
            getHandleOutline(model, settings, base.width),
          ]),
        )
        const holeCenters: HandleMetadata['holeCenters'] = []
        if (settings.cutout === 'svg') {
          const paths = getHandleSvgPaths(model, settings)
          if (paths.length) {
            const filledPaths = paths.map((path) =>
              own(
                new module.CrossSection(
                  path.contours,
                  path.fillRule === 'evenodd' ? 'EvenOdd' : 'NonZero',
                ),
              ),
            )
            const cutouts = own(module.CrossSection.union(filledPaths))
            if (cutouts.isEmpty())
              throw new Error(
                'The SVG has no filled cutout area. Use closed, filled shapes.',
              )
            section = own(section.subtract(cutouts))
            const sections = section.decompose()
            const count = sections.length
            sections.forEach((part) => part.delete())
            if (count !== 1)
              throw new Error(
                'This SVG leaves floating islands in the handle. Add bridges to enclosed details or use a solid silhouette.',
              )
          }
        } else if (settings.cutout !== 'none' && settings.cutout !== 'slits') {
          const holes: Point[][] = []
          for (const hole of getHandleHoleCenters(model, settings)) {
            holes.push(capsule(hole.width, hole.height, hole.x, hole.y))
            holeCenters.push({ ...hole, y: hole.y + base.seamY })
          }
          if (holes.length) {
            const cutouts = own(new module.CrossSection(holes))
            section = own(section.subtract(cutouts))
          }
        }
        const extrusion = own(section.extrude(HANDLE_THICKNESS))
        const extension = own(extrusion.translate([0, base.seamY, base.backZ]))
        const studCenters = getHandleStudCenters(
          model,
          settings,
          raceStripes,
        ).map((center) => ({
          x: center.x,
          y: center.y + base.seamY,
        }))
        let united = own(base.solid.add(extension))
        if (studCenters.length) {
          // Embed each cylinder slightly into the face for a robust solid union.
          const overlap = 0.25
          const stud = own(
            module.Manifold.cylinder(
              HANDLE_STUD_HEIGHT + overlap,
              HANDLE_STUD_DIAMETER / 2,
              HANDLE_STUD_DIAMETER / 2,
              64,
            ),
          )
          const studs = studCenters.map(({ x, y }) =>
            own(
              stud.translate([x, y, base.backZ + HANDLE_THICKNESS - overlap]),
            ),
          )
          united = own(module.Manifold.union([united, ...studs]))
        }
        if (united.status() !== 'NoError' || united.isEmpty())
          throw new Error('This handle could not be joined to the panel.')
        // Boolean intersections can create sub-float-precision slivers. Remove
        // them before the binary STL's Float32 conversion, within 0.00005 mm.
        const consolidated = own(united.asOriginal())
        const stable = own(consolidated.simplify(0.00005))
        const components = stable.decompose()
        const componentCount = components.length
        components.forEach((component) => component.delete())
        if (componentCount !== 1)
          throw new Error('The handle must form a single connected panel.')
        const mesh = stable.getMesh()
        const positions = new Float32Array(mesh.triVerts.length * 3)
        for (let index = 0; index < mesh.triVerts.length; index += 1) {
          const vertex = mesh.triVerts[index] * mesh.numProp
          positions[index * 3] = mesh.vertProperties[vertex]
          positions[index * 3 + 1] = mesh.vertProperties[vertex + 1]
          positions[index * 3 + 2] = mesh.vertProperties[vertex + 2]
        }
        return {
          positions,
          metadata: {
            settings,
            seamY: base.seamY,
            backZ: base.backZ,
            thickness: HANDLE_THICKNESS,
            holeCenters,
            studCenters,
          },
        }
      } finally {
        disposable.reverse().forEach((value) => value.delete())
      }
    },
    dispose() {
      bases.forEach((base) => base.solid.delete())
      bases.clear()
    },
  }
}
