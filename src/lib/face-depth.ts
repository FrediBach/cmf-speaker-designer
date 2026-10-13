import type { SpeakerModel } from './panels'

export const MAX_FACE_DEPTH = 2

/** Shared by the source-mesh path and the worker, before adding a custom grille. */
export function applyFaceDepth(
  positions: { length: number; [index: number]: number },
  model: SpeakerModel,
  relief: number,
) {
  if (!Number.isFinite(relief) || relief < 0 || relief > MAX_FACE_DEPTH)
    throw new RangeError(
      `Added face depth must be between 0 and ${MAX_FACE_DEPTH} mm.`,
    )
  if (relief === 0) return
  const faceTop = model === 's' ? 19 : 57
  for (let index = 0; index < positions.length; index += 3) {
    const y = positions[index + 1]
    const z = positions[index + 2]
    const frontWeight = Math.min(1, Math.max(0, (z - 0.5) / 3.5))
    const t = Math.min(1, Math.max(0, (y - faceTop + 3) / 3))
    const controlWeight = 1 - t * t * (3 - 2 * t)
    if (frontWeight > 0 && controlWeight > 0)
      positions[index + 2] = z + relief * frontWeight * controlWeight
  }
}
