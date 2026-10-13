import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { createPanelEngine } from './panel-engine'
import type { HandleWorkerRequest, HandleWorkerResponse } from './handles'

const engine = createPanelEngine(wasmUrl)

self.onmessage = async (event: MessageEvent<HandleWorkerRequest>) => {
  const { id } = event.data
  try {
    const result = await engine.build(event.data)
    const message: HandleWorkerResponse = { id, result }
    self.postMessage(message, { transfer: [result.positions.buffer] })
  } catch (error) {
    const message: HandleWorkerResponse = {
      id,
      error:
        error instanceof Error
          ? error.message
          : 'The custom panel could not be generated.',
    }
    self.postMessage(message)
  }
}
