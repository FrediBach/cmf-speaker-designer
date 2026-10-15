import { BufferGeometry, Mesh } from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { STLExporter } from 'three/addons/exporters/STLExporter.js'
import originalAsset from '../../resources/stl-files/cmf-speaker-sm-3d-printing-power-button-original-v1.stl?url'

/**
 * Keep the supplied cap, keyed mounting flange, and actuator unchanged.
 * Its face points down in the original STL: translate it onto the print bed,
 * retaining the shaft's XY origin instead of centering the asymmetric flange.
 * Dimensions and all coordinates remain in millimeters.
 */
export function parsePowerButtonGeometry(data: ArrayBuffer): BufferGeometry {
  const geometry = new STLLoader().parse(data)
  geometry.computeBoundingBox()
  const bounds = geometry.boundingBox!
  if (
    !geometry.getAttribute('position').count ||
    ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)
  ) {
    geometry.dispose()
    throw new Error('The power button is missing from its source file.')
  }
  geometry.translate(0, 0, -bounds.min.z)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

let source: Promise<BufferGeometry> | undefined

/** Shared loads are cached; each caller owns and disposes its returned clone. */
export async function loadPowerButtonGeometry(
  signal?: AbortSignal,
): Promise<BufferGeometry> {
  signal?.throwIfAborted()
  if (!source) {
    source = fetch(originalAsset)
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            `Unable to load the power button (${response.status}).`,
          )
        return parsePowerButtonGeometry(await response.arrayBuffer())
      })
      .catch((error: unknown) => {
        source = undefined
        throw error
      })
  }
  // Cancelling a caller must not cancel another preview's shared source load.
  const geometry = await source
  signal?.throwIfAborted()
  return geometry.clone()
}

export function preparePowerButtonExportGeometry(
  geometry: BufferGeometry,
): BufferGeometry {
  const printable = geometry.clone()
  printable.computeBoundingBox()
  printable.translate(0, 0, -printable.boundingBox!.min.z)
  printable.computeBoundingBox()
  return printable
}

export function exportPowerButtonStl(geometry: BufferGeometry): ArrayBuffer {
  const printable = preparePowerButtonExportGeometry(geometry)
  const mesh = new Mesh(printable)
  mesh.updateMatrixWorld(true)
  const binary = new STLExporter().parse(mesh, { binary: true })
  const result = new ArrayBuffer(binary.byteLength)
  new Uint8Array(result).set(
    new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength),
  )
  printable.dispose()
  return result
}

export function powerButtonFilename(): string {
  return 'cmf-speaker-power-button-original.stl'
}
