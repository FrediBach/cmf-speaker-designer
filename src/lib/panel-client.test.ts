import { BufferGeometry, Float32BufferAttribute } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DESIGN } from './design'
import type { SerializedGeometry } from './geometry-transfer'
import type { HandleWorkerRequest } from './handles'
import type { GeneratedPanel } from './panel-engine'

interface Request {
  id: number
  payload: Omit<HandleWorkerRequest, 'id'>
}

class PanelWorker {
  static instances: PanelWorker[] = []
  readonly requests: Request[] = []
  readonly transfers: Transferable[][] = []
  readonly url: URL
  readonly options: WorkerOptions
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null

  constructor(url: URL, options: WorkerOptions) {
    this.url = url
    this.options = options
    PanelWorker.instances.push(this)
  }

  postMessage(request: Request, transfer: Transferable[]) {
    this.transfers.push(transfer)
    this.requests.push(structuredClone(request, { transfer }))
  }

  respond(request: Request, result = serializedPanel()) {
    this.onmessage?.({ data: { id: request.id, result } } as MessageEvent)
  }

  terminate() {}
}

function serializedPanel(): SerializedGeometry {
  return {
    positions: new Float32Array([0, 0, 4, 42, 0, 4, 42, 20, 3.5]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    boundingBox: { min: [0, 0, 3.5], max: [42, 20, 4] },
    boundingSphere: { center: [21, 10, 3.75], radius: 23.26 },
    userData: {
      model: 's',
      style: 'original',
      addedFaceDepth: 0,
      panelExtension: 0,
      panelGap: 0,
      units: 'mm',
    },
  }
}

function sourcePanel() {
  return new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute(
      [38, 0, 4, 42, 0, 4, 42, 20, 3.5, 38, 0, 4, 42, 20, 3.5, 38, 20, 3.5],
      3,
    ),
  )
}

function panelRequest(): Omit<HandleWorkerRequest, 'id'> {
  return {
    model: DEFAULT_DESIGN.model,
    style: 'original',
    settings: DEFAULT_DESIGN.handle,
    grille: DEFAULT_DESIGN.grille,
    halo: DEFAULT_DESIGN.halo,
    relief: DEFAULT_DESIGN.relief,
    panelExtension: DEFAULT_DESIGN.panelExtension,
    panelGap: DEFAULT_DESIGN.panelGap,
    raceStripes: DEFAULT_DESIGN.raceStripes,
  }
}

beforeEach(() => {
  vi.resetModules()
  PanelWorker.instances = []
  vi.stubGlobal('Worker', PanelWorker)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('panel worker client', () => {
  it('sends only design settings and reuses prepared buffers without scanning vertices on the main thread', async () => {
    const { buildDesignPanelGeometry } = await import('./handles')
    const panelNormals = await import('./panel-normals')
    const normals = vi.spyOn(panelNormals, 'computePanelNormals')
    const vertexNormals = vi.spyOn(
      BufferGeometry.prototype,
      'computeVertexNormals',
    )
    const bounds = vi.spyOn(BufferGeometry.prototype, 'computeBoundingBox')
    const sphere = vi.spyOn(BufferGeometry.prototype, 'computeBoundingSphere')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    const pending = buildDesignPanelGeometry(DEFAULT_DESIGN)
    const worker = PanelWorker.instances[0]
    expect(worker.url.pathname).toMatch(/\/handles\.worker\.ts$/)
    expect(worker.options).toEqual({ type: 'module' })
    expect(worker.requests[0].payload).toEqual({
      ...panelRequest(),
      source: undefined,
    })
    expect(worker.transfers[0]).toEqual([])
    expect(fetch).not.toHaveBeenCalled()

    const result = serializedPanel()
    worker.respond(worker.requests[0], result)
    const geometry = await pending
    expect(geometry.getAttribute('position').array).toBe(result.positions)
    expect(geometry.getAttribute('normal').array).toBe(result.normals)
    expect(geometry.boundingBox!.min.toArray()).toEqual(result.boundingBox.min)
    expect(geometry.boundingBox!.max.toArray()).toEqual(result.boundingBox.max)
    expect(geometry.boundingSphere!.center.toArray()).toEqual(
      result.boundingSphere.center,
    )
    expect(geometry.boundingSphere!.radius).toBe(result.boundingSphere.radius)
    expect(geometry.userData).toEqual(result.userData)
    expect(normals).not.toHaveBeenCalled()
    expect(vertexNormals).not.toHaveBeenCalled()
    expect(bounds).not.toHaveBeenCalled()
    expect(sphere).not.toHaveBeenCalled()
    geometry.dispose()
  })

  it('transfers a copy of an explicit source without detaching the caller geometry', async () => {
    const { buildHandledPanelGeometry } = await import('./handles')
    const source = sourcePanel()
    const positions = source.getAttribute('position').array as Float32Array
    const original = positions.slice()
    const pending = buildHandledPanelGeometry(
      source,
      's',
      'original',
      0,
      DEFAULT_DESIGN.handle,
    )
    const worker = PanelWorker.instances[0]
    expect(worker.transfers[0]).toHaveLength(1)
    expect(worker.transfers[0][0]).not.toBe(positions.buffer)
    expect(worker.requests[0].payload.source).toEqual(original)
    expect(positions).toEqual(original)
    expect(positions.byteLength).toBeGreaterThan(0)
    worker.respond(worker.requests[0])
    const geometry = await pending
    geometry.dispose()
    source.dispose()
  })

  it.each(['before response', 'after response'] as const)(
    'does not reconstruct obsolete geometry when canceled %s',
    async (timing) => {
      const { buildDesignPanelGeometry } = await import('./handles')
      const transfer = await import('./geometry-transfer')
      const deserialize = vi.spyOn(transfer, 'deserializeGeometry')
      const controller = new AbortController()
      const pending = buildDesignPanelGeometry(
        DEFAULT_DESIGN,
        controller.signal,
      )
      const rejected = expect(pending).rejects.toMatchObject({
        name: 'AbortError',
      })
      const worker = PanelWorker.instances[0]
      if (timing === 'before response') controller.abort()
      worker.respond(worker.requests[0])
      if (timing === 'after response') controller.abort()
      await rejected
      expect(deserialize).not.toHaveBeenCalled()
    },
  )

  it.each([
    { relief: 0, panelExtension: 0 },
    { relief: 2, panelExtension: 4 },
  ])(
    'preserves original-panel mesh preparation with $relief mm depth and $panelExtension mm extension',
    async ({ relief, panelExtension }) => {
      const { buildPanelGeometry } = await import('./panels')
      const { createPanelEngine } = await import('./panel-engine')
      const { preparePanelGeometry } = await import('./panel-result')
      const { serializeGeometry, deserializeGeometry } =
        await import('./geometry-transfer')
      const source = sourcePanel()
      const sourcePositions = source.getAttribute('position')
        .array as Float32Array
      const original = sourcePositions.slice()
      const request = {
        ...panelRequest(),
        relief,
        panelExtension,
        source: sourcePositions,
      }
      const engine = createPanelEngine()
      const result = await engine.build(request)
      const prepared = preparePanelGeometry(result, request)
      const received = deserializeGeometry(serializeGeometry(prepared))
      const expected = buildPanelGeometry(
        source,
        's',
        'original',
        relief,
        panelExtension,
      )

      expect(received.getAttribute('position').array).toEqual(
        expected.getAttribute('position').array,
      )
      expect(received.getAttribute('normal').array).toEqual(
        expected.getAttribute('normal').array,
      )
      expect(received.boundingBox).toEqual(expected.boundingBox)
      expect(received.boundingSphere).toEqual(expected.boundingSphere)
      expect(received.userData).toEqual(expected.userData)
      expect(result.positions.buffer).not.toBe(sourcePositions.buffer)
      expect(sourcePositions).toEqual(original)
      if (relief > 0) {
        expect(received.boundingBox!.max.z).toBe(6)
        expect(received.boundingBox!.max.x).toBe(46)
      }

      expected.dispose()
      received.dispose()
      prepared.dispose()
      source.dispose()
      await engine.dispose()
    },
  )

  it('retains custom feature metadata through worker preparation and transfer', async () => {
    const { preparePanelGeometry } = await import('./panel-result')
    const { serializeGeometry, deserializeGeometry, geometryTransferList } =
      await import('./geometry-transfer')
    const request = panelRequest()
    const result: GeneratedPanel = {
      positions: serializedPanel().positions,
      handle: {
        settings: { ...request.settings, mode: 'custom' },
        seamY: 41,
        backZ: -20,
        thickness: 4,
        holeCenters: [{ x: 0, y: 50, width: 20, height: 10 }],
        studCenters: [{ x: 0, y: 60 }],
      },
      grille: {
        settings: { ...request.grille, mode: 'custom' },
        frontZ: 4,
        backZ: 0,
        throughHoleCount: 1,
        recessCount: 0,
        holes: [{ x: 0, y: -20, kind: 'through' }],
      },
      halo: {
        settings: { ...request.halo, mode: 'custom' },
        baseZ: 4,
        frontZ: 8,
        center: { x: 0, y: -20 },
        centers: [{ x: 0, y: -20 }],
        innerRadius: 30,
        outerRadius: 35,
        topInnerRadius: 31,
        topOuterRadius: 34,
        baseRimHeight: 1,
      },
      gap: {
        gapMm: 2,
        frontOffset: 2,
        deckOffset: [0, Math.SQRT2, Math.SQRT2],
        supports: [],
        controlWells: [],
      },
      raceStripes: {
        settings: { ...DEFAULT_DESIGN.raceStripes, enabled: true },
        depthMm: 1,
        intervals: [{ minX: -5, maxX: 5 }],
      },
    }
    const prepared = preparePanelGeometry(result, { ...request, panelGap: 2 })
    const serialized = serializeGeometry(prepared)
    const transferred = structuredClone(serialized, {
      transfer: geometryTransferList(serialized),
    })
    const received = deserializeGeometry(transferred)
    expect(received.userData).toEqual({
      ...serializedPanel().userData,
      panelGap: 2,
      handle: result.handle,
      grille: result.grille,
      halo: result.halo,
      gap: result.gap,
      raceStripes: result.raceStripes,
    })
    expect(received.getAttribute('normal').count).toBe(
      received.getAttribute('position').count,
    )
    expect(serialized.positions.byteLength).toBe(0)
    expect(received.boundingBox!.max.toArray()).toEqual([42, 20, 4])
    prepared.dispose()
    received.dispose()
  })
})
