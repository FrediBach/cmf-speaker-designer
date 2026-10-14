import { BufferAttribute, BufferGeometry } from 'three'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { createStepMeshPreparer } from './step-mesh'
import { exportStep } from './step-export'
import type {
  StepExportRequest,
  StepExportResponse,
} from './step-export-client'

self.onmessage = async (event: MessageEvent<StepExportRequest>) => {
  const source = new BufferGeometry()
  let prepared: BufferGeometry | undefined
  try {
    const { positions, indices, name } = event.data
    source.setAttribute('position', new BufferAttribute(positions, 3))
    if (indices) source.setIndex(new BufferAttribute(indices, 1))
    prepared = (await createStepMeshPreparer(wasmUrl)).prepare(source)
    const data = exportStep(prepared, name)
    const message: StepExportResponse = { data }
    self.postMessage(message, { transfer: [data] })
  } catch (error) {
    const message: StepExportResponse = {
      error: error instanceof Error ? error.message : 'The STP export failed.',
    }
    self.postMessage(message)
  } finally {
    prepared?.dispose()
    source.dispose()
  }
}
