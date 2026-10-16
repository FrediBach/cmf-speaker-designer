import { Box3, BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three'

type Point = [number, number, number]

/** Prepared mesh data: receiving a worker result never needs a vertex scan. */
export interface SerializedGeometry {
  positions: Float32Array
  normals?: Float32Array
  indices?: Uint16Array | Uint32Array
  boundingBox: { min: Point; max: Point }
  boundingSphere: { center: Point; radius: number }
  userData: BufferGeometry['userData']
}

/** Borrows arrays; transfer only an owned geometry, never a cached source. */
export function serializeGeometry(
  geometry: BufferGeometry,
): SerializedGeometry {
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  if (!geometry.boundingSphere) geometry.computeBoundingSphere()
  return {
    positions: geometry.getAttribute('position').array as Float32Array,
    normals: geometry.getAttribute('normal')?.array as Float32Array | undefined,
    indices: geometry.index?.array as Uint16Array | Uint32Array | undefined,
    boundingBox: {
      min: geometry.boundingBox!.min.toArray(),
      max: geometry.boundingBox!.max.toArray(),
    },
    boundingSphere: {
      center: geometry.boundingSphere!.center.toArray(),
      radius: geometry.boundingSphere!.radius,
    },
    userData: geometry.userData,
  }
}

export function deserializeGeometry(data: SerializedGeometry): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3))
  if (data.normals)
    geometry.setAttribute('normal', new BufferAttribute(data.normals, 3))
  if (data.indices) geometry.setIndex(new BufferAttribute(data.indices, 1))
  geometry.boundingBox = new Box3(
    new Vector3(...data.boundingBox.min),
    new Vector3(...data.boundingBox.max),
  )
  geometry.boundingSphere = new Sphere(
    new Vector3(...data.boundingSphere.center),
    data.boundingSphere.radius,
  )
  geometry.userData = data.userData
  return geometry
}

export function geometryTransferList(data: SerializedGeometry): ArrayBuffer[] {
  return [
    ...new Set(
      [
        data.positions,
        data.normals,
        data.indices,
        data.userData.split?.frontPositions as Float32Array | undefined,
        data.userData.split?.upperPositions as Float32Array | undefined,
      ]
        .filter((array) => array !== undefined)
        .map((array) => array.buffer as ArrayBuffer),
    ),
  ]
}
