import { BufferAttribute, BufferGeometry } from 'three'
import type { MaterialGeometry, MulticolorMesh } from './multicolor-geometry'
import type { MulticolorRequest, MulticolorResponse } from './multicolor.worker'
import type { MulticolorSettings } from './multicolor-settings'
import { deserializeGeometry } from './geometry-transfer'
import type { PreparedMulticolorResult } from './multicolor-mesh'

interface Job {
  request: MulticolorRequest
  resolve(result: PreparedMulticolorResult): void
  reject(error: Error): void
  signal?: AbortSignal
  abort(): void
  timeout?: ReturnType<typeof setTimeout>
}

let worker: Worker | undefined
let nextId = 0
let running: Job | undefined
let queued: Job | undefined
let testEngine:
  | Promise<
      Awaited<
        ReturnType<
          typeof import('./multicolor-geometry').createMulticolorEngine
        >
      >
    >
  | undefined

const cancelled = () =>
  new DOMException('Multicolor generation was replaced.', 'AbortError')

function finish(job: Job) {
  clearTimeout(job.timeout)
  job.signal?.removeEventListener('abort', job.abort)
}

function resetWorker(message: string) {
  worker?.terminate()
  worker = undefined
  if (running) {
    finish(running)
    running.reject(new Error(message))
    running = undefined
  }
  pump()
}

/** One active request and one latest pending request bound queue growth. */
function pump() {
  if (running || !queued) return
  running = queued
  queued = undefined
  try {
    if (!worker) {
      worker = new Worker(new URL('./multicolor.worker.ts', import.meta.url), {
        type: 'module',
      })
      worker.onmessage = (event: MessageEvent<MulticolorResponse>) => {
        const job = running
        if (!job || event.data.id !== job.request.id) return
        finish(job)
        running = undefined
        if (event.data.result) job.resolve(event.data.result)
        else
          job.reject(
            new Error(
              event.data.error ||
                'The multicolor panel could not be generated.',
            ),
          )
        pump()
      }
      worker.onerror = () =>
        resetWorker('The multicolor generator could not run. Please retry.')
      worker.onmessageerror = () =>
        resetWorker(
          'The multicolor result could not be received. Please retry.',
        )
    }
    const { request } = running
    const transfer: ArrayBuffer[] = [
      request.mesh.positions.buffer as ArrayBuffer,
    ]
    if (request.mesh.indices)
      transfer.push(request.mesh.indices.buffer as ArrayBuffer)
    running.timeout = setTimeout(
      () =>
        resetWorker(
          'This pattern took too long to generate. Reduce its complexity or retry.',
        ),
      45_000,
    )
    worker.postMessage(request, transfer)
  } catch (error) {
    resetWorker(
      error instanceof Error
        ? error.message
        : 'The multicolor generator could not start.',
    )
  }
}

function requestPartition(
  mesh: MulticolorMesh,
  settings: MulticolorSettings,
  signal?: AbortSignal,
) {
  if (signal?.aborted) return Promise.reject(cancelled())
  return new Promise<PreparedMulticolorResult>((resolve, reject) => {
    const job: Job = {
      request: { id: ++nextId, mesh, settings },
      resolve,
      reject,
      signal,
      abort() {
        if (queued === job) {
          queued = undefined
          finish(job)
        }
        // A running WASM call finishes in its worker; its result is ignored.
        // The newest request waits in the single pending slot.
        reject(cancelled())
      },
    }
    if (queued) {
      finish(queued)
      queued.reject(cancelled())
    }
    queued = job
    signal?.addEventListener('abort', job.abort, { once: true })
    pump()
  })
}

/** The caller owns and must dispose every returned indexed BufferGeometry. */
export async function buildMulticolorGeometry(
  panel: BufferGeometry,
  settings: MulticolorSettings,
  signal?: AbortSignal,
): Promise<{ parts: MaterialGeometry[]; diagnostics: string[] }> {
  if (signal?.aborted) throw cancelled()
  const attribute = panel.getAttribute('position')
  const contiguous =
    attribute instanceof BufferAttribute &&
    attribute.itemSize === 3 &&
    !attribute.normalized
  const positions = contiguous
    ? new Float32Array(attribute.array)
    : new Float32Array(attribute.count * 3)
  if (!contiguous) {
    for (let i = 0; i < attribute.count; i++) {
      positions[i * 3] = attribute.getX(i)
      positions[i * 3 + 1] = attribute.getY(i)
      positions[i * 3 + 2] = attribute.getZ(i)
    }
  }
  const index = panel.getIndex()
  const mesh: MulticolorMesh = {
    positions,
    ...(index ? { indices: Uint32Array.from(index.array) } : {}),
  }
  let result: PreparedMulticolorResult
  if (typeof Worker === 'undefined') {
    testEngine ??= import('./multicolor-geometry')
      .then(({ createMulticolorEngine }) => createMulticolorEngine())
      .catch((error) => {
        testEngine = undefined
        throw error
      })
    const { prepareMulticolorResult } = await import('./multicolor-mesh')
    result = prepareMulticolorResult(
      (await testEngine).build(mesh, settings),
      settings,
    )
  } else {
    result = await requestPartition(mesh, settings, signal)
  }
  if (signal?.aborted) throw cancelled()
  const parts: MaterialGeometry[] = result.parts.map(
    ({
      materialId,
      geometry: printable,
      previewGeometry: preview,
      volume,
      elementIds,
    }) => {
      const geometry = deserializeGeometry(printable)
      const previewGeometry = deserializeGeometry(preview)
      geometry.userData.multicolorSourceUuid = panel.uuid
      previewGeometry.userData.multicolorSourceUuid = panel.uuid
      return { materialId, geometry, previewGeometry, volume, elementIds }
    },
  )
  return { parts, diagnostics: result.diagnostics }
}
