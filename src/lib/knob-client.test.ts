import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedGeometry } from './geometry-transfer'
import type { KnobSettings } from './knob-settings'

interface Request {
  id: number
  payload: Partial<KnobSettings>
}

class KnobWorker {
  static instances: KnobWorker[] = []
  readonly requests: Request[] = []
  readonly url: URL
  readonly options: WorkerOptions
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null

  constructor(url: URL, options: WorkerOptions) {
    this.url = url
    this.options = options
    KnobWorker.instances.push(this)
  }

  postMessage(request: Request) {
    this.requests.push(request)
  }

  respond(request: Request, result = serializedKnob()) {
    this.onmessage?.({ data: { id: request.id, result } } as MessageEvent)
  }

  terminate() {}
}

function serializedKnob(): SerializedGeometry {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 16]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    boundingBox: { min: [0, 0, 0], max: [1, 1, 16] },
    boundingSphere: { center: [0.5, 0.5, 8], radius: 8.1 },
    userData: { knob: { settings: { style: 'bar' }, units: 'mm' } },
  }
}

function sourceAsset() {
  const bytes = readFileSync(
    new URL(
      '../../resources/stl-files/cmf-speaker-sm-3d-printing-knob-original-v1.stl',
      import.meta.url,
    ),
  )
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  )
}

beforeEach(() => {
  vi.resetModules()
  KnobWorker.instances = []
  vi.stubGlobal('Worker', KnobWorker)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('volume knob worker client', () => {
  it('sends settings to a module worker and reuses its finished geometry buffers', async () => {
    const { buildKnobGeometryInWorker } = await import('./knob-client')
    const settings: Partial<KnobSettings> = {
      style: 'fluted',
      flutePath: 'spiral',
    }
    const pending = buildKnobGeometryInWorker(settings)
    const worker = KnobWorker.instances[0]
    expect(worker.url.pathname).toMatch(/\/knobs\.worker\.ts$/)
    expect(worker.options).toEqual({ type: 'module' })
    expect(worker.requests[0].payload).toEqual(settings)

    const result = serializedKnob()
    worker.respond(worker.requests[0], result)
    const geometry = await pending
    expect(geometry.getAttribute('position').array).toBe(result.positions)
    expect(geometry.getAttribute('normal').array).toBe(result.normals)
    expect(geometry.boundingBox!.max.toArray()).toEqual([1, 1, 16])
    expect(geometry.boundingSphere!.radius).toBe(8.1)
    expect(geometry.userData).toEqual(result.userData)
    geometry.dispose()
  })

  it('removes superseded queued knobs without dropping another preview request', async () => {
    const { buildKnobGeometryInWorker } = await import('./knob-client')
    const stale = new AbortController()
    const first = buildKnobGeometryInWorker({ style: 'bar' })
    const second = buildKnobGeometryInWorker({ style: 'fluted' }, stale.signal)
    const rejected = expect(second).rejects.toMatchObject({
      name: 'AbortError',
    })
    const third = buildKnobGeometryInWorker({ style: 'hex' })
    stale.abort()
    await rejected

    const worker = KnobWorker.instances[0]
    expect(worker.requests).toHaveLength(1)
    worker.respond(worker.requests[0])
    const firstGeometry = await first
    expect(worker.requests).toHaveLength(2)
    expect(worker.requests[1].payload.style).toBe('hex')
    worker.respond(worker.requests[1])
    const thirdGeometry = await third
    firstGeometry.dispose()
    thirdGeometry.dispose()
  })

  it('does not start generation for an already canceled request', async () => {
    const { buildKnobGeometryInWorker } = await import('./knob-client')
    const controller = new AbortController()
    controller.abort()
    await expect(
      buildKnobGeometryInWorker({ style: 'fluted' }, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(KnobWorker.instances).toHaveLength(0)
  })

  it('keeps the direct geometry path available when workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(sourceAsset())),
    )
    const { buildKnobGeometryInWorker } = await import('./knob-client')
    const geometry = await buildKnobGeometryInWorker({
      style: 'bar',
      height: 20,
    })
    expect(geometry.boundingBox!.min.z).toBe(0)
    expect(geometry.boundingBox!.max.z).toBe(20)
    expect(geometry.userData.knob.settings).toMatchObject({
      style: 'bar',
      height: 20,
    })
    expect(geometry.getAttribute('normal').count).toBe(
      geometry.getAttribute('position').count,
    )
    expect(KnobWorker.instances).toHaveLength(0)
    geometry.dispose()
  })
})
