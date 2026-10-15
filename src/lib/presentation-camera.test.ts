import { Box3, PerspectiveCamera, Spherical, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  PRESENTATION_MAX_POLAR,
  CAMERA_MIN_POLAR,
  presentationAngles,
  presentationDistance,
  presentationFrameDelta,
} from './presentation-camera'

describe('presentation camera', () => {
  it('starts at the current angle and gradually accelerates', () => {
    for (const phi of [0.18, 0.8, 1.3, Math.PI / 2]) {
      expect(presentationAngles(0, -0.9, phi).theta).toBe(-0.9)
      expect(presentationAngles(0, -0.9, phi).phi).toBeCloseTo(phi, 12)
    }
    // Starting presentation from a manual underside view returns to level.
    expect(presentationAngles(0, -0.9, 2.7).phi).toBeCloseTo(Math.PI / 2, 12)
    const initialStep = presentationAngles(0.1, 0, 1).theta
    const settledStep =
      presentationAngles(10.1, 0, 1).theta - presentationAngles(10, 0, 1).theta
    expect(initialStep).toBeGreaterThan(0)
    expect(initialStep).toBeLessThan(settledStep / 10)
  })

  it('visits every azimuth from level to above without dipping below the midline', () => {
    const elevations = Array.from({ length: 12 }, () => ({
      min: Infinity,
      max: -Infinity,
    }))
    for (let elapsed = 0; elapsed <= 1600; elapsed += 0.5) {
      const angles = presentationAngles(elapsed, 0.5, 1.2)
      expect(angles.phi).toBeGreaterThanOrEqual(CAMERA_MIN_POLAR - 1e-12)
      expect(angles.phi).toBeLessThanOrEqual(PRESENTATION_MAX_POLAR + 1e-12)
      expect(angles.phi).toBeLessThanOrEqual(Math.PI / 2 + 1e-12)
      const sector = Math.floor(
        ((angles.theta % (Math.PI * 2)) / (Math.PI * 2)) * 12,
      )
      elevations[sector].min = Math.min(elevations[sector].min, angles.phi)
      elevations[sector].max = Math.max(elevations[sector].max, angles.phi)
    }
    for (const sector of elevations) {
      expect(sector.min).toBeLessThan(0.25)
      expect(sector.max).toBeGreaterThan(Math.PI / 2 - 0.05)
    }
    // Two complete azimuth turns must not repeat the first turn's elevation.
    expect(
      Math.abs(
        presentationAngles(80.8, 0.5, 1.2).phi -
          presentationAngles(40.8, 0.5, 1.2).phi,
      ),
    ).toBeGreaterThan(0.5)
  })

  it('keeps all corners in frame for both models, extended panels, exploded parts and knobs', () => {
    const scenes = [
      new Box3(new Vector3(-43, -67, -57), new Vector3(43, 66, 10)),
      new Box3(new Vector3(-43, -115, -66), new Vector3(43, 113, 10)),
      new Box3(new Vector3(-88, -115, -66), new Vector3(88, 178, 10)),
      new Box3(new Vector3(-43, -67, -57), new Vector3(43, 92, 48)),
      new Box3(new Vector3(-16, 0, -16), new Vector3(16, 29, 16)),
    ]
    for (const bounds of scenes) {
      for (const aspect of [0.2, 0.65, 1.5]) {
        const camera = new PerspectiveCamera(34, aspect, 1, 10000)
        const target = bounds.getCenter(new Vector3())
        const distance = presentationDistance(bounds, camera.fov, aspect)
        for (let theta = 0; theta < Math.PI * 2; theta += Math.PI / 4) {
          for (const phi of [0.18, 0.6, Math.PI / 2, 2.5, Math.PI - 0.18]) {
            camera.position
              .copy(target)
              .add(
                new Vector3().setFromSpherical(
                  new Spherical(distance, phi, theta),
                ),
              )
            camera.lookAt(target)
            camera.updateMatrixWorld()
            for (const x of [bounds.min.x, bounds.max.x]) {
              for (const y of [bounds.min.y, bounds.max.y]) {
                for (const z of [bounds.min.z, bounds.max.z]) {
                  const projected = new Vector3(x, y, z).project(camera)
                  expect(Math.abs(projected.x)).toBeLessThan(0.9)
                  expect(Math.abs(projected.y)).toBeLessThan(0.9)
                  expect(Math.abs(projected.z)).toBeLessThan(1)
                }
              }
            }
          }
        }
      }
    }
  })

  it('matches motion across frame rates and ignores suspended-tab time', () => {
    const elapsed = (fps: number) => {
      let time = 0
      for (let frame = 0; frame < 15 * fps; frame++) {
        time += presentationFrameDelta(1 / fps)
      }
      return presentationAngles(time, -1, 0.8)
    }
    expect(elapsed(30).theta).toBeCloseTo(elapsed(144).theta, 10)
    expect(elapsed(30).phi).toBeCloseTo(elapsed(144).phi, 10)
    expect(presentationFrameDelta(120)).toBe(0)
    expect(presentationFrameDelta(Number.NaN)).toBe(0)
    expect(presentationFrameDelta(-1)).toBe(0)
    expect(presentationFrameDelta(0.1)).toBe(0.1)
  })
})
