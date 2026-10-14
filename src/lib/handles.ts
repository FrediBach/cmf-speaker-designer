import { BufferGeometry, Float32BufferAttribute } from 'three'
import {
  buildPanelGeometry,
  type PanelStyle,
  type SpeakerModel,
} from './panels'
import { normalizeHandleSettings, type HandleSettings } from './handle-settings'
import { normalizeGrilleSettings, type GrilleSettings } from './grille-settings'
import { normalizeHaloSettings, type HaloSettings } from './halo-settings'
import type { GeneratedPanel } from './panel-engine'

export interface HandleWorkerRequest {
  id: number
  model: SpeakerModel
  style: PanelStyle
  settings: HandleSettings
  grille: GrilleSettings
  halo: HaloSettings
  relief: number
  panelExtension: number
  panelGap: number
  source?: Float32Array
}
export interface HandleWorkerResponse {
  id: number
  result?: GeneratedPanel
  error?: string
}

let worker: Worker | undefined
let nextRequest = 0
const sources = new Set<string>()
const pending = new Map<
  number,
  {
    key: string
    resolve(result: GeneratedPanel): void
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
        new Error(error || 'The custom panel could not be generated.'),
      )
    }
  }
  worker.onerror = () => {
    for (const request of pending.values())
      request.reject(
        new Error('The panel generator could not start. Please retry.'),
      )
    pending.clear()
    worker?.terminate()
    worker = undefined
    sources.clear()
  }
  return worker
}

let testEngine:
  | Promise<ReturnType<typeof import('./panel-engine').createPanelEngine>>
  | undefined

/**
 * Generate the handle, side extension, gap, face depth, grille, and halo in one worker.
 * Callers own the returned geometry; preview and STL export use this same mesh.
 * The original path clones the original mesh without any CSG or remeshing.
 */
export async function buildHandledPanelGeometry(
  source: BufferGeometry,
  model: SpeakerModel,
  style: PanelStyle,
  relief: number,
  input: HandleSettings,
  grilleInput?: GrilleSettings,
  haloInput?: HaloSettings,
  panelExtension = 0,
  panelGap = 0,
): Promise<BufferGeometry> {
  const settings = normalizeHandleSettings(model, input)
  const grille = normalizeGrilleSettings(grilleInput)
  const halo = normalizeHaloSettings(haloInput)
  if (
    settings.mode === 'original' &&
    grille.mode === 'original' &&
    halo.mode === 'original' &&
    panelGap === 0
  )
    return buildPanelGeometry(source, model, style, relief, panelExtension)

  let result: GeneratedPanel
  if (typeof Worker === 'undefined') {
    // Tests use the identical geometry kernel without a browser Worker runtime.
    testEngine ??= import('./panel-engine').then((module) =>
      module.createPanelEngine(),
    )
    result = await (
      await testEngine
    ).build({
      model,
      style,
      settings,
      grille,
      halo,
      relief,
      panelExtension,
      panelGap,
      source: new Float32Array(source.getAttribute('position').array),
    })
  } else {
    const generator = getWorker()
    const key = `${model}:${style}`
    const positions = sources.has(key)
      ? undefined
      : new Float32Array(source.getAttribute('position').array)
    const id = ++nextRequest
    result = await new Promise<GeneratedPanel>((resolve, reject) => {
      pending.set(id, { key, resolve, reject })
      try {
        generator.postMessage(
          {
            id,
            model,
            style,
            settings,
            grille,
            halo,
            relief,
            panelExtension,
            panelGap,
            source: positions,
          } satisfies HandleWorkerRequest,
          positions ? [positions.buffer] : [],
        )
      } catch (error) {
        pending.delete(id)
        reject(
          error instanceof Error
            ? error
            : new Error('The panel generator could not start.'),
        )
      }
    })
  }
  const handled = new BufferGeometry()
  handled.setAttribute(
    'position',
    new Float32BufferAttribute(result.positions, 3),
  )
  const completed = buildPanelGeometry(handled, model, style, 0)
  handled.dispose()
  completed.userData.addedFaceDepth = relief
  completed.userData.panelExtension = panelExtension
  completed.userData.panelGap = panelGap
  if (result.handle) completed.userData.handle = result.handle
  if (result.grille) completed.userData.grille = result.grille
  if (result.halo) completed.userData.halo = result.halo
  if (result.gap) completed.userData.gap = result.gap
  completed.computeBoundingBox()
  completed.computeBoundingSphere()
  return completed
}
