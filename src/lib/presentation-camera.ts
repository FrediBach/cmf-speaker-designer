import { Box3, Vector3 } from 'three'

export const CAMERA_MIN_POLAR = 0.18
export const CAMERA_MAX_POLAR = Math.PI - CAMERA_MIN_POLAR
export const PRESENTATION_MAX_POLAR = Math.PI / 2

const ORBIT_PERIOD = 40
const ELEVATION_PERIOD = ORBIT_PERIOD * Math.SQRT2
const EASE_IN_SECONDS = 0.8

/** Absolute elapsed time keeps the trajectory independent of rendering rate. */
export function presentationAngles(
  elapsed: number,
  initialTheta: number,
  initialPhi: number,
) {
  // Ease the speed in without moving away from the user's current angle first.
  const time = Math.max(0, elapsed)
  const travel = time + EASE_IN_SECONDS * Math.expm1(-time / EASE_IN_SECONDS)
  const center = (CAMERA_MIN_POLAR + PRESENTATION_MAX_POLAR) / 2
  const amplitude = (PRESENTATION_MAX_POLAR - CAMERA_MIN_POLAR) / 2
  const startPhi = Math.max(
    CAMERA_MIN_POLAR,
    Math.min(PRESENTATION_MAX_POLAR, initialPhi),
  )
  const phase = Math.asin(
    Math.max(-1, Math.min(1, (startPhi - center) / amplitude)),
  )
  return {
    theta: initialTheta + (travel * Math.PI * 2) / ORBIT_PERIOD,
    // An irrational period ratio prevents successive circuits retracing the
    // same elevations. Stay above the midline and clear of the top pole.
    phi:
      center +
      amplitude * Math.sin(phase + (travel * Math.PI * 2) / ELEVATION_PERIOD),
  }
}

/** A surrounding sphere stays framed at every azimuth and elevation. */
export function presentationDistance(
  bounds: Box3,
  fov: number,
  aspect: number,
) {
  const radius = bounds.getSize(new Vector3()).length() / 2
  const verticalHalfAngle = (fov * Math.PI) / 360
  const horizontalHalfAngle = Math.atan(
    Math.tan(verticalHalfAngle) * Math.max(aspect, 0.01),
  )
  return (
    (Math.max(radius, 1) * 1.12) /
    Math.sin(Math.min(verticalHalfAngle, horizontalHalfAngle))
  )
}

/** Discard suspended-tab/idle time, but retain normal frame durations. */
export function presentationFrameDelta(delta: number) {
  return delta > 0.25 || !Number.isFinite(delta) ? 0 : Math.max(0, delta)
}
