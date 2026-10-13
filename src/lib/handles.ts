import { BufferGeometry, Float32BufferAttribute } from 'three'
import {
  buildPanelGeometry,
  type PanelStyle,
  type SpeakerModel,
} from './panels'
import { normalizeHandleSettings, type HandleSettings } from './handle-settings'
import type { HandleResult } from './handle-geometry'

export interface HandleWorkerRequest {
  id: number
  model: SpeakerModel
  style: PanelStyle
  settings: HandleSettings
  source?: Float32Array
}
export interface HandleWorkerResponse {
  id: number
  result?: HandleResult
  error?: string
}

let worker: Worker | undefined
let nextRequest = 0
const sources = new Set<string>()
const pending = new Map<
  number,
  {
    key: string
    resolve(result: HandleResult): void
    reject(reason: Error): void
  }
>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./handles.worker.ts', import.meta.url), {
    type: 'module',
  })
  worker.onmessage = (event: MessageEvent<HandleWorkerResponse>) => {
    const { id, result, error } = event.data
    const request = pending.get(id)
    if (!request) return
    pending.delete(id)
    if (result) {
      sources.add(request.key)
      request.resolve(result)
    } else {
      sources.delete(request.key)
      request.reject(
        new Error(error || 'The custom handle could not be generated.'),
      )
    }
  }
  worker.onerror = () => {
    for (const request of pending.values())
      request.reject(
        new Error('The handle generator could not start. Please retry.'),
      )
    pending.clear()
    worker?.terminate()
    worker = undefined
    sources.clear()
  }
  return worker
}

let testEngine:
  ReturnType<typeof import('./handle-geometry').createHandleEngine> | undefined

/**
 * Generate real upper geometry in a dedicated WASM worker, then apply the
 * independent front-face depth setting. Callers own the returned geometry.
 * The original path clones the original mesh without any CSG or remeshing.
 */
export async function buildHandledPanelGeometry(
  source: BufferGeometry,
  model: SpeakerModel,
  style: PanelStyle,
  relief: number,
  input: HandleSettings,
): Promise<BufferGeometry> {
  const settings = normalizeHandleSettings(model, input)
  if (settings.mode === 'original')
    return buildPanelGeometry(source, model, style, relief)

  let result: HandleResult
  if (typeof Worker === 'undefined') {
    // Tests use the identical geometry kernel without a browser Worker runtime.
    testEngine ??= import('./handle-geometry').then((module) =>
      module.createHandleEngine(),
    )
    result = (await testEngine).build(
      model,
      style,
      settings,
      new Float32Array(source.getAttribute('position').array),
    )
  } else {
    const generator = getWorker()
    const key = `${model}:${style}`
    const positions = sources.has(key)
      ? undefined
      : new Float32Array(source.getAttribute('position').array)
    const id = ++nextRequest
    result = await new Promise<HandleResult>((resolve, reject) => {
      pending.set(id, { key, resolve, reject })
      try {
        generator.postMessage(
          {
            id,
            model,
            style,
            settings,
            source: positions,
          } satisfies HandleWorkerRequest,
          positions ? [positions.buffer] : [],
        )
      } catch (error) {
        pending.delete(id)
        reject(
          error instanceof Error
            ? error
            : new Error('The handle generator could not start.'),
        )
      }
    })
  }
  const handled = new BufferGeometry()
  handled.setAttribute(
    'position',
    new Float32BufferAttribute(result.positions, 3),
  )
  handled.computeVertexNormals()
  const completed = buildPanelGeometry(handled, model, style, relief)
  handled.dispose()
  completed.userData.handle = result.metadata
  completed.computeBoundingBox()
  completed.computeBoundingSphere()
  return completed
}
