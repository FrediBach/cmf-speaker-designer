import { BufferAttribute, BufferGeometry } from 'three'
import {
  geometryTransferList,
  serializeGeometry,
  type SerializedGeometry,
} from './geometry-transfer'
import {
  patternGeometryKey,
  type MulticolorResult,
} from './multicolor-geometry'
import type { MulticolorSettings } from './multicolor-settings'
import { computePanelNormals } from './panel-normals'

export interface PreparedMulticolorResult {
  parts: {
    materialId: string
    geometry: SerializedGeometry
    previewGeometry: SerializedGeometry
    volume: number
    elementIds: string[]
  }[]
  diagnostics: string[]
}

/** Finish both printable topology and display normals before leaving the worker. */
export function prepareMulticolorResult(
  result: MulticolorResult,
  settings: MulticolorSettings,
): PreparedMulticolorResult {
  const key = patternGeometryKey(settings)
  return {
    parts: result.parts.map(
      ({ materialId, positions, indices, volume, elementIds }) => {
        const geometry = new BufferGeometry()
        geometry.setAttribute('position', new BufferAttribute(positions, 3))
        geometry.setIndex(new BufferAttribute(indices, 1))
        geometry.computeVertexNormals()
        geometry.userData.multicolorKey = key
        const previewGeometry = computePanelNormals(geometry)
        previewGeometry.userData.multicolorKey = key
        return {
          materialId,
          geometry: serializeGeometry(geometry),
          previewGeometry: serializeGeometry(previewGeometry),
          volume,
          elementIds,
        }
      },
    ),
    diagnostics: result.diagnostics,
  }
}

export function multicolorTransferList(
  result: PreparedMulticolorResult,
): ArrayBuffer[] {
  return [
    ...new Set(
      result.parts.flatMap(({ geometry, previewGeometry }) => [
        ...geometryTransferList(geometry),
        ...geometryTransferList(previewGeometry),
      ]),
    ),
  ]
}
