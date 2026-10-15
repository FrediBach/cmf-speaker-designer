import {
  deserializeGeometry,
  type SerializedGeometry,
} from './geometry-transfer'
import type { KnobSettings } from './knob-settings'
import { createWorkerClient } from './worker-client'

const client = createWorkerClient<Partial<KnobSettings>, SerializedGeometry>(
  () =>
    new Worker(new URL('./knobs.worker.ts', import.meta.url), {
      type: 'module',
    }),
  'The volume knob generator could not run. Please retry.',
)

/** The caller owns the geometry used by both the preview and the export. */
export async function buildKnobGeometryInWorker(
  settings: Partial<KnobSettings> = {},
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  if (typeof Worker === 'undefined') {
    const { buildKnobGeometry } = await import('./knobs')
    return buildKnobGeometry(settings, signal)
  }
  const result = await client.request(settings, undefined, signal)
  signal?.throwIfAborted()
  return deserializeGeometry(result)
}
