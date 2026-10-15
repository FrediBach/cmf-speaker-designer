import { BufferAttribute, BufferGeometry } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildMulticolorGeometry } from './multicolor-client'
import { deserializeGeometry } from './geometry-transfer'
import type { MulticolorResult } from './multicolor-geometry'
import {
  multicolorTransferList,
  prepareMulticolorResult,
} from './multicolor-mesh'
import { getDefaultMulticolorSettings } from './multicolor-settings'
import { computePanelNormals } from './panel-normals'
import type { MulticolorRequest, MulticolorResponse } from './multicolor.worker'

function indexedBevel(): MulticolorResult {
  return {
    parts: [
      {
        materialId: 'base',
        positions: new Float32Array([
          0, 0, 4, 2, 0, 4, 2, 1, 4, 0, 1, 4, 2.1, 0, 3.98, 2.1, 1, 3.98, 2.1,
          0, 0.5, 2.1, 1, 0.5,
        ]),
        indices: new Uint32Array([
          0, 1, 2, 0, 2, 3, 1, 4, 5, 1, 5, 2, 4, 6, 7, 4, 7, 5,
        ]),
        volume: 7,
        elementIds: ['stripe-1'],
      },
    ],
    diagnostics: ['Prepared fixture'],
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('worker-prepared multicolor meshes', () => {
  it('retains printable indices and existing bevel shading through transfer', () => {
    const source = indexedBevel()
    const expected = new BufferGeometry()
    expected.setAttribute(
      'position',
      new BufferAttribute(source.parts[0].positions.slice(), 3),
    )
    expected.setIndex(new BufferAttribute(source.parts[0].indices.slice(), 1))
    expected.computeVertexNormals()
    const expectedPreview = computePanelNormals(expected)
    expected.computeBoundingBox()
    expected.computeBoundingSphere()
    const prepared = prepareMulticolorResult(
      source,
      getDefaultMulticolorSettings(),
    )
    const transferred = structuredClone(prepared, {
      transfer: multicolorTransferList(prepared),
    })
    const part = transferred.parts[0]
    const geometry = deserializeGeometry(part.geometry)
    const preview = deserializeGeometry(part.previewGeometry)

    expect(source.parts[0].positions.byteLength).toBe(0)
    expect(geometry.index?.array).toEqual(expected.index!.array)
    expect(geometry.getAttribute('position').array).toEqual(
      expected.getAttribute('position').array,
    )
    expect(geometry.getAttribute('normal').array).toEqual(
      expected.getAttribute('normal').array,
    )
    expect(preview.index).toBeNull()
    expect(preview.getAttribute('position').array).toEqual(
      expectedPreview.getAttribute('position').array,
    )
    expect(preview.getAttribute('normal').array).toEqual(
      expectedPreview.getAttribute('normal').array,
    )
    expect(geometry.boundingBox).toEqual(expected.boundingBox)
    expect(geometry.boundingSphere).toEqual(expected.boundingSphere)
    expect(part.elementIds).toEqual(['stripe-1'])
    expect(part.volume).toBe(7)
    expect(transferred.diagnostics).toEqual(['Prepared fixture'])
    geometry.dispose()
    preview.dispose()
    expected.dispose()
    expectedPreview.dispose()
  })

  it('transfers shared buffers only once', () => {
    const prepared = prepareMulticolorResult(
      indexedBevel(),
      getDefaultMulticolorSettings(),
    )
    prepared.parts.push({ ...prepared.parts[0], materialId: 'second' })
    const transfer = multicolorTransferList(prepared)
    expect(new Set(transfer).size).toBe(transfer.length)
    expect(() => structuredClone(prepared, { transfer })).not.toThrow()
  })

  it('receives worker results without scanning vertices or recomputing normals', async () => {
    const settings = getDefaultMulticolorSettings()
    const source = indexedBevel()
    const panel = new BufferGeometry()
    panel.setAttribute(
      'position',
      new BufferAttribute(source.parts[0].positions.slice(), 3),
    )
    panel.setIndex(new BufferAttribute(source.parts[0].indices.slice(), 1))
    const prepared = prepareMulticolorResult(source, settings)
    class PreparedWorker {
      onmessage?: (event: MessageEvent<MulticolorResponse>) => void
      postMessage(request: MulticolorRequest) {
        queueMicrotask(() =>
          this.onmessage?.({
            data: { id: request.id, result: prepared },
          } as MessageEvent<MulticolorResponse>),
        )
      }
    }
    vi.stubGlobal('Worker', PreparedWorker)
    const unexpectedWork = () => {
      throw new Error('Mesh preparation must finish in the worker.')
    }
    vi.spyOn(
      BufferGeometry.prototype,
      'computeVertexNormals',
    ).mockImplementation(unexpectedWork)
    vi.spyOn(BufferGeometry.prototype, 'computeBoundingBox').mockImplementation(
      unexpectedWork,
    )
    vi.spyOn(
      BufferGeometry.prototype,
      'computeBoundingSphere',
    ).mockImplementation(unexpectedWork)
    const result = await buildMulticolorGeometry(panel, settings)
    const part = result.parts[0]
    expect(part.geometry.getAttribute('position').array).toBe(
      prepared.parts[0].geometry.positions,
    )
    expect(part.previewGeometry!.getAttribute('normal').array).toBe(
      prepared.parts[0].previewGeometry.normals,
    )
    expect(part.geometry.userData.multicolorSourceUuid).toBe(panel.uuid)
    expect(part.previewGeometry!.userData).toEqual(part.geometry.userData)
    expect(panel.getAttribute('position').array.byteLength).toBeGreaterThan(0)
    part.geometry.dispose()
    part.previewGeometry!.dispose()
    panel.dispose()
  })
})
