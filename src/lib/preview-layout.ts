import { Box3, BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three'
import type { PanelSplitMetadata } from './panel-split'
import { computePanelNormals } from './panel-normals'

export type PreviewAssembly = 'assembled' | 'panel' | 'exploded' | 'knob'
export type PreviewPosition = [number, number, number]

export interface SpeakerPreviewLayout {
  front: PreviewPosition
  upper: PreviewPosition
  knob: PreviewPosition
  powerButton: PreviewPosition
  bounds: Box3
}

const PART_GAP = 18
const CONTROL_ANGLE = -Math.PI / 4

/** Owned display meshes; the worker already smoothed front then upper vertices. */
export function splitPanelPreviewGeometries(geometry: BufferGeometry) {
  const split = geometry.userData.split as PanelSplitMetadata | undefined
  if (!split) return null
  const normal = geometry.getAttribute('normal')
  const count = split.frontPositions.length + split.upperPositions.length
  const reusable =
    !geometry.index &&
    normal instanceof BufferAttribute &&
    normal.itemSize === 3 &&
    !normal.normalized &&
    normal.count * 3 === count &&
    geometry.getAttribute('position').count * 3 === count
  let offset = 0
  return (['front', 'upper'] as const).map((part) => {
    const positions = split[`${part}Positions`]
    const piece = new BufferGeometry()
    piece.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(positions), 3),
    )
    if (reusable) {
      piece.setAttribute(
        'normal',
        new BufferAttribute(
          new Float32Array(
            normal.array.slice(offset, offset + positions.length),
          ),
          3,
        ),
      )
    } else {
      // Supports independently constructed fixtures without prepared worker data.
      computePanelNormals(piece)
    }
    offset += positions.length
    piece.computeBoundingBox()
    piece.computeBoundingSphere()
    return { part, geometry: piece }
  })
}

function geometryBounds(geometry: BufferGeometry) {
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  return geometry.boundingBox!.clone()
}

function splitBounds(positions: Float32Array) {
  return new Box3().setFromArray(positions)
}

/** Match the mesh's mounting transform, including its original stem/socket. */
export function previewControlBounds(
  geometry: BufferGeometry,
  part: 'knob' | 'powerButton',
  position: PreviewPosition,
) {
  const bounds = geometryBounds(geometry)
  if (part === 'knob') {
    bounds.translate(
      new Vector3(0, 0, -(geometry.userData.knob?.mountHeight ?? 5)),
    )
  } else {
    bounds.applyMatrix4(new Matrix4().makeRotationX(Math.PI))
    bounds.translate(new Vector3(0, 0, 0.7))
    // Include the visible seat and factory indicator that accompany the cap.
    bounds.union(
      new Box3(new Vector3(-9.4, -9.4, -0.55), new Vector3(9.4, 9.4, 0.75)),
    )
  }
  return bounds
    .applyMatrix4(new Matrix4().makeRotationX(CONTROL_ANGLE))
    .translate(new Vector3(...position))
}

/** Render positions and camera bounds derive from the same physical pieces. */
export function speakerPreviewLayout(
  geometry: BufferGeometry,
  model: 's' | 'm',
  assembly: PreviewAssembly,
  knobGeometry: BufferGeometry | null,
  powerButtonGeometry: BufferGeometry | null,
): SpeakerPreviewLayout {
  const top = model === 's' ? 29.5 : 70
  const depth = model === 's' ? -6 : -8.5
  const layout: SpeakerPreviewLayout = {
    front: [0, 0, 0],
    upper: [0, 0, 0],
    knob: [28.5, top, depth],
    powerButton: [-28.5, top, depth],
    bounds: new Box3(),
  }
  if (assembly === 'knob' && knobGeometry) {
    layout.bounds = geometryBounds(knobGeometry).applyMatrix4(
      new Matrix4().makeRotationX(-Math.PI / 2),
    )
    return layout
  }

  const panel = geometryBounds(geometry)
  const split = geometry.userData.split as PanelSplitMetadata | undefined
  const separated = assembly === 'exploded' && !!split
  const front = separated ? splitBounds(split.frontPositions) : panel.clone()
  const upper = separated ? splitBounds(split.upperPositions) : panel.clone()
  if (assembly === 'exploded') {
    // Clear the housing first, then expose the sliding joint along its axis.
    const forward = Math.max(32, 4 - panel.min.z)
    layout.front = [0, 0, forward]
    layout.upper = [
      0,
      separated ? Math.max(PART_GAP, front.max.y - upper.min.y + PART_GAP) : 0,
      forward,
    ]
    front.translate(new Vector3(...layout.front))
    upper.translate(new Vector3(...layout.upper))
    const deck = separated ? upper : front
    for (const [part, source] of [
      ['knob', knobGeometry],
      ['powerButton', powerButtonGeometry],
    ] as const) {
      const position = layout[part]
      position[1] += layout.upper[1]
      position[2] += forward
      if (!source) continue
      const mounted = previewControlBounds(source, part, position)
      // Lift along the control shaft and above the handle silhouette, clearing
      // tall handles, deep knobs and projecting halos in the default view.
      const lift = Math.max(
        36,
        (deck.max.z + PART_GAP - mounted.min.z) / Math.SQRT1_2,
        (deck.max.y + PART_GAP - mounted.min.y) / Math.SQRT1_2,
      )
      position[1] += lift * Math.SQRT1_2
      position[2] += lift * Math.SQRT1_2
    }
  }
  layout.bounds.copy(front)
  if (separated) layout.bounds.union(upper)
  if (assembly !== 'panel') {
    const height = model === 's' ? 130.97 : 224.97
    const bodyDepth = model === 's' ? 55 : 64
    const roofTop = model === 's' ? 39.65 : 82.65
    layout.bounds.union(
      new Box3(
        new Vector3(-84.97 / 2, -height / 2 - 1.65, -bodyDepth - 2),
        new Vector3(84.97 / 2, roofTop, 0),
      ),
    )
    if (knobGeometry)
      layout.bounds.union(
        previewControlBounds(knobGeometry, 'knob', layout.knob),
      )
    if (powerButtonGeometry)
      layout.bounds.union(
        previewControlBounds(
          powerButtonGeometry,
          'powerButton',
          layout.powerButton,
        ),
      )
  }
  return layout
}
