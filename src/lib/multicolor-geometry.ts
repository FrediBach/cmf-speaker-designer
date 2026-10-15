import initializeManifold, {
  type Manifold,
  type ManifoldToplevel,
} from 'manifold-3d'
import type { BufferGeometry } from 'three'
import { getElementContours } from './multicolor-patterns'
import {
  normalizeMulticolorSettings,
  type MulticolorSettings,
} from './multicolor-settings'

/** Indexed topology is authoritative for both preview and multipart exports. */
export interface MaterialGeometry {
  materialId: string
  geometry: BufferGeometry
  previewGeometry?: BufferGeometry
  volume: number
  elementIds: string[]
}

export interface MulticolorMesh {
  positions: Float32Array
  indices?: Uint32Array
}

export interface MaterialMesh extends MulticolorMesh {
  indices: Uint32Array
  materialId: string
  volume: number
  elementIds: string[]
}

export interface MulticolorResult {
  parts: MaterialMesh[]
  diagnostics: string[]
}

/** Appearance and editor names must not invalidate a geometric partition. */
export function multicolorGeometryKey(settings: MulticolorSettings): string {
  return JSON.stringify({
    enabled: settings.enabled,
    frame: settings.frame,
    elements: settings.elements.map(
      ({ name: _name, groupId: _group, ...shape }) => shape,
    ),
  })
}

export const patternGeometryKey = multicolorGeometryKey

function sourceSolid(
  module: ManifoldToplevel,
  input: MulticolorMesh,
): Manifold {
  if (!input.positions.length || input.positions.length % 3)
    throw new Error('Multicolor needs a nonempty panel mesh.')
  if (!input.positions.every(Number.isFinite))
    throw new Error('The panel contains invalid coordinates.')
  if (input.indices)
    return new module.Manifold(
      new module.Mesh({
        numProp: 3,
        vertProperties: input.positions,
        triVerts: input.indices,
      }),
    )

  // The canonical STL panel is triangle soup. Only this source conversion welds
  // coordinates; output topology must instead follow the kernel's merge map.
  const vertices: number[] = []
  const ids = new Map<string, number>()
  const indices = new Uint32Array(input.positions.length / 3)
  for (let i = 0; i < input.positions.length; i += 3) {
    const key = `${input.positions[i]},${input.positions[i + 1]},${input.positions[i + 2]}`
    let id = ids.get(key)
    if (id === undefined) {
      id = ids.size
      ids.set(key, id)
      vertices.push(
        input.positions[i],
        input.positions[i + 1],
        input.positions[i + 2],
      )
    }
    indices[i / 3] = id
  }
  return new module.Manifold(
    new module.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(vertices),
      triVerts: indices,
    }),
  )
}

function indexedMesh(solid: Manifold): Required<MulticolorMesh> {
  const mesh = solid.getMesh()
  const parents = Uint32Array.from(
    { length: mesh.vertProperties.length / mesh.numProp },
    (_, i) => i,
  )
  const root = (vertex: number): number => {
    while (parents[vertex] !== vertex) {
      parents[vertex] = parents[parents[vertex]]
      vertex = parents[vertex]
    }
    return vertex
  }
  for (let i = 0; i < mesh.mergeFromVert.length; i++)
    parents[root(mesh.mergeFromVert[i])] = root(mesh.mergeToVert[i])
  const ids = new Map<number, number>()
  const positions: number[] = []
  const indices = new Uint32Array(mesh.triVerts.length)
  for (let i = 0; i < indices.length; i++) {
    const vertex = root(mesh.triVerts[i])
    let id = ids.get(vertex)
    if (id === undefined) {
      id = ids.size
      ids.set(vertex, id)
      const offset = vertex * mesh.numProp
      positions.push(...mesh.vertProperties.subarray(offset, offset + 3))
    }
    indices[i] = id
  }
  return { positions: new Float32Array(positions), indices }
}

/** Check the actual Float32 export buffers, including directed shared edges. */
function validateMesh(mesh: Required<MulticolorMesh>) {
  const edges = new Map<string, { count: number; direction: number }>()
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = mesh.indices.subarray(i, i + 3)
    const p = mesh.positions
    const ux = p[b * 3] - p[a * 3]
    const uy = p[b * 3 + 1] - p[a * 3 + 1]
    const uz = p[b * 3 + 2] - p[a * 3 + 2]
    const vx = p[c * 3] - p[a * 3]
    const vy = p[c * 3 + 1] - p[a * 3 + 1]
    const vz = p[c * 3 + 2] - p[a * 3 + 2]
    const area = Math.hypot(
      uy * vz - uz * vy,
      uz * vx - ux * vz,
      ux * vy - uy * vx,
    )
    if (!Number.isFinite(area) || area === 0)
      throw new Error(
        'A color boundary is too small to export reliably. Move or resize the nearby shapes.',
      )
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = `${Math.min(from, to)}:${Math.max(from, to)}`
      const edge = edges.get(key) ?? { count: 0, direction: 0 }
      edge.count++
      edge.direction += from < to ? 1 : -1
      edges.set(key, edge)
    }
  }
  if (
    [...edges.values()].some(
      ({ count, direction }) => count !== 2 || direction !== 0,
    )
  )
    throw new Error(
      'A color region could not form a closed printable part. Adjust the intersecting shapes.',
    )
}

/** Full-depth material assignment never changes the final panel's exterior. */
export async function createMulticolorEngine(wasmUrl?: string) {
  const module = await initializeManifold(
    wasmUrl ? { locateFile: () => wasmUrl } : undefined,
  )
  module.setup()
  return {
    build(
      input: MulticolorMesh,
      inputSettings: MulticolorSettings,
    ): MulticolorResult {
      const settings = normalizeMulticolorSettings(inputSettings)
      const disposables: { delete(): void }[] = []
      const own = <T extends { delete(): void }>(value: T): T => {
        disposables.push(value)
        return value
      }
      try {
        const original = own(sourceSolid(module, input))
        if (
          original.status() !== 'NoError' ||
          original.isEmpty() ||
          original.volume() <= 0
        )
          throw new Error(
            'The panel could not be prepared for multicolor printing.',
          )
        const allowed = new Set([
          'base',
          ...settings.materials.map(({ id }) => id),
        ])
        const frame = settings.frame
        if (
          ![frame.centerX, frame.centerY, frame.width, frame.height].every(
            Number.isFinite,
          ) ||
          frame.width <= 0 ||
          frame.height <= 0
        )
          throw new Error('The artwork frame needs positive finite dimensions.')
        const clip = own(
          module.CrossSection.square([frame.width, frame.height], true),
        )
        const translatedClip = own(
          clip.translate([frame.centerX, frame.centerY]),
        )
        let minZ = Infinity,
          maxZ = -Infinity
        for (let i = 2; i < input.positions.length; i += 3) {
          minZ = Math.min(minZ, input.positions[i])
          maxZ = Math.max(maxZ, input.positions[i])
        }
        const margin = 1
        const groups = new Map<
          string,
          { solids: Manifold[]; elementIds: string[] }
        >()
        const diagnostics: string[] = []
        const assign = (id: string, solid: Manifold, elementId?: string) => {
          if (solid.isEmpty()) return
          const group = groups.get(id) ?? { solids: [], elementIds: [] }
          group.solids.push(solid)
          if (elementId) group.elementIds.push(elementId)
          groups.set(id, group)
        }
        let remaining = original
        // Resolve paint coverage in the projection plane before cutting the
        // solid. Re-cutting an already consumed face can leave a nonempty,
        // zero-volume sheet in the 3D kernel for an otherwise covered layer.
        let unpainted = translatedClip
        if (settings.enabled) {
          for (const element of [...settings.elements].reverse()) {
            if (!element.visible) continue
            if (!allowed.has(element.materialId))
              throw new Error(
                'A shape refers to a missing material. Assign its color again.',
              )
            const contours = getElementContours(element)
            if (
              contours.some((contour) =>
                contour.some((point) => !point.every(Number.isFinite)),
              )
            )
              throw new Error('A pattern contains invalid coordinates.')
            const outline = own(new module.CrossSection(contours, 'NonZero'))
            const profile = own(outline.intersect(translatedClip))
            const visible = own(profile.intersect(unpainted))
            if (remaining.isEmpty() || visible.isEmpty()) {
              diagnostics.push(
                `${element.name || 'Shape'} contributes no material: it is covered or outside the panel.`,
              )
              continue
            }
            unpainted = own(unpainted.subtract(profile))
            // Keep the original cutter for partial overlaps. Trimming it to
            // visible coverage creates extra coplanar edges at previous cuts,
            // which can collapse when the result is serialized to Float32.
            const extrusion = own(profile.extrude(maxZ - minZ + margin * 2))
            const cutter = own(extrusion.translate([0, 0, minZ - margin]))
            const [covered, rest] = remaining.split(cutter).map(own)
            if (covered.status() !== 'NoError' || rest.status() !== 'NoError')
              throw new Error(
                'These shapes could not be split into printable color regions.',
              )
            remaining = rest
            if (covered.isEmpty()) {
              diagnostics.push(
                `${element.name || 'Shape'} contributes no material: it is covered or lies in an opening.`,
              )
            } else {
              assign(element.materialId, covered, element.id)
            }
          }
        }
        assign('base', remaining)
        const parts: MaterialMesh[] = []
        for (const materialId of allowed) {
          const group = groups.get(materialId)
          if (!group) continue
          const solid =
            group.solids.length === 1
              ? group.solids[0]
              : own(module.Manifold.union(group.solids))
          if (
            solid.status() !== 'NoError' ||
            solid.isEmpty() ||
            solid.volume() <= 0
          )
            throw new Error(
              'A material could not be joined into a printable part.',
            )
          const mesh = indexedMesh(solid)
          validateMesh(mesh)
          // A conservative footprint heuristic, not a promise about any printer.
          // Check the resolved material, including clipping and layer overlaps.
          const footprint = own(solid.project())
          const islands = footprint.decompose().map(own)
          if (islands.some((island) => own(island.offset(-0.4)).isEmpty()))
            diagnostics.push(
              `Material ${materialId} contains a small or narrow island against a 0.8 mm width reference. Check its sliced layers and your selected line width.`,
            )
          parts.push({
            ...mesh,
            materialId,
            volume: solid.volume(),
            elementIds: group.elementIds,
          })
        }
        const volume = original.volume()
        const total = parts.reduce((sum, part) => sum + part.volume, 0)
        if (Math.abs(total - volume) > Math.max(0.001, volume * 0.00001))
          throw new Error(
            'The color regions do not cover the panel reliably. Adjust the intersecting shapes.',
          )
        if (parts.length > 8)
          diagnostics.push(
            `${parts.length} materials are used. Confirm your printer's capacity and tool changes in the slicer.`,
          )
        return { parts, diagnostics }
      } finally {
        disposables.reverse().forEach((value) => value.delete())
      }
    },
    dispose() {},
  }
}
