import type { BufferGeometry } from 'three'
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js'

const CREASE_ANGLE = Math.PI / 6

/**
 * Smooth curved panel edges without spreading bevel normals across large flat
 * faces. Horizontal face corners anchor their smoothing group to the exact
 * plane normal, including the adjoining bevel corner; hard walls stay sharp.
 * Positions and printable topology are unchanged. Like toCreasedNormals, this
 * returns a new non-indexed geometry only when the input has an index.
 */
export function computePanelNormals(geometry: BufferGeometry): BufferGeometry {
  const result = toCreasedNormals(geometry, CREASE_ANGLE)
  const positions = result.getAttribute('position')
  const normals = result.getAttribute('normal')
  const anchors = new Map<string, number>()
  const key = (index: number) =>
    `${positions.getX(index)},${positions.getY(index)},${positions.getZ(index)}`

  for (let triangle = 0; triangle < positions.count; triangle += 3) {
    const z = positions.getZ(triangle)
    if (
      z !== positions.getZ(triangle + 1) ||
      z !== positions.getZ(triangle + 2)
    )
      continue
    const ax = positions.getX(triangle),
      ay = positions.getY(triangle)
    const bx = positions.getX(triangle + 1),
      by = positions.getY(triangle + 1)
    const cx = positions.getX(triangle + 2),
      cy = positions.getY(triangle + 2)
    const direction = Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax))
    if (!direction) continue
    for (let corner = 0; corner < 3; corner += 1)
      anchors.set(key(triangle + corner), direction)
  }

  const creaseDot = Math.cos(CREASE_ANGLE)
  for (let triangle = 0; triangle < positions.count; triangle += 3) {
    const ax = positions.getX(triangle),
      ay = positions.getY(triangle),
      az = positions.getZ(triangle)
    const bx = positions.getX(triangle + 1) - ax,
      by = positions.getY(triangle + 1) - ay,
      bz = positions.getZ(triangle + 1) - az
    const cx = positions.getX(triangle + 2) - ax,
      cy = positions.getY(triangle + 2) - ay,
      cz = positions.getZ(triangle + 2) - az
    const nx = by * cz - bz * cy
    const ny = bz * cx - bx * cz
    const nz = bx * cy - by * cx
    const length = Math.hypot(nx, ny, nz)
    // Only a corner belonging to the plane's smoothing group inherits its
    // anchor. In particular, coincident perpendicular hole walls do not.
    if (Math.abs(nz) <= length * creaseDot) continue
    for (let corner = 0; corner < 3; corner += 1) {
      const index = triangle + corner
      const direction = anchors.get(key(index))
      if (direction !== undefined && nz * direction > 0)
        normals.setXYZ(index, 0, 0, direction)
    }
  }
  normals.needsUpdate = true
  return result
}
