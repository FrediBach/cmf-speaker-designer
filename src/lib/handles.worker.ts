import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { createHandleEngine } from './handle-geometry'
import type { HandleWorkerRequest, HandleWorkerResponse } from './handles'

let engine: ReturnType<typeof createHandleEngine> | undefined

self.onmessage = async (event: MessageEvent<HandleWorkerRequest>) => {
  const { id, model, style, settings, source } = event.data
  try {
    engine ??= createHandleEngine(wasmUrl)
    const kernel = await engine.catch((error) => {
      engine = undefined
      throw error
    })
    const result = kernel.build(model, style, settings, source)
    const message: HandleWorkerResponse = { id, result }
    self.postMessage(message, { transfer: [result.positions.buffer] })
  } catch (error) {
    const message: HandleWorkerResponse = {
      id,
      error:
        error instanceof Error
          ? error.message
          : 'The custom handle could not be generated.',
    }
    self.postMessage(message)
  }
}
