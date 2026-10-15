import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { createPanelEngine } from './panel-engine'
import type { HandleWorkerRequest } from './handles'
import { loadPanelGeometry } from './panels'
import { preparePanelGeometry } from './panel-result'
import { geometryTransferList, serializeGeometry } from './geometry-transfer'

const engine = createPanelEngine(wasmUrl)
const sources = new Map<string, Promise<Float32Array>>()
type Request = Omit<HandleWorkerRequest, 'id'>

self.onmessage = async (
  event: MessageEvent<{ id: number; payload: Request }>,
) => {
  const { id, payload } = event.data
  try {
    if (!payload.source) {
      const key = `${payload.model}:${payload.style}`
      let source = sources.get(key)
      if (!source) {
        source = loadPanelGeometry(payload.model, payload.style)
          .then((geometry) => {
            const positions = geometry.getAttribute('position')
              .array as Float32Array
            geometry.dispose()
            return positions
          })
          .catch((error) => {
            sources.delete(key)
            throw error
          })
        sources.set(key, source)
      }
      payload.source = await source
    }
    const geometry = preparePanelGeometry(await engine.build(payload), payload)
    try {
      const result = serializeGeometry(geometry)
      self.postMessage(
        { id, result },
        { transfer: geometryTransferList(result) },
      )
    } finally {
      geometry.dispose()
    }
  } catch (error) {
    self.postMessage({
      id,
      error:
        error instanceof Error
          ? error.message
          : 'The custom panel could not be generated.',
    })
  }
}
