import wasmUrl from 'manifold-3d/manifold.wasm?url'
import {
  createMulticolorEngine,
  type MulticolorMesh,
} from './multicolor-geometry'
import {
  multicolorTransferList,
  prepareMulticolorResult,
  type PreparedMulticolorResult,
} from './multicolor-mesh'
import type { MulticolorSettings } from './multicolor-settings'

export interface MulticolorRequest {
  id: number
  mesh: MulticolorMesh
  settings: MulticolorSettings
}

export interface MulticolorResponse {
  id: number
  result?: PreparedMulticolorResult
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
    const result = prepareMulticolorResult(
      (await engine).build(mesh, settings),
      settings,
    )
    self.postMessage({ id, result } satisfies MulticolorResponse, {
      transfer: multicolorTransferList(result),
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
