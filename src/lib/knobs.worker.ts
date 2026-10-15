import type { BufferGeometry } from 'three'
import { geometryTransferList, serializeGeometry } from './geometry-transfer'
import type { KnobSettings } from './knob-settings'
import { buildKnobGeometry } from './knobs'

self.onmessage = async (
  event: MessageEvent<{ id: number; payload: Partial<KnobSettings> }>,
) => {
  const { id, payload } = event.data
  let geometry: BufferGeometry | undefined
  try {
    geometry = await buildKnobGeometry(payload)
    const result = serializeGeometry(geometry)
    self.postMessage({ id, result }, { transfer: geometryTransferList(result) })
  } catch (error) {
    self.postMessage({
      id,
      error:
        error instanceof Error
          ? error.message
          : 'The volume knob could not be generated.',
    })
  } finally {
    geometry?.dispose()
  }
}
