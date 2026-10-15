import type { BufferGeometry } from 'three'
import { loadPanelGeometry, type PanelStyle, type SpeakerModel } from './panels'
import { normalizeHandleSettings, type HandleSettings } from './handle-settings'
import { normalizeGrilleSettings, type GrilleSettings } from './grille-settings'
import { normalizeHaloSettings, type HaloSettings } from './halo-settings'
import { preparePanelGeometry } from './panel-result'
import {
  deserializeGeometry,
  type SerializedGeometry,
} from './geometry-transfer'
import { createWorkerClient } from './worker-client'
import type { Design } from './design'
import {
  normalizeRaceStripeSettings,
  type RaceStripeSettings,
} from './race-stripe-settings'

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
  raceStripes?: RaceStripeSettings
  source?: Float32Array
}
const client = createWorkerClient<
  Omit<HandleWorkerRequest, 'id'>,
  SerializedGeometry
>(
  () =>
    new Worker(new URL('./handles.worker.ts', import.meta.url), {
      type: 'module',
    }),
  'The panel generator could not run. Please retry.',
)

let testEngine:
  | Promise<ReturnType<typeof import('./panel-engine').createPanelEngine>>
  | undefined

/**
 * Generate the handle, side extension, gap, face depth, grille, halo, and stripes in one worker.
 * Callers own the returned geometry; preview and STL export use this same mesh.
 * Original panels also use the worker for deformation, normals, and bounds.
 */
export async function buildHandledPanelGeometry(
  source: BufferGeometry | null,
  model: SpeakerModel,
  style: PanelStyle,
  relief: number,
  input: HandleSettings,
  grilleInput?: GrilleSettings,
  haloInput?: HaloSettings,
  panelExtension = 0,
  panelGap = 0,
  raceStripesInput?: RaceStripeSettings,
  signal?: AbortSignal,
): Promise<BufferGeometry> {
  const settings = normalizeHandleSettings(model, input)
  const grille = normalizeGrilleSettings(grilleInput)
  const halo = normalizeHaloSettings(haloInput)
  const raceStripes = normalizeRaceStripeSettings(raceStripesInput)
  signal?.throwIfAborted()
  const request: Omit<HandleWorkerRequest, 'id'> = {
    model,
    style,
    settings,
    grille,
    halo,
    relief,
    panelExtension,
    panelGap,
    raceStripes,
    source: source
      ? new Float32Array(source.getAttribute('position').array)
      : undefined,
  }
  if (typeof Worker !== 'undefined') {
    const result = await client.request(
      request,
      request.source ? [request.source.buffer as ArrayBuffer] : [],
      signal,
    )
    signal?.throwIfAborted()
    return deserializeGeometry(result)
  }
  // Tests use the same geometry kernel and mesh preparation without a Worker runtime.
  testEngine ??= import('./panel-engine').then((module) =>
    module.createPanelEngine(),
  )
  if (!request.source) {
    const loaded = await loadPanelGeometry(model, style, signal)
    request.source = loaded.getAttribute('position').array as Float32Array
    loaded.dispose()
  }
  const result = await (await testEngine).build(request)
  signal?.throwIfAborted()
  return preparePanelGeometry(result, request)
}

/** Source parsing and caching stay in the worker for every preview candidate. */
export function buildDesignPanelGeometry(design: Design, signal?: AbortSignal) {
  return buildHandledPanelGeometry(
    null,
    design.model,
    'original',
    design.relief,
    design.handle,
    design.grille,
    design.halo,
    design.panelExtension,
    design.panelGap,
    design.raceStripes,
    signal,
  )
}
