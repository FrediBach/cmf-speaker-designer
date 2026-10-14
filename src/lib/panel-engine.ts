import { createHandleEngine, type HandleMetadata } from './handle-geometry'
import { createGrilleEngine, type GrilleMetadata } from './grille-geometry'
import { createHaloEngine, type HaloMetadata } from './halo-geometry'
import { applyFaceDepth } from './face-depth'
import { applyPanelExtension } from './panel-extension'
import type { HandleWorkerRequest } from './handles'

export interface GeneratedPanel {
  positions: Float32Array
  handle?: HandleMetadata
  grille?: GrilleMetadata
  halo?: HaloMetadata
}

/** One worker pipeline keeps all panel customizations in the same solid. */
export function createPanelEngine(wasmUrl?: string) {
  const sources = new Map<string, Float32Array>()
  let handleEngine: ReturnType<typeof createHandleEngine> | undefined
  let grilleEngine: ReturnType<typeof createGrilleEngine> | undefined
  let haloEngine: ReturnType<typeof createHaloEngine> | undefined

  return {
    async build(
      request: Omit<HandleWorkerRequest, 'id'>,
    ): Promise<GeneratedPanel> {
      const {
        model,
        style,
        settings,
        grille,
        halo,
        relief,
        panelExtension,
        source,
      } = request
      const key = `${model}:${style}`
      if (source) sources.set(key, source)
      const original = sources.get(key)
      if (!original)
        throw new Error('The source panel is missing. Please retry.')
      let positions = applyPanelExtension(original, model, panelExtension)
      let handle: HandleMetadata | undefined
      let grilleMetadata: GrilleMetadata | undefined
      let haloMetadata: HaloMetadata | undefined
      if (settings.mode === 'custom') {
        handleEngine ??= createHandleEngine(wasmUrl).catch((error) => {
          handleEngine = undefined
          throw error
        })
        const result = (await handleEngine).build(
          model,
          style,
          settings,
          positions,
          panelExtension,
        )
        positions = result.positions
        handle = result.metadata
      } else if (positions === original) {
        // Source arrays stay cached in the worker and must never be transferred or edited.
        positions = new Float32Array(original)
      }
      positions = applyFaceDepth(positions, model, relief)
      if (grille.mode === 'custom') {
        if (style !== 'original')
          throw new Error('A custom grille needs the original open panel.')
        grilleEngine ??= createGrilleEngine(wasmUrl).catch((error) => {
          grilleEngine = undefined
          throw error
        })
        const result = (await grilleEngine).build(model, grille, positions)
        positions = result.positions
        grilleMetadata = result.metadata
      }
      if (halo.mode === 'custom') {
        if (style !== 'original')
          throw new Error('A custom halo needs the original open panel.')
        haloEngine ??= createHaloEngine(wasmUrl).catch((error) => {
          haloEngine = undefined
          throw error
        })
        const result = (await haloEngine).build(model, halo, positions)
        positions = result.positions
        haloMetadata = result.metadata
      }
      return { positions, handle, grille: grilleMetadata, halo: haloMetadata }
    },
    async dispose() {
      const handles = await handleEngine
      const grilles = await grilleEngine
      const halos = await haloEngine
      handles?.dispose()
      grilles?.dispose()
      halos?.dispose()
      sources.clear()
    },
  }
}
