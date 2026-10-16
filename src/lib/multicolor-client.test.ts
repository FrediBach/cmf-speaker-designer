import { BoxGeometry, BufferAttribute, BufferGeometry } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreparedMulticolorResult } from './multicolor-mesh'
import type { MulticolorRequest, MulticolorResponse } from './multicolor.worker'
import { getDefaultMulticolorSettings } from './multicolor-settings'

class PartitionWorker {
  static instances: PartitionWorker[] = []
  requests: MulticolorRequest[] = []
  onmessage?: (event: MessageEvent<MulticolorResponse>) => void
  constructor() {
    PartitionWorker.instances.push(this)
  }
  postMessage(request: MulticolorRequest, transfer: Transferable[]) {
    this.requests.push(structuredClone(request, { transfer }))
  }
  respond(request: MulticolorRequest, result: PreparedMulticolorResult) {
    this.onmessage?.({
      data: { id: request.id, result },
    } as MessageEvent<MulticolorResponse>)
  }
  terminate() {}
}

function splitPanel() {
  const front = new BoxGeometry(20, 30, 4).toNonIndexed().translate(0, -15, 0)
  const upper = new BoxGeometry(20, 10, 4).toNonIndexed().translate(0, 10, -6)
  const frontPositions = new Float32Array(front.getAttribute('position').array)
  const upperPositions = new Float32Array(upper.getAttribute('position').array)
  const positions = new Float32Array(
    frontPositions.length + upperPositions.length,
  )
  positions.set(frontPositions)
  positions.set(upperPositions, frontPositions.length)
  const panel = new BufferGeometry().setAttribute(
    'position',
    new BufferAttribute(positions, 3),
  )
  panel.userData.split = { frontPositions, upperPositions }
  front.dispose()
  upper.dispose()
  return panel
}

beforeEach(() => {
  vi.resetModules()
  PartitionWorker.instances = []
  vi.stubGlobal('Worker', PartitionWorker)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('split material worker jobs', () => {
  it('partitions both physical pieces atomically without transferring owned panel buffers', async () => {
    const { buildMulticolorGeometry } = await import('./multicolor-client')
    const { createMulticolorEngine } = await import('./multicolor-geometry')
    const { prepareMulticolorPanelResult } = await import('./multicolor-mesh')
    const engine = await createMulticolorEngine()
    const panel = splitPanel()
    const before = structuredClone(panel.userData.split)
    const settings = getDefaultMulticolorSettings()
    const pending = buildMulticolorGeometry(panel, settings)
    const worker = PartitionWorker.instances[0]
    expect(worker.requests).toHaveLength(1)
    const request = worker.requests[0]
    expect(request.mesh.positions).toEqual(before.frontPositions)
    expect(request.upperMesh?.positions).toEqual(before.upperPositions)
    expect(panel.userData.split).toEqual(before)
    const prepared = prepareMulticolorPanelResult(
      engine.build,
      request.mesh,
      settings,
      request.upperMesh,
    )
    worker.respond(request, prepared)
    const result = await pending
    expect(
      result.parts.map((part) => [part.materialId, part.panelPart]),
    ).toEqual([
      ['base', 'front'],
      ['base', 'upper'],
    ])
    expect(result.parts.map((part) => part.volume)).toEqual([2400, 800])
    for (const part of result.parts) {
      expect(part.geometry.userData.multicolorSourceUuid).toBe(panel.uuid)
      expect(part.previewGeometry?.userData).toEqual(part.geometry.userData)
      part.geometry.dispose()
      part.previewGeometry?.dispose()
    }
    expect(panel.userData.split).toEqual(before)
    panel.dispose()
    engine.dispose()
  })

  it('discards an obsolete two-piece result and delivers only the newest panel identity', async () => {
    const { buildMulticolorGeometry } = await import('./multicolor-client')
    const transfer = await import('./geometry-transfer')
    const deserialize = vi.spyOn(transfer, 'deserializeGeometry')
    const panel = splitPanel()
    const replacement = splitPanel()
    const controller = new AbortController()
    const settings = getDefaultMulticolorSettings()
    const obsolete = buildMulticolorGeometry(panel, settings, controller.signal)
    const rejected = expect(obsolete).rejects.toMatchObject({
      name: 'AbortError',
    })
    const latest = buildMulticolorGeometry(replacement, settings)
    controller.abort()
    await rejected
    const worker = PartitionWorker.instances[0]
    expect(worker.requests).toHaveLength(1)
    worker.respond(worker.requests[0], { parts: [], diagnostics: ['obsolete'] })
    expect(worker.requests).toHaveLength(2)
    expect(deserialize).not.toHaveBeenCalled()
    const latestRequest = worker.requests[1]
    expect(latestRequest.upperMesh).toBeDefined()
    worker.respond(latestRequest, { parts: [], diagnostics: ['latest'] })
    expect((await latest).diagnostics).toEqual(['latest'])
    panel.dispose()
    replacement.dispose()
  })
})
