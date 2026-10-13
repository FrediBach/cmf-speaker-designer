import { BufferGeometry, Float32BufferAttribute } from 'three'
import { describe, expect, it } from 'vitest'
import { computePanelNormals } from './panel-normals'

function panelWithBevel() {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      [
        // Two broad front triangles.
        0, 0, 4, 2, 0, 4, 2, 1, 4, 0, 0, 4, 2, 1, 4, 0, 1, 4,
        // A shallow bevel adjoining the plane.
        2, 0, 4, 2.1, 0, 3.98, 2.1, 1, 3.98, 2, 0, 4, 2.1, 1, 3.98, 2, 1, 4,
        // A perpendicular wall with a hard edge at the bevel.
        2.1, 0, 3.98, 2.1, 0, 0.5, 2.1, 1, 0.5, 2.1, 0, 3.98, 2.1, 1, 0.5, 2.1,
        1, 3.98,
      ],
      3,
    ),
  )
  return geometry
}

describe('panel surface normals', () => {
  it('keeps broad faces flat and meets the bevel without a shading seam', () => {
    const geometry = panelWithBevel()
    const originalPositions = geometry.getAttribute('position').array.slice()
    expect(computePanelNormals(geometry)).toBe(geometry)
    expect(geometry.getAttribute('position').array).toEqual(originalPositions)
    const normals = geometry.getAttribute('normal')
    // All front corners and their coincident bevel corners share +Z.
    for (const index of [0, 1, 2, 3, 4, 5, 6, 9, 11]) {
      expect(normals.getX(index)).toBe(0)
      expect(normals.getY(index)).toBe(0)
      expect(normals.getZ(index)).toBe(1)
    }
    // The other bevel corners still slope smoothly toward the side wall.
    for (const index of [7, 8, 10]) {
      expect(normals.getX(index)).toBeGreaterThan(0.1)
      expect(normals.getZ(index)).toBeGreaterThan(0.95)
    }
    // Coincident hard wall vertices retain their perpendicular normal.
    for (let index = 12; index < 18; index += 1) {
      expect(normals.getX(index)).toBe(1)
      expect(normals.getY(index)).toBe(0)
      expect(normals.getZ(index)).toBe(0)
    }
    geometry.dispose()
  })

  it('preserves rear-facing planes and their adjacent bevel', () => {
    const geometry = panelWithBevel()
    geometry.rotateX(Math.PI)
    // A rigid 180-degree matrix carries sin(pi) residue, so put the nominal
    // horizontal coordinates back onto their exact Float32 plane.
    const positions = geometry.getAttribute('position')
    for (const index of [0, 1, 2, 3, 4, 5, 6, 9, 11]) positions.setZ(index, -4)
    computePanelNormals(geometry)
    const normals = geometry.getAttribute('normal')
    for (const index of [0, 1, 2, 3, 4, 5, 6, 9, 11]) {
      expect(normals.getX(index)).toBe(0)
      expect(normals.getY(index)).toBe(0)
      expect(normals.getZ(index)).toBe(-1)
    }
    geometry.dispose()
  })
})
