import type { BufferGeometry } from 'three'

export interface StepExportRequest {
  positions: Float32Array
  indices?: Uint32Array
  name: string
}

export type StepExportResponse = { data: ArrayBuffer } | { error: string }

let testPreparer:
  ReturnType<typeof import('./step-mesh').createStepMeshPreparer> | undefined

/** Keep CAD preparation and serialization off the browser's UI thread. */
export async function exportStepFile(
  geometry: BufferGeometry,
  name: string,
): Promise<ArrayBuffer> {
  if (typeof window === 'undefined') {
    const { createStepMeshPreparer } = await import('./step-mesh')
    const { exportStep } = await import('./step-export')
    testPreparer ??= createStepMeshPreparer().catch((error: unknown) => {
      testPreparer = undefined
      throw error
    })
    const prepared = (await testPreparer).prepare(geometry)
    try {
      return exportStep(prepared, name)
    } finally {
      prepared.dispose()
    }
  }

  const position = geometry.getAttribute('position')
  const positions = new Float32Array(position.count * 3)
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    positions[vertex * 3] = position.getX(vertex)
    positions[vertex * 3 + 1] = position.getY(vertex)
    positions[vertex * 3 + 2] = position.getZ(vertex)
  }
  const index = geometry.getIndex()
  const indices = index
    ? Uint32Array.from({ length: index.count }, (_, i) => index.getX(i))
    : undefined
  const request: StepExportRequest = { positions, indices, name }

  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./step-export.worker.ts', import.meta.url),
      {
        type: 'module',
      },
    )
    worker.onmessage = (event: MessageEvent<StepExportResponse>) => {
      worker.terminate()
      if ('data' in event.data) resolve(event.data.data)
      else reject(new Error(event.data.error))
    }
    worker.onerror = () => {
      worker.terminate()
      reject(new Error('The STP exporter could not start. Please retry.'))
    }
    worker.onmessageerror = () => {
      worker.terminate()
      reject(new Error('The STP export could not be read. Please retry.'))
    }
    const transfer: ArrayBuffer[] = [positions.buffer]
    if (indices) transfer.push(indices.buffer as ArrayBuffer)
    worker.postMessage(request, transfer)
  })
}
