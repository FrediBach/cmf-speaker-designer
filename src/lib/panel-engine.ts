import { createHandleEngine, type HandleMetadata } from './handle-geometry'
import { createGrilleEngine, type GrilleMetadata } from './grille-geometry'
import { applyFaceDepth } from './face-depth'
import type { HandleWorkerRequest } from './handles'

export interface GeneratedPanel {
  positions: Float32Array
  handle?: HandleMetadata
  grille?: GrilleMetadata
}

/** One worker pipeline keeps the handle, face depth, and grille in the same solid. */
export function createPanelEngine(wasmUrl?: string) {
  const sources = new Map<string, Float32Array>()
  let handleEngine: ReturnType<typeof createHandleEngine> | undefined
  let grilleEngine: ReturnType<typeof createGrilleEngine> | undefined

  return {
    async build(
      request: Omit<HandleWorkerRequest, 'id'>,
    ): Promise<GeneratedPanel> {
      const { model, style, settings, grille, relief, source } = request
      const key = `${model}:${style}`
      if (source) sources.set(key, source)
      const original = sources.get(key)
      if (!original)
        throw new Error('The source panel is missing. Please retry.')
      let positions = original
      let handle: HandleMetadata | undefined
      let grilleMetadata: GrilleMetadata | undefined
      if (settings.mode === 'custom') {
        handleEngine ??= createHandleEngine(wasmUrl).catch((error) => {
          handleEngine = undefined
          throw error
        })
        const result = (await handleEngine).build(
          model,
          style,
          settings,
          original,
        )
        positions = result.positions
        handle = result.metadata
      } else {
        // Source arrays stay cached in the worker and must never be transferred or edited.
        positions = new Float32Array(original)
      }
      applyFaceDepth(positions, model, relief)
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
      return { positions, handle, grille: grilleMetadata }
    },
    async dispose() {
      const handles = await handleEngine
      const grilles = await grilleEngine
      handles?.dispose()
      grilles?.dispose()
      sources.clear()
    },
  }
}
