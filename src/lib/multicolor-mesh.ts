import { BufferAttribute, BufferGeometry } from 'three'
import {
  geometryTransferList,
  serializeGeometry,
  type SerializedGeometry,
} from './geometry-transfer'
import {
  patternGeometryKey,
  type MulticolorMesh,
  type MulticolorResult,
} from './multicolor-geometry'
import type { MulticolorSettings } from './multicolor-settings'
import { computePanelNormals } from './panel-normals'

export interface PreparedMulticolorResult {
  parts: {
    materialId: string
    panelPart?: 'front' | 'upper'
    geometry: SerializedGeometry
    previewGeometry: SerializedGeometry
    volume: number
    elementIds: string[]
  }[]
  diagnostics: string[]
}

/** Keep physical part identity through color partitioning, in assembly coordinates. */
export function prepareMulticolorPanelResult(
  build: (
    mesh: MulticolorMesh,
    settings: MulticolorSettings,
  ) => MulticolorResult,
  mesh: MulticolorMesh,
  settings: MulticolorSettings,
  upperMesh?: MulticolorMesh,
): PreparedMulticolorResult {
  const front = prepareMulticolorResult(build(mesh, settings), settings)
  if (!upperMesh) return front
  const upper = prepareMulticolorResult(build(upperMesh, settings), settings)
  return {
    parts: [
      ...front.parts.map((part) => ({ ...part, panelPart: 'front' as const })),
      ...upper.parts.map((part) => ({ ...part, panelPart: 'upper' as const })),
    ],
    diagnostics: [...new Set([...front.diagnostics, ...upper.diagnostics])],
  }
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
