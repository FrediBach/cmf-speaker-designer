import initializeManifold, {
  type Manifold,
  type ManifoldToplevel,
} from 'manifold-3d'
import { getFaceFold, MAX_FACE_DEPTH } from './face-depth'
import { getPanelGapMetadata, MAX_PANEL_GAP } from './panel-gap'
import type { SpeakerModel } from './panels'

/** Clearance on each side of the tongue; printer calibration still matters. */
export const PANEL_SPLIT_CLEARANCE = 0.2
export const PANEL_SPLIT_ENGAGEMENT = 5

export interface PanelSplitMetadata {
  seamY: number
  seamGapMm: number
  clearanceMm: number
  engagementMm: number
  tongueWidthMm: number
  tongueThicknessMm: number
  /** Slide the upper piece down into the front before mounting the assembly. */
  insertionAxis: [number, number, number]
  frontPositions: Float32Array
  upperPositions: Float32Array
}

export interface PanelSplitResult {
  positions: Float32Array
  metadata: PanelSplitMetadata
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

function positionsOf(solid: Manifold) {
  const mesh = solid.getMesh()
  const positions = new Float32Array(mesh.triVerts.length * 3)
  for (let index = 0; index < mesh.triVerts.length; index += 1) {
    const vertex = mesh.triVerts[index] * mesh.numProp
    positions[index * 3] = mesh.vertProperties[vertex]
    positions[index * 3 + 1] = mesh.vertProperties[vertex + 1]
    positions[index * 3 + 2] = mesh.vertProperties[vertex + 2]
  }
  return positions
}

/**
 * Separate the complete angled deck/handle at the start of the front bend.
 * A broad downward tongue engages a blind groove within the front web, leaving
 * its rear face flush. The tongue adapts to the available face depth to retain
 * 0.8 mm behind the groove and 0.7 mm in front beneath 0.8 mm race stripes.
 * Internal reinforcement backs extended grille recesses only at the joint.
 * Hooks and control seats remain unmodified. Projecting halo geometry stays
 * with the front, even when its crown extends above the fold in front view.
 */
export async function createPanelSplitEngine(wasmUrl?: string) {
  const module = await initializeManifold(
    wasmUrl ? { locateFile: () => wasmUrl } : undefined,
  )
  module.setup()
  return {
    build(
      model: SpeakerModel,
      positions: Float32Array,
      addedFaceDepth = 0,
      panelGap = 0,
    ): PanelSplitResult {
      if (
        !Number.isFinite(addedFaceDepth) ||
        addedFaceDepth < 0 ||
        addedFaceDepth > MAX_FACE_DEPTH ||
        !Number.isFinite(panelGap) ||
        panelGap < 0 ||
        panelGap > MAX_PANEL_GAP
      )
        throw new RangeError(
          'The split panel requires valid face depth and mounting gap.',
        )

      const disposable: { delete(): void }[] = []
      const own = <T extends { delete(): void }>(value: T): T => {
        disposable.push(value)
        return value
      }
      const box = (
        low: [number, number, number],
        high: [number, number, number],
      ) =>
        own(
          own(
            module.Manifold.cube([
              high[0] - low[0],
              high[1] - low[1],
              high[2] - low[2],
            ]),
          ).translate(low),
        )
      const requirePart = (solid: Manifold, name: string) => {
        if (solid.status() !== 'NoError' || solid.isEmpty())
          throw new Error(`The split panel ${name} could not be constructed.`)
        const stable = own(own(solid.asOriginal()).setTolerance(0.00005))
        const parts = stable.decompose().map(own)
        const physical = parts.filter((part) => Math.abs(part.volume()) > 1e-8)
        if (physical.length !== 1)
          throw new Error(
            `The split panel ${name} must remain one connected part.`,
          )
        return physical[0]
      }
      try {
        const original = own(sourceSolid(module, positions))
        const seamY = getFaceFold(model).frontY - addedFaceDepth
        const clearanceMm = PANEL_SPLIT_CLEARANCE
        const halfSeam = clearanceMm / 2
        const frontZ = 4 + addedFaceDepth + panelGap
        // The stock deck and every supported handle sit below the front plane.
        // Halo crowns can cross the seam in Y, but live above that plane.
        const crown = own(original.trimByPlane([0, 0, 1], frontZ + 0.01))
        const lower = own(original.trimByPlane([0, -1, 0], -(seamY - halfSeam)))
        let front = own(lower.add(crown))
        let upper = own(
          own(original.trimByPlane([0, 1, 0], seamY + halfSeam)).trimByPlane(
            [0, 0, -1],
            -(frontZ + 0.01),
          ),
        )
        // Recessed control seats can extend below the split on spaced panels.
        // Keep their original geometry with the upper piece instead of cutting
        // detached tips from them. Limit ownership to the space behind the
        // front web so the visible seam and internal joint stay unchanged.
        for (const well of getPanelGapMetadata(model, panelGap).controlWells) {
          const cylinder = own(
            module.Manifold.cylinder(
              80,
              well.outerRadius + 0.25,
              well.outerRadius + 0.25,
              96,
            ),
          )
          const bounds = own(
            own(cylinder.rotate([-45, 0, 0])).translate(
              well.center.map(
                (coordinate, axis) => coordinate - well.axis[axis] * 40,
              ) as [number, number, number],
            ),
          )
          const seat = own(
            own(original.intersect(bounds)).trimByPlane(
              [0, 0, -1],
              -(panelGap + 0.5),
            ),
          )
          front = own(front.subtract(seat))
          upper = own(upper.add(seat))
        }
        const tongueWidthMm = 26
        // The thinnest striped face has 2.7 mm of material: 0.8 mm rear wall,
        // 0.7 mm front wall, 0.4 mm clearance, and a 0.8 mm tongue. Added face
        // depth allows the tongue to grow back to its full 1.2 mm thickness.
        const tongueThicknessMm = Math.min(1.2, 0.8 + addedFaceDepth)
        const tongueBack = 1.5 + panelGap
        const tongueFront = tongueBack + tongueThicknessMm
        const bottomY = seamY - PANEL_SPLIT_ENGAGEMENT
        // The stock inner rear face is Z=0.5. Reinforcement stays entirely
        // inside the face envelope, without adding a rib behind the panel.
        // It closes extended grille cuts locally to keep the groove enclosed.
        const receiver = box(
          [-tongueWidthMm / 2 - 1.2, bottomY - 0.8, panelGap + 0.5],
          [
            tongueWidthMm / 2 + 1.2,
            seamY - halfSeam,
            tongueFront + clearanceMm + 0.7,
          ],
        )
        front = own(front.add(receiver))
        const socket = box(
          [
            -tongueWidthMm / 2 - clearanceMm,
            bottomY - clearanceMm,
            tongueBack - clearanceMm,
          ],
          [
            tongueWidthMm / 2 + clearanceMm,
            seamY + 1,
            tongueFront + clearanceMm,
          ],
        )
        const tongue = box(
          [-tongueWidthMm / 2, bottomY, tongueBack],
          [tongueWidthMm / 2, seamY + 0.8, tongueFront],
        )
        front = requirePart(own(front.subtract(socket)), 'front')
        upper = requirePart(own(upper.add(tongue)), 'upper section')
        const overlap = own(front.intersect(upper))
        if (Math.abs(overlap.volume()) > 1e-6)
          throw new Error('The split panel joint intersects the front section.')
        const frontPositions = positionsOf(front)
        const upperPositions = positionsOf(upper)
        const output = new Float32Array(
          frontPositions.length + upperPositions.length,
        )
        output.set(frontPositions)
        output.set(upperPositions, frontPositions.length)
        return {
          positions: output,
          metadata: {
            seamY,
            seamGapMm: clearanceMm,
            clearanceMm,
            engagementMm: PANEL_SPLIT_ENGAGEMENT,
            tongueWidthMm,
            tongueThicknessMm,
            insertionAxis: [0, -1, 0],
            frontPositions,
            upperPositions,
          },
        }
      } finally {
        disposable.reverse().forEach((value) => value.delete())
      }
    },
    dispose() {},
  }
}
