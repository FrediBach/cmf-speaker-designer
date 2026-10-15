import { BufferAttribute, BufferGeometry } from 'three'
import { computePanelNormals } from './panel-normals'
import type { GeneratedPanel } from './panel-engine'
import type { HandleWorkerRequest } from './handles'

/** Complete the printable mesh in the worker, including expensive smoothing. */
export function preparePanelGeometry(
  result: GeneratedPanel,
  request: Omit<HandleWorkerRequest, 'id'>,
): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(result.positions, 3))
  geometry.userData = {
    model: request.model,
    style: request.style,
    addedFaceDepth: request.relief,
    panelExtension: request.panelExtension,
    panelGap: request.panelGap,
    units: 'mm',
  }
  for (const key of ['handle', 'grille', 'halo', 'gap', 'raceStripes'] as const)
    if (result[key]) geometry.userData[key] = result[key]
  computePanelNormals(geometry)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
