import wasmUrl from 'manifold-3d/manifold.wasm?url'
import {
  createMulticolorEngine,
  type MulticolorMesh,
  type MulticolorResult,
} from './multicolor-geometry'
import type { MulticolorSettings } from './multicolor-settings'

export interface MulticolorRequest {
  id: number
  mesh: MulticolorMesh
  settings: MulticolorSettings
}

export interface MulticolorResponse {
  id: number
  result?: MulticolorResult
  error?: string
}

let engine: ReturnType<typeof createMulticolorEngine> | undefined
self.onmessage = async (event: MessageEvent<MulticolorRequest>) => {
  const { id, mesh, settings } = event.data
  try {
    engine ??= createMulticolorEngine(wasmUrl).catch((error) => {
      engine = undefined
      throw error
    })
    const result = (await engine).build(mesh, settings)
    self.postMessage({ id, result } satisfies MulticolorResponse, {
      transfer: result.parts.flatMap(({ positions, indices }) => [
        positions.buffer,
        indices.buffer,
      ]),
    })
  } catch (error) {
    self.postMessage({
      id,
      error:
        error instanceof Error
          ? error.message
          : 'The multicolor panel could not be generated.',
    } satisfies MulticolorResponse)
  }
}
