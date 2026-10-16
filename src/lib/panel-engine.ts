import { createHandleEngine, type HandleMetadata } from './handle-geometry'
import { createGrilleEngine, type GrilleMetadata } from './grille-geometry'
import { createHaloEngine, type HaloMetadata } from './halo-geometry'
import { applyFaceDepth } from './face-depth'
import { applyPanelExtension } from './panel-extension'
import { createPanelGapEngine, type PanelGapMetadata } from './panel-gap'
import type { HandleWorkerRequest } from './handles'
import {
  createRaceStripeEngine,
  type RaceStripeMetadata,
} from './race-stripe-geometry'

export interface GeneratedPanel {
  positions: Float32Array
  handle?: HandleMetadata
  grille?: GrilleMetadata
  halo?: HaloMetadata
  gap?: PanelGapMetadata
  raceStripes?: RaceStripeMetadata
}

/** One worker pipeline keeps all panel customizations in the same solid. */
export function createPanelEngine(wasmUrl?: string) {
  const sources = new Map<string, Float32Array>()
  let handleEngine: ReturnType<typeof createHandleEngine> | undefined
  let grilleEngine: ReturnType<typeof createGrilleEngine> | undefined
  let haloEngine: ReturnType<typeof createHaloEngine> | undefined
  let gapEngine: ReturnType<typeof createPanelGapEngine> | undefined
  let stripeEngine: ReturnType<typeof createRaceStripeEngine> | undefined

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
        panelGap = 0,
        raceStripes,
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
      let gapMetadata: PanelGapMetadata | undefined
      let stripeMetadata: RaceStripeMetadata | undefined
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
          raceStripes,
        )
        positions = result.positions
        handle = result.metadata
      } else if (positions === original) {
        // Source arrays stay cached in the worker and must never be transferred or edited.
        positions = new Float32Array(original)
      }
      positions = applyFaceDepth(positions, model, relief)
      if (panelGap !== 0) {
        gapEngine ??= createPanelGapEngine(wasmUrl).catch((error) => {
          gapEngine = undefined
          throw error
        })
        const result = (await gapEngine).build(
          model,
          positions,
          panelGap,
          relief,
        )
        positions = result.positions
        gapMetadata = result.metadata
        if (handle) {
          const [, offsetY, offsetZ] = gapMetadata.deckOffset
          handle = {
            ...handle,
            seamY: handle.seamY + offsetY,
            backZ: handle.backZ + offsetZ,
            holeCenters: handle.holeCenters.map((hole) => ({
              ...hole,
              y: hole.y + offsetY,
            })),
            studCenters: handle.studCenters.map((stud) => ({
              ...stud,
              y: stud.y + offsetY,
            })),
          }
        }
      }
      if (grille.mode === 'custom') {
        if (style !== 'original')
          throw new Error('A custom grille needs the original open panel.')
        grilleEngine ??= createGrilleEngine(wasmUrl).catch((error) => {
          grilleEngine = undefined
          throw error
        })
        const result = (await grilleEngine).build(
          model,
          grille,
          positions,
          panelGap,
          raceStripes,
        )
        positions = result.positions
        grilleMetadata = result.metadata
      }
      if (raceStripes?.enabled) {
        stripeEngine ??= createRaceStripeEngine(wasmUrl).catch((error) => {
          stripeEngine = undefined
          throw error
        })
        const result = (await stripeEngine).build(
          model,
          raceStripes,
          positions,
          relief,
          panelGap,
        )
        positions = result.positions
        stripeMetadata = result.metadata
      }
      if (halo.mode === 'custom') {
        if (style !== 'original')
          throw new Error('A custom halo needs the original open panel.')
        haloEngine ??= createHaloEngine(wasmUrl).catch((error) => {
          haloEngine = undefined
          throw error
        })
        const result = (await haloEngine).build(
          model,
          halo,
          positions,
          panelGap,
          grilleMetadata?.frontZ,
        )
        positions = result.positions
        haloMetadata = result.metadata
      }
      return {
        positions,
        handle,
        grille: grilleMetadata,
        halo: haloMetadata,
        gap: gapMetadata,
        raceStripes: stripeMetadata,
      }
    },
    async dispose() {
      const handles = await handleEngine
      const grilles = await grilleEngine
      const halos = await haloEngine
      const gaps = await gapEngine
      const stripes = await stripeEngine
      handles?.dispose()
      grilles?.dispose()
      halos?.dispose()
      gaps?.dispose()
      stripes?.dispose()
      sources.clear()
    },
  }
}
